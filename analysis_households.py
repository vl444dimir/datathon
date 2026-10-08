"""Reproducible descriptive statistics for the StatDatathon screening slides.

Uses the synthetic D006 dwelling, D008 roster and D004 budget tables
(kv_vopr0 participation, kv_vopr11 incomes). Outputs sample statistics,
not population estimates.
"""

from __future__ import annotations

import csv
import json
import statistics
import math
import re
from decimal import Decimal, ROUND_HALF_UP
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).parent / "synthetic_microdata_2021-2024_20260921"
OUT = Path(__file__).parent / "households_summary.json"

# TE has no codebook in documentation/; the codes match the two-digit KATO
# region codes (Abai, Zhetysu and Ulytau appear from 2022, as in KATO).
# K: only 1 occurs in the three cities of republican significance, so 1 = urban.
REGIONS = {
    "10": "Абайская", "11": "Акмолинская", "15": "Актюбинская", "19": "Алматинская",
    "23": "Атырауская", "27": "Западно-Казахстанская", "31": "Жамбылская",
    "33": "Жетысуская", "35": "Карагандинская", "39": "Костанайская",
    "43": "Кызылординская", "47": "Мангистауская", "55": "Павлодарская",
    "59": "Северо-Казахстанская", "61": "Туркестанская", "62": "Улытауская",
    "63": "Восточно-Казахстанская", "71": "г. Астана", "75": "г. Алматы", "79": "г. Шымкент",
}
LOCALITIES = {"1": "город", "2": "село"}
AREA_BIN_CAP = 26  # total m² per person, floored; the last bin means 26 and more
CROWDING_THRESHOLD = 15  # m² per person, lower bound of the state housing norm (15–18 m²)

# D004 section 3 "Доходы": GR1–GR23 follow the rows of the questionnaire.
INCOME_ITEMS = {
    1: "работа по найму", 2: "работа не по найму", 3: "из него продажа сельхозпродукции",
    4: "пенсии по возрасту", 5: "стипендии", 6: "адресная социальная помощь",
    7: "жилищная помощь", 8: "пособия семьям с детьми", 9: "государственное социальное пособие",
    10: "специальное государственное пособие", 11: "другие трансферты от государства",
    12: "социальные трансферты в натуральной форме", 13: "материальная помощь в денежной форме",
    14: "материальная помощь в натуральной форме", 15: "прочие трансферты", 16: "алименты",
    17: "продажа недвижимости", 18: "продажа личного имущества", 19: "доход от собственности",
    20: "сдача жилья в аренду", 21: "сдача в аренду земли и техники",
    22: "прочие денежные поступления", 23: "дотации и льготы",
}
# Money income: excludes GR3 (already inside GR2), in-kind items (12, 14, 23)
# and asset sales (17, 18), which are not income.
MONEY_INCOME_ITEMS = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 19, 20, 21, 22]
PROGRAMMES = {"housing_assistance": 7, "targeted_social_assistance": 6, "child_benefits": 8}


def read_rows(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def as_positive_float(value: str):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result > 0 else None


def median(values):
    return float(Decimal(str(statistics.median(values))).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)) if values else None


def as_number(value: str):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if math.isfinite(result) else 0.0


def load_income(year: int):
    """Mean quarterly money income per household over the quarters it took part in."""
    quarters = defaultdict(set)
    totals = defaultdict(float)
    programmes = defaultdict(set)
    for folder in sorted((ROOT / "d004" / str(year)).iterdir()):
        for row in read_rows(folder / "kv_vopr0.csv"):
            if row["REZ"] == "1":
                quarters[row["NOMER"]].add(folder.name)
        for row in read_rows(folder / "kv_vopr11.csv"):
            if folder.name not in quarters[row["NOMER"]]:
                continue
            totals[row["NOMER"]] += sum(as_number(row[f"GR{item}"]) for item in MONEY_INCOME_ITEMS)
            for name, item in PROGRAMMES.items():
                if as_number(row[f"GR{item}"]) > 0:
                    programmes[row["NOMER"]].add(name)
    return {
        key: {"monthly": totals[key] / len(done) / 3, "quarters": len(done), "programmes": programmes[key]}
        for key, done in quarters.items() if done
    }


def quantile_bounds(values, parts=5):
    ordered = sorted(values)
    return [ordered[min(len(ordered) - 1, math.ceil(len(ordered) * i / parts) - 1)] for i in range(1, parts)]


def share(part, whole):
    return round(part / whole, 4) if whole else None


def analyse_year(year: int):
    d006 = next((ROOT / "d006" / str(year)).glob("*.csv"))
    d008 = ROOT / "d008" / str(year) / "kontr_k.csv"
    dwellings = {}
    duplicate_dwelling_keys = 0
    for row in read_rows(d006):
        key = row["NOMER"]
        if key in dwellings:
            duplicate_dwelling_keys += 1
        else:
            dwellings[key] = row

    roster = defaultdict(list)
    duplicate_person_keys = 0
    person_keys = set()
    for row in read_rows(d008):
        key = (row["NOMER"], row["NOMP"])
        if key in person_keys:
            duplicate_person_keys += 1
        person_keys.add(key)
        roster[row["NOMER"]].append(row)

    size_distribution = Counter()
    persons = 0
    size_mismatches = 0
    area_by_size = defaultdict(list)
    total_area_by_size = defaultdict(list)
    living_area_by_size = defaultdict(list)
    all_area_per_person = []
    inconsistent_area_households = 0
    income = load_income(year)
    records = []
    valid_birth_years = 0
    children = 0
    households_with_child = 0
    for key, members in roster.items():
        size = len(members)
        persons += size
        size_distribution[str(size if size < 5 else "5+")] += 1
        reported_sizes = {r["KOL_CHL"] for r in members}
        if reported_sizes != {str(size)}:
            size_mismatches += 1

        has_child = False
        household_children = 0
        household_births = 0
        for member in members:
            birth = member.get("GOD_ROJD", "")
            if birth.isdigit() and 1900 <= int(birth) <= year:
                valid_birth_years += 1
                household_births += 1
                if year - int(birth) < 18:
                    children += 1
                    household_children += 1
                    has_child = True
        households_with_child += has_child

        dwelling = dwellings.get(key)
        if dwelling is None:
            continue
        total = as_positive_float(dwelling.get("OB_PL", ""))
        living = as_positive_float(dwelling.get("J_PL", ""))
        if total is not None and living is not None and living > total:
            inconsistent_area_households += 1
            continue
        group = str(size if size < 5 else "5+")
        if total is not None:
            total_area_by_size[group].append(total)
            area_by_size[group].append(total / size)
            all_area_per_person.append(total / size)
            # Children bucket 0-4 (4 = four or more, "многодетная" in Kazakhstan);
            # None when the household has no usable birth years (all of 2021).
            child_bucket = min(household_children, 4) if household_births else None
            budget = income.get(key)
            records.append({
                "region": dwelling["TE"], "locality": dwelling["K"], "children": child_bucket,
                "area_per_person": total / size,
                "income_per_capita": budget["monthly"] / size if budget else None,
                "programmes": budget["programmes"] if budget else set(),
            })
        if living is not None:
            living_area_by_size[group].append(living / size)

    # Income quintiles of monthly money income per capita among households with valid area.
    bounds = quantile_bounds([r["income_per_capita"] for r in records if r["income_per_capita"] is not None])
    crowding_cells = Counter()
    by_quintile = defaultdict(Counter)
    reach = defaultdict(Counter)
    for record in records:
        pc = record["income_per_capita"]
        record["quintile"] = None if pc is None else 1 + sum(pc > bound for bound in bounds)
        crowded = record["area_per_person"] < CROWDING_THRESHOLD
        area_bin = min(math.floor(record["area_per_person"]), AREA_BIN_CAP)
        crowding_cells[(record["region"], record["locality"], record["children"], record["quintile"], area_bin)] += 1
        if record["quintile"] is not None:
            for group in ("all", "with_children") if record["children"] else ("all",):
                by_quintile[(group, record["quintile"])]["households"] += 1
                by_quintile[(group, record["quintile"])]["crowded"] += crowded
        groups = ["all"]
        if crowded:
            groups.append("crowded")
            if record["quintile"] in (1, 2):
                groups.append("crowded_low_income")
        for group in groups:
            reach[group]["households"] += 1
            for name in PROGRAMMES:
                reach[group][name] += name in record["programmes"]
    income_values = [r["income_per_capita"] for r in records if r["income_per_capita"] is not None]

    return {
        "year": year,
        "source_files": [str(d006.relative_to(ROOT)), str(d008.relative_to(ROOT))],
        "dwelling_rows": len(dwellings),
        "roster_households": len(roster),
        "roster_person_rows": persons,
        "dwellings_linked_to_roster": len(dwellings.keys() & roster.keys()),
        "roster_linked_to_dwellings": len(roster.keys() & dwellings.keys()),
        "duplicate_dwelling_keys": duplicate_dwelling_keys,
        "duplicate_person_keys": duplicate_person_keys,
        "household_size_mismatches": size_mismatches,
        "size_distribution": dict(sorted(size_distribution.items())),
        "median_household_size": median([len(x) for x in roster.values()]),
        "mean_household_size": round(persons / len(roster), 2),
        "valid_birth_years": valid_birth_years,
        "age_reference": f"31 December {year}; year minus birth year",
        "children_under_18": children if valid_birth_years else None,
        "households_with_child": households_with_child if valid_birth_years else None,
        "inconsistent_area_households_excluded": inconsistent_area_households,
        "area_valid_households": len(all_area_per_person),
        "median_total_area_per_person_m2": median(all_area_per_person),
        "median_total_area_per_person_by_size_m2": {
            group: median(values) for group, values in sorted(area_by_size.items())
        },
        "median_total_area_by_size_m2": {
            group: median(values) for group, values in sorted(total_area_by_size.items())
        },
        "area_valid_by_size": {group: len(values) for group, values in sorted(area_by_size.items())},
        "median_living_area_per_person_by_size_m2": {
            group: median(values) for group, values in sorted(living_area_by_size.items())
        },
        "income_valid_households": len(income_values),
        "median_money_income_per_capita_month_kzt": median(income_values),
        "income_quintile_upper_bounds_kzt": [round(bound) for bound in bounds],
        f"crowded_below_{CROWDING_THRESHOLD}_by_income_quintile": {
            group: {
                str(q): {
                    "households": by_quintile[(group, q)]["households"],
                    "crowded": by_quintile[(group, q)]["crowded"],
                    "share": share(by_quintile[(group, q)]["crowded"], by_quintile[(group, q)]["households"]),
                } for q in range(1, 6)
            } for group in ("all", "with_children")
        },
        "programme_reach": {
            group: {"households": counts["households"], **{
                name: share(counts[name], counts["households"]) for name in PROGRAMMES
            }} for group, counts in reach.items()
        },
        "crowding_cells_columns": ["region", "locality", "children", "income_quintile", "area_per_person_bin", "households"],
        "crowding_cells": [
            [*cell, count]
            for cell, count in sorted(
                crowding_cells.items(),
                key=lambda item: tuple(-1 if value is None else value for value in item[0]),
            )
        ],
    }


def main():
    result = {
        "scope": "Synthetic survey microdata; unweighted sample statistics",
        "regions": REGIONS,
        "regions_note": "TE decoded by two-digit KATO region codes; no TE codebook in the supplied documentation",
        "localities": LOCALITIES,
        "area_bin_note": f"Total area per person floored to whole m²; bin {AREA_BIN_CAP} means {AREA_BIN_CAP} m² and more",
        "income_note": "Monthly money income per capita from D004 kv_vopr11: mean over quarters with REZ=1, divided by 3 and by the D008 household size; quintiles are unweighted within each year's households with valid area",
        "income_items": {str(k): v for k, v in INCOME_ITEMS.items()},
        "money_income_items": MONEY_INCOME_ITEMS,
        "years": [analyse_year(year) for year in range(2021, 2025)],
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    # Keep flat arrays (crowding cells, file lists) on one line each.
    text = re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text)
    OUT.write_text(text, encoding="utf-8")
    for year in result["years"]:
        print(f"{year['year']}: {year['roster_households']} households, "
              f"{year['area_valid_households']} with valid area, "
              f"{year['income_valid_households']} with income, "
              f"median income per capita {year['median_money_income_per_capita_month_kzt']} KZT/month, "
              f"{len(year['crowding_cells'])} crowding cells")
    print(f"Wrote {OUT.name}")


if __name__ == "__main__":
    main()
