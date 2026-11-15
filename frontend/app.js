// Air quality dashboard. Pick a dataset and a pollutant, and the page loads its results from the API.

const LABELS = {
  hour: "Hour (0-23)", weekday: "Weekday (0 = Mon)",
  lag_1: "Value 1 h earlier", lag_2: "Value 2 h earlier", lag_3: "Value 3 h earlier", lag_24: "Value 24 h earlier",
  temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)", absolute_humidity: "Absolute humidity",
  pressure: "Pressure (hPa)", dew_point: "Dew point (°C)", rain: "Rain (mm)", wind_speed: "Wind speed (m/s)",
  observed: "Actual value (optional)",
};

const charts = {};
let allDatasets = [];
let current = null; // results of the selected pollutant
let currentDataset = null;

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null ? "–" : Number(v).toFixed(d));
const unitOf = (r) => r.unit || "units";

async function getJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw body;
  return body;
}

function chart(id) {
  if (!charts[id]) charts[id] = echarts.init($(id));
  return charts[id];
}

// ---------- pickers ----------
async function init() {
  $("dataset").addEventListener("change", () => showDataset($("dataset").value));
  $("pollutant").addEventListener("change", () => load($("pollutant").value));
  $("episode-filter").addEventListener("change", renderEpisodes);
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  $("upload-form").addEventListener("submit", upload);
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  await refreshDatasets();
}

async function refreshDatasets(selectId) {
  allDatasets = await getJSON("/api/datasets");
  $("dataset").innerHTML = allDatasets.map((d) => `<option value="${d.id}">${d.title}</option>`).join("");
  showDataset(selectId || allDatasets[0].id);
}

function showDataset(id) {
  currentDataset = allDatasets.find((d) => d.id === id);
  $("dataset").value = id;
  $("pollutant").innerHTML = currentDataset.pollutants
    .map((p) => `<option value="${p.key}">${p.pollutant}${p.unit ? ` (${p.unit})` : ""}</option>`)
    .join("");
  load(currentDataset.pollutants[0].key);
}

async function load(key) {
  current = await getJSON(`/api/results/${currentDataset.id}/${key}`);
  renderCards();
  renderTestChart();
  renderModelChart();
  renderImportance();
  renderDaily();
  renderHourly();
  renderEpisodes();
  buildForm();
  $("predict-result").hidden = true;
  loadSample();
}

// ---------- summary cards ----------
function renderCards() {
  const r = current;
  const best = r.models.find((m) => m.model === r.model);
  const counts = r.episode_counts;
  const gain = r.improvement_vs_persistence_pct;
  const cards = [
    ["Chosen model", r.model, r.model === "XGBoost" && r.device === "cuda" ? "picked on validation · trained on GPU" : "picked on the validation period"],
    ["Test error (MAE)", `${fmt(best.test.MAE)} ${unitOf(r)}`, `average miss per hour over ${best.test.n} test hours`],
    ["R² on test", fmt(best.test.R2), "1.0 would be perfect"],
    ["vs. 'same as last hour'", `${gain >= 0 ? "" : "−"}${fmt(Math.abs(gain), 1)}% ${gain >= 0 ? "better" : "worse"}`,
      gain >= 1 ? "the model does better than just repeating the last value" : "this pollutant changes slowly, so the last value is hard to beat"],
    ["Flagged episodes", counts.total, `${counts["Unusual pollution"]} unusual pollution · ${counts["Data limitation"]} data limitation`],
  ];
  $("cards").innerHTML = cards
    .map(([label, value, note]) =>
      `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`)
    .join("");
}

// ---------- charts ----------
function renderTestChart() {
  const pts = current.test_predictions;
  const end = Math.min(100, Math.round((24 * 14 / pts.length) * 100)) || 100; // start zoomed on two weeks
  chart("chart-test").setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["Actual", "Predicted", "Flagged"] },
    grid: { left: 55, right: 20, top: 40, bottom: 70 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: unitOf(current) },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, lineStyle: { width: 1 }, color: "#2563eb",
        data: pts.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, lineStyle: { width: 1 }, color: "#16a34a",
        data: pts.map((p) => [p.t, p.predicted]) },
      { name: "Flagged", type: "scatter", symbolSize: 6, color: "#dc2626",
        data: pts.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ],
  }, true);
}

function renderModelChart() {
  const rows = current.models;
  chart("chart-models").setOption({
    tooltip: { trigger: "axis", valueFormatter: (v) => `${fmt(v, 3)} ${unitOf(current)}` },
    grid: { left: 150, right: 50, top: 10, bottom: 30 },
    xAxis: { type: "value", name: unitOf(current) },
    yAxis: { type: "category", data: rows.map((m) => m.model.replace(" (same as previous hour)", "")), inverse: true },
    series: [{
      type: "bar",
      data: rows.map((m) => ({
        value: m.test.MAE,
        itemStyle: { color: m.model === current.model ? "#2563eb" : m.model.startsWith("Persistence") ? "#9ca3af" : "#93c5fd" },
      })),
      label: { show: true, position: "right", formatter: (p) => fmt(p.value, 3) },
    }],
  }, true);
}

function renderImportance() {
  const rows = current.feature_importance;
  chart("chart-importance").setOption({
    tooltip: { trigger: "axis", valueFormatter: (v) => `${fmt(v * 100, 1)}%` },
    grid: { left: 130, right: 40, top: 10, bottom: 30 },
    xAxis: { type: "value", axisLabel: { formatter: (v) => `${Math.round(v * 100)}%` } },
    yAxis: { type: "category", data: rows.map((r) => r.feature), inverse: true },
    series: [{ type: "bar", color: "#7c3aed", data: rows.map((r) => r.importance) }],
  }, true);
}

function renderDaily() {
  chart("chart-daily").setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 55, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: unitOf(current) },
    series: [{ type: "line", showSymbol: false, color: "#2563eb", areaStyle: { opacity: 0.1 }, data: current.data.daily }],
  }, true);
}

function renderHourly() {
  chart("chart-hourly").setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 55, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category", data: [...Array(24).keys()], name: "hour" },
    yAxis: { type: "value", name: unitOf(current) },
    series: [{ type: "bar", color: "#0891b2", data: current.data.hourly_profile }],
  }, true);
}

// ---------- episodes table ----------
function renderEpisodes() {
  const filter = $("episode-filter").value;
  const rows = current.episodes.filter((e) => filter === "all" || e.type === filter);
  const date = (s) => s.replace("T", " ").slice(0, 16);
  $("episodes").innerHTML = rows.length
    ? rows.map((e) => `<tr>
        <td class="num">${e.id}</td><td class="num">${date(e.start)}</td><td class="num">${date(e.end)}</td>
        <td class="num">${e.flagged_hours}</td><td class="num">${fmt(e.max_deviation)} ${current.unit}</td>
        <td><span class="badge ${e.type === "Unusual pollution" ? "unusual" : "data"}">${e.type}</span></td>
        <td>${e.reason}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">No episodes of this type.</td></tr>`;
}

// ---------- prediction form ----------
function buildForm() {
  const fields = [...current.features, "observed"];
  $("predict-form").innerHTML = fields
    .map((f) => `<label>${LABELS[f] || f}<input name="${f}" type="number" step="any"></label>`)
    .join("");
}

async function loadSample() {
  const sample = await getJSON(`/api/sample/${currentDataset.id}/${current.pollutant}`);
  for (const input of $("predict-form").elements) input.value = sample.input[input.name] ?? "";
  $("load-sample").textContent = `Load a real hour (now: ${sample.time.replace("T", " ").slice(0, 16)})`;
}

async function predict(event) {
  event.preventDefault();
  const body = { dataset: currentDataset.id, pollutant: current.pollutant };
  for (const input of $("predict-form").elements) body[input.name] = input.value === "" ? null : Number(input.value);
  const box = $("predict-result");
  box.hidden = false;
  try {
    const r = await getJSON("/predict", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let html = `<div>Predicted ${r.pollutant} for the next hour (${r.model})</div>
                <div class="big">${fmt(r.prediction, 3)} ${r.unit}</div>`;
    box.className = "result";
    if (r.episode_check) {
      const c = r.episode_check;
      box.className = c.flagged ? "result flagged" : "result";
      html += `<div>Actual ${fmt(c.observed, 3)} · off by ${fmt(c.deviation, 3)} (limit ±${fmt(c.threshold, 3)}) →
               <b>${c.flagged ? "flagged as a possible episode" : "normal"}</b></div>`;
    }
    box.innerHTML = html;
  } catch (err) {
    box.className = "result error";
    box.innerHTML = Array.isArray(err.detail)
      ? err.detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join("<br>")
      : err.detail || "Request failed";
  }
}

// ---------- upload your own dataset ----------
async function upload(event) {
  event.preventDefault();
  const box = $("upload-result");
  const form = new FormData();
  form.append("file", $("upload-file").files[0]);
  form.append("name", $("upload-name").value);
  box.hidden = false;
  box.className = "result";
  box.textContent = "Training on your file. A big file can take a couple of minutes.";
  try {
    const r = await getJSON("/api/upload", { method: "POST", body: form });
    box.innerHTML = `<b>${r.title}</b> is ready. Trained ${r.pollutants.length} pollutant(s): ` +
      r.pollutants.map((p) => `${p.pollutant} (${p.model}, ${p["better_than_persistence_%"]}% vs. last hour)`).join(", ");
    await refreshDatasets(r.id);
  } catch (err) {
    box.className = "result error";
    box.textContent = err.detail || "Upload failed";
  }
}

init();
