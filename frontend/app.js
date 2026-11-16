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
const KIND_COLOR = { "Unusual pollution": "#ea580c", "Data limitation": "#7c3aed", "Unclear": "#94a3b8" };

let datasets = [];
let dataset = null;   // the selected dataset
let results = null;   // numbers for the selected pollutant
let report = null;    // the same results in words
let filter = "all";
let showAll = false;
let chart = null;
let patternChart = null;

const $ = (id) => document.getElementById(id);
const CALM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;   // no animation for people who asked for less motion

// Counts a number up from 0, e.g. 0.000 -> 0.393, over about 0.8 seconds
function countUp(el, value, decimals, before = "", afterHtml = "") {
  const show = (v) => { el.innerHTML = `${before}${v.toFixed(decimals)}${afterHtml}`; };
  const token = (el.dataset.run = String(Math.random()));   // a newer count on the same element wins
  if (CALM || !Number.isFinite(value)) { show(value); return; }
  const start = performance.now();
  const step = (now) => {
    if (el.dataset.run !== token) return;
    const t = Math.min(1, (now - start) / 800);
    show(value * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // Safety net: browsers pause animations in hidden tabs, so make sure the final number always shows
  setTimeout(() => { if (el.dataset.run === token) { el.dataset.run = ""; show(value); } }, 1000);
}

// Sections fade in as they scroll into view
function revealOnScroll() {
  const items = document.querySelectorAll("main .card, main .grid2");
  if (CALM || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("shown"); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  items.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  // Safety net: if the browser never reports visibility (e.g. a background tab), show everything anyway
  setTimeout(() => items.forEach((el) => el.classList.add("shown")), 1500);
}

// Lets a width transition play: render at 0, then set the real width on the next frame
// ---------- parallax ----------
// The header moves slower than the page, and each chart drifts a little as it passes through the screen.
function parallax() {
  if (CALM) return;
  const layers = () => document.querySelectorAll("[data-parallax]");
  let ticking = false;
  const update = () => {
    ticking = false;
    if (document.documentElement.classList.contains("no-motion")) return;
    document.documentElement.style.setProperty("--scroll", String(Math.min(window.scrollY, 600)));
    const middle = window.innerHeight / 2;
    layers().forEach((el) => {
      const r = el.parentElement.getBoundingClientRect();
      const raw = (r.top + r.height / 2 - middle) * parseFloat(el.dataset.parallax);
      const shift = Math.max(-16, Math.min(16, raw));    // small drift, so nothing gets cut off
      el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
    });
  };
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    const run = () => { if (ticking) update(); };
    requestAnimationFrame(run);
    setTimeout(run, 100);      // fallback: hidden tabs may never deliver an animation frame
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// Runs `play` the first time `el` scrolls into view (or straight away if it is already on screen).
const pending = new Map();
let watcher = null;
function playWhenVisible(el, play) {
  if (CALM || !("IntersectionObserver" in window)) { play(); return; }
  watcher = watcher || new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting && pending.has(e.target)) {
      const run = pending.get(e.target);
      pending.delete(e.target);
      watcher.unobserve(e.target);
      run();
    }
  }), { threshold: 0.25 });
  pending.set(el, play);
  watcher.unobserve(el);
  watcher.observe(el);
  // Safety net for tabs where the browser never reports visibility
  setTimeout(() => { if (pending.get(el) === play) { pending.delete(el); watcher.unobserve(el); play(); } }, 2500);
}

function growWidths(container) {
  const apply = () => container.querySelectorAll("[data-width]").forEach((el) => { el.style.width = el.dataset.width; });
  if (CALM) { apply(); return; }
  setTimeout(apply, 50);   // a short delay lets the bar start at 0 and grow (works in background tabs too)
}
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
  revealOnScroll();
  parallax();
  await loadDatasets();
  // Safety net: if the browser froze the animations (some background tabs and capture tools do),
  // switch motion off so nothing is left half-faded
  setTimeout(() => {
    const stuck = document.getAnimations && document.getAnimations()
      .some((a) => a.playState === "running" && (a.currentTime || 0) < 600);
    if (stuck) document.documentElement.classList.add("no-motion");
  }, 1500);
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
  countUp($("kpi-error"), best.test.MAE, best.test.MAE < 10 ? 3 : 1, "", `<span class="unit">${esc(unit)}</span>`);
  $("kpi-model").textContent = `${results.model}, per hour`;
  countUp($("kpi-gain"), Math.abs(gain), 1, gain >= 0 ? "+" : "−", "%");
  $("kpi-gain").className = "kpi-value " + (gain >= 1 ? "good" : gain <= -1 ? "bad" : "");
  $("kpi-gain-note").textContent = gain >= 1 ? "more accurate than the simple guess"
    : gain <= -1 ? "the simple guess wins here" : "about the same as the simple guess";
  countUp($("kpi-r2"), best.test.R2, 2);

  const counts = results.episode_counts;
  countUp($("kpi-episodes"), counts.total, 0);
  $("kpi-mix").innerHTML = KINDS.map((k) => counts.total
    ? `<span data-width="${(100 * (counts[k] || 0)) / counts.total}%" style="background:${KIND_COLOR[k]}"></span>` : "").join("");
  growWidths($("kpi-mix"));
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
  playWhenVisible($("chart"), drawChart);
}

function drawChart() {
  const points = results.test_predictions;
  const end = Math.min(100, Math.round((24 * 14 / points.length) * 100)) || 100;
  chart = chart || echarts.init($("chart"));
  chart.setOption({
    animation: !CALM, animationDuration: 900, animationEasing: "cubicOut",
    tooltip: { trigger: "axis" },
    legend: { data: ["Actual", "Predicted", "Flagged"], top: 0 },
    grid: { left: 50, right: 16, top: 34, bottom: 60 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: results.unit, splitLine: { lineStyle: { color: "#eef2f7" } } },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: "#4f46e5", lineStyle: { width: 1.4 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(79,70,229,0.28)" }, { offset: 1, color: "rgba(14,165,233,0.02)" }]) },
        data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#0d9488", lineStyle: { width: 1.4, type: "dashed" },
        data: points.map((p) => [p.t, p.predicted]) },
      { name: "Flagged", type: "scatter", symbolSize: 8, color: "#ea580c", itemStyle: { borderColor: "#fff", borderWidth: 1 },
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
      <div class="bar-track"><div class="bar-fill" data-width="${(100 * m.test_error) / max}%"></div></div>
      <span class="bar-value">${fmt(m.test_error, m.test_error < 10 ? 3 : 1)}</span></div>`;
  }).join("") + `<p class="small">Lower is better. The coloured bar is the model we chose (picked on the validation period).</p>`;
  playWhenVisible($("models"), () => growWidths($("models")));
}

function showPatterns() {
  playWhenVisible($("chart-patterns"), drawPatterns);
}

function drawPatterns() {
  const p = results.patterns;
  $("patterns").textContent = p ? p.text : "Run the training again to see when episodes happen.";
  if (!p) { if (patternChart) patternChart.clear(); return; }
  patternChart = patternChart || echarts.init($("chart-patterns"));
  patternChart.setOption({
    animation: !CALM, animationDuration: 700, animationEasing: "cubicOut",
    animationDelay: (i) => i * 25,
    tooltip: { trigger: "axis" },
    legend: { show: false },
    grid: { left: 30, right: 8, top: 10, bottom: 24 },
    xAxis: { type: "category", data: [...Array(24).keys()].map((h) => `${h}`) },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: KINDS.filter((k) => p.by_hour[k]).map((k) => ({
      name: k, type: "bar", stack: "all", data: p.by_hour[k], color: KIND_COLOR[k], barWidth: "60%",
      itemStyle: { borderRadius: [3, 3, 0, 0] },
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
