// Air quality report page. Pick a dataset and a pollutant, and the page fills itself in from the API.

const LABELS = {
  hour: "Hour (0-23)", weekday: "Weekday (0 = Monday)",
  lag_1: "Value 1 hour before", lag_2: "Value 2 hours before", lag_3: "Value 3 hours before",
  lag_24: "Value 24 hours before", temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)",
  absolute_humidity: "Absolute humidity", pressure: "Pressure (hPa)", dew_point: "Dew point (°C)",
  rain: "Rain (mm)", wind_speed: "Wind speed (m/s)", observed: "Actual value (optional)",
};
const KIND_CLASS = { "Unusual pollution": "unusual", "Data limitation": "data", "Unclear": "unclear" };
const KIND_COLOR = { "Unusual pollution": "#c2410c", "Data limitation": "#6d28d9", "Unclear": "#9ca3af" };

let datasets = [];
let dataset = null;   // the selected dataset
let results = null;   // numbers for the selected pollutant
let report = null;    // the same results written out in words
let showAll = false;
let chart = null;
let patternChart = null;

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (v == null ? "–" : Number(v).toFixed(d));

async function getJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw body;
  return body;
}

async function start() {
  $("dataset").addEventListener("change", () => pickDataset($("dataset").value));
  $("pollutant").addEventListener("change", () => pickPollutant($("pollutant").value));
  $("episode-filter").addEventListener("change", () => { showAll = false; showEpisodes(); });
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
  $("dataset").innerHTML = datasets.map((d) => `<option value="${d.id}">${d.title}</option>`).join("");
  pickDataset(selectId || datasets[0].id);
}

function pickDataset(id) {
  dataset = datasets.find((d) => d.id === id);
  $("dataset").value = id;
  $("pollutant").innerHTML = dataset.pollutants
    .map((p) => `<option value="${p.key}">${p.pollutant}${p.unit ? ` (${p.unit})` : ""}</option>`).join("");
  pickPollutant(dataset.pollutants[0].key);
}

async function pickPollutant(key) {
  [results, report] = await Promise.all([
    getJSON(`/api/results/${dataset.id}/${key}`),
    getJSON(`/api/report/${dataset.id}/${key}`),
  ]);
  $("download").href = `/api/report/${dataset.id}/${key}?download=true`;
  $("summary").textContent = report.summary;
  $("steps").innerHTML = report.how_it_was_made.map((s) => `<li>${s}</li>`).join("");
  showResults();
  showChart();
  showAll = false;
  showCounts();
  showPatterns();
  showEpisodes();
  buildForm();
  $("predict-result").hidden = true;
  loadSample();
}

function showResults() {
  const unit = results.unit || "";
  $("results").innerHTML = report.models_compared.map((m) => {
    const name = m.model.startsWith("Persistence") ? "Repeat last hour" : m.model;
    return `<tr class="${m.model === results.model ? "chosen" : ""}"><td>${name}</td>
      <td class="num">${fmt(m.validation_error)} ${unit}</td><td class="num">${fmt(m.test_error)} ${unit}</td></tr>`;
  }).join("");
}

function showChart() {
  const points = results.test_predictions;
  const end = Math.min(100, Math.round((24 * 14 / points.length) * 100)) || 100;
  chart = chart || echarts.init($("chart"));
  chart.setOption({
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: ["Actual", "Predicted", "Flagged"] },
    grid: { left: 50, right: 16, top: 36, bottom: 60 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: results.unit },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: "#333", lineStyle: { width: 1 },
        data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#1a5fb4", lineStyle: { width: 1, type: "dashed" },
        data: points.map((p) => [p.t, p.predicted]) },
      { name: "Flagged", type: "scatter", symbolSize: 6, color: "#d62828",
        data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ],
  }, true);
}

function showCounts() {
  const c = report.episode_counts;
  $("counts").textContent = c.total
    ? `${c.total} episodes: ${c["Unusual pollution"] || 0} unusual pollution, ${c["Data limitation"] || 0} data limitations, ${c["Unclear"] || 0} unclear.`
    : "No episodes were flagged.";
}

function showPatterns() {
  const p = results.patterns;
  $("patterns").textContent = p ? p.text : "";
  $("chart-patterns").hidden = !p;
  if (!p) return;
  patternChart = patternChart || echarts.init($("chart-patterns"));
  patternChart.setOption({
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: Object.keys(p.by_hour) },
    grid: { left: 36, right: 10, top: 30, bottom: 30 },
    xAxis: { type: "category", data: [...Array(24).keys()].map((h) => `${h}`), name: "hour" },
    yAxis: { type: "value", minInterval: 1 },
    series: Object.entries(p.by_hour).map(([kind, counts]) => ({
      name: kind, type: "bar", stack: "all", data: counts, color: KIND_COLOR[kind],
    })),
  }, true);
}

function showEpisodes() {
  const filter = $("episode-filter").value;
  const matching = report.episodes.filter((e) => filter === "all" || e.type === filter);
  const list = showAll ? matching : [...matching].sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, 10);
  $("episodes-title").textContent = showAll ? "All episodes, in time order" : `The ${Math.min(10, matching.length)} biggest episodes`;
  $("episodes").innerHTML = list.length
    ? list.map((e) => `<div class="episode ${KIND_CLASS[e.type] || "unclear"}">
        <h3>Episode ${e.id} · <span class="tag">${e.type}</span>
          <span class="meta">${e.confidence ? `· ${e.confidence} confidence` : ""}${e.severity ? ` · ${Number(e.severity).toFixed(1)}× the limit` : ""}</span></h3>
        <p>${e.explanation}</p></div>`).join("")
    : "<p>No episodes of this kind here.</p>";
  $("more").hidden = matching.length <= 10;
  $("more").textContent = showAll ? "Show only the 10 biggest" : `Show all ${matching.length} in time order`;
}

// ---------- prediction form ----------
function buildForm() {
  $("predict-form").innerHTML = [...results.features, "observed"]
    .map((f) => `<label>${LABELS[f] || f}<input name="${f}" type="number" step="any"></label>`).join("");
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
    let text = `Predicted ${r.pollutant} for the next hour: ${fmt(r.prediction)} ${r.unit} (${r.model}).`;
    box.className = "result";
    if (r.episode_check) {
      const c = r.episode_check;
      box.className = c.flagged ? "result flagged" : "result";
      text += ` The actual value was ${fmt(c.observed)}, a difference of ${fmt(Math.abs(c.deviation))}. ` +
        (c.flagged ? `That is more than the ${fmt(c.threshold)} limit, so this hour would be flagged.`
                   : `That is within the ${fmt(c.threshold)} limit, so this hour looks normal.`);
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
    // Training runs on the server in the background; check on it every few seconds.
    while (job.status === "waiting" || job.status === "training") {
      const seconds = Math.round((Date.now() - started) / 1000);
      box.textContent = job.status === "waiting"
        ? `Waiting for another training to finish… (${seconds}s)`
        : `Training models for ${job.pollutants.join(", ")}… (${seconds}s). This can take a few minutes on the online server.`;
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
