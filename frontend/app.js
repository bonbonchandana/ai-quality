// Air Health Portal: simple air pollution forecasts and health alerts for public health organisations.
//
// Everything comes from main.py: our UCI Air Quality dataset (Italy, 2004-2005) and the models trained on it.
// Only the sign-in below is a stand-in until the backend team adds real accounts.

/* ---------------------------------------------------------------- sign-in (stand-in for the backend) */
const ACCOUNTS = [
  { email: "admin@demo.health", name: "Admin", role: "admin" },
  { email: "doctor@demo.health", name: "Doctor", role: "doctor" },
  { email: "viewer@demo.health", name: "Viewer", role: "viewer" },
];
async function signIn(email, password) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const user = ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());
  if (!user || password !== "demo123") throw new Error("Wrong email or password.");
  return { token: "preview-token", user: { ...user } };
}

/* ---------------------------------------------------------------- data from main.py */
async function getJSON(url) {
  const res = await fetch(url);
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || `The server answered ${res.status}.`);
  return body;
}
const cache = new Map();
const cached = (url) => {
  if (!cache.has(url)) cache.set(url, getJSON(url).catch((err) => { cache.delete(url); throw err; }));
  return cache.get(url);
};
const api = {
  datasets: () => cached("/api/datasets"),
  results: (key) => cached(`/api/results/${encodeURIComponent(key)}`),
  forecast: (key) => cached(`/api/forecast/${encodeURIComponent(key)}`),   // 1 and 2 hours ahead for every hour
  reportUrl: (key) => `/api/report/${encodeURIComponent(key)}?download=true`,
  episodesCsvUrl: (key) => `/api/episodes/${encodeURIComponent(key)}`,
};

/* ---------------------------------------------------------------- what the levels mean, in plain words */
const NAMES = { CO: "Carbon monoxide", NO2: "Nitrogen dioxide", NOx: "Nitrogen oxides", C6H6: "Benzene" };

// CO and NO2 use official health limits (WHO and EU). NOx and benzene have no short-term health limit,
// so for them "Watch" and "Warning" mean higher than 95 and 99 in 100 earlier hours at this station.
const GUIDE = {
  CO: {
    limits: [4, 10],
    good: "Safe.",
    watch: { means: "Above the WHO daily safe level. Risky for people with heart disease if it lasts all day.",
             rising: "If it keeps rising, people with heart disease may get chest pain." },
    warning: { means: "Above the WHO 8-hour safe level. People with heart disease may get chest pain.",
               rising: "If it keeps rising, headaches and dizziness near busy roads." },
  },
  NO2: {
    limits: [200, 400],
    good: "Safe for short exposure.",
    watch: { means: "Above the EU 1-hour limit. Asthma attacks become more likely.",
             rising: "If it keeps rising, breathing problems spread to more people." },
    warning: { means: "At the EU alert level. Breathing problems for many people.",
               rising: "If it keeps rising, even healthy people are affected." },
  },
  NOx: {
    station: true,
    good: "Normal for this area.",
    watch: { means: "Very heavy traffic pollution. Breathing problems are more likely near main roads.",
             rising: "If it keeps rising, treat it like a nitrogen dioxide alert." },
    warning: { means: "Extreme traffic pollution for this area.", rising: "If it keeps rising, reduce traffic in the area." },
  },
  C6H6: {
    station: true,
    good: "Normal for this area.",
    watch: { means: "Unusually high benzene. Harmless for one day, harmful if it keeps happening.",
             rising: "If it keeps rising, find the source (traffic jams, fuel stations)." },
    warning: { means: "Very high benzene for this area. Find and report the source.",
               rising: "Repeated high levels raise the long-term cancer risk." },
  },
};
const ACTIONS = {
  good: ["No action needed.", "Keep checking the forecast."],
  watch: ["Warn people with asthma, heart or lung disease.", "Tell hospitals and doctors to be ready.", "Move school sports away from busy roads."],
  warning: ["Alert the public (news, SMS).", "Ask hospitals to add staff and check oxygen and inhalers.", "Move school sports and breaks indoors.", "Ask the city to reduce traffic."],
};
const CHECKLIST = [
  "Each morning, open the Dashboard and look at each pollutant.",
  "If you see Watch or Warning, follow “What to do”.",
  "Check Unusual changes. A sensor problem goes to the data team.",
  "Once a week, download the report from the Model page.",
];
const LEVELS = { good: ["Good", "good"], watch: ["Watch", "watch"], warning: ["Warning", "warning"], none: ["No data", "none"] };
const KINDS = { "Unusual pollution": ["Real pollution", "real"], "Data limitation": ["Sensor problem", "sensor"], "Unclear": ["Not sure", "unsure"] };

/* ---------------------------------------------------------------- app */
const $ = (id) => document.getElementById(id);
// Every value that goes into HTML passes through esc(): data from a server is never trusted.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return "–";
  const d = Math.abs(n) < 10 ? 1 : 0;
  return esc(n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
};
const CALM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NARROW = window.matchMedia("(max-width: 860px)");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RIGHTS = { admin: ["sendAlerts"], doctor: ["sendAlerts"], viewer: [] };   // the backend must check the same rules

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  changes: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  model: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
};
const PAGES = {
  home: { title: "Dashboard", render: renderHome },
  alerts: { title: "Alerts", render: renderAlerts },
  changes: { title: "Unusual changes", render: renderChanges },
  model: { title: "Model", render: renderModel },
};

const store = {
  get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* keep going without it */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

let session = store.get("ahp-session", null);
let dataset = null;
let pollutant = store.get("ahp-pollutant", null);
const series = {};       // pollutant -> forecast table (all pollutants share the same hours)
const episodesOf = {};   // pollutant -> unusual changes
const sent = new Set();
let charts = [];
let renderToken = 0;
const can = (action) => !!session && (RIGHTS[session.user.role] || []).includes(action);

// ---------- formatting ----------
function clock(d) { const h = d.getHours(); return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`; }
const toDate = (s) => new Date(String(s).replace(" ", "T"));
function fmtTime(s) { const d = toDate(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock(d)}`; }
function fmtMonth(s) { const d = toDate(s); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
const chip = (level) => `<span class="chip ${LEVELS[level][1]}">${LEVELS[level][0]}</span>`;

// ---------- charts ----------
function makeChart(el, option) {
  const chart = echarts.init(el);
  chart.setOption({ animation: !CALM, textStyle: { fontFamily: "Fira Sans, system-ui, sans-serif" }, ...option });
  charts.push(chart);
  return chart;
}
function clearCharts() { charts.forEach((c) => c.dispose()); charts = []; }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
const gridLine = { lineStyle: { color: "#eef2f7" } };

// ---------- levels ----------
function limitsOf(key) {
  const g = GUIDE[key];
  return g.station ? [series[key].levels.high, series[key].levels.very_high] : g.limits;
}
function levelOf(key, value) {
  if (value == null) return "none";
  const [watch, warning] = limitsOf(key);
  return value >= warning ? "warning" : value >= watch ? "watch" : "good";
}
// The level for the next 2 hours: the higher of the two forecasts
function statusAt(key, i) {
  const f = series[key];
  const ahead = [f.f1[i], f.f2[i]];
  const known = ahead.filter((v) => v != null);
  if (!known.length) return { level: "none", now: f.now[i], ahead };
  const top = Math.max(...known);
  return { level: levelOf(key, top), now: f.now[i], ahead, top, at: ahead.indexOf(top) + 1 };
}
const alerting = (level) => level === "watch" || level === "warning";
function lastKnownLevel(key, i) {   // missing hours don't start or end an alert
  for (let j = i - 1; j >= 0; j--) { const level = statusAt(key, j).level; if (level !== "none") return level; }
  return "good";
}
const alertStarts = (key, i) => alerting(statusAt(key, i).level) && !alerting(lastKnownLevel(key, i));
function alertStart(key, i) { let j = i; while (j > 0 && !alertStarts(key, j)) j--; return j; }

// ---------- time: the test period played back hour by hour, as if live ----------
const time = { i: 48, playing: false, timer: null, listener: null };
const hours = () => series[dataset.pollutants[0].key].times;
function setTime(i) {
  time.i = Math.max(0, Math.min(hours().length - 1, i));
  if (time.listener) time.listener();
}
function play() {
  if (time.playing) return;
  if (time.i >= hours().length - 1) setTime(0);
  time.playing = true;
  time.timer = setInterval(() => (time.i >= hours().length - 1 ? pause() : setTime(time.i + 1)), 1000);
  if (time.listener) time.listener();
}
function pause() {
  time.playing = false;
  clearInterval(time.timer);
  if (time.listener) time.listener();
}
const timebar = () => `
  <section class="card timebar no-print">
    <button type="button" id="play" class="btn primary small">Play</button>
    <input type="range" id="slider" min="0" max="${hours().length - 1}" step="1" aria-label="Time">
    <b id="time"></b>
    <button type="button" id="next-alert" class="btn ghost small">Next alert</button>
  </section>`;
function wireTime(keys) {
  $("play").addEventListener("click", () => (time.playing ? pause() : play()));
  $("slider").addEventListener("input", (event) => setTime(Number(event.target.value)));
  $("next-alert").addEventListener("click", () => {
    for (let i = time.i + 1; i < hours().length; i++) if (keys.some((k) => alertStarts(k, i))) { setTime(i); return; }
    $("next-alert").textContent = "No more alerts";
  });
}
function syncTime() {
  $("slider").value = String(time.i);
  $("time").textContent = fmtTime(hours()[time.i]);
  $("play").textContent = time.playing ? "Pause" : "Play";
}

// ---------- sign-in and layout ----------
function startSignIn() {
  $("signin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("signin-error");
    const button = event.target.querySelector("button[type=submit]");
    error.hidden = true;
    if (!$("signin-email").value.trim() || !$("signin-password").value) {
      error.textContent = "Enter your email and password.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      session = await signIn($("signin-email").value, $("signin-password").value);
      store.set("ahp-session", session);
      $("signin-password").value = "";
      show();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function signOut() {
  renderToken++;
  pause();
  sent.clear();
  session = null;
  store.remove("ahp-session");
  clearCharts();
  location.hash = "";
  show();
}

async function loadData() {
  if (dataset) return;
  const all = await api.datasets();
  const keys = all.pollutants.map((x) => x.key);
  const [forecasts, results] = await Promise.all([Promise.all(keys.map(api.forecast)), Promise.all(keys.map(api.results))]);
  keys.forEach((k, j) => { series[k] = forecasts[j]; episodesOf[k] = results[j].episodes; });
  dataset = all;
  if (!keys.includes(pollutant)) pollutant = keys[0];
  $("pollutant").innerHTML = all.pollutants.map((x) => `<button type="button" id="pill-${esc(x.key)}" data-key="${esc(x.key)}"
    aria-pressed="${x.key === pollutant}" title="${esc(NAMES[x.key] || x.pollutant)}">${esc(x.pollutant)}</button>`).join("");
}

function choosePollutant(key) {
  pollutant = key;
  store.set("ahp-pollutant", key);
  $("pollutant").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
  show(`pill-${key}`);
}

function openMenu(open) {
  $("shell").classList.toggle("menu-open", open);
  $("scrim").hidden = !open;
  $("menu-toggle").setAttribute("aria-expanded", String(open));
  $("sidebar").inert = NARROW.matches && !open;   // a hidden menu shouldn't take keyboard focus
}

function currentPage() { const name = location.hash.replace(/^#\/?/, ""); return PAGES[name] ? name : "home"; }

// keep: id of a control to keep focus on after the page redraws
async function show(keep) {
  if (!session) {
    $("shell").hidden = true;
    $("signin").hidden = false;
    document.title = "Sign in · Air Health Portal";
    $("signin-email").focus();
    return;
  }
  $("signin").hidden = true;
  $("shell").hidden = false;
  $("nav").innerHTML = Object.entries(PAGES).map(([name, page]) =>
    `<a href="#/${name}" data-page="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>${esc(page.title)}</a>`).join("");
  $("me-name").textContent = session.user.name;
  const name = currentPage();
  const page = PAGES[name];
  document.title = `${page.title} · Air Health Portal`;
  $("page-title").textContent = page.title;
  $("nav").querySelector(`[data-page="${name}"]`).setAttribute("aria-current", "page");
  openMenu(false);
  clearCharts();
  time.listener = null;
  if (name !== "home" && name !== "alerts") pause();
  const token = ++renderToken;
  const fresh = () => token === renderToken;   // false once the user has moved on
  $("view").innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    await loadData();
    if (fresh()) await page.render($("view"), fresh);
  } catch (err) {
    if (fresh()) $("view").innerHTML = `<div class="card"><p class="form-error">Couldn't load this page: ${esc(err.message)}</p></div>`;
  }
  if (fresh()) ($(keep) || $("view")).focus({ preventScroll: true });
}

// ---------- Dashboard ----------
async function renderHome(view) {
  const key = pollutant;
  const f = series[key];
  const unit = esc(f.unit);
  view.innerHTML = `
    ${timebar()}
    <section id="status" class="status"></section>
    <div id="numbers" class="numbers"></div>
    <section class="card">
      <div class="card-head"><h3>Actual vs predicted</h3><span class="muted">Last 24 hours and the next 2 hours</span></div>
      <div id="chart" class="chart"></div>
    </section>
    <section class="card">
      <h3>What to do now</h3>
      <ul id="todo" class="todo"></ul>
      <p><a href="#/alerts">See all alerts</a></p>
    </section>`;

  const chart = makeChart($("chart"), {
    animation: false,
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no reading" : `${num(v)} ${f.unit}`) },
    legend: { top: 0, data: ["Actual", "Predicted", "Next 2 hours"] },
    grid: { left: 46, right: 14, top: 34, bottom: 26 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: f.unit, splitLine: gridLine },
    series: [
      { id: "actual", name: "Actual", type: "line", showSymbol: false, connectNulls: false, color: "#1d4ed8", lineStyle: { width: 2.5 }, data: [] },
      { id: "predicted", name: "Predicted", type: "line", showSymbol: false, connectNulls: false, color: "#0f766e", lineStyle: { width: 2, type: "dashed" }, data: [] },
      { id: "next", name: "Next 2 hours", type: "line", color: "#dc2626", symbolSize: 9, lineStyle: { width: 2.5, type: "dashed" }, data: [] },
    ],
  });

  const update = () => {
    syncTime();
    const i = time.i;
    const s = statusAt(key, i);
    const g = GUIDE[key];
    const level = s.level === "none" ? "good" : s.level;
    $("status").className = `status ${LEVELS[s.level][1]}`;
    $("status").innerHTML = `<div class="status-level">${LEVELS[s.level][0]}</div>
      <div><p class="status-title">${esc(NAMES[key] || f.pollutant)} (${esc(f.pollutant)}), next 2 hours</p>
        <p>${esc(s.level === "none" ? "No reading for this hour." : alerting(s.level) ? g[s.level].means : g.good)}</p>
        ${alerting(s.level) ? `<p class="soft">${esc(g[s.level].rising)}</p>` : ""}</div>`;

    const boxes = [["Now", s.now], ["In 1 hour", s.ahead[0]], ["In 2 hours", s.ahead[1]]];
    $("numbers").innerHTML = boxes.map(([label, v]) => `<div class="card number ${LEVELS[levelOf(key, v)][1]}">
      <span>${label}</span><b>${num(v)}</b><small>${unit}</small>${chip(levelOf(key, v))}</div>`).join("");

    const from = Math.max(1, i - 23);
    const actual = [];
    const predicted = [];
    for (let j = from; j <= i; j++) {
      actual.push([f.times[j], f.now[j]]);
      predicted.push([f.times[j], f.f1[j - 1]]);   // what the model predicted for this hour, one hour earlier
    }
    const next = [[f.times[i], f.now[i]], [f.times[i + 1] || f.times[i], f.f1[i]], [f.times[i + 2] || f.times[i], f.f2[i]]];
    const top = Math.max(0, ...[...actual, ...predicted, ...next].map((x) => x[1]).filter((v) => v != null));
    const [watch, warning] = limitsOf(key);
    const lines = [["Watch", watch, "#d97706"], ["Warning", warning, "#dc2626"]].filter(([, v]) => v <= top * 1.3)
      .map(([label, v, color]) => ({ yAxis: v, label: { formatter: label, color }, lineStyle: { color, type: "dotted" } }));
    chart.setOption({ series: [{ id: "actual", data: actual, markLine: { silent: true, symbol: "none", data: lines } },
      { id: "predicted", data: predicted }, { id: "next", data: next }] });

    $("todo").innerHTML = ACTIONS[level].map((a) => `<li>${esc(a)}</li>`).join("");
  };
  time.listener = update;
  wireTime([key]);
  update();
}

// ---------- Alerts ----------
async function renderAlerts(view) {
  const keys = dataset.pollutants.map((x) => x.key);
  view.innerHTML = `
    ${timebar()}
    <section class="card">
      <div class="card-head"><h3>Next 2 hours</h3><button type="button" id="print" class="btn ghost small no-print">Print</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th class="num">Now</th><th class="num">In 1 hour</th><th class="num">In 2 hours</th><th>Level</th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </section>
    <div id="cards" class="alert-list"></div>
    <div class="grid cols-2">
      <section class="card no-print"><h3>Recent alerts</h3><ul id="recent" class="recent"></ul></section>
      <section class="card"><h3>Daily checklist</h3><ol class="steps">${CHECKLIST.map((c) => `<li>${esc(c)}</li>`).join("")}</ol></section>
    </div>`;
  $("print").addEventListener("click", () => window.print());

  const card = (k, s, since) => {
    const g = GUIDE[k];
    const id = `${k}|${since}`;   // one alert per episode, not one per hour
    return `<article class="card alert ${LEVELS[s.level][1]}">
      <h3>${esc(NAMES[k] || k)} · ${LEVELS[s.level][0]}</h3>
      <p class="big-line">${num(s.top)} ${esc(series[k].unit)} expected in ${s.at} hour${s.at === 1 ? "" : "s"}</p>
      <p>${esc(g[s.level].means)}</p>
      <p class="soft">${esc(g[s.level].rising)}</p>
      <b>What to do</b>
      <ul class="todo">${ACTIONS[s.level].map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      <p class="muted">Send to: hospitals, doctors and public health teams</p>
      <div class="no-print">${!can("sendAlerts") ? `<p class="muted">Admins and doctors can send alerts.</p>`
        : sent.has(id) ? `<p class="note">Preview only: nothing was sent yet. The backend will deliver it.</p>`
        : `<button type="button" class="btn primary small" data-send="${esc(id)}">Send alert</button>`}</div>
    </article>`;
  };

  let shown = "";
  const update = () => {
    syncTime();
    const statuses = keys.map((k) => [k, statusAt(k, time.i)]);
    $("rows").innerHTML = statuses.map(([k, s]) => `<tr><td><b>${esc(series[k].pollutant)}</b> <span class="muted">${esc(series[k].unit)}</span></td>
      <td class="num">${num(s.now)}</td><td class="num">${num(s.ahead[0])}</td><td class="num">${num(s.ahead[1])}</td><td>${chip(s.level)}</td></tr>`).join("");

    const active = statuses.filter(([, s]) => alerting(s.level)).map(([k, s]) => [k, s, alertStart(k, time.i)]);
    const signature = active.map(([k, s, since]) => `${k}${s.level}${since}${s.top}${sent.has(`${k}|${since}`)}`).join("|");
    if (signature !== shown) {   // only rebuild when something changed, so a click never lands on a replaced button
      shown = signature;
      $("cards").innerHTML = active.length ? active.map(([k, s, since]) => card(k, s, since)).join("")
        : `<section class="card"><p class="note ok">No alerts right now. All pollutants look fine for the next 2 hours.</p></section>`;
      $("cards").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => { sent.add(b.dataset.send); update(); }));
    }

    const recent = [];
    for (const k of keys) for (let j = Math.max(1, time.i - 167); j <= time.i; j++) if (alertStarts(k, j)) recent.push([j, k]);
    recent.sort((a, b) => b[0] - a[0]);
    $("recent").innerHTML = recent.length ? recent.slice(0, 8).map(([j, k]) => {
      const s = statusAt(k, j);
      return `<li>${chip(s.level)} <b>${esc(series[k].pollutant)}</b> ${num(s.top)} ${esc(series[k].unit)} <span class="muted">· ${esc(fmtTime(hours()[j]))}</span></li>`;
    }).join("") : `<li class="muted">No alerts in the last 7 days.</li>`;
  };
  time.listener = update;
  wireTime(keys);
  update();
}

// ---------- Unusual changes ----------
function likelyCause(e) {
  const d = toDate(e.peak_time || e.start);
  const h = d.getHours();
  const weekday = d.getDay() > 0 && d.getDay() < 6;
  const others = (e.checks && e.checks.other_pollutants_agreeing) || [];
  if (e.type === "Data limitation") return "Probably a sensor or data problem, not real pollution.";
  if (e.type === "Unclear" || !others.length) return "Not clear: only this gas changed.";
  if (e.direction === "lower") return "Cleaner air or less traffic.";
  if (weekday && ((h >= 7 && h <= 10) || (h >= 17 && h <= 21))) return "Rush-hour traffic.";
  if ([10, 11, 0, 1].includes(d.getMonth()) && (h >= 18 || h <= 6)) return "Home heating and still winter air.";
  return "A local source such as traffic, burning or industry.";
}

async function renderChanges(view) {
  const key = pollutant;
  const unit = esc(series[key].unit);
  const changes = [...episodesOf[key]].sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, 12);
  let filter = "all";
  view.innerHTML = `
    <section class="card">
      <p>Hours when ${esc(NAMES[key] || key)} was very different from what the model expected, and the likely cause.</p>
      <div class="filters" id="filters" role="group" aria-label="Filter">
        <button type="button" data-k="all" aria-pressed="true">All</button>
        ${Object.entries(KINDS).map(([k, [label]]) => `<button type="button" data-k="${esc(k)}" aria-pressed="false">${label}</button>`).join("")}
        <a class="btn ghost small" href="${esc(api.episodesCsvUrl(key))}">Download CSV</a>
      </div>
    </section>
    <div id="list" class="changes"></div>`;
  const draw = () => {
    $("filters").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === filter)));
    const list = changes.filter((e) => filter === "all" || e.type === filter);
    $("list").innerHTML = list.map((e) => {
      const [label, cls] = KINDS[e.type] || KINDS.Unclear;
      const peak = Number(e.peak_value);
      const expected = Number(e.expected_value);
      const pct = expected > 0 ? Math.round(((peak - expected) / expected) * 100) : null;
      const others = (e.checks && e.checks.other_pollutants_agreeing) || [];
      return `<article class="card change ${cls}">
        <div class="change-top"><b>${esc(fmtTime(e.peak_time || e.start))}</b><span class="chip ${cls}">${label}</span></div>
        <p class="big-line">${esc(series[key].pollutant)} ${peak >= expected ? "went up" : "went down"}${pct != null ? ` ${Math.abs(pct)}%` : ""}</p>
        <p>${num(peak)} ${unit} instead of the expected ${num(expected)}.${others.length ? ` ${esc(others.join(", "))} ${peak >= expected ? "rose" : "fell"} too.` : ""}</p>
        <p><b>Likely cause:</b> ${esc(likelyCause(e))}</p>
      </article>`;
    }).join("") || `<p class="muted">None of this kind.</p>`;
  };
  $("filters").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    filter = b.dataset.k;
    draw();
  });
  draw();
}

// ---------- Model ----------
async function renderModel(view, fresh) {
  const keys = dataset.pollutants.map((x) => x.key);
  const results = await Promise.all(keys.map(api.results));
  if (!fresh()) return;
  const r = results[keys.indexOf(pollutant)];
  const f = series[pollutant];
  view.innerHTML = `
    <section class="card">
      <h3>How it works</h3>
      <p>The model looks at the last few hours of each pollutant, the time of day and the weather, and predicts the next hour.
        For 2 hours ahead it builds on its own 1-hour prediction. It learned from ${esc(fmtMonth(r.periods.train[0]))} to
        ${esc(fmtMonth(r.periods.validation[1]))} and was tested on ${esc(fmtMonth(r.periods.test[0]))} to ${esc(fmtMonth(r.periods.test[1]))},
        which it had never seen.</p>
    </section>
    <div class="model-cards">${keys.map((k, j) => {
      const t = series[k];
      const better = Math.round((1 - t.mae["1"] / t.simple_guess_mae["1"]) * 100);
      return `<div class="card model-card ${k === pollutant ? "on" : ""}">
        <b>${esc(t.pollutant)}</b><span class="muted">${esc(results[j].model)}</span>
        <p>Usually within <b>± ${num(t.mae["1"])} ${esc(t.unit)}</b> one hour ahead, and ± ${num(t.mae["2"])} two hours ahead.</p>
        <p class="soft">${better}% better than guessing "no change".</p></div>`;
    }).join("")}</div>
    <section class="card">
      <div class="card-head"><h3>${esc(f.pollutant)}: actual vs predicted on the test period</h3>
        <a class="btn ghost small" href="${esc(api.reportUrl(pollutant))}">Download report</a></div>
      <div id="test-chart" class="chart tall"></div>
    </section>`;
  const points = r.test_predictions;
  const end = Math.min(100, Math.round(((24 * 7) / points.length) * 100)) || 100;
  makeChart($("test-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => `${num(v)} ${f.unit}` },
    legend: { data: ["Actual", "Predicted"], top: 0 },
    grid: { left: 46, right: 14, top: 34, bottom: 58 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: f.unit, splitLine: gridLine },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: "#1d4ed8", lineStyle: { width: 2 }, data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#0f766e", lineStyle: { width: 2, type: "dashed" }, data: points.map((p) => [p.t, p.predicted]) },
    ],
  });
}

// ---------- start ----------
function start() {
  startSignIn();
  $("signout").addEventListener("click", signOut);
  $("menu-toggle").addEventListener("click", () => openMenu(!$("shell").classList.contains("menu-open")));
  $("scrim").addEventListener("click", () => openMenu(false));
  $("nav").addEventListener("click", (event) => { if (event.target.closest("a")) openMenu(false); });
  $("pollutant").addEventListener("click", (event) => { const b = event.target.closest("button"); if (b) choosePollutant(b.dataset.key); });
  window.addEventListener("hashchange", () => show());
  NARROW.addEventListener("change", () => openMenu(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") openMenu(false); });
  window.addEventListener("beforeprint", () => charts.forEach((c) => c.resize()));
  window.addEventListener("afterprint", () => charts.forEach((c) => c.resize()));
  show();
}

start();
