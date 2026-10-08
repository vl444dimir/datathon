"""Logistic model of housing crowding (total area below 15 m² per person).

Question: do children raise the risk of crowding once income, region,
settlement type, dwelling type and tenure are held fixed?

Data: synthetic D006 + D008 + D004 for 2022–2024 (2021 has no birth years).
Unweighted; household rows from different years are pooled with year
effects. Synthetic data roughly halve associations (data-guide.Rmd), so
effects here are best read as lower bounds.

Requires pandas and statsmodels (see requirements.txt). Writes
model_results.json.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from analysis_households import (
    CROWDING_THRESHOLD, REGIONS, ROOT, as_positive_float, load_income, read_rows,
)

OUT = Path(__file__).parent / "model_results.json"
YEARS = (2022, 2023, 2024)
TENURE = {"1": "own", "2": "own", "3": "free", "4": "rent", "5": "free", "6": "rent", "7": "state"}
DWELLING = {"1": "house", "2": "house", "3": "house", "4": "apartment", "5": "apartment"}


def household_rows(year: int):
    dwellings = {row["NOMER"]: row for row in read_rows(next((ROOT / "d006" / str(year)).glob("*.csv")))}
    roster = {}
    for row in read_rows(ROOT / "d008" / str(year) / "kontr_k.csv"):
        roster.setdefault(row["NOMER"], []).append(row)
    income = load_income(year)
    for key, members in roster.items():
        dwelling, budget = dwellings.get(key), income.get(key)
        if dwelling is None or budget is None:
            continue
        total = as_positive_float(dwelling["OB_PL"])
        living = as_positive_float(dwelling["J_PL"])
        if total is None or (living is not None and living > total):
            continue
        births = [int(m["GOD_ROJD"]) for m in members if m["GOD_ROJD"].isdigit()]
        if len(births) != len(members):
            continue
        children = sum(year - birth < 18 for birth in births)
        yield {
            "year": year,
            "crowded": int(total / len(members) < CROWDING_THRESHOLD),
            "log_area": math.log(total),
            "children": str(min(children, 4)) if children < 4 else "4+",
            "adults": min(len(members) - children, 5),
            "income_month": budget["monthly"],
            "region": dwelling["TE"],
            "urban": int(dwelling["K"] == "1"),
            "dwelling": DWELLING.get(dwelling["TIP_J"], "other"),
            "tenure": TENURE.get(dwelling["VLAD1"], "other"),
        }


def odds_table(result, prefix):
    table = {}
    conf = result.conf_int()
    for name in result.params.index:
        if name.startswith(prefix):
            table[name] = {
                "odds_ratio": round(math.exp(result.params[name]), 3),
                "ci95": [round(math.exp(conf.loc[name, 0]), 3), round(math.exp(conf.loc[name, 1]), 3)],
                "p_value": float(f"{result.pvalues[name]:.3g}"),
            }
    return table


def main():
    frame = pd.DataFrame([row for year in YEARS for row in household_rows(year)])
    # Households need some money income (log) and at least one adult (one child-only household).
    frame = frame[(frame["income_month"] > 0) & (frame["adults"] > 0)].copy()
    frame["log_income"] = np.log(frame["income_month"])
    # Reference levels first; levels with no households are dropped to keep the design full rank.
    frame["dwelling"] = pd.Categorical(frame["dwelling"], ["apartment", "house", "other"]).remove_unused_categories()
    frame["tenure"] = pd.Categorical(frame["tenure"], ["own", "rent", "free", "state", "other"]).remove_unused_categories()

    children = "C(children, Treatment('0'))"
    formulas = {
        "children_only": f"crowded ~ {children} + C(year)",
        "full": f"crowded ~ {children} + log_income + C(adults) + urban + dwelling + tenure + C(region) + C(year)",
    }
    models = {}
    fitted = {}
    for name, formula in formulas.items():
        result = smf.logit(formula, data=frame).fit(disp=False, cov_type="HC1", maxiter=200)
        if not result.mle_retvals["converged"]:
            raise RuntimeError(f"{name} model did not converge")
        fitted[name] = result
        models[name] = {
            "formula": formula,
            "households": int(result.nobs),
            "pseudo_r2": round(result.prsquared, 3),
            "children_odds_ratios": odds_table(result, "C(children"),
        }

    full = fitted["full"]
    models["full"]["income_odds_ratio_per_doubling"] = round(math.exp(full.params["log_income"] * math.log(2)), 3)
    models["full"]["other_odds_ratios"] = odds_table(full, "urban") | odds_table(full, "dwelling") | odds_table(full, "tenure")
    margins = full.get_margeff(at="overall").summary_frame()
    models["full"]["average_marginal_effects_pp"] = {
        name: round(row["dy/dx"] * 100, 1)
        for name, row in margins.iterrows() if name.startswith("C(children") or name in ("log_income", "urban")
    }

    # Mechanism: how much larger is the dwelling for each extra child?
    # OLS of log total area; exp(b) - 1 is the % difference in area.
    area = smf.ols(
        f"log_area ~ {children} + log_income + C(adults) + urban + dwelling + tenure + C(region) + C(year)",
        data=frame,
    ).fit(cov_type="HC1")
    area_conf = area.conf_int()
    models["dwelling_area"] = {
        "formula": area.model.formula,
        "households": int(area.nobs),
        "r2": round(area.rsquared, 3),
        "area_difference_pct_vs_no_children": {
            name: {
                "pct": round((math.exp(area.params[name]) - 1) * 100, 1),
                "ci95": [round((math.exp(area_conf.loc[name, 0]) - 1) * 100, 1), round((math.exp(area_conf.loc[name, 1]) - 1) * 100, 1)],
            } for name in area.params.index if name.startswith("C(children")
        },
        "area_difference_pct_per_income_doubling": round((2 ** area.params["log_income"] - 1) * 100, 1),
        "needed_to_keep_area_per_person_pct": {
            # A two-adult home needs (2 + c) / 2 times the area to keep m² per person.
            label: round(((2 + count) / 2 - 1) * 100) for label, count in (("1", 1), ("2", 2), ("3", 3), ("4+", 4))
        },
    }

    # Predicted probability for a typical urban two-adult family in an owned
    # apartment at the sample median income, by number of children.
    base = {
        "adults": 2, "urban": 1, "dwelling": "apartment", "tenure": "own",
        "region": frame["region"].mode()[0], "year": max(YEARS),
        "log_income": float(np.log(frame["income_month"].median())),
    }
    # Average over regions so the profile does not depend on one region.
    predictions = {}
    for children_value in ["0", "1", "2", "3", "4+"]:
        rows = pd.DataFrame([{**base, "children": children_value, "region": r} for r in sorted(frame["region"].unique())])
        rows["dwelling"] = pd.Categorical(rows["dwelling"], frame["dwelling"].cat.categories)
        rows["tenure"] = pd.Categorical(rows["tenure"], frame["tenure"].cat.categories)
        predictions[children_value] = round(float(full.predict(rows).mean()) * 100, 1)

    result = {
        "scope": "Synthetic survey microdata 2022–2024, pooled, unweighted; HC1 robust standard errors",
        "outcome": f"Total area per person below {CROWDING_THRESHOLD} m²",
        "caveat": "Synthesis roughly halves associations between variables; treat effects as lower bounds",
        "sample": {
            "households": int(len(frame)),
            "crowded_share": round(float(frame["crowded"].mean()), 4),
            "median_household_income_month_kzt": round(float(frame["income_month"].median())),
        },
        "models": models,
        "predicted_crowding_pct_by_children": {
            "profile": "urban, two adults, owned apartment, median household income, averaged over regions, 2024",
            "values": predictions,
        },
        "regions": REGIONS,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("sample", "predicted_crowding_pct_by_children")}, ensure_ascii=False, indent=2))
    for name, model in ((n, models[n]) for n in formulas):
        print(name, model["households"], model["pseudo_r2"])
        for term, values in model["children_odds_ratios"].items():
            print("  ", term, values)
    print("income OR per doubling", models["full"]["income_odds_ratio_per_doubling"])
    print("other", models["full"]["other_odds_ratios"])
    print("AME pp", models["full"]["average_marginal_effects_pp"])
    print("area", models["dwelling_area"]["area_difference_pct_vs_no_children"], models["dwelling_area"]["area_difference_pct_per_income_doubling"], models["dwelling_area"]["r2"])


if __name__ == "__main__":
    main()
