const decimal = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('ru-RU');
const hundredths = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const THRESHOLD = 15;
const MIN_GROUP = 30;
const CHILD_LABELS = { 0: 'нет', 1: '1', 2: '2', 3: '3', '4+': '4+' };

const el = (id) => document.getElementById(id);
const pct = (value, digits = 1) => `${digits ? decimal.format(value) : whole.format(value)}%`;
const times = (value) => (value >= 10 ? whole.format(value) : decimal.format(value));

function fill(key, value) {
  document.querySelectorAll(`[data-fill="${key}"]`).forEach((node) => { node.textContent = value; });
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderProbability(model) {
  const values = model.predicted.values;
  const odds = Object.fromEntries(model.children.map((child) => [child.label, child.odds_ratio]));
  el('probability-chart').replaceChildren(...Object.entries(values).map(([label, value]) => {
    const column = node('div', `probability-column${label === '0' ? ' is-base' : ''}`);
    const ratio = odds[label];
    column.title = ratio
      ? `Детей: ${label}. ${pct(value)}; шансы ×${times(ratio.odds_ratio)} (95% ДИ ${times(ratio.ci95[0])}–${times(ratio.ci95[1])})`
      : `Без детей: ${pct(value)}`;
    const bar = node('div', 'probability-bar');
    bar.style.setProperty('--height', `${value}%`);
    bar.append(node('span', 'probability-value', pct(value, 0)));
    column.append(bar, node('span', 'probability-label', CHILD_LABELS[label]),
      node('span', 'probability-odds', ratio ? `×${times(ratio.odds_ratio)}` : 'база'));
    return column;
  }));
}

function renderMechanism(model) {
  const scale = Math.max(...model.children.map((child) => child.area_needed_pct));
  el('mechanism-chart').replaceChildren(...model.children.map((child) => {
    const row = node('div', 'mechanism-row');
    row.title = `Детей: ${child.label}. Фактически +${decimal.format(child.area_difference.pct)}% (95% ДИ ${decimal.format(child.area_difference.ci95[0])}–${decimal.format(child.area_difference.ci95[1])}), нужно +${child.area_needed_pct}%`;
    row.append(node('span', 'mechanism-label', `${child.label} ${{ 1: 'ребёнок', 2: 'ребёнка', 3: 'ребёнка' }[child.label] || 'детей'}`));
    const bars = node('div', 'mechanism-bars');
    for (const [className, value, label] of [
      ['mechanism-actual', child.area_difference.pct, `+${decimal.format(child.area_difference.pct)}%`],
      ['mechanism-needed', child.area_needed_pct, `+${child.area_needed_pct}%`],
    ]) {
      const line = node('div', 'mechanism-line');
      const bar = node('i', className);
      bar.style.width = `${Math.max(value / scale * 100, 0.8)}%`;
      line.append(bar, node('span', 'mechanism-value', label));
      bars.append(line);
    }
    row.append(bars);
    return row;
  }));
}

// Same aggregation as the calculator: cells are [region, locality, children, quintile, area bin, households].
function childRule(cells) {
  let all = 0; let allBelow = 0; let group = 0; let groupBelow = 0;
  const regions = {};
  for (const [region, , children, , areaBin, count] of cells) {
    const below = areaBin < THRESHOLD ? count : 0;
    all += count; allBelow += below;
    if (children === null || children < 1) continue;
    group += count; groupBelow += below;
    regions[region] ??= { n: 0, below: 0 };
    regions[region].n += count;
    regions[region].below += below;
  }
  return { all, allBelow, group, groupBelow, regions };
}

function renderFacts(model, regionData) {
  const latest = regionData.years.at(-1);
  const rule = childRule(latest.cells);
  const ranked = Object.entries(rule.regions)
    .filter(([, stats]) => stats.n >= MIN_GROUP)
    .map(([code, stats]) => ({ name: regionData.regions[code], share: stats.below / stats.n * 100 }))
    .sort((a, b) => b.share - a.share);
  const reach = model.programme_reach.crowded;
  const quintiles = model.crowded_by_income_quintile;
  const children = Object.fromEntries(model.children.map((child) => [child.label, child]));

  fill('households', number.format(model.sample.households));
  fill('pseudo_r2', hundredths.format(model.pseudo_r2));
  fill('income_effect', `${model.income_effect_pp_per_doubling > 0 ? '+' : ''}${decimal.format(model.income_effect_pp_per_doubling)}`);
  fill('q1_share', pct(quintiles['1'].share * 100, 0));
  fill('q5_share', pct(quintiles['5'].share * 100, 0));
  fill('house_or', hundredths.format(model.house_odds_ratio.odds_ratio));
  fill('housing_reach', pct(reach.housing_assistance * 100));
  fill('child_benefit_reach', pct(reach.child_benefits * 100, 0));
  fill('reach_year', model.latest_year);
  fill('or_1', times(children['1'].odds_ratio.odds_ratio));
  fill('or_2', times(children['2'].odds_ratio.odds_ratio));
  fill('or_4', times(children['4+'].odds_ratio.odds_ratio));
  fill('p_2', pct(model.predicted.values['2'], 0));
  fill('coverage', pct(rule.groupBelow / rule.allBelow * 100, 0));
  fill('target', pct(rule.groupBelow / rule.all * 100, 0));
  fill('area_2', pct(children['2'].area_difference.pct));
  fill('area_4', pct(children['4+'].area_difference.pct, 0));
  const place = (r) => `${pct(r.share, 0)} — ${r.name.startsWith('г. ') ? r.name : `${r.name} обл.`}`;
  fill('top_regions', ranked.slice(0, 3).map(place).join(', '));
  const last = ranked.at(-1);
  fill('bottom_region', `${place(last)} (${latest.year})`);
}

export async function initFindings() {
  try {
    const [model, regionData] = await Promise.all(['/data/model.json', '/data/regions.json'].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.json();
    }));
    renderProbability(model);
    renderMechanism(model);
    renderFacts(model, regionData);
  } catch (error) {
    const message = el('findings-error');
    message.textContent = 'Не удалось загрузить результаты модели. Обновите страницу или скачайте материалы ниже.';
    message.hidden = false;
    console.error('Could not load model results:', error);
  } finally {
    el('findings-results').setAttribute('aria-busy', 'false');
  }
}
