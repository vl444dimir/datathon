import './styles.css';
import { initRegions } from './regions.js';
import { initFindings } from './findings.js';

const number = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const groups = ['1', '2', '3', '4', '5+'];
const select = document.querySelector('#year-select');
const areaButtons = [...document.querySelectorAll('[data-area]')];
let years = [];
let area = 'total';

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderFeaturedYear() {
  const featured = years.at(-1);
  const medians = featured.median_total_area_per_person_by_size_m2;
  const maximum = Math.max(...Object.values(medians));
  const visual = document.querySelector('.hero-visual');
  visual.setAttribute('aria-label', `Медианная общая площадь на человека в выборке ${featured.year} года`);
  visual.querySelector('.visual-year').textContent = featured.year;
  visual.querySelector('.visual-stat strong').textContent = decimal.format(medians['5+']);
  visual.querySelectorAll('.mini-column').forEach((column, index) => {
    const value = medians[groups[index]];
    column.querySelector('span').textContent = decimal.format(value);
    column.style.setProperty('--height', `${value / maximum * 100}%`);
  });
}

function render() {
  const year = years.find((item) => item.year === Number(select.value));
  if (!year) return;
  const householdCount = year.roster_households;
  const largeCount = year.size_distribution['5+'];
  const medians = year[area === 'total' ? 'median_total_area_per_person_by_size_m2' : 'median_living_area_per_person_by_size_m2'];
  const max = Math.max(...Object.values(medians));

  setText('household-count', number.format(householdCount));
  setText('person-count', number.format(year.roster_person_rows));
  setText('large-share', `${decimal.format(largeCount / householdCount * 100)}%`);
  setText('large-count', `Домохозяйств: ${number.format(largeCount)}`);
  if (year.households_with_child === null) {
    setText('children-share', 'Нет данных');
    setText('children-note', 'В этом году нет данных о возрасте');
  } else {
    setText('children-share', `${decimal.format(year.households_with_child / householdCount * 100)}%`);
    setText('children-note', 'Хотя бы один ребёнок до 18 лет на конец года');
  }
  setText('chart-year', year.year);
  setText('area-sample', `После проверки: ${number.format(year.area_valid_households)} домохозяйств`);
  setText('insight-text', `В ${year.year} году медианная ${area === 'total' ? 'общая' : 'жилая'} площадь на человека — ${decimal.format(medians['1'])} м² для живущих по одному и ${decimal.format(medians['5+'])} м² для домохозяйств из 5+ человек.`);

  const chart = document.querySelector('#area-chart');
  chart.replaceChildren(...groups.map((group) => {
    const row = document.createElement('div');
    row.className = `chart-row${group === '5+' ? ' chart-row-accent' : ''}`;
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = group === '1' ? '1 человек' : `${group} ${group === '5+' ? 'человек' : 'человека'}`;
    const track = document.createElement('div');
    track.className = 'chart-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.width = `${medians[group] / max * 100}%`;
    track.append(bar);
    const value = document.createElement('strong');
    value.className = 'chart-value';
    value.textContent = decimal.format(medians[group]);
    const sample = document.createElement('span');
    sample.className = 'sr-only';
    sample.textContent = ` м² на человека, ${number.format(year.area_valid_by_size[group])} домохозяйств`;
    value.append(sample);
    row.append(label, track, value);
    return row;
  }));
  areaButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.area === area)));
  setText('data-status', `Показатели за ${year.year} год. ${number.format(householdCount)} домохозяйств. ${area === 'total' ? 'Общая' : 'Жилая'} площадь.`);
}

select.addEventListener('change', render);
areaButtons.forEach((button) => button.addEventListener('click', () => {
  area = button.dataset.area;
  render();
}));

async function loadData() {
  try {
    const response = await fetch('/data/households.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.years) || !data.years.length) throw new Error('Empty dataset');
    years = data.years.sort((a, b) => a.year - b.year);
    select.replaceChildren(...years.map((year) => new Option(year.year, year.year)));
    select.value = String(years.at(-1).year);
    renderFeaturedYear();
    render();
    select.disabled = false;
  } catch (error) {
    const message = document.querySelector('#data-error');
    message.textContent = 'Не удалось загрузить показатели. Обновите страницу или скачайте материалы ниже.';
    message.hidden = false;
    areaButtons.forEach((button) => { button.disabled = true; });
    setText('data-status', 'Показатели недоступны.');
    setText('area-sample', 'Показатели недоступны');
    console.error('Could not load household summary:', error);
  } finally {
    document.querySelector('#research-results').setAttribute('aria-busy', 'false');
  }
}

loadData();
initRegions();
initFindings();
