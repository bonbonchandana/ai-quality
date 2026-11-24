// Air Health Portal: air quality forecasts and health warnings for hospitals, doctors and public health organisations.
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
const RIGHTS = { admin: ["sendAlerts"], doctor: ["sendAlerts"], viewer: [] };   // the backend must enforce the same rules
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
// What each gas means for health, in plain words. Alert levels themselves come from the server ("levels"):
// High = above 95 in 100 earlier hours at this station, Very high = above 99 in 100.
const HEALTH = {
  CO: {
    risk: "Carbon monoxide lowers how much oxygen the blood can carry. At roadside levels like these it mainly matters for people with heart disease.",
    reference: "WHO guideline: 4 mg/m³ averaged over 24 hours (35 mg/m³ over 1 hour).",
  },
  NO2: {
    limit: 200, limitName: "the EU 1-hour limit of 200 µg/m³",
    risk: "Nitrogen dioxide irritates the airways. Higher levels are linked to more asthma attacks and more hospital visits for breathing problems, especially in children and older people.",
    reference: "EU 1-hour limit: 200 µg/m³. WHO 24-hour guideline: 25 µg/m³.",
  },
  NOx: {
    risk: "Nitrogen oxides come mostly from traffic exhaust. They irritate the airways and rise together with nitrogen dioxide.",
    reference: "No separate health limit; used as a sign of traffic pollution.",
  },
  C6H6: {
    risk: "Benzene comes from petrol and exhaust. The concern is long-term exposure, which raises the risk of leukaemia; short rises at these levels don't cause symptoms.",
    reference: "EU limit: 5 µg/m³ as a yearly average.",
  },
};
// Planning guidance for each audience (adapted from the team's action protocol)
const GUIDE = {
  high: {
    "Hospitals and doctors": "Readiness level 1: let the emergency and respiratory teams know, and check inhaler and nebuliser stock.",
    "Sensitive groups": "People with asthma, lung or heart disease, older people, children and pregnant women: keep usual medicines handy and avoid long exercise near traffic.",
    "Schools and sports": "Move hard outdoor sports away from busy roads.",
    "Public": "Avoid busy roads at rush hour and keep windows on the traffic side closed.",
  },
  veryhigh: {
    "Hospitals and doctors": "Readiness level 2: consider extra staff for the emergency room and respiratory clinic, and check beds and oxygen supply.",
    "Sensitive groups": "Limit time outdoors near busy roads, especially at rush hour, and follow your care plan.",
    "Schools and sports": "Hold sports and break time indoors where possible.",
    "Public": "Limit time near traffic. Local authorities can consider traffic and anti-idling measures.",
  },
};
const LEVELS = { normal: ["Normal", "st-normal"], high: ["High", "st-watch"], veryhigh: ["Very high", "st-alert"], unknown: ["No data", "st-unknown"] };
const RECIPIENTS = "nearby hospitals · doctors · public health organisations";
const DISCLAIMER = "Planning aid based on a research forecast. It doesn't replace official warnings or clinical judgement.";
const SETTING_NAMES = { n_estimators: "trees", max_depth: "depth", min_samples_leaf: "hours per leaf", learning_rate: "learning rate" };

const ICONS = {
  live: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  dataset: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  model: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  unusual: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
};
const PAGES = {
  live: { title: "Live forecast", render: renderLive },
  alerts: { title: "Health alerts", render: renderAlerts },
  unusual: { title: "Unusual changes", render: renderUnusual },
  model: { title: "Model results", render: renderModel },
  dataset: { title: "Dataset", render: renderDataset },
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
function fmtDate(iso) { const d = new Date(String(iso).replace(" ", "T")); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtDateTime(iso) { const d = new Date(String(iso).replace(" ", "T")); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock(d)}`; }
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
  sent.clear();
  replay.i = START_HOUR;
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
  const when = new Date(String(e.peak_time || e.start).replace(" ", "T"));
  const h = when.getHours();
  const weekend = when.getDay() === 0 || when.getDay() === 6;
  const others = (e.checks && e.checks.other_pollutants_agreeing) || [];
  const list = others.join(", ");
  if (e.type === "Data limitation") return "The readings around this time look unreliable (missing, stuck or jumpy), so this may be a sensor or data problem rather than real pollution.";
  if (e.type === "Unclear" || !others.length) return "Only this gas moved and the data looked fine, so the cause is unclear.";
  if (e.direction === "lower") return `${list} fell at the same time: usually a quieter period (night, weekend or holiday) or cleaner air.`;
  if (!weekend && ((h >= 7 && h <= 10) || (h >= 17 && h <= 21))) return `Weekday rush hour: ${list} rose at the same time, which points to traffic exhaust.`;
  if ([10, 11, 0, 1].includes(when.getMonth()) && (h >= 18 || h <= 6)) return `A winter evening or night: heating and still, cold air keep exhaust near the ground (${list} rose too).`;
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
const START_HOUR = 48;    // start two days in, so the chart has some history
const series = {};        // pollutant -> /api/forecast table (all pollutants share the same hours)
const episodesOf = {};    // pollutant -> unusual changes found by the model
const replay = { i: START_HOUR, playing: false, speed: 1000, timer: null, listener: null };
const sent = new Set();
const statusCache = new Map();
const warning = (level) => level === "high" || level === "veryhigh";

async function loadReplayData() {
  const keys = dataset.pollutants.map((x) => x.key);
  if (keys.every((k) => series[k])) return;
  const [forecasts, results] = await Promise.all([Promise.all(keys.map((k) => api.forecast(k))), Promise.all(keys.map((k) => api.results(k)))]);
  keys.forEach((k, j) => { series[k] = forecasts[j]; episodesOf[k] = results[j].episodes; });
  replay.i = Math.min(replay.i, replayLength() - 1);
}
const replayLength = () => { const any = Object.values(series)[0]; return any ? any.times.length : 0; };
const replayTime = () => Object.values(series)[0].times[replay.i];
function plusHours(s, k) {
  const d = new Date(s);
  d.setHours(d.getHours() + k);
  const two = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:00`;
}

function levelOf(key, value) {
  if (value == null) return "unknown";
  const levels = series[key].levels;
  if (value >= levels.very_high) return "veryhigh";
  if (value >= levels.high) return "high";
  return "normal";
}

// Health status of one pollutant at replay hour i: the highest of its forecasts for the next 1-3 hours
function statusAt(key, i) {
  const id = `${key}|${i}`;
  if (statusCache.has(id)) return statusCache.get(id);
  const f = series[key];
  const now = f.now[i];
  const ahead = [f.f1[i], f.f2[i], f.f3[i]];
  const known = ahead.filter((v) => v != null);
  let result;
  if (!known.length) {
    result = { level: "unknown", now, ahead, reason: "No forecast for this hour because the latest reading is missing." };
  } else {
    const top = Math.max(...known);
    const level = levelOf(key, top);
    const h = HEALTH[key] || {};
    const amount = `${num(top)} ${f.unit}`;
    const overLimit = h.limit != null && top >= h.limit ? ` That is above ${h.limitName}.` : "";
    const reason = level === "veryhigh" ? `The forecast of ${amount} is higher than 99 in 100 earlier hours at this station.${overLimit}`
      : level === "high" ? `The forecast of ${amount} is higher than 95 in 100 earlier hours at this station.${overLimit}`
      : `All forecasts for the next 3 hours are in the usual range for this station.${overLimit}`;
    result = { level, now, ahead, top, at: ahead.indexOf(top) + 1, change: now > 0 ? (top - now) / now : null, reason };
  }
  statusCache.set(id, result);
  return result;
}

// The last known level before hour i (missing hours don't end or start a warning)
function levelBefore(key, i) {
  for (let j = i - 1; j >= 0; j--) { const level = statusAt(key, j).level; if (level !== "unknown") return level; }
  return "normal";
}
const startsWarning = (key, i) => warning(statusAt(key, i).level) && !warning(levelBefore(key, i));
function warningStart(key, i) {   // the hour the current warning began
  let j = i;
  while (j > 0 && !startsWarning(key, j)) j--;
  return j;
}
// Warnings that began in the 7 days up to hour i, newest first. Worked out from the data, so jumping around can't confuse it.
function recentWarnings(i) {
  const out = [];
  for (const key of Object.keys(series)) {
    for (let j = Math.max(1, i - 167); j <= i; j++) if (startsWarning(key, j)) out.push({ key, j, ...statusAt(key, j) });
  }
  return out.sort((a, b) => b.j - a.j).slice(0, 30);
}

function setReplay(i) {
  const n = replayLength();
  if (!n) return;
  replay.i = Math.max(0, Math.min(n - 1, i));
  if (replay.listener) replay.listener();
}
function playReplay() {
  if (replay.playing || !replayLength()) return;
  if (replay.i >= replayLength() - 1) setReplay(0);   // at the end: start again
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
        <button type="button" id="replay-next-alert" class="btn ghost small">Next warning</button>
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
    for (let i = replay.i + 1; i < replayLength(); i++) if (keys().some((k) => startsWarning(k, i))) { setReplay(i); return; }
    say("No more warnings after this time.");
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
      <p class="muted">Solid: measured. Dashed: the model's forecast for 1, 2 and 3 hours ahead, made only with what was known at that moment.
        Dotted lines: this station's High and Very high levels.</p>
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
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no reading" : `${num(v)} ${f.unit}`) },
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
    const lines = [["High", f.levels.high, "#d97706"], ["Very high", f.levels.very_high, "#dc2626"]].filter(([, v]) => v <= top * 1.4)
      .map(([name, v, color]) => ({ yAxis: v, label: { formatter: name, color }, lineStyle: { color, type: "dotted" } }));
    chart.setOption({ series: [{ id: "past", data: past, markLine: { silent: true, symbol: "none", data: lines } }, { id: "fc", data: forecast }, { id: "real", data: real }] });

    const [name, cls] = LEVELS[s.level];
    $("live-health").innerHTML = `<div class="card-head"><h3>Health status, next 3 hours</h3><span class="pill ${cls}">${name}</span></div>
      <p>${esc(s.reason)}</p><p class="muted"><b>Why it matters:</b> ${esc(h.risk || "")}</p><p class="muted">${esc(h.reference || "")}</p>
      ${warning(s.level) ? `<p><a href="#/alerts">See the warning for hospitals and public health organisations</a></p>` : ""}`;

    const now = replayTime();
    const dayBefore = plusHours(now, -24);
    const recent = episodesOf[key].filter((e) => { const t = String(e.peak_time || e.start).slice(0, 16); return t <= now && t > dayBefore; }).pop();
    $("live-change").innerHTML = `<div class="card-head"><h3>Unusual change</h3><span class="muted">Last 24 hours</span></div>` + (recent
      ? `<p><b>${esc(fmtDateTime(recent.peak_time || recent.start))}</b> <span class="pill ${(KINDS[recent.type] || KINDS.Unclear)[1]}">${esc((KINDS[recent.type] || KINDS.Unclear)[0])}</span></p>${changeLines(recent, u)}`
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
    <div class="print-only"><h2>Air quality health advisory</h2>
      <p>For hospitals, doctors and public health organisations. Station: UCI Air Quality, Italy. <b id="advisory-time"></b></p></div>
    <section class="card">
      <div class="card-head"><h3>All pollutants: now and the next 3 hours</h3>
        <button type="button" id="print-advisory" class="btn ghost small no-print">Print advisory</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th class="num">Now</th><th class="num">In 1 h</th><th class="num">In 2 h</th><th class="num">In 3 h</th><th>Status</th></tr></thead>
        <tbody id="alert-table"></tbody></table></div>
      <p class="muted">High: above 95 in 100 earlier hours at this station. Very high: above 99 in 100. ${esc(DISCLAIMER)}</p>
    </section>
    <div id="alert-cards" class="alert-list"></div>
    <section class="card no-print">
      <div class="card-head"><h3>Warnings in the last 7 days</h3><span class="muted">Newest first</span></div>
      <div id="alert-log"></div>
    </section>`;
  $("print-advisory").addEventListener("click", () => window.print());

  const card = (k, s, since) => {
    const h = HEALTH[k] || {};
    const f = series[k];
    const u = esc(f.unit);
    const [name, cls] = LEVELS[s.level];
    const id = `${k}|${f.times[since]}`;   // one send per warning, not per hour
    const guide = GUIDE[s.level];
    return `<article class="card alert-card ${cls}">
      <div class="card-head"><h3>${esc(f.pollutant)}: ${name.toLowerCase()} expected</h3><span class="pill ${cls}">${name}</span></div>
      <p><b>${num(s.top)} ${u} forecast in ${esc(s.at)} hour${s.at === 1 ? "" : "s"}</b> (now ${num(s.now)}${s.change != null
        ? `, ${s.change >= 0 ? "+" : "−"}${Math.abs(Math.round(s.change * 100))}%` : ""}). ${esc(s.reason)}</p>
      <p class="muted">Since ${esc(fmtDateTime(f.times[since]))}</p>
      <p><b>Why it matters:</b> ${esc(h.risk || "")}</p>
      <div class="advice-grid">${Object.entries(guide).map(([who, text]) => `<div><b>${esc(who)}</b><p>${esc(text)}</p></div>`).join("")}</div>
      <p class="muted">Goes to: ${esc(RECIPIENTS)}</p>
      <div class="no-print">${!can("sendAlerts") ? `<p class="muted">Admins and doctors can send this warning.</p>`
        : sent.has(id) ? `<p class="note">Preview only: nothing was sent. Your team's backend will deliver this to the hospitals, doctors and public health organisations for this area.</p>`
        : `<button type="button" class="btn primary small" data-send="${esc(id)}">Send warning</button>`}</div>
    </article>`;
  };

  let shown = "";
  const update = () => {
    syncReplayControls();
    $("advisory-time").textContent = `Issued for ${fmtDateTime(replayTime())}.`;
    const statuses = keys.map((k) => [k, statusAt(k, replay.i)]);
    $("alert-table").innerHTML = statuses.map(([k, s]) => {
      const [name, cls] = LEVELS[s.level];
      return `<tr><td><b>${esc(series[k].pollutant)}</b> <span class="muted">${esc(series[k].unit)}</span></td><td class="num">${num(s.now)}</td>
        ${s.ahead.map((v) => `<td class="num"><span class="dot-inline ${LEVELS[levelOf(k, v)][1]}"></span>${num(v)}</td>`).join("")}
        <td><span class="pill ${cls}">${name}</span></td></tr>`;
    }).join("");
    const active = statuses.filter(([, s]) => warning(s.level)).map(([k, s]) => [k, s, warningStart(k, replay.i)]);
    const signature = active.map(([k, s, since]) => `${k}:${s.level}:${since}:${s.top}:${sent.has(`${k}|${series[k].times[since]}`)}`).join("|");
    if (signature !== shown) {   // rebuild the cards only when something changed, so a click never lands on a replaced button
      shown = signature;
      $("alert-cards").innerHTML = active.length ? active.map(([k, s, since]) => card(k, s, since)).join("")
        : `<section class="card"><p class="note ok">No warnings for ${esc(fmtDateTime(replayTime()))}: every forecast for the next 3 hours is in the usual range.</p></section>`;
      $("alert-cards").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => { sent.add(b.dataset.send); update(); }));
    }
    const log = recentWarnings(replay.i);
    $("alert-log").innerHTML = log.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Began</th><th>Pollutant</th><th>Level</th><th class="num">Forecast</th></tr></thead>
        <tbody>${log.map((a) => `<tr><td>${esc(fmtDateTime(series[a.key].times[a.j]))}</td><td>${esc(series[a.key].pollutant)}</td>
          <td><span class="pill ${LEVELS[a.level][1]}">${LEVELS[a.level][0]}</span></td><td class="num">${num(a.top)} ${esc(series[a.key].unit)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">No warnings in the 7 days up to this time.</p>`;
  };
  replay.listener = update;
  wireReplay(() => keys);
  update();
}

function choosePollutant(key, keep) {
  if (!dataset.pollutants.some((p) => p.key === key)) return;
  pollutant = key;
  store.set("ahp-pollutant", key);
  $("pollutant").value = key;
  show(keep);
}

// ---------- Dataset ----------
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
    <p class="note">Hourly readings from an air quality station on a busy road in an Italian city, ${esc(fmtDate(dataset.start))}
      to ${esc(fmtDate(dataset.end))} (${num(dataset.rows, 0)} hours, UCI Machine Learning Repository). The models learned from
      the earlier part and were tested on the last part, from ${esc(fmtDate(r.periods.test[0]))}, which they never saw.</p>
    <section class="card">
      <div class="card-head"><h3>${esc(r.pollutant)}: daily average over the whole dataset</h3><span class="muted">Shaded: learning · choosing the model · future test</span></div>
      <div id="daily-chart" class="chart"></div>
    </section>
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
  makeChart($("daily-chart"), {
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no readings" : `${Number(v).toFixed(2)} ${info().unit}`) },
    grid: { left: 44, right: 14, top: 16, bottom: 56 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: info().unit, splitLine: grid },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
    series: [{ name: "Daily average", type: "line", showSymbol: false, connectNulls: false, color: "#1d4ed8", lineStyle: { width: 1.5 },
      data: r.data.daily.map(([day, v]) => [day, v]), markArea: { silent: true, label: { color: "#475569", fontSize: 11 }, data: splitBands(r.periods) } }],
  });
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

// ---------- Model results ----------
async function renderModel(view, fresh) {
  const all = await Promise.all(dataset.pollutants.map((x) => api.results(x.key)));
  if (!fresh()) return;
  const r = all[dataset.pollutants.findIndex((x) => x.key === pollutant)];
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
      <div class="card-head"><h3>All four pollutants</h3>
        <span class="downloads no-print"><a class="btn ghost small" href="${esc(api.reportUrl(pollutant))}">Report for ${esc(r.pollutant)} (JSON)</a>
          <button type="button" id="print-page" class="btn ghost small">Print / save as PDF</button></span></div>
      <p class="muted">Click a row to see that pollutant.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Pollutant</th><th>Best model</th><th class="num">Typical miss</th><th class="num">R²</th><th class="num">Within 20%</th>
          <th class="num">Better than simple guess</th><th class="num">Unusual changes</th><th>Overfitting check</th></tr></thead>
        <tbody>${all.map((x, i) => { const key = dataset.pollutants[i].key; const b = bestOf(x); return `
          <tr class="pick ${key === pollutant ? "on" : ""}" data-key="${esc(key)}" tabindex="0">
            <td><b>${esc(x.pollutant)}</b> <span class="muted">${esc(x.unit)}</span></td><td>${esc(x.model)}</td>
            <td class="num">${num(b.test.MAE)}</td><td class="num">${num(b.test.R2, 2)}</td><td class="num">${pct(x.accuracy_within_20pct)}</td>
            <td class="num">${x.improvement_vs_persistence_pct >= 0 ? "+" : "−"}${pct(Math.abs(x.improvement_vs_persistence_pct), 1)}</td>
            <td class="num">${num(x.episode_counts.total, 0)}</td><td>${esc(x.overfitting_check ? x.overfitting_check.verdict : "–")}</td></tr>`; }).join("")}</tbody>
      </table></div>
    </section>
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

  view.querySelectorAll("tr.pick").forEach((row) => {
    const pick = () => choosePollutant(row.dataset.key);
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(); } });
  });
  $("print-page").addEventListener("click", () => window.print());
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

// ---------- Unusual changes ----------
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
