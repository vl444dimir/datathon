// Builds web/src/kz-regions.json: SVG paths of the 20 current regions of Kazakhstan
// (17 oblasts and 3 cities, borders after the 2022 reform) from OpenStreetMap.
// Run once with network access: node scripts/build-kz-map.mjs
// Data © OpenStreetMap contributors, ODbL 1.0.
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../web/src/kz-regions.json', import.meta.url);
const HEADERS = { 'User-Agent': 'statdatathon-map-build/1.0 (+https://github.com/vl444dimir/datathon)' };
const CODES = ['10', '11', '15', '19', '23', '27', '31', '33', '35', '39', '43', '47', '55', '59', '61', '62', '63', '71', '75', '79'];
const WIDTH = 1000;
const LAT0 = 48 * Math.PI / 180; // equirectangular projection true at 48°N

async function getJson(url, options = {}, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { ...HEADERS, ...options.headers } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`${error.message}; retry ${attempt}`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

// 1. Region relations. ISO 3166-2:KZ codes are the two-digit KATO codes (KZ-10 … KZ-79).
const query = '[out:json][timeout:90];area["ISO3166-1"="KZ"][admin_level=2]->.kz;'
  + 'rel(area.kz)["boundary"="administrative"]["admin_level"="4"];out tags;';
const overpass = await getJson('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: query }),
});
const relations = {};
for (const element of overpass.elements) {
  const code = (element.tags['ISO3166-2'] || '').replace('KZ-', '');
  if (CODES.includes(code)) relations[code] = element.id;
}
const missing = CODES.filter((code) => !relations[code]);
if (missing.length) {
  console.error(overpass.elements.map((e) => `${e.id} ${e.tags['ISO3166-2']} ${e.tags.name}`).join('\n'));
  throw new Error(`No OSM relation for KATO ${missing.join(', ')}`);
}

// 2. Simplified polygons from Nominatim (≈0.02° tolerance, about 2 km).
const ids = CODES.map((code) => `R${relations[code]}`).join(',');
const places = await getJson(`https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=json&polygon_geojson=1&polygon_threshold=0.02`);
const byId = Object.fromEntries(places.map((place) => [place.osm_id, place]));

const project = ([lon, lat]) => [lon * Math.cos(LAT0), -lat];
const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
const projected = {};
for (const code of CODES) {
  const place = byId[relations[code]];
  if (!place) throw new Error(`Nominatim returned no polygon for KATO ${code}`);
  projected[code] = polygonsOf(place.geojson).map((polygon) => polygon.map((ring) => ring.map(project)));
}

// 3. Fit into WIDTH and write SVG paths plus a label point (centroid of the largest ring).
const points = Object.values(projected).flat(3);
const minX = Math.min(...points.map((p) => p[0]));
const maxX = Math.max(...points.map((p) => p[0]));
const minY = Math.min(...points.map((p) => p[1]));
const maxY = Math.max(...points.map((p) => p[1]));
const scale = WIDTH / (maxX - minX);
const height = Math.ceil((maxY - minY) * scale);
const fit = ([x, y]) => [(x - minX) * scale, (y - minY) * scale];
const round = (value) => Math.round(value * 10) / 10;

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return area / 2;
}
function centroid(ring) {
  let x = 0; let y = 0; let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross; x += (ring[j][0] + ring[i][0]) * cross; y += (ring[j][1] + ring[i][1]) * cross;
  }
  return [x / (3 * area), y / (3 * area)];
}

const regions = {};
for (const code of CODES) {
  const polygons = projected[code].map((polygon) => polygon.map((ring) => ring.map(fit)));
  const d = polygons.flatMap((polygon) => polygon.map((ring) => {
    const [first, ...rest] = ring.slice(0, -1).map(([x, y]) => [round(x), round(y)]);
    return `M${first.join(',')}L${rest.map((p) => p.join(',')).join(' ')}Z`;
  })).join('');
  const largest = polygons.map((polygon) => polygon[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  regions[code] = { osm: relations[code], d, label: centroid(largest).map(round) };
}

await writeFile(OUT, `${JSON.stringify({
  source: 'OpenStreetMap contributors, ODbL 1.0; simplified via Nominatim (polygon_threshold=0.02)',
  built: new Date().toISOString().slice(0, 10),
  viewBox: `0 0 ${WIDTH} ${height}`,
  regions,
})}\n`);
console.log(`Wrote ${CODES.length} regions, viewBox 0 0 ${WIDTH} ${height}`);
