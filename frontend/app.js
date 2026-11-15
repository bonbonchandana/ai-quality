const LABELS = {
  timestamp: "Date and time",
  lag_1: "Previous hour", lag_2: "2 hours before", lag_3: "3 hours before", lag_24: "24 hours before",
  temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)", absolute_humidity: "Absolute humidity",
  pressure: "Pressure (hPa)", dew_point: "Dew point (°C)", rain: "Rain (mm)", wind_speed: "Wind speed (m/s)", observed: "Actual value (optional)",
};
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);
let datasets = [], dataset = null, results = null, report = null, chart = null;

async function getJSON(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw body;
  return body;
}

async function start() {
  $("dataset").addEventListener("change", () => pickDataset($("dataset").value));
  $("pollutant").addEventListener("change", () => pickPollutant($("pollutant").value));
  $("episode-filter").addEventListener("change", showEpisodes);
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  window.addEventListener("resize", () => chart && chart.resize());
  try { await loadDatasets(); } catch (error) { showError(error); }
}

async function loadDatasets(selectId) {
  datasets = await getJSON("/api/datasets");
  $("dataset").innerHTML = datasets.map((d) => `<option value="${d.id}">${d.title}</option>`).join("");
  pickDataset(selectId || datasets[0].id);
}

function pickDataset(id) {
  dataset = datasets.find((item) => item.id === id);
  $("pollutant").innerHTML = dataset.pollutants.map((p) => `<option value="${p.key}">${p.pollutant}</option>`).join("");
  pickPollutant(dataset.pollutants[0].key);
}

async function pickPollutant(key) {
  try {
    [results, report] = await Promise.all([
      getJSON(`/api/results/${dataset.id}/${key}`),
      getJSON(`/api/report/${dataset.id}/${key}`),
    ]);
    renderSummary(); renderChart(); renderEpisodes(); renderPerformance(); buildForm(); await loadSample(); $("error").hidden = true;
  } catch (error) { showError(error); }
}

function renderSummary() {
  const best = results.models.find((m) => m.model === results.model);
  $("metric-pollutant").textContent = results.pollutant;
  $("metric-unit").textContent = results.unit || "";
  $("metric-model").textContent = results.model;
  $("metric-model-note").textContent = `${fmt(best?.test?.R2)} test R²`;
  $("metric-mae").textContent = fmt(best?.test?.MAE);
  $("metric-episodes").textContent = results.episode_counts.total;
  $("metric-episode-note").textContent = `${results.episode_counts["Unusual pollution"] || 0} unusual pollution`;
}

function renderChart() {
  const points = results.test_predictions;
  chart = chart || echarts.init($("chart"));
  chart.setOption({ animation: false, tooltip: { trigger: "axis" }, legend: { show: false }, grid: { left: 48, right: 18, top: 18, bottom: 58 },
    xAxis: { type: "time" }, yAxis: { type: "value", name: results.unit }, dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: "#172b4d", lineStyle: { width: 2 }, data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#2f80ed", lineStyle: { width: 2, type: "dashed" }, data: points.map((p) => [p.t, p.predicted]) },
      { name: "Flagged", type: "scatter", symbolSize: 9, color: "#e05252", data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ] }, true);
}

function renderEpisodes() {
  const filter = $("episode-filter").value;
  const list = results.episodes.filter((e) => filter === "all" || e.type === filter).sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, 8);
  const counts = results.episode_counts;
  $("counts").textContent = `${counts.total} flagged · ${counts["Unusual pollution"] || 0} unusual · ${counts["Data limitation"] || 0} data limitations · ${counts.Unclear || 0} unclear`;
  $("episodes").innerHTML = list.length ? list.map((e) => `<article class="episode ${e.type === "Unusual pollution" ? "unusual" : e.type === "Data limitation" ? "data" : "unclear"}"><div><strong>${e.when || e.start}</strong><span class="tag">${e.type}</span></div><p>${e.explanation}</p></article>`).join("") : `<p class="muted">No episodes match this filter.</p>`;
}

function renderPerformance() {
  $("performance").innerHTML = results.models.map((m) => `<tr class="${m.model === results.model ? "chosen" : ""}"><td>${m.model.replace(" (same as previous hour)", "")}</td><td>${fmt(m.test.MAE)}</td><td>${fmt(m.test.RMSE)}</td><td>${fmt(m.test.R2)}</td></tr>`).join("");
  const chosen = results.models.find((m) => m.model === results.model), persistence = results.models.at(-1);
  $("model-summary").textContent = `${results.model} is ${fmt(results.improvement_vs_persistence_pct, 1)}% better than repeating the previous hour on MAE.`;
}

function buildForm() {
  const fields = results.features.filter((f) => f !== "hour" && f !== "weekday");
  $("predict-form").innerHTML = `<label class="wide">${LABELS.timestamp}<input name="timestamp" type="datetime-local" required></label>` + fields.map((f) => `<label>${LABELS[f] || f}<input name="${f}" type="number" step="any"></label>`).join("") + `<p class="form-note">Hour and weekday are derived from the selected time.</p>`;
}

async function loadSample() {
  const sample = await getJSON(`/api/sample/${dataset.id}/${results.pollutant}`);
  for (const input of $("predict-form").elements) input.value = input.name === "timestamp" ? sample.time.slice(0, 16) : (sample.input[input.name] ?? "");
}

async function predict(event) {
  event.preventDefault();
  const body = { dataset: dataset.id, pollutant: results.pollutant };
  for (const input of $("predict-form").elements) body[input.name] = input.name === "timestamp" ? `${input.value}:00` : (input.value === "" ? null : Number(input.value));
  const box = $("predict-result"); box.hidden = false;
  try { const r = await getJSON("/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); box.className = "result success"; box.textContent = `Predicted ${r.pollutant}: ${fmt(r.prediction)} ${r.unit} for ${r.timestamp.replace("T", " ").slice(0, 16)}.`; }
  catch (error) { box.className = "result error"; box.textContent = error.detail || "Prediction failed."; }
}

function showError(error) { $("error").hidden = false; $("error").textContent = error.detail || error.message || "Could not load the dashboard."; }
start();
