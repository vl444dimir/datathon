import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const publicDir = new URL('web/public/', root);
const summary = JSON.parse(await readFile(new URL('households_summary.json', root), 'utf8'));

// Publish only the aggregate fields that the page uses.
const fields = [
  'year', 'roster_households', 'roster_person_rows', 'size_distribution',
  'households_with_child', 'roster_linked_to_dwellings',
  'inconsistent_area_households_excluded', 'area_valid_households',
  'area_valid_by_size', 'median_total_area_per_person_by_size_m2',
  'median_living_area_per_person_by_size_m2',
];
const data = {
  scope: summary.scope,
  years: summary.years.map((year) => Object.fromEntries(fields.map((field) => {
    if (!(field in year)) throw new Error(`Missing ${field} in ${year.year}`);
    return [field, year[field]];
  }))),
};

// Region × locality × children × area-per-person counts for the map and the calculator.
for (const field of ['regions', 'regions_note', 'localities', 'area_bin_note']) {
  if (!(field in summary)) throw new Error(`Missing ${field} in summary`);
}
const regions = {
  scope: summary.scope,
  regions: summary.regions,
  regions_note: summary.regions_note,
  localities: summary.localities,
  area_bin_note: summary.area_bin_note,
  years: summary.years.map((year) => {
    for (const field of ['crowding_cells_columns', 'crowding_cells']) {
      if (!(field in year)) throw new Error(`Missing ${field} in ${year.year}`);
    }
    return { year: year.year, columns: year.crowding_cells_columns, cells: year.crowding_cells };
  }),
};

// Model results and policy figures for the "Модель и рекомендации" section.
const modelResults = JSON.parse(await readFile(new URL('model_results.json', root), 'utf8'));
const { full, dwelling_area: area } = modelResults.models;
const childKey = (label) => `C(children, Treatment('0'))[T.${label}]`;
const childLabels = ['1', '2', '3', '4+'];
const latest = summary.years.at(-1);
for (const field of ['programme_reach', 'crowded_below_15_by_income_quintile']) {
  if (!(field in latest)) throw new Error(`Missing ${field} in ${latest.year}`);
}
const model = {
  scope: modelResults.scope,
  outcome: modelResults.outcome,
  caveat: modelResults.caveat,
  sample: modelResults.sample,
  predicted: modelResults.predicted_crowding_pct_by_children,
  children: childLabels.map((label) => ({
    label,
    odds_ratio: full.children_odds_ratios[childKey(label)],
    marginal_effect_pp: full.average_marginal_effects_pp[childKey(label)],
    area_difference: area.area_difference_pct_vs_no_children[childKey(label)],
    area_needed_pct: area.needed_to_keep_area_per_person_pct[label],
  })),
  // AME of log income × ln 2 = percentage-point change for a doubling of household income.
  income_effect_pp_per_doubling: Math.round(full.average_marginal_effects_pp.log_income * Math.LN2 * 10) / 10,
  area_difference_pct_per_income_doubling: area.area_difference_pct_per_income_doubling,
  house_odds_ratio: full.other_odds_ratios['dwelling[T.house]'],
  pseudo_r2: full.pseudo_r2,
  robustness: modelResults.robustness,
  latest_year: latest.year,
  programme_reach: latest.programme_reach,
  crowded_by_income_quintile: latest.crowded_below_15_by_income_quintile.all,
};

await mkdir(new URL('data/', publicDir), { recursive: true });
await mkdir(new URL('materials/', publicDir), { recursive: true });
await writeFile(new URL('data/households.json', publicDir), `${JSON.stringify(data, null, 2)}\n`);
await writeFile(new URL('data/regions.json', publicDir), `${JSON.stringify(regions)}\n`);
await writeFile(new URL('data/model.json', publicDir), `${JSON.stringify(model, null, 2)}\n`);
await copyFile(
  new URL('submission/StatDatathon.pdf', root),
  new URL('materials/StatDatathon.pdf', publicDir),
);
console.log(`Prepared ${data.years.length} years and presentation in ${fileURLToPath(publicDir)}`);
