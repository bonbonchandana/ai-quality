// Air Quality dashboard: loads results for the selected pollutant from the API and draws them.

const FIELDS = [
  { key: "hour", label: "Hour (0-23)", step: 1 },
  { key: "weekday", label: "Weekday (0 = Mon)", step: 1 },
  { key: "lag_1", label: "Value 1 h earlier", step: "any" },
  { key: "lag_2", label: "Value 2 h earlier", step: "any" },
  { key: "lag_3", label: "Value 3 h earlier", step: "any" },
  { key: "lag_24", label: "Value 24 h earlier", step: "any" },
  { key: "temperature", label: "Temperature (°C)", step: "any" },
  { key: "relative_humidity", label: "Relative humidity (%)", step: "any" },
  { key: "absolute_humidity", label: "Absolute humidity", step: "any" },
  { key: "observed", label: "Actual value (optional)", step: "any" },
];

const charts = {};
let current = null; // results of the selected pollutant

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null ? "–" : Number(v).toFixed(d));

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

// ---------- page setup ----------
async function init() {
  const pollutants = await getJSON("/api/pollutants");
  $("pollutant").innerHTML = pollutants
    .map((p) => `<option value="${p.key}">${p.key} – ${p.name} (${p.unit})</option>`)
    .join("");
  $("predict-form").innerHTML = FIELDS.map(
    (f) => `<label>${f.label}<input name="${f.key}" type="number" step="${f.step}"></label>`
  ).join("");

  $("pollutant").addEventListener("change", () => load($("pollutant").value));
  $("episode-filter").addEventListener("change", renderEpisodes);
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  load(pollutants[0].key);
}

async function load(key) {
  current = await getJSON(`/api/results/${key}`);
  renderCards();
  renderTestChart();
  renderModelChart();
  renderImportance();
  renderDaily();
  renderHourly();
  renderEpisodes();
  $("predict-result").hidden = true;
  loadSample();
}

// ---------- summary cards ----------
function renderCards() {
  const r = current;
  const best = r.models.find((m) => m.model === r.selected_model);
  const counts = r.episode_counts;
  const cards = [
    ["Chosen model", r.selected_model, r.selected_model === "XGBoost" && r.device_used === "cuda" ? "picked on the validation period · trained on GPU" : "picked on the validation period"],
    ["Test error (MAE)", `${fmt(best.test.MAE)} ${r.unit}`, `average miss per hour, ${best.test.n} test hours`],
    ["R² on test", fmt(best.test.R2), "1.0 would be perfect"],
    ["Better than persistence", `${fmt(r.improvement_vs_persistence_pct, 1)}%`, "vs. 'same as previous hour'"],
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
  chart("chart-test").setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["Actual", "Predicted", "Flagged"] },
    grid: { left: 50, right: 20, top: 40, bottom: 70 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: current.unit },
    dataZoom: [{ type: "inside", start: 0, end: 20 }, { type: "slider", start: 0, end: 20 }],
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
    tooltip: { trigger: "axis", valueFormatter: (v) => `${fmt(v, 3)} ${current.unit}` },
    grid: { left: 150, right: 30, top: 10, bottom: 30 },
    xAxis: { type: "value", name: current.unit },
    yAxis: { type: "category", data: rows.map((m) => m.model), inverse: true },
    series: [{
      type: "bar",
      data: rows.map((m) => ({
        value: m.test.MAE,
        itemStyle: { color: m.model === current.selected_model ? "#2563eb" : m.model.startsWith("Persistence") ? "#9ca3af" : "#93c5fd" },
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
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: current.unit },
    series: [{ type: "line", showSymbol: false, color: "#2563eb", areaStyle: { opacity: 0.1 },
               data: current.data.daily, connectNulls: false }],
  }, true);
}

function renderHourly() {
  chart("chart-hourly").setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category", data: [...Array(24).keys()], name: "hour" },
    yAxis: { type: "value", name: current.unit },
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
async function loadSample() {
  const sample = await getJSON(`/api/sample/${current.key}`);
  for (const f of FIELDS) $("predict-form").elements[f.key].value = sample.input[f.key] ?? "";
  $("load-sample").textContent = `Load a real hour (now: ${sample.time.replace("T", " ").slice(0, 16)})`;
}

async function predict(event) {
  event.preventDefault();
  const body = { pollutant: current.key };
  for (const f of FIELDS) {
    const raw = $("predict-form").elements[f.key].value;
    body[f.key] = raw === "" ? null : Number(raw);
  }
  const box = $("predict-result");
  box.hidden = false;
  try {
    const r = await getJSON("/predict", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let html = `<div>Predicted ${r.name} next hour (${r.model})</div><div class="big">${fmt(r.prediction, 3)} ${r.unit}</div>`;
    box.className = "result";
    if (r.episode_check) {
      const c = r.episode_check;
      box.className = c.flagged ? "result flagged" : "result";
      html += `<div>Actual ${fmt(c.observed, 3)} ${r.unit} · deviation ${fmt(c.deviation, 3)} (threshold ±${fmt(c.threshold, 3)}) →
               <b>${c.flagged ? "FLAGGED as a possible episode" : "normal"}</b></div>`;
    }
    box.innerHTML = html;
  } catch (err) {
    box.className = "result error";
    box.innerHTML = Array.isArray(err.detail)
      ? err.detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join("<br>")
      : err.detail || "Request failed";
  }
}

init();
