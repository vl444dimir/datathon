"""Reproducible descriptive statistics for the StatDatathon screening slides.

Uses only the supplied synthetic D006 dwelling and D008 roster tables.
Outputs sample statistics, not population estimates.
"""

from __future__ import annotations

import csv
import json
import statistics
import math
from decimal import Decimal, ROUND_HALF_UP
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).parent / "synthetic_microdata_2021-2024_20260921"
OUT = Path(__file__).parent / "households_summary.json"


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
        for member in members:
            birth = member.get("GOD_ROJD", "")
            if birth.isdigit() and 1900 <= int(birth) <= year:
                valid_birth_years += 1
                if year - int(birth) < 18:
                    children += 1
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
    }


def main():
    result = {
        "scope": "Synthetic survey microdata; unweighted sample statistics",
        "years": [analyse_year(year) for year in range(2021, 2025)],
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
