// Air Health Portal: air quality prediction and unusual-period analysis for healthcare centers.
//
// Everything on screen comes from our own work, served by main.py: the UCI Air Quality dataset (Italy, 2004-2005),
// the models trained on it, their results on the future test period and the unusual periods they flagged.
// Only the sign-in below is a stand-in until the backend team adds real accounts.

/* =====================================================================================================
   SIGN-IN (stand-in: replace with POST /api/auth/login on the backend)
   ===================================================================================================== */
const ACCOUNTS = [
  { email: "admin@demo.health", name: "Center admin", role: "admin" },
  { email: "doctor@demo.health", name: "Duty doctor", role: "doctor" },
  { email: "viewer@demo.health", name: "Read-only viewer", role: "viewer" },
];
async function signIn(email, password) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const user = ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());
  if (!user || password !== "demo123") throw new Error("That email and password don't match a staff account.");
  return { token: "preview-token", user: { ...user } };
}

/* =====================================================================================================
   DATA (all from main.py)
   ===================================================================================================== */
async function getJSON(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const detail = body && body.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join(". ") : `The server answered ${res.status}.`);
  }
  return body;
}

const resultsCache = new Map();   // one results file per pollutant, fetched once
const forecastCache = new Map();
const api = {
  datasets: () => getJSON("/api/datasets"),
  results(key) {
    if (!resultsCache.has(key)) {
      resultsCache.set(key, getJSON(`/api/results/${encodeURIComponent(key)}`).catch((err) => { resultsCache.delete(key); throw err; }));
    }
    return resultsCache.get(key);
  },
  forecast(key) {   // 1, 2 and 3 hours ahead for every hour of the test period
    if (!forecastCache.has(key)) {
      forecastCache.set(key, getJSON(`/api/forecast/${encodeURIComponent(key)}`).catch((err) => { forecastCache.delete(key); throw err; }));
    }
    return forecastCache.get(key);
  },
  sample: (key) => getJSON(`/api/sample/${encodeURIComponent(key)}`),
  predict: (body) => getJSON("/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  reportUrl: (key) => `/api/report/${encodeURIComponent(key)}?download=true`,
  episodesCsvUrl: (key) => `/api/episodes/${encodeURIComponent(key)}`,
};

/* =====================================================================================================
   APP
   ===================================================================================================== */
const $ = (id) => document.getElementById(id);
// Every value that goes into HTML passes through esc(), numbers too: data from a server is never trusted.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CALM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NARROW = window.matchMedia("(max-width: 860px)");   // the width where the menu becomes a slide-out
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROLE_NAMES = { admin: "Admin", doctor: "Doctor", viewer: "Viewer" };
const RIGHTS = { admin: ["manageUsers", "sendAlerts"], doctor: ["sendAlerts"], viewer: [] };   // the backend must enforce the same rules
const KINDS = {
  "Unusual pollution": ["Real pollution event", "tag-real", "#c2410c"],
  "Data limitation": ["Probably a data problem", "tag-sensor", "#7c3aed"],
  "Unclear": ["Not sure", "tag-unsure", "#64748b"],
};
const FEATURES = {
  hour: "Hour of the day", weekday: "Day of the week (0 = Monday)", lag_1: "Value 1 hour before", lag_2: "Value 2 hours before",
  lag_3: "Value 3 hours before", lag_24: "Same hour yesterday", temperature: "Temperature, previous hour (°C)",
  relative_humidity: "Humidity, previous hour (%)", absolute_humidity: "Absolute humidity, previous hour",
};
// Health reference levels from WHO and the EU. NOx and benzene have no short-term health limit, so for them a
// warning means "higher than 95% of hours at this station" or a sharp rise.
const HEALTH = {
  CO: {
    watch: 4, alert: 10, limits: "WHO guidelines: 4 mg/m³ over a day, 10 mg/m³ over 8 hours",
    risk: "Carbon monoxide lowers how much oxygen the blood can carry. It can cause headaches, dizziness and chest pain, and is most dangerous for people with heart disease, pregnant women and young children.",
    prepare: ["Keep oxygen and pulse oximeters ready in the emergency room", "Remind staff of carbon monoxide symptoms: headache, dizziness, confusion", "Watch heart patients more closely"],
    publicAdvice: "Avoid busy roads and idling traffic, never run engines or stoves in closed rooms, and people with heart disease should avoid hard exercise.",
  },
  NO2: {
    watch: 150, alert: 200, limits: "EU and WHO 1-hour limit: 200 µg/m³",
    risk: "Nitrogen dioxide inflames the airways. It can trigger asthma attacks, coughing and wheezing, and brings more hospital visits for breathing problems, especially among children and older people.",
    prepare: ["Stock inhalers, nebulisers and steroid medicines", "Plan extra staff for the respiratory clinic and emergency room", "Contact registered asthma and COPD patients"],
    publicAdvice: "People with asthma should carry their inhaler and avoid exercise near traffic; keep windows closed at rush hour.",
  },
  NOx: {
    limits: "No health limit for NOx itself; it is a marker of traffic exhaust",
    risk: "Nitrogen oxides come mostly from vehicle exhaust. They irritate the airways and usually rise together with nitrogen dioxide and fine dust.",
    prepare: ["Expect more breathing complaints from people living near main roads", "Check stock of inhalers and nebulisers"],
    publicAdvice: "Avoid main roads at rush hour; people with lung disease should limit time outdoors.",
  },
  C6H6: {
    limits: "EU limit: 5 µg/m³ as a yearly average; there is no short-term limit",
    risk: "Benzene comes from petrol and exhaust. High short-term levels can cause dizziness and headaches; long-term exposure raises the risk of leukaemia.",
    prepare: ["Be ready for headache and dizziness complaints", "Report repeated high levels to the public health office"],
    publicAdvice: "Avoid fuel stations and heavy traffic, and keep children away from idling vehicles.",
  },
};
const LEVELS = { normal: ["Normal", "st-normal"], watch: ["Watch", "st-watch"], alert: ["Alert", "st-alert"], unknown: ["No data", "st-unknown"] };
const SETTING_NAMES = { n_estimators: "trees", max_depth: "depth", min_samples_leaf: "hours per leaf", learning_rate: "learning rate" };

const ICONS = {
  live: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  dataset: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  model: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  unusual: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  predict: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  reports: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
};
const PAGES = {
  live: { title: "Live forecast", render: renderLive },
  alerts: { title: "Health alerts", render: renderAlerts },
  unusual: { title: "Unusual changes", render: renderUnusual },
  overview: { title: "Overview", render: renderOverview },
  model: { title: "Model results", render: renderModel },
  dataset: { title: "Dataset", render: renderDataset },
  predict: { title: "Try a prediction", render: renderPredict },
  reports: { title: "Reports", render: renderReports },
  settings: { title: "Settings", render: renderSettings },
};

const store = {
  get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* keep going without it */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

let session = store.get("ahp-session", null);   // {token, user}
let dataset = null;                             // /api/datasets
let pollutant = store.get("ahp-pollutant", null);
let charts = [];
let renderToken = 0;

const can = (action) => !!session && (RIGHTS[session.user.role] || []).includes(action);

// ---------- formatting ----------
const num = (v, digits) => {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return "–";
  const d = digits ?? (Math.abs(n) < 10 ? 3 : Math.abs(n) < 100 ? 1 : 0);
  return esc(n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
};
const pct = (v, digits = 0) => (v == null ? "–" : `${num(v, digits)}%`);
function clock(d) { const h = d.getHours(); return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`; }
function fmtDate(iso) { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtDateTime(iso) { const d = new Date(iso); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock(d)}`; }
const info = () => dataset.pollutants.find((p) => p.key === pollutant);
const unit = () => esc(info().unit);
const bestOf = (r) => r.models.find((m) => m.model === r.model);
const persistenceOf = (r) => r.models.find((m) => m.model.startsWith("Persistence"));
function settingsText(settings) {
  if (!settings) return "";
  return Object.entries(SETTING_NAMES).filter(([k]) => settings[k] != null).map(([k, name]) => `${esc(settings[k])} ${name}`).join(", ");
}

// ---------- charts ----------
function makeChart(el, option) {
  const chart = echarts.init(el);
  chart.setOption({ animation: !CALM, textStyle: { fontFamily: "Fira Sans, system-ui, sans-serif" }, ...option });
  charts.push(chart);
  return chart;
}
function clearCharts() { charts.forEach((c) => c.dispose()); charts = []; }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
const grid = { lineStyle: { color: "#eef2f7" } };

// The train / validation / test split as shaded bands on a time chart
function splitBands(periods) {
  const band = (name, [from, to], color) => [{ name, xAxis: from, itemStyle: { color, opacity: 0.1 } }, { xAxis: to }];
  return [band("Learning", periods.train, "#1d4ed8"), band("Choosing", periods.validation, "#d97706"), band("Test (future)", periods.test, "#16a34a")];
}

// ---------- sign-in and shell ----------
function startSignIn() {
  $("signin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("signin-error");
    const button = event.target.querySelector("button[type=submit]");
    const email = $("signin-email").value;
    const password = $("signin-password").value;
    error.hidden = true;
    if (!email.trim() || !password) {
      error.textContent = "Enter your work email and password.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      session = await signIn(email, password);
      store.set("ahp-session", session);
      $("signin-password").value = "";
      await setupShell();
      show();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
}

function signOut() {
  renderToken++;
  pauseReplay();
  session = null;
  store.remove("ahp-session");
  clearCharts();
  location.hash = "";
  show();
}

async function setupShell() {
  $("nav").innerHTML = Object.entries(PAGES).map(([name, page]) =>
    `<a href="#/${name}" data-page="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>${esc(page.title)}</a>`).join("");
  $("me-name").textContent = session.user.name;
  $("me-role").textContent = ROLE_NAMES[session.user.role] || session.user.role;
  dataset = dataset || await api.datasets();
  if (!dataset.pollutants.some((p) => p.key === pollutant)) pollutant = dataset.pollutants[0].key;
  $("pollutant").innerHTML = dataset.pollutants.map((p) => `<option value="${esc(p.key)}">${esc(p.pollutant)} (${esc(p.unit)})</option>`).join("");
  $("pollutant").value = pollutant;
}

function openMenu(open) {
  $("shell").classList.toggle("menu-open", open);
  $("scrim").hidden = !open;
  $("menu-toggle").setAttribute("aria-expanded", String(open));
  $("sidebar").inert = NARROW.matches && !open;   // a hidden menu shouldn't take keyboard focus
}

function currentPage() { const name = location.hash.replace(/^#\/?/, ""); return PAGES[name] ? name : "live"; }

// keep: id of a control to keep focus on after the screen redraws (e.g. the pollutant menu being changed)
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
  const name = currentPage();
  const page = PAGES[name];
  document.title = `${page.title} · Air Health Portal`;
  $("page-title").textContent = page.title;
  $("nav").querySelectorAll("a").forEach((a) => {
    if (a.dataset.page === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  openMenu(false);
  clearCharts();
  replay.listener = null;
  if (name !== "live" && name !== "alerts") pauseReplay();   // the replay only runs while someone is watching it
  const token = ++renderToken;
  const fresh = () => token === renderToken;   // false once the user has moved on to another screen
  $("view").innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    if (!dataset) await setupShell();
    await page.render($("view"), fresh);
  } catch (err) {
    if (fresh()) $("view").innerHTML = `<div class="card"><p class="form-error">Couldn't load this screen: ${esc(err.message)}</p></div>`;
  }
  if (fresh()) ($(keep) || $("view")).focus({ preventScroll: true });
}

// ---------- unusual changes: what changed and why ----------
function possibleReason(e) {
  const d = new Date(e.start);
  const h = d.getHours();
  const others = (e.checks && e.checks.other_pollutants_agreeing) || [];
  const list = others.join(", ");
  if (e.type === "Data limitation") return "Probably a sensor or data problem (missing, stuck or jumpy readings), not real pollution.";
  if (e.type === "Unclear") return "Only this gas moved and the data looked fine, so the cause is unclear.";
  if (e.direction === "lower") return `${list} fell at the same time, which usually means wind or rain cleared the air.`;
  if ((h >= 7 && h <= 10) || (h >= 17 && h <= 21)) return `Rush-hour traffic: ${list} rose at the same time, which points to vehicle exhaust.`;
  if ([10, 11, 0, 1].includes(d.getMonth()) && (h >= 18 || h <= 6)) return `A winter evening or night: heating and still, cold air keep exhaust near the ground (${list} rose too).`;
  return `${list} rose at the same time, which points to a real local source such as traffic, burning or industry.`;
}

function changeLines(e, unitHtml) {
  if (e.peak_value == null) return "";
  const peak = Number(e.peak_value);
  const expected = Number(e.expected_value);
  const diff = peak - expected;
  const share = expected > 0 ? `, ${diff >= 0 ? "+" : "−"}${Math.abs(Math.round((diff / expected) * 100))}%` : "";
  const others = (e.checks && e.checks.other_pollutants_agreeing) || [];
  return `<p>Reached <b>${num(peak)} ${unitHtml}</b> where the model expected ${num(expected)} (${diff >= 0 ? "+" : "−"}${num(Math.abs(diff))}${share}).
      ${others.length ? `${esc(others.join(", "))} ${e.direction === "lower" ? "fell" : "rose"} at the same time.` : "No other gas moved with it."}</p>
    <p><b>Possible reason:</b> ${esc(possibleReason(e))}</p>`;
}

// ---------- replay: the test period played back hour by hour, as if live ----------
const series = {};       // pollutant -> /api/forecast table (all pollutants share the same hours)
const stats = {};        // pollutant -> {p50, p95} of the real values in the test period
const episodesOf = {};   // pollutant -> unusual changes found by the model
const replay = { i: 0, playing: false, speed: 1000, timer: null, listener: null, last: {} };
const sent = new Set();
let alertLog = [];

const plainNum = (v) => { const n = Number(v); return Math.abs(n) < 10 ? n.toFixed(2) : Math.abs(n) < 100 ? n.toFixed(1) : n.toFixed(0); };
function plusHours(s, k) {
  const d = new Date(s);
  d.setHours(d.getHours() + k);
  const two = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:00`;
}

async function loadReplayData() {
  const keys = dataset.pollutants.map((x) => x.key);
  if (keys.every((k) => series[k])) return;
  const [forecasts, results] = await Promise.all([Promise.all(keys.map((k) => api.forecast(k))), Promise.all(keys.map((k) => api.results(k)))]);
  keys.forEach((k, j) => {
    series[k] = forecasts[j];
    const real = results[j].test_predictions.map((x) => x.actual).filter((v) => v != null).sort((a, b) => a - b);
    stats[k] = { p50: real[Math.floor(real.length * 0.5)], p95: real[Math.floor(real.length * 0.95)] };
    episodesOf[k] = results[j].episodes;
  });
  setReplay(replay.i);
}
const replayLength = () => { const any = Object.values(series)[0]; return any ? any.times.length : 0; };
const replayTime = () => Object.values(series)[0].times[replay.i];

function levelOf(key, value) {
  if (value == null) return "unknown";
  const h = HEALTH[key] || {};
  if (h.alert != null && value >= h.alert) return "alert";
  if (h.watch != null && value >= h.watch) return "watch";
  if (h.watch == null && stats[key] && value >= stats[key].p95) return "watch";
  return "normal";
}

// Health status of one pollutant at replay hour i, from its forecasts for the next 1-3 hours
function statusAt(key, i) {
  const f = series[key];
  const now = f.now[i];
  const ahead = [f.f1[i], f.f2[i], f.f3[i]];
  const known = ahead.filter((v) => v != null);
  if (!known.length) return { level: "unknown", now, ahead, reason: "No forecast for this hour because readings are missing." };
  const top = Math.max(...known);
  const at = ahead.indexOf(top) + 1;
  const change = now > 0 ? (top - now) / now : null;
  const h = HEALTH[key] || {};
  const amount = `${plainNum(top)} ${f.unit}`;
  let level = levelOf(key, top);
  let reason = "All forecasts for the next 3 hours stay at normal levels.";
  if (level === "alert") reason = `Forecast reaches ${amount}, above the ${h.alert} ${f.unit} limit (${h.limits}).`;
  else if (level === "watch" && h.watch != null) reason = `Forecast reaches ${amount}, above the ${h.watch} ${f.unit} watch level (${h.limits}).`;
  else if (level === "watch") reason = `Forecast reaches ${amount}, higher than 95% of hours at this station (${h.limits}).`;
  else if (change != null && change >= 0.5 && top >= stats[key].p50) {
    level = "watch";
    reason = `Sharp rise expected: from ${plainNum(now)} to ${amount} (+${Math.round(change * 100)}%).`;
  }
  return { level, now, ahead, top, at, change, reason };
}

function setReplay(i) {
  const n = replayLength();
  if (!n) return;
  replay.i = Math.max(0, Math.min(n - 1, i));
  for (const key of Object.keys(series)) {   // log each pollutant the moment it turns to watch or alert
    const s = statusAt(key, replay.i);
    if ((s.level === "watch" || s.level === "alert") && s.level !== replay.last[key]) {
      alertLog.unshift({ time: series[key].times[replay.i], key, level: s.level, top: s.top, at: s.at });
      alertLog = alertLog.slice(0, 30);
    }
    replay.last[key] = s.level;
  }
  if (replay.listener) replay.listener();
}
function playReplay() {
  if (replay.playing || !replayLength()) return;
  replay.playing = true;
  replay.timer = setInterval(() => (replay.i >= replayLength() - 1 ? pauseReplay() : setReplay(replay.i + 1)), replay.speed);
  if (replay.listener) replay.listener();
}
function pauseReplay() {
  replay.playing = false;
  clearInterval(replay.timer);
  replay.timer = null;
  if (replay.listener) replay.listener();
}

function replayControls() {
  const f = Object.values(series)[0];
  return `<section class="card no-print">
      <div class="replay-row">
        <button type="button" id="replay-play" class="btn primary small">Play</button>
        <label class="inline">Speed <select id="replay-speed"><option value="1000">1 hour per second</option>
          <option value="250">4 hours per second</option><option value="60">16 hours per second</option></select></label>
        <button type="button" id="replay-next-alert" class="btn ghost small">Next health alert</button>
        <button type="button" id="replay-next-change" class="btn ghost small">Next unusual change</button>
        <span id="replay-msg" class="muted" role="status"></span>
      </div>
      <label class="replay-time"><span>Replay time: <b id="replay-now"></b></span>
        <input type="range" id="replay-slider" min="0" max="${f.times.length - 1}" step="1"></label>
      <p class="muted">Plays back the test period (${esc(fmtDate(f.times[0]))} to ${esc(fmtDate(f.times[f.times.length - 1]))}) hour by
        hour, as if it were live. The model never saw these hours.</p>
    </section>`;
}

function wireReplay(keys) {   // keys(): the pollutants the "next" buttons look at
  const say = (text) => { $("replay-msg").textContent = text; setTimeout(() => { if ($("replay-msg")) $("replay-msg").textContent = ""; }, 3000); };
  $("replay-speed").value = String(replay.speed);
  $("replay-play").addEventListener("click", () => (replay.playing ? pauseReplay() : playReplay()));
  $("replay-speed").addEventListener("change", (event) => {
    replay.speed = Number(event.target.value);
    if (replay.playing) { pauseReplay(); playReplay(); }
  });
  $("replay-slider").addEventListener("input", (event) => setReplay(Number(event.target.value)));
  $("replay-next-alert").addEventListener("click", () => {
    const warn = (k, i) => ["watch", "alert"].includes(statusAt(k, i).level);
    for (let i = replay.i + 1; i < replayLength(); i++) {
      if (keys().some((k) => warn(k, i) && !warn(k, i - 1))) { setReplay(i); return; }
    }
    say("No more health alerts after this time.");
  });
  $("replay-next-change").addEventListener("click", () => {
    const now = replayTime();
    const next = keys().flatMap((k) => episodesOf[k].map((e) => e.start.slice(0, 16))).filter((t) => t > now).sort()[0];
    const i = next ? Object.values(series)[0].times.indexOf(next) : -1;
    if (i >= 0) setReplay(i); else say("No more unusual changes after this time.");
  });
}

function syncReplayControls() {
  $("replay-slider").value = String(replay.i);
  $("replay-now").textContent = fmtDateTime(replayTime());
  $("replay-play").textContent = replay.playing ? "Pause" : "Play";
}

// ---------- Live forecast ----------
async function renderLive(view, fresh) {
  await loadReplayData();
  if (!fresh()) return;
  const key = pollutant;
  const f = series[key];
  const h = HEALTH[key] || {};
  const u = esc(f.unit);
  const better = (s) => Math.round((1 - f.mae[s] / f.simple_guess_mae[s]) * 100);
  view.innerHTML = `
    ${replayControls()}
    <div id="live-cards" class="grid cols-4"></div>
    <section class="card">
      <div class="card-head"><h3>${esc(f.pollutant)}: the last 2 days and the next 3 hours</h3>
        <label class="inline"><input type="checkbox" id="show-real"> Show what really happened next</label></div>
      <div id="live-chart" class="chart tall"></div>
      <p class="muted">Solid: measured. Dashed: the model's forecast for 1, 2 and 3 hours ahead, made only with what was known at that moment.</p>
    </section>
    <div class="grid cols-2">
      <section class="card" id="live-health"></section>
      <section class="card" id="live-change"></section>
    </div>
    <section class="card">
      <div class="card-head"><h3>How accurate are these forecasts?</h3><span class="muted">Typical miss over the whole test period</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Forecast for</th><th class="num">Our model</th><th class="num">Simple guess (no change)</th><th class="num">Better by</th></tr></thead>
        <tbody>${["1", "2", "3"].map((s) => `<tr><td>${s} hour${s === "1" ? "" : "s"} ahead</td><td class="num">± ${num(f.mae[s])} ${u}</td>
          <td class="num">± ${num(f.simple_guess_mae[s])} ${u}</td><td class="num">${esc(better(s))}%</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;

  const chart = makeChart($("live-chart"), {
    animation: false,
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no reading" : `${plainNum(v)} ${f.unit}`) },
    legend: { top: 0, data: ["Measured", "Forecast", "What really happened"] },
    grid: { left: 50, right: 16, top: 34, bottom: 28 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: f.unit, splitLine: grid },
    series: [
      { id: "past", name: "Measured", type: "line", showSymbol: false, connectNulls: false, color: "#1d4ed8", lineStyle: { width: 2 }, data: [] },
      { id: "fc", name: "Forecast", type: "line", color: "#dc2626", symbolSize: 7, lineStyle: { width: 2, type: "dashed" }, data: [],
        label: { show: true, position: "top", fontSize: 10, formatter: (x) => (x.dataIndex ? `+${x.dataIndex} h` : "") } },
      { id: "real", name: "What really happened", type: "line", color: "#64748b", symbolSize: 5, lineStyle: { width: 1.5, type: "dotted" }, data: [] },
    ],
  });

  const update = () => {
    syncReplayControls();
    const i = replay.i;
    const s = statusAt(key, i);
    const cards = [["Now (measured)", s.now, 0], ["In 1 hour", s.ahead[0], 1], ["In 2 hours", s.ahead[1], 2], ["In 3 hours", s.ahead[2], 3]];
    $("live-cards").innerHTML = cards.map(([label, v, k]) => {
      const [name, cls] = LEVELS[levelOf(key, v)];
      const ch = k && v != null && s.now > 0 ? Math.round(((v - s.now) / s.now) * 100) : null;
      return `<section class="card kpi lvl ${cls}"><span class="label">${label}</span><span class="value">${num(v)} <small>${u}</small></span>
        <span class="sub"><span class="pill ${cls}">${name}</span>${ch != null ? ` ${ch >= 0 ? "+" : "−"}${Math.abs(ch)}% vs now` : ""}</span></section>`;
    }).join("");

    const from = Math.max(0, i - 47);
    const past = [];
    for (let j = from; j <= i; j++) past.push([f.times[j], f.now[j]]);
    const at = (k) => f.times[i + k] || plusHours(f.times[i], k);
    const forecast = [[f.times[i], f.now[i]], [at(1), f.f1[i]], [at(2), f.f2[i]], [at(3), f.f3[i]]];
    const real = $("show-real").checked ? [[f.times[i], f.now[i]], ...[1, 2, 3].map((k) => [at(k), f.now[i + k] ?? null])] : [];
    const top = Math.max(0, ...[...past, ...forecast, ...real].map((x) => x[1]).filter((v) => v != null));
    const lines = [["Watch", h.watch, "#d97706"], ["Limit", h.alert, "#dc2626"]].filter(([, v]) => v != null && v <= top * 1.4)
      .map(([name, v, color]) => ({ yAxis: v, label: { formatter: `${name} ${v}`, color }, lineStyle: { color, type: "dashed" } }));
    chart.setOption({ series: [{ id: "past", data: past, markLine: { silent: true, symbol: "none", data: lines } }, { id: "fc", data: forecast }, { id: "real", data: real }] });

    const [name, cls] = LEVELS[s.level];
    $("live-health").innerHTML = `<div class="card-head"><h3>Health status</h3><span class="pill ${cls}">${name}</span></div>
      <p>${esc(s.reason)}</p><p class="muted"><b>Why it matters:</b> ${esc(h.risk || "")}</p>
      ${s.level === "watch" || s.level === "alert" ? `<p><a href="#/alerts">See the alert for hospitals and doctors</a></p>` : ""}`;

    const now = replayTime();
    const dayBefore = plusHours(now, -24);
    const recent = episodesOf[key].filter((e) => { const t = e.start.slice(0, 16); return t <= now && t > dayBefore; }).pop();
    $("live-change").innerHTML = `<div class="card-head"><h3>Unusual change</h3><span class="muted">Last 24 hours</span></div>` + (recent
      ? `<p><b>${esc(fmtDateTime(recent.start))}</b> <span class="pill ${(KINDS[recent.type] || KINDS.Unclear)[1]}">${esc((KINDS[recent.type] || KINDS.Unclear)[0])}</span></p>${changeLines(recent, u)}`
      : `<p class="muted">No unusual change in the last 24 hours.</p>`);
  };
  replay.listener = update;
  wireReplay(() => [pollutant]);
  $("show-real").addEventListener("change", update);
  update();
}

// ---------- Health alerts ----------
async function renderAlerts(view, fresh) {
  await loadReplayData();
  if (!fresh()) return;
  const keys = dataset.pollutants.map((x) => x.key);
  view.innerHTML = `
    ${replayControls()}
    <section class="card">
      <div class="card-head"><h3>All pollutants: now and the next 3 hours</h3><span class="muted">The status uses the highest forecast</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th class="num">Now</th><th class="num">In 1 h</th><th class="num">In 2 h</th><th class="num">In 3 h</th><th>Status</th></tr></thead>
        <tbody id="alert-table"></tbody></table></div>
    </section>
    <div id="alert-cards" class="alert-list"></div>
    <section class="card">
      <div class="card-head"><h3>Alerts raised during this replay</h3><span class="muted">Newest first</span></div>
      <div id="alert-log"></div>
    </section>`;

  const card = (k, s) => {
    const h = HEALTH[k] || {};
    const f = series[k];
    const u = esc(f.unit);
    const [name, cls] = LEVELS[s.level];
    const id = `${k}|${replayTime()}`;
    return `<article class="card alert-card ${cls}">
      <div class="card-head"><h3>${esc(f.pollutant)}: ${s.level === "alert" ? "health alert" : "watch"}</h3><span class="pill ${cls}">${name}</span></div>
      <p><b>Forecast ${num(s.top)} ${u} in ${esc(s.at)} hour${s.at === 1 ? "" : "s"}</b> (now ${num(s.now)}${s.change != null
        ? `, ${s.change >= 0 ? "+" : "−"}${Math.abs(Math.round(s.change * 100))}%` : ""}). ${esc(s.reason)}</p>
      <p><b>Health risk:</b> ${esc(h.risk || "")}</p>
      <p><b>Hospitals and doctors can prepare:</b></p>
      <ul class="plain">${(h.prepare || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p><b>Advice for the public:</b> ${esc(h.publicAdvice || "")}</p>
      <p class="muted">Goes to: nearby hospitals · doctors on duty · public health office</p>
      ${!can("sendAlerts") ? `<p class="muted">Admins and doctors can send this alert.</p>`
        : sent.has(id) ? `<p class="note">Preview only: nothing was sent. Your team's backend will deliver this to the hospitals, doctors and public health office for this area.</p>`
        : `<button type="button" class="btn primary small" data-send="${esc(id)}">Send alert to hospitals and doctors</button>`}
    </article>`;
  };

  const update = () => {
    syncReplayControls();
    const statuses = keys.map((k) => [k, statusAt(k, replay.i)]);
    $("alert-table").innerHTML = statuses.map(([k, s]) => {
      const [name, cls] = LEVELS[s.level];
      return `<tr><td><b>${esc(series[k].pollutant)}</b> <span class="muted">${esc(series[k].unit)}</span></td><td class="num">${num(s.now)}</td>
        ${s.ahead.map((v) => `<td class="num"><span class="dot-inline ${LEVELS[levelOf(k, v)][1]}"></span>${num(v)}</td>`).join("")}
        <td><span class="pill ${cls}">${name}</span></td></tr>`;
    }).join("");
    const active = statuses.filter(([, s]) => s.level === "watch" || s.level === "alert");
    $("alert-cards").innerHTML = active.length ? active.map(([k, s]) => card(k, s)).join("")
      : `<section class="card"><p class="note ok">No health alerts at ${esc(fmtDateTime(replayTime()))}: every forecast for the next 3 hours is at a normal level.</p></section>`;
    $("alert-cards").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => { sent.add(b.dataset.send); update(); }));
    $("alert-log").innerHTML = alertLog.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Replay time</th><th>Pollutant</th><th>Status</th><th class="num">Forecast</th><th class="num">In</th></tr></thead>
        <tbody>${alertLog.map((a) => `<tr><td>${esc(fmtDateTime(a.time))}</td><td>${esc(series[a.key].pollutant)}</td>
          <td><span class="pill ${LEVELS[a.level][1]}">${LEVELS[a.level][0]}</span></td><td class="num">${num(a.top)} ${esc(series[a.key].unit)}</td>
          <td class="num">${esc(a.at)} h</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">No alerts yet. Press Play, or use "Next health alert".</p>`;
  };
  replay.listener = update;
  wireReplay(() => keys);
  update();
}

// ---------- 1. Overview ----------
async function renderOverview(view, fresh) {
  const all = await Promise.all(dataset.pollutants.map((p) => api.results(p.key)));
  if (!fresh()) return;
  const r = all[dataset.pollutants.findIndex((p) => p.key === pollutant)];
  const best = bestOf(r);
  view.innerHTML = `
    <p class="note">Hourly readings from an air quality station on a busy road in an Italian city, ${esc(fmtDate(dataset.start))}
      to ${esc(fmtDate(dataset.end))} (${num(dataset.rows, 0)} hours, UCI Machine Learning Repository). The models learned from
      the earlier part and were tested on the last part, from ${esc(fmtDate(r.periods.test[0]))}, which they never saw.</p>
    <div class="grid cols-4">
      <section class="card kpi"><span class="label">Best model for ${esc(r.pollutant)}</span><span class="value">${esc(r.model)}</span>
        <span class="sub">Picked on the validation period</span></section>
      <section class="card kpi"><span class="label">Typical miss per hour</span><span class="value">± ${num(best.test.MAE)} <small>${unit()}</small></span>
        <span class="sub">On the future test period</span></section>
      <section class="card kpi"><span class="label">Accuracy</span><span class="value">${pct(r.accuracy_within_20pct)}</span>
        <span class="sub">of test hours within 20% of the real value</span></section>
      <section class="card kpi"><span class="label">Better than a simple guess</span>
        <span class="value ${r.improvement_vs_persistence_pct >= 1 ? "good" : ""}">${r.improvement_vs_persistence_pct >= 0 ? "+" : "−"}${pct(Math.abs(r.improvement_vs_persistence_pct), 1)}</span>
        <span class="sub">vs. assuming next hour = this hour</span></section>
    </div>
    <section class="card">
      <div class="card-head"><h3>${esc(r.pollutant)}: daily average over the whole dataset</h3><span class="muted">Shaded: learning · choosing the model · future test</span></div>
      <div id="daily-chart" class="chart"></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>All four pollutants</h3><span class="muted">Click a row to see that pollutant</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th>Best model</th><th class="num">Typical miss</th><th class="num">R²</th><th class="num">Within 20%</th>
          <th class="num">Better than simple guess</th><th class="num">Unusual periods</th><th>Overfitting check</th></tr></thead>
        <tbody>${all.map((x, i) => { const p = dataset.pollutants[i]; const b = bestOf(x); return `
          <tr class="pick ${p.key === pollutant ? "on" : ""}" data-key="${esc(p.key)}" tabindex="0">
            <td><b>${esc(x.pollutant)}</b> <span class="muted">${esc(x.unit)}</span></td><td>${esc(x.model)}</td>
            <td class="num">${num(b.test.MAE)}</td><td class="num">${num(b.test.R2, 2)}</td><td class="num">${pct(x.accuracy_within_20pct)}</td>
            <td class="num">${x.improvement_vs_persistence_pct >= 0 ? "+" : "−"}${pct(Math.abs(x.improvement_vs_persistence_pct), 1)}</td>
            <td class="num">${num(x.episode_counts.total, 0)}</td><td>${esc(x.overfitting_check ? x.overfitting_check.verdict : "–")}</td></tr>`; }).join("")}</tbody>
      </table></div>
    </section>`;
  view.querySelectorAll("tr.pick").forEach((row) => {
    const pick = () => choosePollutant(row.dataset.key);
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(); } });
  });
  makeChart($("daily-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no readings" : `${Number(v).toFixed(2)} ${info().unit}`) },
    grid: { left: 44, right: 14, top: 16, bottom: 56 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: info().unit, splitLine: grid },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
    series: [{ name: "Daily average", type: "line", showSymbol: false, connectNulls: false, color: "#1d4ed8", lineStyle: { width: 1.5 },
      data: r.data.daily.map(([day, v]) => [day, v]), markArea: { silent: true, label: { color: "#475569", fontSize: 11 }, data: splitBands(r.periods) } }],
  });
}

function choosePollutant(key, keep) {
  if (!dataset.pollutants.some((p) => p.key === key)) return;
  pollutant = key;
  store.set("ahp-pollutant", key);
  $("pollutant").value = key;
  show(keep);
}

// ---------- 2. Dataset ----------
async function renderDataset(view, fresh) {
  const all = await Promise.all(dataset.pollutants.map((p) => api.results(p.key)));
  if (!fresh()) return;
  const r = all[dataset.pollutants.findIndex((p) => p.key === pollutant)];
  const missingDays = r.data.daily.filter(([, v]) => v == null).length;
  const monthly = {};
  r.data.daily.forEach(([day, v]) => { if (v == null) return; const m = day.slice(0, 7); (monthly[m] = monthly[m] || []).push(v); });
  const months = Object.keys(monthly).sort();
  const weather = Object.keys(dataset.weather || {});
  view.innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>About the dataset</h3></div>
        <div class="table-wrap"><table><tbody>
          <tr><th>Source</th><td>UCI Machine Learning Repository: Air Quality (Italy)</td></tr>
          <tr><th>Where</th><td>Sensor station on a busy road in an Italian city</td></tr>
          <tr><th>Period</th><td>${esc(fmtDate(dataset.start))} to ${esc(fmtDate(dataset.end))}</td></tr>
          <tr><th>Size</th><td>${num(dataset.rows, 0)} hourly rows</td></tr>
          <tr><th>Pollutants</th><td>${dataset.pollutants.map((p) => `${esc(p.pollutant)} (${esc(p.unit)})`).join(", ")}</td></tr>
          <tr><th>Weather</th><td>${weather.map((w) => esc(FEATURES[w] ? FEATURES[w].replace(", previous hour", "") : w)).join(", ")}</td></tr>
          <tr><th>Missing values</th><td>Marked as -200 in the original file and treated as missing</td></tr>
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>How complete the readings are</h3><span class="muted">Share of hours with a reading</span></div>
        <div id="complete-chart" class="chart small"></div>
        <p class="muted">${esc(r.pollutant)}: ${num(missingDays, 0)} days without any reading.</p>
      </section>
    </div>
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>${esc(r.pollutant)} through a typical day</h3><span class="muted">Average for each hour</span></div>
        <div id="hourly-chart" class="chart"></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>${esc(r.pollutant)} month by month</h3><span class="muted">Monthly average</span></div>
        <div id="monthly-chart" class="chart"></div>
      </section>
    </div>`;
  makeChart($("complete-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => `${Number(v).toFixed(1)}%` },
    grid: { left: 60, right: 30, top: 8, bottom: 24 },
    xAxis: { type: "value", max: 100, splitLine: grid },
    yAxis: { type: "category", data: all.map((x) => x.pollutant) },
    series: [{ type: "bar", barWidth: "55%", data: all.map((x) => ({ value: Number(x.data.observed_pct.toFixed(1)),
      itemStyle: { color: x.pollutant === r.pollutant ? "#1d4ed8" : "#93c5fd", borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", formatter: (p) => `${p.value}%` } }],
  });
  makeChart($("hourly-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => `${Number(v).toFixed(2)} ${info().unit}` },
    grid: { left: 44, right: 12, top: 16, bottom: 28 },
    xAxis: { type: "category", data: [...Array(24).keys()].map((h) => `${h}:00`) },
    yAxis: { type: "value", name: info().unit, splitLine: grid },
    series: [{ type: "bar", barWidth: "60%", color: "#0f766e", data: r.data.hourly_profile, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  });
  makeChart($("monthly-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => `${Number(v).toFixed(2)} ${info().unit}` },
    grid: { left: 44, right: 12, top: 16, bottom: 28 },
    xAxis: { type: "category", data: months.map((m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`) },
    yAxis: { type: "value", name: info().unit, splitLine: grid },
    series: [{ type: "bar", barWidth: "60%", color: "#1d4ed8", itemStyle: { borderRadius: [3, 3, 0, 0] },
      data: months.map((m) => Number((monthly[m].reduce((a, b) => a + b, 0) / monthly[m].length).toFixed(3))) }],
  });
}

// ---------- 3. Model results ----------
async function renderModel(view, fresh) {
  const r = await api.results(pollutant);
  if (!fresh()) return;
  const best = bestOf(r);
  const base = persistenceOf(r);
  const o = r.overfitting_check;
  const days = (from, to) => Math.max(1, (new Date(to) - new Date(from)) / 86400000);
  const parts = [["Learning", r.periods.train, "#1d4ed8"], ["Choosing the model", r.periods.validation, "#d97706"], ["Future test", r.periods.test, "#16a34a"]];
  const total = parts.reduce((s, [, p]) => s + days(...p), 0);
  view.innerHTML = `
    <div class="grid cols-4">
      <section class="card kpi"><span class="label">Best model</span><span class="value">${esc(r.model)}</span>
        <span class="sub">${settingsText(r.settings) || "Default settings"}</span></section>
      <section class="card kpi"><span class="label">Typical miss per hour</span><span class="value">± ${num(best.test.MAE)} <small>${unit()}</small></span>
        <span class="sub">Simple guess misses by ± ${num(base.test.MAE)}</span></section>
      <section class="card kpi"><span class="label">Ups and downs explained (R²)</span><span class="value">${pct(best.test.R2 * 100)}</span>
        <span class="sub">${pct(r.accuracy_within_20pct)} of hours within 20%</span></section>
      <section class="card kpi"><span class="label">Overfitting check</span><span class="value small-value">${esc(o ? o.verdict : "–")}</span>
        <span class="sub">${o ? `Miss on learned hours ${num(o.mae_on_learned_data)} vs new hours ${num(o.mae_on_test)}` : ""}</span></section>
    </div>
    <section class="card">
      <div class="card-head"><h3>How the data was split by time</h3><span class="muted">The test period comes after everything the model learned from</span></div>
      <div class="timeline">${parts.map(([name, p, color]) => `<div style="flex:${days(...p) / total};--c:${color}">
        <b>${esc(name)}</b><span>${esc(fmtDate(p[0]))} – ${esc(fmtDate(p[1]))}</span></div>`).join("")}</div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Real vs predicted on the future test period</h3><span class="muted">Red dots: unusual hours · drag the slider to move</span></div>
      <div id="test-chart" class="chart tall"></div>
    </section>
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>All models compared</h3><span class="muted">Typical miss, shorter is better</span></div>
        <div id="models-chart" class="chart"></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>What the model relies on</h3><span class="muted">Share of importance of each input</span></div>
        <div id="importance-chart" class="chart"></div>
      </section>
    </div>
    ${o ? `<p class="note">${esc(o.explanation)}</p>` : ""}`;

  const points = r.test_predictions;
  const end = Math.min(100, Math.round(((24 * 14) / points.length) * 100)) || 100;
  makeChart($("test-chart"), {
    tooltip: { trigger: "axis" },
    legend: { data: ["Real", "Predicted", "Unusual hour"], top: 0 },
    grid: { left: 50, right: 16, top: 34, bottom: 60 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: info().unit, splitLine: grid },
    dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 18 }],
    series: [
      { name: "Real", type: "line", showSymbol: false, color: "#1d4ed8", lineStyle: { width: 1.4 }, data: points.map((p) => [p.t, p.actual]) },
      { name: "Predicted", type: "line", showSymbol: false, color: "#0f766e", lineStyle: { width: 1.4, type: "dashed" }, data: points.map((p) => [p.t, p.predicted]) },
      { name: "Unusual hour", type: "scatter", symbolSize: 8, color: "#dc2626", data: points.filter((p) => p.flagged).map((p) => [p.t, p.actual]) },
    ],
  });
  const models = r.models.map((m) => ({ ...m, label: m.model.startsWith("Persistence") ? "Simple guess" : m.model }));
  makeChart($("models-chart"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `${Number(v).toFixed(3)} ${info().unit}` },
    legend: { top: 0 },
    grid: { left: 110, right: 20, top: 30, bottom: 24 },
    xAxis: { type: "value", splitLine: grid },
    yAxis: { type: "category", data: models.map((m) => m.label) },
    series: [
      { name: "Choosing period", type: "bar", color: "#fbbf24", data: models.map((m) => Number(m.validation.MAE.toFixed(4))) },
      { name: "Future test", type: "bar", data: models.map((m) => ({ value: Number(m.test.MAE.toFixed(4)), itemStyle: { color: m.model === r.model ? "#1d4ed8" : "#93c5fd" } })) },
    ],
  });
  const imp = [...r.feature_importance].reverse();
  makeChart($("importance-chart"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `${Number(v).toFixed(1)}%` },
    grid: { left: 190, right: 30, top: 8, bottom: 24 },
    xAxis: { type: "value", splitLine: grid, axisLabel: { formatter: "{value}%" } },
    yAxis: { type: "category", data: imp.map((f) => FEATURES[f.feature] || f.feature) },
    series: [{ type: "bar", barWidth: "60%", color: "#0f766e", itemStyle: { borderRadius: [0, 4, 4, 0] }, data: imp.map((f) => Number((f.importance * 100).toFixed(1))) }],
  });
}

// ---------- 4. Unusual periods ----------
async function renderUnusual(view, fresh) {
  const r = await api.results(pollutant);
  if (!fresh()) return;
  const TOP = 12;
  let filter = "all";
  let showAll = false;
  const counts = r.episode_counts;
  const options = [["all", `All (${counts.total})`], ...Object.entries(KINDS).map(([k, [name]]) => [k, `${name} (${counts[k] || 0})`])];
  view.innerHTML = `
    <p class="note">Hours when the real ${esc(r.pollutant)} level was much further from the model's prediction than usual
      (more than ${num(r.threshold)} ${unit()}, bigger than 95% of misses on the choosing period). Each one is checked: if other
      pollutants moved too, it was probably <b>real pollution</b>; if readings were missing, stuck or jumped on their own, it was
      probably <b>a data problem</b>; otherwise <b>not sure</b>.</p>
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>When they happen</h3><span class="muted">By hour of the day</span></div>
        <div id="hours-chart" class="chart small"></div>
        <p class="muted">${esc(r.patterns ? r.patterns.text : "")}</p>
      </section>
      <section class="card">
        <div class="card-head"><h3>What they were</h3></div>
        <div id="kinds-chart" class="chart small"></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>Unusual changes in the test period</h3><a class="btn ghost small" href="${esc(api.episodesCsvUrl(pollutant))}">Download CSV</a></div>
      <div id="filters" class="filters" role="group" aria-label="Filter by type">${options.map(([k, text]) =>
        `<button type="button" data-k="${esc(k)}" aria-pressed="${k === "all"}">${esc(text)}</button>`).join("")}</div>
      <div id="events" class="events" style="margin-top:14px"></div>
      <p style="margin-top:12px"><button type="button" id="more" class="btn ghost small" hidden></button></p>
    </section>`;
  const draw = () => {
    $("filters").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === filter)));
    const matching = r.episodes.filter((e) => filter === "all" || e.type === filter);
    const list = showAll ? matching : [...matching].sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, TOP);
    $("events").innerHTML = list.map((e) => {
      const [name, cls] = KINDS[e.type] || KINDS.Unclear;
      return `<article class="event ${cls}">
        <div class="top"><b>${esc(e.when || fmtDateTime(e.start))}</b><span class="pill">${esc(name)}</span><span class="muted">${esc(e.confidence)} confidence</span></div>
        ${changeLines(e, unit())}
        <details><summary>How we checked</summary><p>${esc(e.explanation || e.reason)}</p></details></article>`;
    }).join("") || `<p class="muted">None of this kind.</p>`;
    $("more").hidden = matching.length <= TOP;
    $("more").textContent = showAll ? `Show only the ${TOP} biggest` : `Show all ${matching.length} in time order`;
  };
  $("filters").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    filter = b.dataset.k;
    showAll = false;
    draw();
  });
  $("more").addEventListener("click", () => { showAll = !showAll; draw(); });
  draw();
  const p = r.patterns;
  if (p) {
    makeChart($("hours-chart"), {
      tooltip: { trigger: "axis" },
      grid: { left: 30, right: 8, top: 10, bottom: 24 },
      xAxis: { type: "category", data: [...Array(24).keys()].map(String) },
      yAxis: { type: "value", minInterval: 1, splitLine: grid },
      series: Object.keys(KINDS).filter((k) => p.by_hour[k]).map((k) => ({
        name: KINDS[k][0], type: "bar", stack: "all", color: KINDS[k][2], barWidth: "60%", data: p.by_hour[k] })),
    });
  }
  makeChart($("kinds-chart"), {
    tooltip: { trigger: "item", formatter: (x) => `${esc(x.name)}: ${esc(x.value)}` },
    legend: { bottom: 0 },
    series: [{ type: "pie", radius: ["45%", "70%"], label: { formatter: "{c}" },
      data: Object.entries(KINDS).map(([k, [name, , color]]) => ({ name, value: counts[k] || 0, itemStyle: { color } })).filter((x) => x.value) }],
  });
}

// ---------- 5. Try a prediction ----------
async function renderPredict(view, fresh) {
  const r = await api.results(pollutant);
  if (!fresh()) return;
  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Predict the next hour of ${esc(r.pollutant)}</h3><span class="muted">Model: ${esc(r.model)}</span></div>
      <p class="muted">Fill in what you know about the hour before, or load a real hour from the test period. This sends the same
        request as Postman: <code>POST /predict</code>.</p>
      <form id="predict-form" class="form-grid">
        ${r.features.map((f) => `<label>${esc(FEATURES[f] || f)}<input name="${esc(f)}" type="number" step="any" ${["hour", "weekday", "lag_1"].includes(f) ? "required" : ""}></label>`).join("")}
        <label>Real value (optional, to check it)<input name="observed" type="number" step="any" min="0"></label>
      </form>
      <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button type="button" id="load-sample" class="btn ghost">Load a real hour</button>
        <button type="submit" form="predict-form" class="btn primary">Predict</button>
      </p>
      <div id="predict-result" role="status"></div>
    </section>`;
  const form = $("predict-form");
  $("load-sample").addEventListener("click", async () => {
    try {
      const s = await api.sample(pollutant);
      if (!fresh()) return;
      for (const input of form.elements) input.value = input.name === "observed" ? s.observed ?? "" : s.features[input.name] ?? "";
      $("predict-result").innerHTML = `<p class="muted">Loaded ${esc(fmtDateTime(s.time))}.</p>`;
    } catch (err) {
      if (fresh()) $("predict-result").innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const box = $("predict-result");
    const features = {};
    let observed = null;
    for (const input of form.elements) {
      if (!input.name) continue;
      const value = input.value === "" ? null : Number(input.value);
      if (input.name === "observed") observed = value; else features[input.name] = value;
    }
    try {
      const answer = await api.predict({ pollutant, features, observed });
      if (!fresh()) return;
      const c = answer.episode_check;
      box.innerHTML = `<div class="answer">
        <span class="kpi-label">Predicted ${esc(answer.pollutant)} for the next hour</span>
        <b>${num(answer.prediction)} <small>${esc(answer.unit)}</small></b>
        ${c ? `<p class="${c.flagged ? "form-error" : "note ok"}" style="margin-top:8px">Real value ${num(c.observed)}, a difference of
          ${num(Math.abs(c.deviation))}. ${c.flagged ? `That is more than the ${num(c.threshold)} limit, so this hour would be flagged as unusual.`
          : `That is within the ${num(c.threshold)} limit, so this hour looks normal.`}</p>` : ""}</div>`;
    } catch (err) {
      if (fresh()) box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  });
}

// ---------- 6. Reports ----------
async function renderReports(view, fresh) {
  const all = await Promise.all(dataset.pollutants.map((p) => api.results(p.key)));
  if (!fresh()) return;
  const r = all[dataset.pollutants.findIndex((p) => p.key === pollutant)];
  const best = bestOf(r);
  view.innerHTML = `
    <section class="card no-print">
      <div class="card-head" style="margin:0"><h3>Download or print</h3>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn ghost small" href="${esc(api.reportUrl(pollutant))}">Full report for ${esc(r.pollutant)} (JSON)</a>
          <a class="btn ghost small" href="${esc(api.episodesCsvUrl(pollutant))}">Unusual periods (CSV)</a>
          <button type="button" id="report-print" class="btn ghost small">Print / save as PDF</button>
        </span></div>
    </section>
    <section class="card">
      <h3>Air quality model report: ${esc(r.pollutant)}</h3>
      <p class="muted" style="margin-top:4px">UCI Air Quality dataset (Italy), ${esc(fmtDate(dataset.start))} – ${esc(fmtDate(dataset.end))}</p>
      <p style="margin-top:10px">The best model, <b>${esc(r.model)}</b>, predicts next hour's ${esc(r.pollutant)} with a typical miss of
        <b>${num(best.test.MAE)} ${unit()}</b> on the future test period (${esc(fmtDate(r.periods.test[0]))} – ${esc(fmtDate(r.periods.test[1]))}).
        That is ${pct(Math.abs(r.improvement_vs_persistence_pct), 1)} ${r.improvement_vs_persistence_pct >= 0 ? "better" : "worse"} than assuming the next hour
        equals this hour, and ${pct(r.accuracy_within_20pct)} of test hours were within 20% of the real value.
        ${r.overfitting_check ? esc(r.overfitting_check.verdict) + "." : ""} It flagged ${num(r.episode_counts.total, 0)} unusual periods:
        ${num(r.episode_counts["Unusual pollution"] || 0, 0)} real pollution events, ${num(r.episode_counts["Data limitation"] || 0, 0)} likely data problems
        and ${num(r.episode_counts.Unclear || 0, 0)} not sure.</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>All pollutants</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th>Best model</th><th class="num">Typical miss</th><th class="num">R²</th><th class="num">Within 20%</th>
          <th class="num">Better than simple guess</th><th class="num">Unusual periods</th></tr></thead>
        <tbody>${all.map((x) => { const b = bestOf(x); return `<tr><td><b>${esc(x.pollutant)}</b> <span class="muted">${esc(x.unit)}</span></td>
          <td>${esc(x.model)}</td><td class="num">${num(b.test.MAE)}</td><td class="num">${num(b.test.R2, 2)}</td><td class="num">${pct(x.accuracy_within_20pct)}</td>
          <td class="num">${x.improvement_vs_persistence_pct >= 0 ? "+" : "−"}${pct(Math.abs(x.improvement_vs_persistence_pct), 1)}</td>
          <td class="num">${num(x.episode_counts.total, 0)}</td></tr>`; }).join("")}</tbody>
      </table></div>
    </section>`;
  $("report-print").addEventListener("click", () => window.print());
}

// ---------- 7. Settings ----------
async function renderSettings(view) {
  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Data and models</h3></div>
      <div class="table-wrap"><table><tbody>
        <tr><th>Dataset</th><td>UCI Air Quality (Italy), ${num(dataset.rows, 0)} hourly rows</td></tr>
        <tr><th>Models</th><td>${dataset.pollutants.map((p) => `${esc(p.pollutant)}: ${esc(p.model)}`).join(" · ")}</td></tr>
        <tr><th>How they were trained</th><td>train_model.py and the Kaggle notebook, on the same data</td></tr>
        <tr><th>Served by</th><td>main.py: /api/datasets, /api/results, /api/report, /api/episodes, /api/sample, /predict</td></tr>
      </tbody></table></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Users and roles</h3></div>
      ${can("manageUsers") ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>${ACCOUNTS.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(ROLE_NAMES[u.role])}</td></tr>`).join("")}</tbody>
      </table></div><p class="muted" style="margin-top:10px">Accounts will be managed by the backend.</p>`
      : `<p class="muted">Only admins can see users. You are signed in as <b>${esc(ROLE_NAMES[session.user.role])}</b>.</p>`}
    </section>`;
}

// ---------- start ----------
function start() {
  startSignIn();
  $("signout").addEventListener("click", signOut);
  $("menu-toggle").addEventListener("click", () => openMenu(!$("shell").classList.contains("menu-open")));
  $("scrim").addEventListener("click", () => openMenu(false));
  $("pollutant").addEventListener("change", (event) => choosePollutant(event.target.value, "pollutant"));
  $("nav").addEventListener("click", (event) => { if (event.target.closest("a")) openMenu(false); });   // also when tapping the screen you're on
  window.addEventListener("hashchange", () => show());
  NARROW.addEventListener("change", () => openMenu(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") openMenu(false); });
  // charts keep their screen size when printing unless told to resize
  window.addEventListener("beforeprint", () => charts.forEach((c) => c.resize()));
  window.addEventListener("afterprint", () => charts.forEach((c) => c.resize()));
  show();
}

start();
