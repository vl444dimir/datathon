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

await mkdir(new URL('data/', publicDir), { recursive: true });
await mkdir(new URL('materials/', publicDir), { recursive: true });
await writeFile(new URL('data/households.json', publicDir), `${JSON.stringify(data, null, 2)}\n`);
await copyFile(
  new URL('submission/StatDatathon.pdf', root),
  new URL('materials/StatDatathon.pdf', publicDir),
);
console.log(`Prepared ${data.years.length} years and presentation in ${fileURLToPath(publicDir)}`);
