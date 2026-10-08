import map from './kz-regions.json';

const number = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MIN_GROUP = 30;
const SVG = 'http://www.w3.org/2000/svg';

// Label points that would collide with a city marker, in map units.
const LABEL_AT = { 11: [545, 118], 19: [804, 446], 59: [566, 45], 61: [534, 418] };
// City names go under the marker where a neighbouring label sits above it.
const NAME_BELOW = new Set(['75', '79']);
// Regions formed in 2022 and the region they belonged to before.
const FORMED_FROM = { 10: '63', 33: '19', 62: '35' };
const SHORT = {
  10: 'Абай', 11: 'Акмола', 15: 'Актобе', 19: 'Алматин.', 23: 'Атырау', 27: 'ЗКО',
  31: 'Жамбыл', 33: 'Жетысу', 35: 'Караганда', 39: 'Костанай', 43: 'Кызылорда',
  47: 'Мангистау', 55: 'Павлодар', 59: 'СКО', 61: 'Туркестан', 62: 'Улытау',
  63: 'ВКО', 71: 'Астана', 75: 'Алматы', 79: 'Шымкент',
};
const CITIES = new Set(['71', '75', '79']);
// Sequential single-hue ramp (light → dark). Five equal classes span the range of the
// current view, so regional differences stay visible under any filter.
const RAMP = ['#dbe8c4', '#aecb8c', '#7fa564', '#4f7a52', '#1f4b3a'];
let classes = [0, 1];
const FAMILY_LABELS = {
  all: 'все домохозяйства',
  children: 'семьи с детьми до 18 лет',
  '3plus': 'семьи с тремя и более детьми',
  '4plus': 'многодетные семьи (4+ детей)',
};
const FAMILY_MIN = { children: 1, '3plus': 3, '4plus': 4 };
// Highest income quintile (per-capita money income, D004) included by each filter.
const INCOME_MAX = { q1: 1, q12: 2 };
const INCOME_LABELS = { q1: 'с доходом в нижних 20%', q12: 'с доходом в нижних 40%' };

const state = { data: null, year: null, threshold: 15, family: 'children', locality: 'all', income: 'all', region: 'all' };
const el = (id) => document.getElementById(id);

function wilson(below, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = below / n;
  const denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const percent = (value) => `${decimal.format(value * 100)}%`;

function matches(cell, { family = 'all', locality = 'all', income = 'all', region = 'all' }) {
  const [te, k, children, quintile] = cell;
  if (region !== 'all' && te !== region) return false;
  if (locality !== 'all' && k !== locality) return false;
  if (family !== 'all' && (children === null || children < FAMILY_MIN[family])) return false;
  if (income !== 'all' && (quintile === null || quintile > INCOME_MAX[income])) return false;
  return true;
}

function aggregate(filter) {
  let n = 0;
  let below = 0;
  for (const cell of state.year.cells) {
    if (!matches(cell, filter)) continue;
    n += cell[5];
    if (cell[4] < state.threshold) below += cell[5];
  }
  return { n, below, share: n ? below / n : null };
}

function setClasses(rows) {
  const shares = rows.filter((row) => row.present && row.n >= MIN_GROUP).map((row) => row.share * 100);
  let low = Math.floor(Math.min(...shares, 100));
  let high = Math.ceil(Math.max(...shares, 0));
  if (high - low < 5) { low = Math.max(0, low - 2); high = low + 5; }
  classes = [low, high];
}

function classOf(share) {
  const [low, high] = classes;
  return Math.min(RAMP.length - 1, Math.max(0, Math.floor((share * 100 - low) / (high - low) * RAMP.length)));
}

function colorFor(share) {
  return RAMP[classOf(share)];
}

function viewFilter() {
  return { family: state.family, locality: state.locality, income: state.income };
}

function regionStats() {
  const present = new Set(state.year.cells.map((cell) => cell[0]));
  return Object.keys(state.data.regions).map((code) => {
    const stats = aggregate({ ...viewFilter(), region: code });
    return { code, name: state.data.regions[code], present: present.has(code), ...stats, ci: wilson(stats.below, stats.n) };
  });
}

function tooltipContent(row) {
  const tooltip = el('map-tooltip');
  const title = document.createElement('strong');
  title.textContent = row.name;
  const value = document.createElement('span');
  const sample = document.createElement('small');
  sample.textContent = `${number.format(row.below)} из ${number.format(row.n)} домохозяйств`;
  if (!row.present) {
    const parent = FORMED_FROM[row.code];
    value.textContent = parent ? 'Область образована в 2022 году' : `Нет в выборке ${state.year.year} года`;
    sample.textContent = parent ? `В ${state.year.year} году — в составе: ${state.data.regions[parent]}` : '';
  } else if (row.n < MIN_GROUP) value.textContent = `Мало наблюдений: ${number.format(row.n)}`;
  else value.textContent = `${percent(row.share)} ниже порога · ДИ ${percent(row.ci[0])}–${percent(row.ci[1])}`;
  tooltip.replaceChildren(title, value, sample);
  tooltip.hidden = false;
  return tooltip;
}

function placeTooltip(tooltip, x, y) {
  const wrap = el('kz-map').parentElement.getBoundingClientRect();
  tooltip.style.left = `${Math.min(Math.max(x - wrap.left, 110), wrap.width - 110)}px`;
  tooltip.style.top = `${y - wrap.top}px`;
}

function hideTooltip() {
  el('map-tooltip').hidden = true;
}

function selectRegion(code) {
  state.region = state.region === code ? 'all' : code;
  el('region-select').value = state.region;
  render();
}

const mapNodes = {};
let mapRows = {};

function svgNode(name, attributes = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (parent) parent.append(node);
  return node;
}

// Builds the SVG once; render() only updates fills, labels and states.
function buildMap() {
  const svg = el('kz-map');
  svg.setAttribute('viewBox', map.viewBox);
  const defs = svgNode('defs', {}, svg);
  const hatch = svgNode('pattern', { id: 'map-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svgNode('rect', { width: 8, height: 8, fill: '#f2f5ee' }, hatch);
  svgNode('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#d5ddcf', 'stroke-width': 4 }, hatch);
  const shapes = svgNode('g', { class: 'map-shapes' }, svg);
  const labels = svgNode('g', { class: 'map-labels', 'aria-hidden': 'true' }, svg);
  const cities = svgNode('g', { class: 'map-cities' }, svg);

  for (const [code, region] of Object.entries(map.regions)) {
    const city = CITIES.has(code);
    const path = svgNode('path', { d: region.d, class: 'map-region' }, shapes);
    const [x, y] = LABEL_AT[code] || region.label;
    let target = path;
    let value;
    let name;
    if (city) {
      target = svgNode('g', { class: 'map-city' }, cities);
      svgNode('circle', { cx: x, cy: y, r: 22 }, target);
      value = svgNode('text', { x, y: y + 6, class: 'map-value map-city-value' }, target);
      name = svgNode('text', { x, y: NAME_BELOW.has(code) ? y + 40 : y - 28, class: 'map-name map-city-name' }, labels);
      name.textContent = SHORT[code];
    } else {
      name = svgNode('text', { x, y: y - 6, class: 'map-name' }, labels);
      name.textContent = SHORT[code];
      value = svgNode('text', { x, y: y + 16, class: 'map-value' }, labels);
    }
    target.setAttribute('tabindex', '0');
    target.setAttribute('role', 'button');
    target.addEventListener('click', () => { if (mapRows[code]?.present) selectRegion(code); });
    target.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && mapRows[code]?.present) {
        event.preventDefault();
        selectRegion(code);
      }
    });
    target.addEventListener('pointermove', (event) => placeTooltip(tooltipContent(mapRows[code]), event.clientX, event.clientY - 6));
    target.addEventListener('pointerleave', hideTooltip);
    target.addEventListener('focus', () => {
      const box = target.getBoundingClientRect();
      placeTooltip(tooltipContent(mapRows[code]), box.left + box.width / 2, box.top + box.height / 2);
    });
    target.addEventListener('blur', hideTooltip);
    mapNodes[code] = { path, target, value, name, city: city ? target.querySelector('circle') : null };
  }
}

function renderMap(rows) {
  mapRows = Object.fromEntries(rows.map((row) => [row.code, row]));
  for (const row of rows) {
    const node = mapNodes[row.code];
    if (!node) continue;
    let fill = 'url(#map-hatch)';
    let tone = 'small';
    if (!row.present) {
      fill = '#fafbf8';
      tone = 'missing';
      node.value.textContent = '—';
      node.target.setAttribute('aria-label', `${row.name}: нет в выборке этого года`);
    } else if (row.n < MIN_GROUP) {
      node.value.textContent = 'мало';
      node.target.setAttribute('aria-label', `${row.name}: мало наблюдений (${row.n})`);
    } else {
      fill = colorFor(row.share);
      tone = classOf(row.share) >= 3 ? 'dark' : 'light';
      node.value.textContent = decimal.format(row.share * 100);
      node.target.setAttribute('aria-label', `${row.name}: ${percent(row.share)} ниже порога, ${row.n} домохозяйств`);
    }
    node.path.style.fill = fill;
    if (node.city) node.city.style.fill = fill;
    const selected = state.region === row.code;
    node.path.dataset.state = tone;
    node.target.dataset.state = tone;
    node.value.dataset.state = tone;
    node.name.dataset.state = CITIES.has(row.code) ? 'light' : tone;
    node.path.classList.toggle('is-selected', selected);
    node.target.classList.toggle('is-selected', selected);
    node.target.setAttribute('aria-pressed', String(selected));
    node.target.setAttribute('aria-disabled', String(!row.present));
    if (selected) node.path.parentElement.append(node.path);
  }
}

function renderLegend() {
  const [low, high] = classes;
  const step = (high - low) / RAMP.length;
  el('map-legend').replaceChildren(...RAMP.map((color, index) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = color;
    item.append(swatch, `${decimal.format(low + step * index)}–${decimal.format(low + step * (index + 1))}%`);
    return item;
  }));
}

function renderRanking(rows, overall) {
  const usable = rows.filter((row) => row.present && row.n >= MIN_GROUP).sort((a, b) => b.share - a.share);
  const small = rows.filter((row) => row.present && row.n < MIN_GROUP);
  const scale = Math.max(0.1, Math.ceil(Math.max(...usable.map((row) => row.ci[1]), overall.share || 0) * 10) / 10);
  const items = usable.map((row, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rank-row';
    button.setAttribute('aria-pressed', String(state.region === row.code));
    button.setAttribute('aria-label', `${index + 1}. ${row.name}: ${percent(row.share)}, доверительный интервал ${percent(row.ci[0])}–${percent(row.ci[1])}, ${row.n} домохозяйств`);
    const place = document.createElement('span');
    place.className = 'rank-place';
    place.textContent = index + 1;
    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = row.name;
    const track = document.createElement('span');
    track.className = 'rank-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('i');
    bar.className = 'rank-bar';
    bar.style.width = `${row.share / scale * 100}%`;
    const ci = document.createElement('b');
    ci.className = 'rank-ci';
    ci.style.left = `${row.ci[0] / scale * 100}%`;
    ci.style.width = `${(row.ci[1] - row.ci[0]) / scale * 100}%`;
    const average = document.createElement('u');
    average.className = 'rank-average';
    average.style.left = `${overall.share / scale * 100}%`;
    track.append(bar, ci, average);
    const value = document.createElement('strong');
    value.className = 'rank-value';
    value.textContent = decimal.format(row.share * 100);
    const sample = document.createElement('small');
    sample.className = 'rank-n';
    sample.textContent = `n=${number.format(row.n)}`;
    button.append(place, name, track, value, sample);
    button.addEventListener('click', () => selectRegion(row.code));
    item.append(button);
    return item;
  });
  if (small.length) {
    const item = document.createElement('li');
    item.className = 'rank-small';
    item.textContent = `Мало наблюдений (< ${MIN_GROUP}): ${small.map((row) => row.name).join(', ')}`;
    items.push(item);
  }
  el('rank-list').replaceChildren(...items);
}

function describeGroup() {
  const label = [FAMILY_LABELS[state.family], INCOME_LABELS[state.income], state.locality === 'all' ? '' : state.locality === '1' ? 'в городах' : 'в сёлах'].filter(Boolean).join(' ');
  return `${label[0].toUpperCase()}${label.slice(1)}`;
}

function describeRule() {
  const parts = [FAMILY_LABELS[state.family]];
  if (state.income !== 'all') parts.push(INCOME_LABELS[state.income]);
  if (state.locality !== 'all') parts.push(state.locality === '1' ? 'в городах' : 'в сёлах');
  parts.push(state.region === 'all' ? 'по всей стране' : `в регионе «${state.data.regions[state.region]}»`);
  return parts.join(' ');
}

function renderCalculator() {
  const rule = { ...viewFilter(), region: state.region };
  const group = aggregate(rule);
  const all = aggregate({});
  const restN = all.n - group.n;
  const restBelow = all.below - group.below;
  const ci = wilson(group.below, group.n);

  if (group.n < MIN_GROUP) {
    ['calc-share', 'calc-target', 'calc-coverage', 'calc-ratio'].forEach((id) => { el(id).textContent = '—'; });
    el('calc-share-note').textContent = `В группе ${number.format(group.n)} домохозяйств — слишком мало для оценки`;
    ['calc-target-note', 'calc-coverage-note', 'calc-ratio-note'].forEach((id) => { el(id).textContent = 'Ослабьте условия правила'; });
    el('calc-summary').textContent = '';
    return;
  }

  el('calc-share').textContent = percent(group.share);
  el('calc-share-note').textContent = `${number.format(group.below)} из ${number.format(group.n)} · 95% ДИ ${percent(ci[0])}–${percent(ci[1])}`;
  el('calc-target').textContent = percent(group.below / all.n);
  el('calc-target-note').textContent = `${number.format(group.below)} домохозяйств из ${number.format(all.n)} в выборке`;
  el('calc-coverage').textContent = all.below ? percent(group.below / all.below) : '—';
  el('calc-coverage-note').textContent = `от всех ${number.format(all.below)} домохозяйств ниже ${state.threshold} м²`;

  const restShare = restN ? restBelow / restN : null;
  if (!restN || restN < MIN_GROUP) {
    el('calc-ratio').textContent = '—';
    el('calc-ratio-note').textContent = 'Правило охватывает почти всю выборку';
  } else if (!restShare) {
    el('calc-ratio').textContent = '∞';
    el('calc-ratio-note').textContent = 'У остальных домохозяйств случаев ниже порога нет';
  } else {
    el('calc-ratio').textContent = `×${decimal.format(group.share / restShare)}`;
    el('calc-ratio-note').textContent = `${percent(group.share)} против ${percent(restShare)} у остальных`;
  }

  el('calc-summary').textContent = `Если адресовать программу на ${describeRule()} с общей площадью меньше ${state.threshold} м² на человека, в неё попадёт ${percent(group.below / all.n)} домохозяйств выборки — это ${percent(group.below / all.below)} всех, кто живёт ниже порога. Оценка невзвешенная: для расчёта числа семей в стране нужны веса обследования.`;
}

function render() {
  const familyAvailable = state.year.cells.some((cell) => cell[2] !== null);
  if (!familyAvailable) state.family = 'all';
  document.querySelectorAll('[data-family]').forEach((button) => {
    button.disabled = !familyAvailable && button.dataset.family !== 'all';
    button.setAttribute('aria-pressed', String(button.dataset.family === state.family));
  });
  document.querySelectorAll('[data-locality]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.locality === state.locality));
  });
  document.querySelectorAll('[data-income]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.income === state.income));
  });
  el('family-note').hidden = familyAvailable;
  if (state.region !== 'all' && !state.year.cells.some((cell) => cell[0] === state.region)) state.region = 'all';
  el('region-select').value = state.region;
  el('threshold-value').textContent = state.threshold;
  el('map-title').textContent = `Доля домохозяйств ниже ${state.threshold} м² на человека`;

  const rows = regionStats();
  const overall = aggregate(viewFilter());
  setClasses(rows);
  renderLegend();
  renderMap(rows);
  renderRanking(rows, overall);
  renderCalculator();
  el('map-sample').textContent = overall.n
    ? `${describeGroup()}: ${number.format(overall.n)}, в среднем ${percent(overall.share)} ниже порога`
    : 'Нет домохозяйств с такими условиями';
}

function bind() {
  el('region-year').addEventListener('change', (event) => {
    state.year = state.data.years.find((year) => year.year === Number(event.target.value));
    render();
  });
  el('threshold').addEventListener('input', (event) => {
    state.threshold = Number(event.target.value);
    render();
  });
  el('region-select').addEventListener('change', (event) => {
    state.region = event.target.value;
    render();
  });
  document.querySelectorAll('[data-family]').forEach((button) => button.addEventListener('click', () => {
    state.family = button.dataset.family;
    render();
  }));
  document.querySelectorAll('[data-locality]').forEach((button) => button.addEventListener('click', () => {
    state.locality = button.dataset.locality;
    render();
  }));
  document.querySelectorAll('[data-income]').forEach((button) => button.addEventListener('click', () => {
    state.income = button.dataset.income;
    render();
  }));
}

export async function initRegions() {
  try {
    const response = await fetch('/data/regions.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.years) || !data.years.length) throw new Error('Empty dataset');
    state.data = data;
    data.years.sort((a, b) => a.year - b.year);
    state.year = data.years.at(-1);
    el('region-year').replaceChildren(...data.years.map((year) => new Option(year.year, year.year)));
    el('region-year').value = String(state.year.year);
    const names = Object.entries(data.regions).sort((a, b) => a[1].replace('г. ', '').localeCompare(b[1].replace('г. ', ''), 'ru'));
    el('region-select').append(...names.map(([code, name]) => new Option(name, code)));
    buildMap();
    bind();
    render();
    ['region-year', 'threshold', 'region-select'].forEach((id) => { el(id).disabled = false; });
  } catch (error) {
    const message = el('regions-error');
    message.textContent = 'Не удалось загрузить региональные данные. Обновите страницу или скачайте материалы ниже.';
    message.hidden = false;
    document.querySelectorAll('[data-family], [data-locality], [data-income]').forEach((button) => { button.disabled = true; });
    el('map-sample').textContent = 'Показатели недоступны';
    console.error('Could not load regional data:', error);
  } finally {
    el('regions-results').setAttribute('aria-busy', 'false');
  }
}
