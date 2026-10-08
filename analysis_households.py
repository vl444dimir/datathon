"""Reproducible descriptive statistics for the StatDatathon screening slides.

Uses only the supplied synthetic D006 dwelling and D008 roster tables.
Outputs sample statistics, not population estimates.
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
AREA_BIN_CAP = 60  # total m² per person, floored; the last bin means 60 and more


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
    crowding_cells = Counter()
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
            area_bin = min(math.floor(total / size), AREA_BIN_CAP)
            crowding_cells[(dwelling["TE"], dwelling["K"], child_bucket, area_bin)] += 1
        if living is not None:
            living_area_by_size[group].append(living / size)

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
        "crowding_cells_columns": ["region", "locality", "children", "area_per_person_bin", "households"],
        "crowding_cells": [
            [te, k, child, area_bin, count]
            for (te, k, child, area_bin), count in sorted(
                crowding_cells.items(), key=lambda item: (item[0][0], item[0][1], -1 if item[0][2] is None else item[0][2], item[0][3])
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
        "years": [analyse_year(year) for year in range(2021, 2025)],
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    # Keep flat arrays (crowding cells, file lists) on one line each.
    text = re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m.group(1)) + "]", text)
    OUT.write_text(text, encoding="utf-8")
    for year in result["years"]:
        print(f"{year['year']}: {year['roster_households']} households, "
              f"{year['area_valid_households']} with valid area, "
              f"{len(year['crowding_cells'])} crowding cells")
    print(f"Wrote {OUT.name}")


if __name__ == "__main__":
    main()
