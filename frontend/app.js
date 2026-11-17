const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => v == null ? "—" : Number(v).toFixed(d);
const labels = { hour: "Hour (0–23)", weekday: "Weekday (0 = Monday)", lag_1: "Previous hour", lag_2: "2 hours before", lag_3: "3 hours before", lag_24: "24 hours before", temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)", absolute_humidity: "Absolute humidity", observed: "Actual value (optional)" };
let results = null, chart = null;

async function getJSON(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw body; return body; }

async function start() {
  $("pollutant").addEventListener("change", () => loadPollutant($("pollutant").value));
  $("episode-filter").addEventListener("change", renderEpisodes);
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  try { const dataset = await getJSON("/api/datasets"); $("pollutant").innerHTML = dataset.pollutants.map((p) => `<option value="${p.key}">${p.pollutant}</option>`).join(""); await loadPollutant(dataset.pollutants[0].key); } catch (error) { showError(error); }
}

async function loadPollutant(key) {
  try { results = await getJSON(`/api/results/${key}`); $("download-json").href = `/api/report/${key}?download=true`; $("download-csv").href = `/api/episodes/${key}`; renderSummary(); renderChart(); renderPerformance(); renderEpisodes(); buildForm(); await loadSample(); $("error").hidden = true; } catch (error) { showError(error); }
}

function renderSummary() {
  const best = results.models.find((m) => m.model === results.model);
  $("model").textContent = results.model; $("mae").textContent = `${fmt(best.test.MAE)} ${results.unit}`; $("r2").textContent = fmt(best.test.R2); $("within").textContent = `${fmt(results.accuracy_within_20pct, 1)}%`;
  $("period").textContent = `${results.periods.test[0].slice(0, 10)} to ${results.periods.test[1].slice(0, 10)}`;
  const fit = results.overfitting_check; $("fit").textContent = `${fit.verdict}. Learned-data MAE ${fmt(fit.mae_on_learned_data)}; test MAE ${fmt(fit.mae_on_test)}.`;
}

function renderChart() { const points = results.test_predictions; chart = chart || echarts.init($("chart")); chart.setOption({ animation: false, tooltip: { trigger: "axis" }, grid: { left: 50, right: 18, top: 18, bottom: 55 }, xAxis: { type: "time" }, yAxis: { type: "value", name: results.unit }, dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }], series: [{ name: "Actual", type: "line", showSymbol: false, color: "#17324d", data: points.map((p) => [p.t, p.actual]) }, { name: "Predicted", type: "line", showSymbol: false, color: "#168aad", lineStyle: { type: "dashed" }, data: points.map((p) => [p.t, p.predicted]) }, { name: "Flagged", type: "scatter", symbolSize: 9, color: "#d1495b", data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) }] }, true); }

function renderPerformance() { $("performance").innerHTML = results.models.map((m) => `<tr class="${m.model === results.model ? "chosen" : ""}"><td>${m.model.replace(" (same as previous hour)", "")}</td><td>${fmt(m.test.MAE)}</td><td>${fmt(m.test.RMSE)}</td><td>${fmt(m.test.R2)}</td></tr>`).join(""); }
function renderEpisodes() { const filter = $("episode-filter").value; const list = results.episodes.filter((e) => filter === "all" || e.type === filter).sort((a, b) => b.severity - a.severity).slice(0, 8); const c = results.episode_counts; $("counts").textContent = `${c.total} flagged · ${c["Unusual pollution"] || 0} unusual · ${c["Data limitation"] || 0} data limitations · ${c.Unclear || 0} unclear`; $("episodes").innerHTML = list.length ? list.map((e) => `<article class="episode"><strong>${e.when || e.start}</strong><span>${e.type}</span><p>${e.explanation}</p></article>`).join("") : `<p class="muted">No matching episodes.</p>`; }
function buildForm() { $("predict-form").innerHTML = results.features.map((f) => `<label>${labels[f] || f}<input name="${f}" type="number" step="any" ${f === "hour" || f === "weekday" || f === "lag_1" ? "required" : ""}></label>`).join("") + `<label>${labels.observed}<input name="observed" type="number" step="any"></label>`; }
async function loadSample() { const sample = await getJSON(`/api/sample/${results.pollutant}`); for (const input of $("predict-form").elements) input.value = sample.input[input.name] ?? ""; }
async function predict(event) { event.preventDefault(); const body = { pollutant: results.pollutant }; for (const input of $("predict-form").elements) body[input.name] = input.value === "" ? null : Number(input.value); const box = $("predict-result"); box.hidden = false; try { const r = await getJSON("/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); box.className = "result success"; box.textContent = `Predicted ${r.pollutant}: ${fmt(r.prediction)} ${r.unit} (${r.model}).`; } catch (error) { box.className = "result error"; box.textContent = error.detail || "Prediction failed."; } }
function showError(error) { $("error").hidden = false; $("error").textContent = error.detail || error.message || "Could not load the UCI data."; }
window.addEventListener("resize", () => chart && chart.resize()); start();
