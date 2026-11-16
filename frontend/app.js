// Air quality results page. Pick a dataset and a pollutant; everything below fills in from the API.

const LABELS = {
  hour: "Hour (0-23)", weekday: "Weekday (0 = Monday)",
  lag_1: "Value 1 hour before", lag_2: "Value 2 hours before", lag_3: "Value 3 hours before",
  lag_24: "Value 24 hours before", temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)",
  absolute_humidity: "Absolute humidity", pressure: "Pressure (hPa)", dew_point: "Dew point (°C)",
  rain: "Rain (mm)", wind_speed: "Wind speed (m/s)", observed: "Actual value (optional)",
};
const TOP = 6;   // episodes shown before "Show all"
const KINDS = ["Unusual pollution", "Data limitation", "Unclear"];
const KIND_CLASS = { "Unusual pollution": "unusual", "Data limitation": "data", "Unclear": "unclear" };
const KIND_COLOR = { "Unusual pollution": "#c2410c", "Data limitation": "#6d28d9", "Unclear": "#64748b" };

let datasets = [];
let dataset = null;   // the selected dataset
let results = null;   // numbers for the selected pollutant
let report = null;    // the same results in words
let filter = "all";
let showAll = false;
let chart = null;
let patternChart = null;

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(d));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function getJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw body;
  return body;
}

async function start() {
  $("dataset").addEventListener("change", () => pickDataset($("dataset").value));
  $("pollutant").addEventListener("change", () => pickPollutant($("pollutant").value));
  $("more").addEventListener("click", () => { showAll = !showAll; showEpisodes(); });
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  $("upload-form").addEventListener("submit", upload);
  window.addEventListener("resize", () => [chart, patternChart].forEach((c) => c && c.resize()));
  await loadDatasets();
  const health = await getJSON("/health");
  if (!health.upload_enabled) {
    $("upload-form").hidden = true;
    $("upload-result").hidden = false;
    $("upload-result").textContent = "Uploading is turned off on this server. Run the app on your own computer to train on your own file.";
  }
}

async function loadDatasets(selectId) {
  datasets = await getJSON("/api/datasets");
  $("dataset").innerHTML = datasets.map((d) => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join("");
  pickDataset(selectId || datasets[0].id);
}

function pickDataset(id) {
  dataset = datasets.find((d) => d.id === id);
  $("dataset").value = id;
  $("pollutant").innerHTML = dataset.pollutants
    .map((p) => `<option value="${esc(p.key)}">${esc(p.pollutant)}${p.unit ? ` (${esc(p.unit)})` : ""}</option>`).join("");
  pickPollutant(dataset.pollutants[0].key);
}

async function pickPollutant(key) {
  [results, report] = await Promise.all([
    getJSON(`/api/results/${dataset.id}/${key}`),
    getJSON(`/api/report/${dataset.id}/${key}`),
  ]);
  $("download").href = `/api/report/${dataset.id}/${key}?download=true`;
  filter = "all";
  showAll = false;
  showKpis();
  showHeadline();
  showChart();
  showModels();
  showPatterns();
  showFilters();
  showEpisodes();
  $("steps").innerHTML = report.how_it_was_made.map((s) => `<li>${esc(s)}</li>`).join("");
  buildForm();
  $("predict-result").hidden = true;
  loadSample();
}

// ---------- top numbers ----------
function showKpis() {
  const best = results.models.find((m) => m.model === results.model);
  const unit = results.unit || "";
  const gain = results.improvement_vs_persistence_pct;
  $("kpi-error").innerHTML = `${fmt(best.test.MAE, best.test.MAE < 10 ? 3 : 1)}<span class="unit">${esc(unit)}</span>`;
  $("kpi-model").textContent = `${results.model}, per hour`;
  $("kpi-gain").textContent = `${gain >= 0 ? "+" : "−"}${fmt(Math.abs(gain), 1)}%`;
  $("kpi-gain").className = "kpi-value " + (gain >= 1 ? "good" : gain <= -1 ? "bad" : "");
  $("kpi-gain-note").textContent = gain >= 1 ? "more accurate than the simple guess"
    : gain <= -1 ? "the simple guess wins here" : "about the same as the simple guess";
  $("kpi-r2").textContent = fmt(best.test.R2, 2);

  const counts = results.episode_counts;
  $("kpi-episodes").textContent = counts.total;
  $("kpi-mix").innerHTML = KINDS.map((k) => counts.total
    ? `<span style="width:${(100 * (counts[k] || 0)) / counts.total}%;background:${KIND_COLOR[k]}"></span>` : "").join("");
  $("kpi-mix-note").textContent = `${counts["Unusual pollution"] || 0} unusual · ${counts["Data limitation"] || 0} data · ${counts["Unclear"] || 0} unclear`;
}

function showHeadline() {
  const best = results.models.find((m) => m.model === results.model);
  const gain = results.improvement_vs_persistence_pct;
  const unit = results.unit || "";
  const compare = gain >= 1 ? `${fmt(gain, 1)}% better than just repeating the last hour`
    : gain <= -1 ? `slightly worse than just repeating the last hour, because ${results.pollutant} changes slowly here`
    : `about as good as just repeating the last hour, because ${results.pollutant} changes slowly here`;
  $("headline").textContent = `${results.model} predicts next-hour ${results.pollutant} within ${fmt(best.test.MAE, 2)} ${unit} on average, ${compare}.`;
  $("summary").textContent = report.summary;
}

// ---------- charts ----------
function showChart() {
  const points = results.test_predictions;
  const end = Math.min(100, Math.round((24 * 14 / points.length) * 100)) || 100;
  chart = chart || echarts.init($("chart"));
  chart.setOption({
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: ["Actual", "Predicted", "Flagged"], top: 0 },
    grid: { left: 50, right: 16, top: 34, bottom: 60 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: results.unit, splitLine: { lineStyle: { color: "#eef2f7" } } },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: "#1e293b", lineStyle: { width: 1.2 },
        data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#2563eb", lineStyle: { width: 1.2, type: "dashed" },
        data: points.map((p) => [p.t, p.predicted]) },
      { name: "Flagged", type: "scatter", symbolSize: 7, color: "#dc2626",
        data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ],
  }, true);
}

function showModels() {
  const rows = report.models_compared;
  const max = Math.max(...rows.map((m) => m.test_error)) || 1;
  $("models").innerHTML = rows.map((m) => {
    const baseline = m.model.startsWith("Persistence");
    const name = baseline ? "Repeat last hour" : m.model;
    const cls = m.model === results.model ? "chosen" : baseline ? "baseline" : "";
    return `<div class="bar-row ${cls}"><span>${esc(name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(100 * m.test_error) / max}%"></div></div>
      <span class="bar-value">${fmt(m.test_error, m.test_error < 10 ? 3 : 1)}</span></div>`;
  }).join("") + `<p class="small">Lower is better. The dark bar is the model we chose (picked on the validation period).</p>`;
}

function showPatterns() {
  const p = results.patterns;
  $("patterns").textContent = p ? p.text : "Run the training again to see when episodes happen.";
  if (!p) { if (patternChart) patternChart.clear(); return; }
  patternChart = patternChart || echarts.init($("chart-patterns"));
  patternChart.setOption({
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { show: false },
    grid: { left: 30, right: 8, top: 10, bottom: 24 },
    xAxis: { type: "category", data: [...Array(24).keys()].map((h) => `${h}`) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: KINDS.filter((k) => p.by_hour[k]).map((k) => ({
      name: k, type: "bar", stack: "all", data: p.by_hour[k], color: KIND_COLOR[k], barWidth: "60%",
    })),
  }, true);
}

// ---------- episodes ----------
function showFilters() {
  const counts = results.episode_counts;
  const options = [["all", `All (${counts.total})`], ...KINDS.map((k) => [k, `${k} (${counts[k] || 0})`])];
  $("filters").innerHTML = options.map(([value, label]) =>
    `<button type="button" data-filter="${esc(value)}" aria-pressed="${value === filter}">${esc(label)}</button>`).join("");
  $("filters").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    showAll = false;
    showFilters();
    showEpisodes();
  }));
}

function episodeCard(e) {
  const unit = results.unit || "";
  const diff = e.difference ?? (e.peak_value != null && e.expected_value != null ? e.peak_value - e.expected_value : null);
  const agreeing = (e.checks && e.checks.other_pollutants_agreeing) || [];
  const numbers = e.peak_value != null
    ? `Peak <b>${fmt(e.peak_value)}</b> ${esc(unit)} vs <b>${fmt(e.expected_value)}</b> expected
       <span class="${diff > 0 ? "up" : "down"}">(${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))})</span>` +
      (agreeing.length ? ` · also ${diff > 0 ? "up" : "down"}: ${esc(agreeing.join(", "))}` : "")
    : "";
  const meta = [e.confidence ? `${e.confidence} confidence` : "", e.severity ? `${fmt(e.severity, 1)}× the limit` : ""]
    .filter(Boolean).join(" · ");
  return `<article class="episode ${KIND_CLASS[e.type] || "unclear"}">
      <div class="ep-top"><span class="ep-when">${esc(e.when || e.start)}</span>
        <span class="chip ${KIND_CLASS[e.type] || "unclear"}">${esc(e.type)}</span>
        <span class="ep-meta">${esc(meta)}</span></div>
      ${numbers ? `<p class="ep-numbers">${numbers}</p>` : ""}
      <details><summary>Why?</summary><p>${esc(e.explanation || e.reason)}</p></details>
    </article>`;
}

function showEpisodes() {
  const matching = results.episodes.filter((e) => filter === "all" || e.type === filter);
  const list = showAll ? matching : [...matching].sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, TOP);
  $("episodes").innerHTML = list.length ? list.map(episodeCard).join("") : `<p class="small">No episodes of this kind.</p>`;
  $("more").hidden = matching.length <= TOP;
  $("more").textContent = showAll ? `Show only the ${TOP} biggest` : `Show all ${matching.length} in time order`;
}

// ---------- API demo ----------
function buildForm() {
  $("predict-form").innerHTML = [...results.features, "observed"]
    .map((f) => `<label>${esc(LABELS[f] || f)}<input name="${esc(f)}" type="number" step="any"></label>`).join("");
}

async function loadSample() {
  const sample = await getJSON(`/api/sample/${dataset.id}/${results.pollutant}`);
  for (const input of $("predict-form").elements) input.value = sample.input[input.name] ?? "";
  $("load-sample").textContent = `Load a real hour (now ${sample.time.replace("T", " ").slice(0, 16)})`;
}

async function predict(event) {
  event.preventDefault();
  const body = { dataset: dataset.id, pollutant: results.pollutant };
  for (const input of $("predict-form").elements) body[input.name] = input.value === "" ? null : Number(input.value);
  const box = $("predict-result");
  box.hidden = false;
  try {
    const r = await getJSON("/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let text = `Predicted ${r.pollutant} for the next hour: ${fmt(r.prediction, 3)} ${r.unit} (${r.model}).`;
    box.className = "result";
    if (r.episode_check) {
      const c = r.episode_check;
      box.className = c.flagged ? "result flagged" : "result";
      text += ` The actual value was ${fmt(c.observed, 3)}, a difference of ${fmt(Math.abs(c.deviation), 3)}. ` +
        (c.flagged ? `That is more than the ${fmt(c.threshold, 3)} limit, so this hour would be flagged.`
                   : `That is within the ${fmt(c.threshold, 3)} limit, so this hour looks normal.`);
    }
    box.textContent = text;
  } catch (err) {
    box.className = "result error";
    box.textContent = Array.isArray(err.detail)
      ? err.detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join(". ")
      : err.detail || "Something went wrong.";
  }
}

// ---------- upload ----------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function upload(event) {
  event.preventDefault();
  const box = $("upload-result");
  const button = $("upload-form").querySelector("button");
  const form = new FormData();
  form.append("file", $("upload-file").files[0]);
  form.append("name", $("upload-name").value);
  box.hidden = false;
  box.className = "result";
  box.textContent = "Uploading and checking the file…";
  button.disabled = true;
  try {
    let job = await getJSON("/api/upload", { method: "POST", body: form });
    const started = Date.now();
    while (job.status === "waiting" || job.status === "training") {
      const seconds = Math.round((Date.now() - started) / 1000);
      box.textContent = job.status === "waiting"
        ? `Waiting for another training to finish… (${seconds}s)`
        : `Training models for ${job.pollutants.join(", ")}… (${seconds}s). This can take a few minutes online.`;
      await wait(3000);
      job = await getJSON(`/api/upload/${job.job}`);
    }
    if (job.status === "error") throw { detail: job.message };
    const r = job.result;
    box.textContent = `Done. "${r.title}" now has models for ${r.pollutants.map((p) => p.pollutant).join(", ")}. It is selected above.`;
    await loadDatasets(r.id);
  } catch (err) {
    box.className = "result error";
    box.textContent = err.detail || "Upload failed.";
  } finally {
    button.disabled = false;
  }
}

start();
