// Air quality app: live air for any city, the two research datasets, and a plain explanation of how it works.

const LABELS = {
  hour: "Hour (0-23)", weekday: "Weekday (0 = Monday)",
  lag_1: "Value 1 hour before", lag_2: "Value 2 hours before", lag_3: "Value 3 hours before",
  lag_24: "Value 24 hours before", temperature: "Temperature (°C)", relative_humidity: "Relative humidity (%)",
  absolute_humidity: "Absolute humidity", pressure: "Pressure (hPa)", dew_point: "Dew point (°C)",
  rain: "Rain (mm)", wind_speed: "Wind speed (m/s)", observed: "Actual value (optional)",
};
const TOP = 6;   // episodes shown before "Show all"
const KINDS = ["Unusual pollution", "Data limitation", "Unclear"];   // names used by the API
const KIND_LABEL = { "Unusual pollution": "Real pollution event", "Data limitation": "Probably a data problem", "Unclear": "Not sure" };
const KIND_CLASS = { "Unusual pollution": "unusual", "Data limitation": "data", "Unclear": "unclear" };
const KIND_COLOR = { "Unusual pollution": "#ea580c", "Data limitation": "#7c3aed", "Unclear": "#94a3b8" };

// US EPA air quality index bands, with the PM2.5 range (µg/m³) each one covers
const AQI_SCALE = [
  { top: 50, pm: [0, 9], name: "Good", short: "Good", color: "#16a34a" },
  { top: 100, pm: [9, 35.4], name: "Moderate", short: "Moderate", color: "#ca8a04" },
  { top: 150, pm: [35.4, 55.4], name: "Unhealthy for sensitive groups", short: "Sensitive groups", color: "#ea580c" },
  { top: 200, pm: [55.4, 125.4], name: "Unhealthy", short: "Unhealthy", color: "#dc2626" },
  { top: 300, pm: [125.4, 225.4], name: "Very unhealthy", short: "Very unhealthy", color: "#9333ea" },
  { top: 500, pm: [225.4, 500], name: "Hazardous", short: "Hazardous", color: "#7f1d1d" },
];
// WHO 2021 daily guideline levels (µg/m³), used to say whether a pollutant is high
const WHO_DAILY = { "PM2.5": 15, PM10: 45, NO2: 25, O3: 100, SO2: 40, CO: 4000 };
const NAMES = { "PM2.5": "Fine dust", PM10: "Coarse dust", NO2: "Nitrogen dioxide", O3: "Ozone", SO2: "Sulphur dioxide", CO: "Carbon monoxide" };
const QUICK = [
  ["Hyderabad", 17.385, 78.4867], ["Delhi", 28.6139, 77.209], ["Mumbai", 19.076, 72.8777],
  ["Bengaluru", 12.9716, 77.5946], ["Chennai", 13.0827, 80.2707], ["Kolkata", 22.5726, 88.3639],
  ["London", 51.5072, -0.1276], ["New York", 40.7128, -74.006],
];

let datasets = [];
let dataset = null;   // the selected research dataset
let results = null;   // numbers for the selected pollutant
let report = null;    // the same results in words
let filter = "all";
let showAll = false;
let chart = null;
let patternChart = null;
let liveChart = null;
let historyChart = null;
let live = null;          // the latest live result
let liveRequest = 0;      // so an older, slower answer can't replace a newer one
let researchStarted = false;

const $ = (id) => document.getElementById(id);
const CALM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;   // no animation for people who asked for less motion

// ---------- small helpers ----------
const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(d));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-11-16T15:00:00" -> "3 pm" (times are already in the city's local time)
function hourText(iso) {
  const h = Number(iso.slice(11, 13));
  return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
}
// Adds "today" / "tomorrow" / weekday, compared with the reference date
function dayHourText(iso, ref) {
  const day = iso.slice(0, 10);
  const today = ref.slice(0, 10);
  const next = new Date(`${today}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const label = day === today ? "today" : day === tomorrow ? "tomorrow" : DAYS[new Date(`${day}T12:00:00`).getDay()];
  return `${hourText(iso)} ${label}`;
}

async function getJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw body;
  return body;
}

function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
function recall(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

// ---------- motion ----------
// Counts a number up from 0 over about 0.8 seconds
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
function revealOnScroll(scope = document) {
  const items = scope.querySelectorAll(".card, .grid2, .now-grid");
  if (CALM || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("shown"); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  items.forEach((el) => { el.classList.remove("shown"); el.classList.add("reveal"); io.observe(el); });
  // Safety net: if the browser never reports visibility (e.g. a background tab), show everything anyway
  setTimeout(() => items.forEach((el) => el.classList.add("shown")), 1500);
}

// The header moves slower than the page, and each chart drifts a little as it passes through the screen.
function parallax() {
  if (CALM) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    if (document.documentElement.classList.contains("no-motion")) return;
    document.documentElement.style.setProperty("--scroll", String(Math.min(window.scrollY, 600)));
    const middle = window.innerHeight / 2;
    document.querySelectorAll("[data-parallax]").forEach((el) => {
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

// Lets a width transition play: render at 0, then set the real width a moment later
function growWidths(container) {
  const apply = () => container.querySelectorAll("[data-width]").forEach((el) => { el.style.width = el.dataset.width; });
  if (CALM) { apply(); return; }
  setTimeout(apply, 50);
}

// ---------- tabs ----------
function openView(name) {
  if (!["live", "research", "how"].includes(name)) name = "live";
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll(".tabs a").forEach((a) => {
    if (a.dataset.view === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (name === "research" && !researchStarted) { researchStarted = true; startResearch(); }
  // charts drawn while their tab was hidden have no size yet
  setTimeout(() => [chart, patternChart, liveChart, historyChart].forEach((c) => c && c.resize()), 30);
}

async function start() {
  window.addEventListener("hashchange", () => openView(location.hash.slice(1)));
  window.addEventListener("resize", () => [chart, patternChart, liveChart, historyChart].forEach((c) => c && c.resize()));
  startLive();
  openView(location.hash.slice(1) || "live");
  revealOnScroll();
  parallax();
  // Safety net: if the browser froze the animations (some background tabs and capture tools do),
  // switch motion off so nothing is left half-faded
  setTimeout(() => {
    const stuck = document.getAnimations && document.getAnimations()
      .some((a) => a.playState === "running" && (a.currentTime || 0) < 600);
    if (stuck) document.documentElement.classList.add("no-motion");
  }, 1500);
}

// =====================================================================
// LIVE AIR
// =====================================================================
function startLive() {
  $("quick-cities").innerHTML = QUICK.map(([name, lat, lon]) =>
    `<button type="button" class="chip-btn" data-name="${esc(name)}" data-lat="${lat}" data-lon="${lon}">${esc(name)}</button>`).join("");
  $("quick-cities").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) loadLive(Number(b.dataset.lat), Number(b.dataset.lon), b.dataset.name);
  });
  $("city-form").addEventListener("submit", searchCity);
  $("city-results").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("city-results").hidden = true;
    $("city-input").value = b.dataset.name;
    loadLive(Number(b.dataset.lat), Number(b.dataset.lon), b.dataset.name);
  });
  $("aqi-scale").innerHTML = AQI_SCALE.map((b) =>
    `<span style="--c:${b.color}" title="${esc(b.name)}"><i>${b.top}</i><small>${esc(b.short)}</small></span>`).join("");
  $("my-location").addEventListener("click", useMyLocation);
  $("share-link").addEventListener("click", shareLink);
  const q = new URLSearchParams(location.search);
  const shared = q.has("lat") && q.has("lon") ? { name: q.get("place") || "Shared place", lat: Number(q.get("lat")), lon: Number(q.get("lon")) } : null;
  const last = shared || recall("city") || { name: "Hyderabad", lat: 17.385, lon: 78.4867 };
  loadLive(last.lat, last.lon, last.name);
}

async function searchCity(event) {
  event.preventDefault();
  const q = $("city-input").value.trim();
  const list = $("city-results");
  if (q.length < 2) return;
  list.hidden = false;
  list.innerHTML = `<li class="small">Searching…</li>`;
  try {
    const places = await getJSON(`/api/live/search?q=${encodeURIComponent(q)}`);
    list.innerHTML = places.length ? places.map((p) => {
      const where = [p.region, p.country].filter(Boolean).join(", ");
      return `<li><button type="button" data-name="${esc(p.name)}" data-lat="${p.lat}" data-lon="${p.lon}">
        <b>${esc(p.name)}</b> <span class="small">${esc(where)}</span></button></li>`;
    }).join("") : `<li class="small">No place found with that name. Try the English spelling.</li>`;
  } catch (err) {
    list.innerHTML = `<li class="small">${esc(err.detail || "The search didn't work. Please try again.")}</li>`;
  }
}

async function loadLive(lat, lon, name) {
  const request = ++liveRequest;
  document.querySelectorAll("#quick-cities button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.name === name)));
  $("live-error").hidden = true;
  $("live-loading").hidden = false;
  try {
    const data = await getJSON(`/api/live?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`);
    if (request !== liveRequest) return;
    live = data;
    remember("city", { name, lat, lon });
    history.replaceState(null, "", `?place=${encodeURIComponent(name)}&lat=${lat}&lon=${lon}${location.hash || "#live"}`);
    $("live-loading").hidden = true;
    $("live-content").hidden = false;
    showLive();
  } catch (err) {
    if (request !== liveRequest) return;
    $("live-loading").hidden = true;
    $("live-error").hidden = false;
    $("live-error").textContent = (err && err.detail) || "Couldn't load the air data. Check your connection and try again.";
  }
}

function showLive() {
  const now = live.now;
  countUp($("now-aqi"), now.aqi, 0);
  $("now-ring").style.setProperty("--aqi-color", now.color);
  $("now-ring").style.setProperty("--aqi-fill", `${Math.min(100, (now.aqi / 300) * 100)}%`);
  $("now-category").textContent = now.category;
  $("now-category").style.color = now.color;
  $("now-advice").textContent = now.advice;
  $("now-meta").textContent = `${live.place || "This area"} · fine dust ${fmt(now.pm25, 0)} µg/m³ · ${dayHourText(now.time, live.updated)} local time`;
  $("aqi-scale").querySelectorAll("span").forEach((s, i) => s.classList.toggle("here", AQI_SCALE[i].name === now.category));

  $("live-headline").textContent = live.headline;
  const pick = (id, t, good) => {
    $(`${id}-time`).textContent = t ? dayHourText(t.time, live.updated) : "–";
    $(`${id}-note`).textContent = t ? `AQI about ${t.aqi} · ${t.category}` : "";
    if (t) $(`${id}-time`).style.color = good ? "#15803d" : "#b91c1c";
  };
  pick("best", live.best_time, true);
  pick("worst", live.worst_time, false);

  $("reasons").innerHTML = (live.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  showAdvice();
  showNormal();
  showHourly();
  playWhenVisible($("live-chart"), drawLiveChart);
  showPollutants();
  showAccuracy();
  showLiveEpisodes();
  $("live-source").innerHTML = `Data: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>, using the
    Copernicus CAMS air quality model. These are estimates for the area (about 11 km across), not a reading from one street.
    Forecast method: ${esc(live.model)}. Refreshed every hour.`;
  revealOnScroll($("live-content"));
}

// ---------- what should I do? ----------
function verdictFor(aqi, limits) {
  if (aqi <= limits[0]) return ["ok", "Fine to be active outside."];
  if (aqi <= limits[1]) return ["care", "OK, but take it easier on long or hard exercise."];
  if (aqi <= limits[2]) return ["reduce", "Cut down on long or hard outdoor activity and take breaks indoors."];
  return ["avoid", "Avoid outdoor exercise. Stay indoors where you can."];
}

function showAdvice() {
  const fc = live.forecast;
  const now = live.now.aqi;
  const groups = [
    ["Everyone", [100, 150, 200]],
    ["Children, older people, and anyone with asthma or heart problems", [50, 100, 150]],
  ];
  let html = groups.map(([who, limits]) => {
    const [cls, text] = verdictFor(now, limits);
    return `<div class="advice-row ${cls}"><span class="dot"></span><div><b>${esc(who)}</b><p>${esc(text)}</p></div></div>`;
  }).join("");

  // best 2-hour window in the daytime (6 am to 9 pm) for a walk or exercise
  let best = null;
  for (let i = 0; i < fc.length - 1; i++) {
    const h = Number(fc[i].time.slice(11, 13));
    if (h < 6 || h > 20) continue;
    const avg = (fc[i].aqi + fc[i + 1].aqi) / 2;
    if (!best || avg < best.avg) best = { avg, from: fc[i].time, to: fc[i + 1].time };
  }
  const tips = [];
  if (best) tips.push(`<b>${best.avg > 150 ? "Least bad" : "Best"} time for a walk or exercise:</b> ${esc(dayHourText(best.from, live.updated))} to ${esc(hourText(best.to))}
    (AQI about ${Math.round(best.avg)}).`);
  const bad = fc.filter((f) => f.aqi > 150);
  if (bad.length) {
    tips.push(`<b>Keep windows closed</b> from ${esc(dayHourText(bad[0].time, live.updated))} to ${esc(dayHourText(bad[bad.length - 1].time, live.updated))},
      when the air is unhealthy.`);
    tips.push(`If you have to be outside for long, a well-fitting <b>N95 mask</b> helps. Cloth masks do little against fine dust.`);
    tips.push(`Indoors, an air purifier with a <b>HEPA filter</b> makes a real difference.`);
  } else if (Math.max(now, ...fc.map((f) => f.aqi)) <= 50) {
    tips.push("The air stays clean all day. A good day to open the windows.");
  }
  html += tips.length ? `<ul class="tips-list">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
  $("advice").innerHTML = html;
}

// ---------- is today normal? ----------
function showNormal() {
  const n = live.normal;
  if (!n) return;
  $("normal-title").textContent = `Is today normal for ${live.place || "this area"}?`;
  $("normal-text").textContent = `The last 24 hours were ${n.verdict}: worse than ${n.worse_than_pct}% of the days in the last 3 months.`;
  $("normal-now").textContent = `${fmt(n.last_24h_avg, 0)} µg/m³`;
  $("normal-typical").textContent = `${fmt(n.typical_day, 0)} µg/m³`;
  $("normal-cig").textContent = `≈ ${fmt(n.cigarettes, 1)} cigarette${n.cigarettes === 1 ? "" : "s"}`;
  playWhenVisible($("history-chart"), drawHistory);
}

function drawHistory() {
  const days = live.normal.daily;
  historyChart = historyChart || echarts.init($("history-chart"));
  historyChart.setOption({
    animation: !CALM, animationDuration: 700, animationDelay: (i) => i * 6,
    tooltip: { trigger: "axis", formatter: (items) => {
      const d = days[items[0].dataIndex];
      return `<b>${esc(d.date)}</b><br>Fine dust ${fmt(d.pm25, 0)} µg/m³<br>AQI about ${d.aqi}, ${esc(d.category)}`;
    } },
    grid: { left: 34, right: 6, top: 8, bottom: 22 },
    xAxis: { type: "category", data: days.map((d) => d.date.slice(5)), axisLabel: { interval: 14 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: [{ type: "bar", barWidth: "70%", data: days.map((d) => ({ value: d.pm25, itemStyle: { color: d.color, borderRadius: [2, 2, 0, 0] } })) }],
  }, true);
}

// ---------- my location and sharing ----------
function useMyLocation() {
  if (!navigator.geolocation) { showLiveError("This browser can't share your location. Search for your city instead."); return; }
  $("my-location").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition((pos) => {
    $("my-location").textContent = "Use my location";
    loadLive(Number(pos.coords.latitude.toFixed(3)), Number(pos.coords.longitude.toFixed(3)), "Your location");
  }, () => {
    $("my-location").textContent = "Use my location";
    showLiveError("We couldn't get your location (permission was denied or it timed out). Search for your city instead.");
  }, { timeout: 10000 });
}

function showLiveError(text) {
  $("live-error").hidden = false;
  $("live-error").textContent = text;
}

async function shareLink() {
  const button = $("share-link");
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Link copied!";
  } catch (e) {
    window.prompt("Copy this link:", location.href);
  }
  setTimeout(() => { button.textContent = "Copy link to this city"; }, 2000);
}

function showHourly() {
  const hours = live.forecast.filter((f) => f.hours_ahead % 3 === 0);
  $("hourly").innerHTML = hours.map((f) => `<div class="hour" style="--c:${f.color}">
      <span class="small">${esc(hourText(f.time))}</span><b>${f.aqi}</b><span class="hour-cat">${esc(f.category)}</span></div>`).join("");
}

function drawLiveChart() {
  const past = live.last_48h.filter((p) => p.pm25 != null);
  const fc = live.forecast;
  const lastPast = past[past.length - 1];
  const top = Math.max(...past.map((p) => p.pm25), ...fc.map((f) => f.high)) * 1.15;
  const bands = AQI_SCALE.filter((b) => b.pm[0] < top).map((b) => [
    { yAxis: b.pm[0], itemStyle: { color: b.color, opacity: 0.08 } }, { yAxis: Math.min(b.pm[1], top) }]);
  const byTime = Object.fromEntries(fc.map((f) => [f.time, f]));
  liveChart = liveChart || echarts.init($("live-chart"));
  liveChart.setOption({
    animation: !CALM, animationDuration: 900, animationEasing: "cubicOut",
    tooltip: {
      trigger: "axis",
      formatter: (items) => {
        const t = items[0].value[0];
        const f = byTime[t];
        const real = items.find((i) => i.seriesName === "Measured");
        let html = `<b>${esc(dayHourText(t, live.updated))}</b><br>`;
        if (real && real.value[1] != null) html += `Measured: ${fmt(real.value[1], 0)} µg/m³<br>`;
        if (f) html += `Forecast: ${fmt(f.pm25, 0)} µg/m³ (likely ${fmt(f.low, 0)}–${fmt(f.high, 0)})<br>AQI about ${f.aqi}, ${esc(f.category)}`;
        return html;
      },
    },
    legend: { data: ["Measured", "Forecast", "Likely range"], top: 0 },
    grid: { left: 44, right: 16, top: 34, bottom: 28 },
    xAxis: { type: "time", axisLabel: { formatter: (v) => { const d = new Date(v); const h = d.getHours();
      return h === 0 ? DAYS[d.getDay()] : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`; } } },
    yAxis: { type: "value", name: "µg/m³", max: Math.ceil(top), splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: [
      { name: "Measured", type: "line", showSymbol: false, color: "#4f46e5", lineStyle: { width: 2 },
        data: past.map((p) => [p.time, p.pm25]),
        markArea: { silent: true, data: bands },
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#64748b", type: "dotted" },
          label: { formatter: "Now", color: "#475569" }, data: [{ xAxis: lastPast.time }] } },
      { name: "range-low", type: "line", stack: "range", showSymbol: false, lineStyle: { opacity: 0 },
        data: fc.map((f) => [f.time, f.low]), tooltip: { show: false } },
      { name: "Likely range", type: "line", stack: "range", showSymbol: false, lineStyle: { opacity: 0 }, color: "#0ea5e9",
        areaStyle: { color: "rgba(14,165,233,0.18)" }, data: fc.map((f) => [f.time, f.high - f.low]) },
      { name: "Forecast", type: "line", showSymbol: false, color: "#0d9488", lineStyle: { width: 2, type: "dashed" },
        data: [[lastPast.time, lastPast.pm25], ...fc.map((f) => [f.time, f.pm25])] },
    ],
  }, true);
}

function showPollutants() {
  $("pollutants").innerHTML = live.pollutants.map((p) => {
    const limit = WHO_DAILY[p.key];
    const ratio = limit ? p.value / limit : null;
    const color = ratio == null ? "#94a3b8" : ratio <= 1 ? "#16a34a" : ratio <= 2 ? "#ea580c" : "#dc2626";
    const verdict = ratio == null ? "" : ratio <= 1 ? "Within the WHO daily guideline"
      : `About ${fmt(ratio, 1)}× the WHO daily guideline`;
    return `<div class="pollutant">
        <div class="p-head"><b>${esc(NAMES[p.key] || p.key)}</b> <span class="small">${esc(p.key)}</span>
          <span class="p-value">${fmt(p.value, 0)} <small>${esc(p.unit)}</small></span></div>
        <div class="p-bar"><span data-width="${Math.min(100, (ratio || 0) * 50)}%" style="background:${color}"></span><i title="WHO guideline"></i></div>
        <p class="small"><span style="color:${color};font-weight:600">${esc(verdict)}</span>. ${esc(p.about)}</p>
      </div>`;
  }).join("") + `<p class="small">The tick on each bar is the World Health Organization's daily guideline.</p>`;
  growWidths($("pollutants"));
}

function showAccuracy() {
  const a = live.accuracy;
  $("acc-1").textContent = `± ${fmt(a.typical_error_1h, 0)}`;
  $("acc-6").textContent = `± ${fmt(a.typical_error_6h, 0)}`;
  $("acc-24").textContent = `± ${fmt(a.typical_error_24h, 0)}`;
  $("acc-plain").textContent = a.plain;
}

function showLiveEpisodes() {
  const c = live.episode_counts;
  $("live-episode-count").textContent = live.episode_count
    ? `${live.episode_count} found: ${c["Unusual pollution"] || 0} real events, ${c["Data limitation"] || 0} data problems, ${c["Unclear"] || 0} not sure`
    : "";
  $("live-episodes").innerHTML = live.episodes.length
    ? live.episodes.map((e) => episodeCard(e, "µg/m³")).join("")
    : `<p class="small">No unusual hours in the last month. The air behaved as the model expected.</p>`;
}

// =====================================================================
// RESEARCH DATASETS
// =====================================================================
async function startResearch() {
  $("dataset").addEventListener("change", () => pickDataset($("dataset").value));
  $("pollutant").addEventListener("change", () => pickPollutant($("pollutant").value));
  $("more").addEventListener("click", () => { showAll = !showAll; showEpisodes(); });
  $("load-sample").addEventListener("click", loadSample);
  $("predict-form").addEventListener("submit", predict);
  $("upload-form").addEventListener("submit", upload);
  revealOnScroll($("view-research"));
  try {
    await loadDatasets();
  } catch (err) {
    $("headline").textContent = "Couldn't load the research results. Please refresh the page.";
    return;
  }
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

let researchRequest = 0;   // same idea as liveRequest: only the newest choice gets drawn
async function pickPollutant(key) {
  const request = ++researchRequest;
  const [newResults, newReport] = await Promise.all([
    getJSON(`/api/results/${dataset.id}/${key}`),
    getJSON(`/api/report/${dataset.id}/${key}`),
  ]);
  if (request !== researchRequest) return;
  results = newResults;
  report = newReport;
  $("download").href = `/api/report/${dataset.id}/${key}?download=true`;
  $("download-csv").href = `/api/episodes/${dataset.id}/${key}`;
  filter = "all";
  showAll = false;
  showKpis();
  showHeadline();
  showTrust();
  playWhenVisible($("chart"), drawChart);
  showModels();
  playWhenVisible($("chart-patterns"), drawPatterns);
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
  countUp($("kpi-error"), best.test.MAE, best.test.MAE < 10 ? 3 : 1, "± ", `<span class="unit">${esc(unit)}</span>`);
  $("kpi-model").textContent = `using ${results.model}`;
  countUp($("kpi-gain"), Math.abs(gain), 1, gain >= 0 ? "+" : "−", "%");
  $("kpi-gain").className = "kpi-value " + (gain >= 1 ? "good" : gain <= -1 ? "bad" : "");
  $("kpi-gain-note").textContent = gain >= 1 ? "than assuming the next hour = this hour"
    : gain <= -1 ? "the simple guess wins here" : "about the same as the simple guess";
  countUp($("kpi-r2"), Math.max(0, best.test.R2 * 100), 0, "", "%");

  const counts = results.episode_counts;
  countUp($("kpi-episodes"), counts.total, 0);
  $("kpi-mix").innerHTML = KINDS.map((k) => counts.total
    ? `<span data-width="${(100 * (counts[k] || 0)) / counts.total}%" style="background:${KIND_COLOR[k]}"></span>` : "").join("");
  growWidths($("kpi-mix"));
  $("kpi-mix-note").textContent = `${counts["Unusual pollution"] || 0} real · ${counts["Data limitation"] || 0} data problems · ${counts["Unclear"] || 0} not sure`;
}

function showHeadline() {
  const best = results.models.find((m) => m.model === results.model);
  const gain = results.improvement_vs_persistence_pct;
  const unit = results.unit || "";
  const compare = gain >= 1 ? `${fmt(gain, 1)}% closer than simply assuming it stays the same as the last hour`
    : `about as close as simply assuming it stays the same, because ${results.pollutant} changes slowly here`;
  $("headline").textContent = `Our model predicts next hour's ${results.pollutant} with a typical miss of ${fmt(best.test.MAE, 2)} ${unit}, ${compare}.`;
  $("summary").textContent = report.summary;
}

// Accuracy in plain terms, and whether the model memorised its training data
function showTrust() {
  const o = results.overfitting_check;
  const within = results.accuracy_within_20pct;
  $("trust").hidden = !o && within == null;
  if (within != null) countUp($("within20"), within, 0, "", "%");
  if (!o) return;
  const kind = o.verdict === "No sign of overfitting" ? "good" : o.verdict.startsWith("Mild") ? "mild" : "bad";
  $("fit-badge").className = `trust-badge ${kind}`;
  $("fit-verdict").textContent = `Overfitting check: ${o.verdict.toLowerCase()}`;
  const why = o.explanation.slice(o.explanation.indexOf(":") + 2);
  $("fit-text").textContent = `Typical miss on the hours it learned from: ${fmt(o.mae_on_learned_data, 3)} ${results.unit}; ` +
    `on new hours: ${fmt(o.mae_on_test, 3)} ${results.unit}. ${why.charAt(0).toUpperCase()}${why.slice(1)}`;
}

// ---------- charts ----------
function drawChart() {
  const points = results.test_predictions;
  const end = Math.min(100, Math.round((24 * 14 / points.length) * 100)) || 100;
  chart = chart || echarts.init($("chart"));
  chart.setOption({
    animation: !CALM, animationDuration: 900, animationEasing: "cubicOut",
    tooltip: { trigger: "axis" },
    legend: { data: ["What really happened", "Our prediction", "Unusual hour"], top: 0 },
    grid: { left: 50, right: 16, top: 34, bottom: 60 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: results.unit, splitLine: { lineStyle: { color: "#eef2f7" } } },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "What really happened", type: "line", showSymbol: false, color: "#4f46e5", lineStyle: { width: 1.4 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(79,70,229,0.28)" }, { offset: 1, color: "rgba(14,165,233,0.02)" }]) },
        data: points.map((p) => [p.t, p.actual]) },
      { name: "Our prediction", type: "line", showSymbol: false, color: "#0d9488", lineStyle: { width: 1.4, type: "dashed" },
        data: points.map((p) => [p.t, p.predicted]) },
      { name: "Unusual hour", type: "scatter", symbolSize: 8, color: "#ea580c", itemStyle: { borderColor: "#fff", borderWidth: 1 },
        data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ],
  }, true);
}

function showModels() {
  const rows = report.models_compared;
  const max = Math.max(...rows.map((m) => m.test_error)) || 1;
  $("models").innerHTML = rows.map((m) => {
    const baseline = m.model.startsWith("Persistence");
    const name = baseline ? "Simple guess (same as last hour)" : m.model;
    const cls = m.model === results.model ? "chosen" : baseline ? "baseline" : "";
    return `<div class="bar-row ${cls}"><span>${esc(name)}</span>
      <div class="bar-track"><div class="bar-fill" data-width="${(100 * m.test_error) / max}%"></div></div>
      <span class="bar-value">${fmt(m.test_error, m.test_error < 10 ? 3 : 1)}</span></div>`;
  }).join("") + `<p class="small">Shorter is better. The coloured bar is the method we chose.</p>`;
  playWhenVisible($("models"), () => growWidths($("models")));
}

function drawPatterns() {
  const p = results.patterns;
  $("patterns").textContent = p ? p.text : "Run the training again to see when unusual periods happen.";
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
      name: KIND_LABEL[k], type: "bar", stack: "all", data: p.by_hour[k], color: KIND_COLOR[k], barWidth: "60%",
      itemStyle: { borderRadius: [3, 3, 0, 0] },
    })),
  }, true);
}

// ---------- episodes ----------
function showFilters() {
  const counts = results.episode_counts;
  const options = [["all", `All (${counts.total})`], ...KINDS.map((k) => [k, `${KIND_LABEL[k]} (${counts[k] || 0})`])];
  $("filters").innerHTML = options.map(([value, label]) =>
    `<button type="button" data-filter="${esc(value)}" aria-pressed="${value === filter}">${esc(label)}</button>`).join("");
  $("filters").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    showAll = false;
    showFilters();
    showEpisodes();
  }));
}

function episodeCard(e, unit) {
  const diff = e.difference ?? (e.peak_value != null && e.expected_value != null ? e.peak_value - e.expected_value : null);
  const agreeing = (e.checks && e.checks.other_pollutants_agreeing) || [];
  const numbers = e.peak_value != null
    ? `Reached <b>${fmt(e.peak_value)}</b> ${esc(unit)}, we expected <b>${fmt(e.expected_value)}</b>
       <span class="${diff > 0 ? "up" : "down"}">(${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))})</span>` +
      (agreeing.length ? ` · also ${diff > 0 ? "up" : "down"}: ${esc(agreeing.join(", "))}` : "")
    : "";
  const sure = { high: "fairly sure", medium: "somewhat sure", low: "not very sure" }[e.confidence] || "";
  const meta = [sure, e.severity ? `${fmt(e.severity, 1)}× bigger miss than usual` : ""].filter(Boolean).join(" · ");
  const cls = KIND_CLASS[e.type] || "unclear";
  return `<article class="episode ${cls}">
      <div class="ep-top"><span class="ep-when">${esc(e.when || e.start)}</span>
        <span class="chip ${cls}">${esc(KIND_LABEL[e.type] || e.type)}</span>
        <span class="ep-meta">${esc(meta)}</span></div>
      ${numbers ? `<p class="ep-numbers">${numbers}</p>` : ""}
      <details><summary>Why do we think so?</summary><p>${esc(e.explanation || e.reason)}</p></details>
    </article>`;
}

function showEpisodes() {
  const matching = results.episodes.filter((e) => filter === "all" || e.type === filter);
  const list = showAll ? matching : [...matching].sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, TOP);
  $("episodes").innerHTML = list.length ? list.map((e) => episodeCard(e, results.unit || "")).join("")
    : `<p class="small">None of this kind.</p>`;
  $("more").hidden = matching.length <= TOP;
  $("more").textContent = showAll ? `Show only the ${TOP} biggest` : `Show all ${matching.length} in time order`;
}

// ---------- API demo ----------
function buildForm() {
  $("predict-form").innerHTML = [...results.features, "observed"]
    .map((f) => `<label>${esc(LABELS[f] || f)}<input name="${esc(f)}" type="number" step="any"></label>`).join("");
}

async function loadSample() {
  const asked = results;
  const sample = await getJSON(`/api/sample/${dataset.id}/${results.pollutant}`);
  if (asked !== results) return;   // the pollutant changed while this was loading
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
        (c.flagged ? `That is more than the ${fmt(c.threshold, 3)} limit, so this hour would count as unusual.`
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
