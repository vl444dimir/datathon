import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\Vladimir\\Documents\\Projects\\datathon";
const SKILL_DIR = "C:\\Users\\Vladimir\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";
const RUNTIME_PYTHON = "C:\\Users\\Vladimir\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const TMP_DIR = path.join(workspaceDir, ".build-slides", "rechecked");
const FINAL_PPTX = path.join(workspaceDir, "submission", "StatDatathon_3_слайда_проверено.pptx");
const { applyPresentationChartFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools", "artifact_tool_utils.mjs")).href
);

const summary = JSON.parse(await fs.readFile(path.join(workspaceDir, "households_summary.json"), "utf8"));
const y2024 = summary.years.find((x) => x.year === 2024);
const manifestRows = 72_643_893;
const forms = 8;
const tables = 236;
const font = "Arial";
const C = { navy: "#152A39", teal: "#087D83", gray: "#52636D", light: "#73828A" };
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function txt(slide, text, x, y, w, h, size, color = C.navy, bold = false) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = { typeface: font, fontSize: size, color, bold, autoFit: "none" };
  return shape;
}

function base(slide, number, title, footer) {
  slide.background.fill = "#FFFFFF";
  txt(slide, `STATDATATHON 2026   ${number}/3`, 72, 33, 600, 30, 16, C.teal, true);
  txt(slide, title, 72, 78, 1136, 90, 43, C.navy, true);
  txt(slide, footer, 72, 663, 1136, 36, 15, C.light);
}

// 1. Dataset scale and the defensible analytic subset.
{
  const s = p.slides.add();
  base(s, 1, "Данные для анализа: 72,6 млн синтетических записей",
    "Источник: MANIFEST.csv и data-guide.Rmd. Синтетические данные, 2021–2024 годы.");
  txt(s, "236", 72, 206, 300, 105, 76, C.teal, true);
  txt(s, "таблиц в 8 формах", 76, 310, 350, 45, 27, C.navy);
  txt(s, "72,6 млн", 478, 206, 620, 105, 76, C.teal, true);
  txt(s, "строк за четыре года", 482, 310, 560, 45, 27, C.navy);
  txt(s, "Наш фокус", 72, 424, 350, 40, 24, C.gray, true);
  txt(s, "D008: состав домохозяйств и год рождения членов", 72, 472, 1050, 38, 26);
  txt(s, "D006: общая и жилая площадь жилья", 72, 514, 1050, 38, 26);
  txt(s, "В 2024 году связались 11 704 из 12 000 домохозяйств (97,5%)", 72, 585, 1120, 45, 24, C.teal, true);
  s.speakerNotes.textFrame.setText(
    `Источники: synthetic_microdata_2021-2024_20260921/MANIFEST.csv (${tables} таблиц, ${manifestRows} строк, ${forms} форм), data-guide.Rmd, d008/2024/kontr_k.csv и d006/2024/rio_2024.csv. Связь по NOMER. D008 содержит ${y2024.roster_households} домохозяйств, D006 — ${y2024.dwelling_rows}. Процент ${((y2024.dwellings_linked_to_roster / y2024.roster_households) * 100).toFixed(1)}. Это синтетическая выборка, не оценка численности населения.`
  );
}

// 2. 2024 household composition.
{
  const s = p.slides.add();
  base(s, 2, "В 2024 году 28% домохозяйств состоят из 5+ человек",
    "Источник: D008, 2024. Доли от 12 000 домохозяйств в синтетической выборке; без весов.");
  txt(s, "Размер домохозяйства", 74, 185, 700, 35, 23, C.gray, true);
  const keys = ["1", "2", "3", "4", "5+"];
  const values = keys.map((k) => Math.round(1000 * y2024.size_distribution[k] / y2024.roster_households) / 10);
  const chart = s.charts.add("bar", {
    position: { left: 64, top: 228, width: 780, height: 366 },
    categories: keys,
    series: [{ name: "Доля", values, fill: C.teal, valuesFormatCode: '0.0"%"' }],
    barOptions: { direction: "column", grouping: "clustered", gapWidth: 70 },
    hasLegend: false,
    xAxis: { textStyle: { typeface: font, fontSize: 22, fill: C.navy } },
    yAxis: { visible: false, min: 0, max: 35, majorGridlines: null },
    dataLabels: { showValue: true, position: "outEnd", textStyle: { typeface: font, fontSize: 20, fill: C.navy } },
    chartFill: "#FFFFFF", plotAreaFill: "#FFFFFF",
  });
  applyPresentationChartFont(chart, { fontFamily: font });
  txt(s, "3,49", 905, 235, 300, 85, 66, C.teal, true);
  txt(s, "человека в среднем", 905, 320, 305, 58, 22, C.navy);
  txt(s, "55,8%", 905, 420, 300, 85, 66, C.teal, true);
  txt(s, "домохозяйств с детьми\nдо 18 лет на конец 2024 г.", 905, 505, 305, 100, 21, C.navy);
  s.speakerNotes.textFrame.setText(
    `Источник: synthetic_microdata_2021-2024_20260921/d008/2024/kontr_k.csv. Уникальный ключ домохозяйства NOMER; 12 000 ключей и 41 821 человек. Размер рассчитан как число записей NOMP в домохозяйстве; с KOL_CHL расхождений нет. Распределение: 1 — 1 726, 2 — 2 846, 3 — 2 185, 4 — 1 889, 5+ — 3 354. Среднее ${y2024.mean_household_size}. Возраст на 31 декабря 2024 года: 2024 минус GOD_ROJD; в 6 700 домохозяйствах есть хотя бы один член младше 18 лет на конец года. Все 41 821 значения года рождения валидны. Доли невзвешенные и относятся только к синтетической выборке.`
  );
}

// 3. Dwelling area by household size; no population-level claim.
{
  const s = p.slides.add();
  base(s, 3, "Площадь на человека по размеру домохозяйства",
    "D006 + D008, 2024. Синтетическая выборка, n = 11 658. Исключены 46 анкет: жилая площадь больше общей.");
  txt(s, "Медиана общей площади на человека, м²", 74, 185, 950, 38, 23, C.gray, true);
  const keys = ["1", "2", "3", "4", "5+"];
  const values = keys.map((k) => y2024.median_total_area_per_person_by_size_m2[k]);
  const chart = s.charts.add("bar", {
    position: { left: 64, top: 230, width: 1110, height: 340 },
    categories: keys,
    series: [{ name: "м² на человека", values, fill: C.teal, valuesFormatCode: '0.0' }],
    barOptions: { direction: "column", grouping: "clustered", gapWidth: 75 },
    hasLegend: false,
    xAxis: { title: { text: "Число членов домохозяйства", textStyle: { typeface: font, fontSize: 18, fill: C.gray } }, textStyle: { typeface: font, fontSize: 22, fill: C.navy } },
    yAxis: { visible: false, min: 0, max: 65, majorGridlines: null },
    dataLabels: { showValue: true, position: "outEnd", textStyle: { typeface: font, fontSize: 21, fill: C.navy } },
    chartFill: "#FFFFFF", plotAreaFill: "#FFFFFF",
  });
  applyPresentationChartFont(chart, { fontFamily: font });
  txt(s, "Медиана площади всего жилья: 73 м² для 5+ человек и 57 м² для одного", 74, 591, 1125, 60, 23, C.navy, true);
  s.speakerNotes.textFrame.setText(
    `Источники: synthetic_microdata_2021-2024_20260921/d006/2024/rio_2024.csv и d008/2024/kontr_k.csv; документация d006/2024/D006_deid/структураД006.doc подтверждает OB_PL как общую площадь, а d008/2024/D008_2024/Структура D008.doc — KOL_CHL как число членов. Соединение по NOMER, 11 704 из 12 000 домохозяйств (97,5%). Для каждого домохозяйства разделили OB_PL на фактическое число членов по NOMP, исключили 46 анкет, в которых J_PL больше OB_PL, затем нашли медиану по группам по 11 658 домохозяйствам: ${values.join(", ")} м². OB_PL положительна у всех 11 704 связанных домохозяйств. После исключения несогласованных анкет медиана общей площади жилья по группам: ${keys.map((k) => y2024.median_total_area_by_size_m2[k]).join(", ")} м². Это описание синтетической выборки, не норматив тесноты и не вывод о населении Казахстана. Следующий этап: проверить распределения внутри групп, по территориальному коду и типу жилья.`
  );
}

await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
for (let i = 0; i < p.slides.items.length; i++) {
  const slide = p.slides.items[i];
  const preview = await p.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(TMP_DIR, `slide-${i + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const candidatePath = path.join(TMP_DIR, "candidate.pptx");
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  explicitTotalSlideCount: 3,
  requiredNativeChartOwnerSlides: [2, 3],
  materializeLiteralChartWorkbooks: true,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools", "inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools", "inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-heading-fit"],
  fontPolicy: { basis: "design", families: [font] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(TMP_DIR, "validation.json"),
});
console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }, null, 2));
