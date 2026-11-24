// Air Health Portal: the frontend for healthcare centers.
//
// The file has two parts:
//   1. SAMPLE DATA: stands in for the backend. Each api.* function names the endpoint it will become.
//      The backend team replaces these one by one with fetch() calls; nothing else needs to change.
//   2. APP: sign-in, menu and the seven screens. It only talks to the data through api.*.

/* =====================================================================================================
   1. SAMPLE DATA (replace with the backend)

   Endpoints the backend should provide. All JSON, all behind the sign-in token, all limited to the
   signed-in user's center. Patient data is counts only, never names.

     POST /api/auth/login                     {email, password, centerId} -> {token, user, center}
     GET  /api/centers                        -> [{id, name, city}]
     GET  /api/centers/{id}                   -> {id, name, city, lat, lon, beds, erBeds, usualVisits}
     GET  /api/centers/{id}/overview          -> {now, forecast, load, actions}
     GET  /api/centers/{id}/surge?days=7      -> [{date, pm25, aqi, category, color, usualVisits, expectedVisits, level, bedsNeeded, erStaff}]
     GET  /api/centers/{id}/patient-groups    -> [{area, group, count}]
     GET  /api/centers/{id}/alerts            -> [{sentAt, group, channel, reached, aqi}]
     POST /api/centers/{id}/alerts            {group, channel, message} -> {queued}
     GET  /api/centers/{id}/thresholds        -> {group: aqi, ...}
     PUT  /api/centers/{id}/thresholds        {group: aqi, ...} -> same
     GET  /api/centers/{id}/unusual-periods   -> [{start, end, label, pollutant, peak, expected, reason}]
     GET  /api/centers/{id}/reports/{YYYY-MM} -> {month, days, summary}
     GET  /api/centers/{id}/users             -> [{name, email, role, lastActive}]   (admins only)
   ===================================================================================================== */

const CENTERS = [
  { id: "hyd-chc", name: "Hyderabad Community Health Centre", city: "Hyderabad", lat: 17.385, lon: 78.487,
    beds: 120, erBeds: 18, usualVisits: 42, base: 58, seed: 11, areas: ["Secunderabad", "Ameerpet", "Old City", "Kukatpally"] },
  { id: "del-dh", name: "Delhi District Hospital", city: "Delhi", lat: 28.614, lon: 77.209,
    beds: 320, erBeds: 44, usualVisits: 90, base: 92, seed: 23, areas: ["Karol Bagh", "Rohini", "Saket", "Lajpat Nagar"] },
  { id: "blr-uhc", name: "Bengaluru Urban Health Centre", city: "Bengaluru", lat: 12.972, lon: 77.595,
    beds: 80, erBeds: 12, usualVisits: 26, base: 34, seed: 37, areas: ["Whitefield", "Jayanagar", "Hebbal", "Yeshwanthpur"] },
];
const ACCOUNTS = [
  { email: "admin@demo.health", name: "Center admin", role: "admin" },
  { email: "doctor@demo.health", name: "Duty doctor", role: "doctor" },
  { email: "viewer@demo.health", name: "Read-only viewer", role: "viewer" },
];
const STAFF = [
  ...ACCOUNTS,
  { email: "er.lead@demo.health", name: "ER nurse lead", role: "viewer" },
  { email: "health.officer@demo.health", name: "Public health officer", role: "viewer" },
];
const GROUPS = ["Asthma", "COPD", "Heart disease", "Pregnancy", "Children under 5", "Over 65"];
const DEFAULT_THRESHOLDS = { Asthma: 100, COPD: 100, "Heart disease": 120, Pregnancy: 100, "Children under 5": 100, "Over 65": 120 };

// US EPA air quality index for PM2.5 (2024 bands): [low, high, AQI low, AQI high, name, colour]
const AQI_BANDS = [
  [0, 9, 0, 50, "Good", "#16a34a"],
  [9.1, 35.4, 51, 100, "Moderate", "#ca8a04"],
  [35.5, 55.4, 101, 150, "Unhealthy for sensitive groups", "#ea580c"],
  [55.5, 125.4, 151, 200, "Unhealthy", "#dc2626"],
  [125.5, 225.4, 201, 300, "Very unhealthy", "#9333ea"],
  [225.5, 500.4, 301, 500, "Hazardous", "#7f1d1d"],
];

const HOUR = 3600000;
const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));   // feels like a network call
const round1 = (v) => Math.round(v * 10) / 10;
const sum = (list) => list.reduce((a, b) => a + b, 0);
function noise(n) { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
function startOfHour(d = new Date()) { const t = new Date(d); t.setMinutes(0, 0, 0); return t; }
function startOfDay(d = new Date()) { const t = new Date(d); t.setHours(0, 0, 0, 0); return t; }
function addDays(d, n) { const t = new Date(d); t.setDate(t.getDate() + n); return t; }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function findCenter(id) { const c = CENTERS.find((x) => x.id === id); if (!c) throw new Error("Unknown center."); return c; }

function aqiOf(pm25) {
  const pm = Math.max(0, round1(pm25));
  for (const [lo, hi, aLo, aHi, category, color] of AQI_BANDS) {
    if (pm <= hi) return { aqi: Math.round(aLo + ((aHi - aLo) * (Math.max(pm, lo) - lo)) / (hi - lo)), category, color };
  }
  return { aqi: 500, category: "Hazardous", color: "#7f1d1d" };
}

// Hourly fine dust (PM2.5, µg/m³): a rush-hour cycle, slower multi-day pollution spells and some noise.
// The same hour always gives the same value, so the sample looks identical on every load.
function pm25At(center, time) {
  const h = Math.floor(time.getTime() / HOUR);
  const hour = time.getHours();
  const rush = 1 + 0.3 * Math.cos(((hour - 8) / 24) * 2 * Math.PI) + 0.2 * Math.cos(((hour - 21) / 12) * 2 * Math.PI);
  const spell = 1 + 0.55 * Math.max(0, Math.sin(h / 24 / 2.7 + center.seed));
  const jitter = 0.85 + 0.3 * noise(h + center.seed * 1000);
  return Math.max(4, center.base * rush * spell * jitter);
}
function dayMean(center, day) {
  let total = 0;
  for (let i = 0; i < 24; i++) total += pm25At(center, new Date(day.getTime() + i * HOUR));
  return total / 24;
}

// Sample rule until the backend's model is connected: about 6% more breathing-related visits
// for every 10 µg/m³ of fine dust above 35.
function expectedVisits(center, pm25) { return Math.round(center.usualVisits * (1 + 0.006 * Math.max(0, pm25 - 35))); }
function loadLevel(expected, usual) { const r = expected / usual; return r >= 1.3 ? "High" : r >= 1.1 ? "Medium" : "Low"; }

function actionsFor(level) {
  const all = [
    { id: "staff", text: "Add one doctor and one nurse to the evening ER shift", why: "Breathing-related visits usually peak in the evening on bad-air days", levels: ["High"] },
    { id: "beds", text: "Keep 2–3 observation beds free for breathing problems", why: "Based on the expected visits for the next 24 hours", levels: ["High"] },
    { id: "stock", text: "Check stock of inhalers, nebuliser solution and oxygen", why: "Enough for at least 3 busy days", levels: ["High", "Medium"] },
    { id: "alert", text: "Send an air alert to asthma and COPD patients", why: "Preview and send it from Patient alerts", levels: ["High", "Medium"] },
    { id: "indoor", text: "Keep ward windows closed and run air purifiers", why: "Indoor fine dust follows outdoor levels", levels: ["High", "Medium"] },
    { id: "routine", text: "No extra staff needed: keep the usual daily checks", why: "The air is expected to stay near normal", levels: ["Low"] },
  ];
  return all.filter((a) => a.levels.includes(level)).map(({ levels, ...a }) => a);
}

const PERIOD_TEMPLATES = [
  { daysAgo: 2, from: 19, hours: 4, label: "real", factor: 2.1,
    reason: "Coarse dust and nitrogen dioxide rose at the same time, which points to real pollution such as waste burning or heavy traffic." },
  { daysAgo: 4, from: 1, hours: 7, label: "sensor", factor: 1.7,
    reason: "The reading stayed at exactly the same value for 7 hours. A stuck sensor is the likely cause." },
  { daysAgo: 6, from: 8, hours: 3, label: "real", factor: 1.8,
    reason: "Morning rush hour with very little wind; carbon monoxide and nitrogen dioxide also rose." },
  { daysAgo: 9, from: 14, hours: 2, label: "sensor", factor: 4.2,
    reason: "A sudden jump to about 4 times the usual level for 2 hours while nothing else moved, then straight back. Probably a glitch or the sensor was being serviced." },
  { daysAgo: 12, from: 22, hours: 5, label: "unsure", factor: 1.9,
    reason: "The level was well above what the model expected and the data looked complete, but no other pollutant moved with it." },
  { daysAgo: 17, from: 6, hours: 3, label: "sensor", factor: 1.6,
    reason: "Readings were missing for 5 of the 6 hours before, so the model had little to go on." },
  { daysAgo: 21, from: 18, hours: 6, label: "real", factor: 2.4,
    reason: "Fine and coarse dust rose together through the evening, which fits a fireworks or festival night." },
  { daysAgo: 26, from: 3, hours: 2, label: "unsure", factor: 1.7,
    reason: "A short rise at night with complete data; no other pollutant confirms it." },
];

const store = {
  get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: keep going */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

const api = {
  // POST /api/auth/login
  async signIn(email, password, centerId) {
    await pause(350);
    const user = ACCOUNTS.find((a) => a.email === email.trim().toLowerCase());
    const center = CENTERS.find((c) => c.id === centerId);
    if (!user || password !== "demo123" || !center) throw new Error("That email and password don't match a staff account at this center.");
    return { token: "sample-token", user: { ...user }, center: { id: center.id, name: center.name, city: center.city } };
  },

  // GET /api/centers
  async centers() { return CENTERS.map(({ id, name, city }) => ({ id, name, city })); },

  // GET /api/centers/{id}
  async center(centerId) {
    await pause();
    const { id, name, city, lat, lon, beds, erBeds, usualVisits } = findCenter(centerId);
    return { id, name, city, lat, lon, beds, erBeds, usualVisits };
  },

  // GET /api/centers/{id}/overview
  async overview(centerId) {
    await pause();
    const c = findCenter(centerId);
    const now = startOfHour();
    const nowPm = pm25At(c, now);
    const forecast = Array.from({ length: 72 }, (_, i) => {
      const t = new Date(now.getTime() + (i + 1) * HOUR);
      const pm = pm25At(c, t);
      return { time: t.toISOString(), pm25: round1(pm), ...aqiOf(pm) };
    });
    const next24 = forecast.slice(0, 24);
    const meanPm = sum(next24.map((f) => f.pm25)) / 24;
    const expected = expectedVisits(c, meanPm);
    const level = loadLevel(expected, c.usualVisits);
    const peak = next24.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
    return {
      now: { time: now.toISOString(), pm25: round1(nowPm), ...aqiOf(nowPm) },
      forecast,
      load: { level, expectedVisits: expected, usualVisits: c.usualVisits, next24Pm25: round1(meanPm), peak },
      actions: actionsFor(level),
    };
  },

  // GET /api/centers/{id}/surge?days=7
  async surge(centerId) {
    await pause();
    const c = findCenter(centerId);
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(startOfDay(), i);
      const pm = dayMean(c, day);
      const expected = expectedVisits(c, pm);
      return { date: dateKey(day), pm25: round1(pm), ...aqiOf(pm), usualVisits: c.usualVisits, expectedVisits: expected,
        level: loadLevel(expected, c.usualVisits), bedsNeeded: Math.ceil(expected * 0.15), erStaff: Math.max(2, Math.ceil(expected / 14)) };
    });
  },

  // GET /api/centers/{id}/patient-groups (counts only)
  async patientGroups(centerId) {
    await pause();
    const c = findCenter(centerId);
    const scale = c.beds / 120;
    return c.areas.flatMap((area, a) => GROUPS.map((group, g) => ({
      area, group, count: Math.round((40 + 260 * noise(c.seed * 100 + a * 10 + g)) * scale),
    })));
  },

  // GET /api/centers/{id}/alerts
  async alertHistory(centerId) {
    await pause();
    const c = findCenter(centerId);
    const out = [];
    for (let i = 1; i <= 30 && out.length < 10; i++) {
      const day = addDays(startOfDay(), -i);
      const q = aqiOf(dayMean(c, day));
      if (q.aqi <= 100) continue;
      const wide = q.aqi > 150;
      out.push({ sentAt: new Date(day.getTime() + 7 * HOUR).toISOString(), group: wide ? "All at-risk groups" : "Asthma and COPD",
        channel: ["SMS", "WhatsApp", "Patient portal"][i % 3], reached: Math.round(c.usualVisits * (wide ? 22 : 9) * (0.8 + 0.4 * noise(c.seed + i))), aqi: q.aqi });
    }
    return out;
  },

  // POST /api/centers/{id}/alerts. The sample only previews; the backend does the sending.
  async sendAlert(centerId, alert) {
    await pause(300);
    findCenter(centerId);
    return { queued: false, preview: true, ...alert };
  },

  // GET /api/centers/{id}/thresholds
  async thresholds(centerId) { await pause(); return { ...DEFAULT_THRESHOLDS, ...store.get(`ahp-thresholds-${centerId}`, {}) }; },

  // PUT /api/centers/{id}/thresholds
  async saveThresholds(centerId, values) { await pause(250); store.set(`ahp-thresholds-${centerId}`, values); return values; },

  // GET /api/centers/{id}/unusual-periods
  async unusualPeriods(centerId) {
    await pause();
    const c = findCenter(centerId);
    return PERIOD_TEMPLATES.map((p) => {
      const start = new Date(addDays(startOfDay(), -p.daysAgo).getTime() + p.from * HOUR);
      const expected = pm25At(c, start);
      return { start: start.toISOString(), end: new Date(start.getTime() + p.hours * HOUR).toISOString(), label: p.label,
        pollutant: "PM2.5", peak: round1(expected * p.factor), expected: round1(expected), reason: p.reason };
    });
  },

  // GET /api/centers/{id}/reports/{YYYY-MM}
  async monthlyReport(centerId, month) {
    await pause();
    const c = findCenter(centerId);
    const [year, mon] = month.split("-").map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    const limits = { ...DEFAULT_THRESHOLDS, ...store.get(`ahp-thresholds-${centerId}`, {}) };
    const lowest = Math.min(...Object.values(limits));
    const days = [];
    for (let d = 1; d <= lastDay; d++) {
      const day = new Date(year, mon - 1, d);
      if (day > startOfDay()) break;
      const pm = dayMean(c, day);
      const q = aqiOf(pm);
      const expected = expectedVisits(c, pm);
      days.push({ date: dateKey(day), pm25: round1(pm), aqi: q.aqi, category: q.category, color: q.color,
        expectedVisits: expected, usualVisits: c.usualVisits, alertsSent: q.aqi > lowest ? 1 : 0 });
    }
    const worst = days.length ? days.reduce((a, b) => (b.pm25 > a.pm25 ? b : a)) : null;
    return {
      month, days,
      summary: {
        avgPm25: days.length ? round1(sum(days.map((d) => d.pm25)) / days.length) : null,
        alertsSent: sum(days.map((d) => d.alertsSent)),
        extraVisits: sum(days.map((d) => Math.max(0, d.expectedVisits - d.usualVisits))),
        worst,
        byCategory: AQI_BANDS.map((b) => ({ category: b[4], color: b[5], days: days.filter((d) => d.category === b[4]).length })),
      },
    };
  },

  // GET /api/centers/{id}/users (admins only)
  async users(centerId) {
    await pause();
    findCenter(centerId);
    return STAFF.map((s, i) => ({ ...s, lastActive: new Date(Date.now() - (i * 7 + 2) * HOUR).toISOString() }));
  },
};

/* =====================================================================================================
   2. APP
   ===================================================================================================== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => Number(v).toLocaleString("en-IN");
const CALM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LABELS = { real: ["Real pollution event", "tag-real"], sensor: ["Probably a sensor problem", "tag-sensor"], unsure: ["Not sure", "tag-unsure"] };
const ROLE_NAMES = { admin: "Admin", doctor: "Doctor", viewer: "Viewer" };

// What each role may do. The backend must enforce the same rules; hiding a button is not security.
const RIGHTS = {
  admin: ["sendAlerts", "editThresholds", "manageUsers", "switchCenter"],
  doctor: ["sendAlerts", "editThresholds"],
  viewer: [],
};

const ICONS = {
  overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  surge: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  unusual: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  reports: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
};
const PAGES = {
  overview: { title: "Overview", render: renderOverview },
  surge: { title: "Surge planning", render: renderSurge },
  alerts: { title: "Patient alerts", render: renderAlerts },
  unusual: { title: "Unusual periods", render: renderUnusual },
  reports: { title: "Reports", render: renderReports },
  settings: { title: "Settings", render: renderSettings },
};

let session = store.get("ahp-session", null);   // {token, user, center}
let charts = [];
let renderToken = 0;

const can = (action) => !!session && (RIGHTS[session.user.role] || []).includes(action);

// ---------- formatting ----------
function clock(d) { const h = d.getHours(); return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`; }
function fmtHour(iso) { const d = new Date(iso); return `${DAYS[d.getDay()]} ${clock(d)}`; }
function fmtDateTime(iso) { const d = new Date(iso); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(d)}`; }
function parseKey(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDay(key) { const d = parseKey(key); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function fmtMonth(key) { const [y, m] = key.split("-").map(Number); return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`; }
const levelPill = (level) => `<span class="pill level-${level.toLowerCase()}">${esc(level)}</span>`;
const aqiPill = (q) => `<span class="pill" style="background:${q.color}">${q.aqi} · ${esc(q.category)}</span>`;

// ---------- charts ----------
function makeChart(el, option) {
  const chart = echarts.init(el);
  chart.setOption({ animation: !CALM, textStyle: { fontFamily: "Fira Sans, system-ui, sans-serif" }, ...option });
  charts.push(chart);
  return chart;
}
function clearCharts() { charts.forEach((c) => c.dispose()); charts = []; }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));

// Light AQI colour stripes behind a PM2.5 axis
function aqiStripes(top) {
  return AQI_BANDS.filter((b) => b[0] < top).map((b) => [
    { yAxis: b[0], itemStyle: { color: b[5], opacity: 0.08 } }, { yAxis: Math.min(b[1], top) }]);
}

// ---------- sign-in ----------
async function startSignIn() {
  const centers = await api.centers();
  $("signin-center").innerHTML = centers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
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
      session = await api.signIn(email, password, $("signin-center").value);   // TODO backend: keep the token for api calls
      store.set("ahp-session", session);
      $("signin-password").value = "";
      setupShell();
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
  session = null;
  store.remove("ahp-session");
  clearCharts();
  location.hash = "";
  show();
}

// ---------- shell ----------
async function setupShell() {
  $("nav").innerHTML = Object.entries(PAGES).map(([name, page]) =>
    `<a href="#/${name}" data-page="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>${esc(page.title)}</a>`).join("");
  $("me-name").textContent = session.user.name;
  $("me-role").textContent = ROLE_NAMES[session.user.role];
  const centers = can("switchCenter") ? await api.centers() : [session.center];
  const pick = $("center-switch");
  pick.innerHTML = centers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  pick.value = session.center.id;
  pick.disabled = !can("switchCenter");
  pick.title = can("switchCenter") ? "Switch center" : "Your center";
}

function openMenu(open) {
  $("shell").classList.toggle("menu-open", open);
  $("scrim").hidden = !open;
  $("menu-toggle").setAttribute("aria-expanded", String(open));
}

function currentPage() { const name = location.hash.replace(/^#\/?/, ""); return PAGES[name] ? name : "overview"; }

async function show() {
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
  const token = ++renderToken;
  const fresh = () => token === renderToken;   // false once the user has moved on to another screen
  $("view").innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
  try {
    await page.render($("view"), fresh);
  } catch (err) {
    if (fresh()) $("view").innerHTML = `<div class="card"><p class="form-error">Couldn't load this screen: ${esc(err.message)}</p></div>`;
  }
  if (fresh()) $("view").focus({ preventScroll: true });
}

// ---------- 1. Overview ----------
async function renderOverview(view, fresh) {
  const o = await api.overview(session.center.id);
  if (!fresh()) return;
  const load = o.load;
  const doneKey = `ahp-done-${session.center.id}-${dateKey(new Date())}`;
  const done = store.get(doneKey, []);
  const bandIndex = AQI_BANDS.findIndex((b) => b[4] === o.now.category);
  view.innerHTML = `
    ${load.level === "High" ? `<p class="note warn"><b>Busy day ahead.</b> Breathing-related visits are expected to be well above normal. See the suggested actions.</p>` : ""}
    <div class="grid cols-4">
      <section class="card span-2">
        <div class="card-head"><h3>Air quality now</h3><span class="muted">${esc(session.center.name)} · ${esc(clock(new Date(o.now.time)))}</span></div>
        <div class="aqi-now">
          <div class="aqi-dial" style="--c:${o.now.color};--p:${Math.min(100, (o.now.aqi / 300) * 100)}%"><b>${o.now.aqi}</b><span>AQI</span></div>
          <div>
            <p style="color:${o.now.color};font-weight:700;font-size:1.15rem;margin:0">${esc(o.now.category)}</p>
            <p class="muted">Fine dust (PM2.5) ${o.now.pm25} µg/m³</p>
          </div>
        </div>
        <div class="aqi-scale" aria-hidden="true">${AQI_BANDS.map((b, i) => `<span class="${i === bandIndex ? "on" : ""}" style="background:${b[5]}"></span>`).join("")}</div>
      </section>
      <section class="card kpi">
        <span class="label">Expected patient load, next 24 h</span>
        <span class="value">${levelPill(load.level)}</span>
        <span class="sub">About <b>${load.expectedVisits}</b> breathing-related visits (usually ${load.usualVisits})</span>
      </section>
      <section class="card kpi">
        <span class="label">Worst hour, next 24 h</span>
        <span class="value">${esc(fmtHour(load.peak.time))}</span>
        <span class="sub">${aqiPill(load.peak)}</span>
      </section>
    </div>
    <div class="grid cols-3">
      <section class="card span-2">
        <div class="card-head"><h3>Next 3 days</h3><span class="muted">Fine dust forecast · colour stripes show the air quality level</span></div>
        <div id="forecast-chart" class="chart"></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Suggested actions</h3><span class="muted">Planning ideas for staff</span></div>
        <ul class="checklist">${o.actions.map((a) => `
          <li class="${done.includes(a.id) ? "done" : ""}"><label><input type="checkbox" data-id="${a.id}" ${done.includes(a.id) ? "checked" : ""}>
            <span>${esc(a.text)}<small>${esc(a.why)}</small></span></label></li>`).join("")}</ul>
      </section>
    </div>`;
  view.querySelectorAll(".checklist input").forEach((box) => box.addEventListener("change", () => {
    const ids = [...view.querySelectorAll(".checklist input:checked")].map((b) => b.dataset.id);
    store.set(doneKey, ids);
    box.closest("li").classList.toggle("done", box.checked);
  }));
  const top = Math.max(...o.forecast.map((f) => f.pm25)) * 1.15;
  makeChart($("forecast-chart"), {
    tooltip: { trigger: "axis", formatter: (items) => {
      const f = o.forecast[items[0].dataIndex];
      return `<b>${esc(fmtHour(f.time))}</b><br>Fine dust ${f.pm25} µg/m³<br>AQI ${f.aqi}, ${esc(f.category)}`;
    } },
    grid: { left: 44, right: 12, top: 16, bottom: 30 },
    xAxis: { type: "category", data: o.forecast.map((f) => fmtHour(f.time)), axisLabel: { interval: 11 } },
    yAxis: { type: "value", name: "µg/m³", max: Math.ceil(top), splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: [{ type: "line", smooth: true, showSymbol: false, color: "#1d4ed8", lineStyle: { width: 2 },
      areaStyle: { color: "rgba(29,78,216,0.08)" }, data: o.forecast.map((f) => f.pm25),
      markArea: { silent: true, data: aqiStripes(top) } }],
  });
}

// ---------- 2. Surge planning ----------
async function renderSurge(view, fresh) {
  const days = await api.surge(session.center.id);
  if (!fresh()) return;
  const busiest = days.reduce((a, b) => (b.expectedVisits > a.expectedVisits ? b : a));
  view.innerHTML = `
    <div class="grid cols-3">
      <section class="card kpi"><span class="label">Busiest day this week</span><span class="value">${esc(fmtDay(busiest.date))}</span>
        <span class="sub">About ${busiest.expectedVisits} breathing-related visits (usually ${busiest.usualVisits})</span></section>
      <section class="card kpi"><span class="label">High-load days</span><span class="value">${days.filter((d) => d.level === "High").length} <small>of 7</small></span>
        <span class="sub">${days.filter((d) => d.level === "Medium").length} more at medium load</span></section>
      <section class="card kpi"><span class="label">Most beds needed in a day</span><span class="value">${Math.max(...days.map((d) => d.bedsNeeded))}</span>
        <span class="sub">Observation beds for breathing problems</span></section>
    </div>
    <section class="card">
      <div class="card-head"><h3>Next 7 days: air vs expected visits</h3><span class="muted">Bars: expected visits · line: fine dust</span></div>
      <div id="surge-chart" class="chart"></div>
      <p class="note">Sample rule until the backend's model is connected: about 6% more breathing-related visits for every
        10 µg/m³ of fine dust above 35.</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Day by day</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Day</th><th>Air quality</th><th class="num">Fine dust</th><th class="num">Expected visits</th><th>Load</th><th class="num">Beds</th><th class="num">ER doctors</th></tr></thead>
        <tbody>${days.map((d) => `<tr><td>${esc(fmtDay(d.date))}</td><td>${aqiPill(d)}</td><td class="num">${d.pm25}</td>
          <td class="num">${d.expectedVisits} <span class="muted">/ ${d.usualVisits}</span></td><td>${levelPill(d.level)}</td>
          <td class="num">${d.bedsNeeded}</td><td class="num">${d.erStaff}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  const levelColor = { Low: "#16a34a", Medium: "#d97706", High: "#dc2626" };
  makeChart($("surge-chart"), {
    tooltip: { trigger: "axis" },
    legend: { data: ["Expected visits", "Usual visits", "Fine dust"], top: 0 },
    grid: { left: 44, right: 50, top: 36, bottom: 28 },
    xAxis: { type: "category", data: days.map((d) => fmtDay(d.date)) },
    yAxis: [{ type: "value", name: "visits", splitLine: { lineStyle: { color: "#eef2f7" } } },
      { type: "value", name: "µg/m³", splitLine: { show: false } }],
    series: [
      { name: "Expected visits", type: "bar", barWidth: "45%", color: "#1d4ed8",
        data: days.map((d) => ({ value: d.expectedVisits, itemStyle: { color: levelColor[d.level], borderRadius: [4, 4, 0, 0] } })) },
      { name: "Usual visits", type: "line", color: "#64748b", symbol: "none", lineStyle: { type: "dashed" }, data: days.map((d) => d.usualVisits) },
      { name: "Fine dust", type: "line", yAxisIndex: 1, color: "#0f766e", smooth: true, data: days.map((d) => d.pm25) },
    ],
  });
}

// ---------- 3. Patient alerts ----------
async function renderAlerts(view, fresh) {
  const id = session.center.id;
  const [groups, history, limits, overview] = await Promise.all([api.patientGroups(id), api.alertHistory(id), api.thresholds(id), api.overview(id)]);
  if (!fresh()) return;
  const totals = GROUPS.map((g) => ({ group: g, count: sum(groups.filter((r) => r.group === g).map((r) => r.count)) }));
  const areas = [...new Set(groups.map((r) => r.area))];
  const tomorrow = overview.forecast.slice(12, 36).reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const editable = can("editThresholds");
  view.innerHTML = `
    <div class="grid cols-3">
      <section class="card kpi"><span class="label">At-risk patients registered</span><span class="value">${num(sum(totals.map((t) => t.count)))}</span>
        <span class="sub">Counts only. Names stay in the hospital system.</span></section>
      <section class="card kpi"><span class="label">Worst air in the next 36 h</span><span class="value">${esc(fmtHour(tomorrow.time))}</span>
        <span class="sub">${aqiPill(tomorrow)}</span></section>
      <section class="card kpi"><span class="label">Alerts sent, last 30 days</span><span class="value">${history.length}</span>
        <span class="sub">${num(sum(history.map((h) => h.reached)))} patients reached</span></section>
    </div>
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>At-risk patients by area</h3></div>
        <div id="groups-chart" class="chart"></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Send an air alert</h3><span class="muted">To patients who opted in</span></div>
        ${can("sendAlerts") ? `
        <form id="composer" class="composer">
          <div class="row">
            <label>Who<select id="alert-group"><option value="All at-risk groups">All at-risk groups</option>${GROUPS.map((g) => `<option>${esc(g)}</option>`).join("")}</select></label>
            <label>How<select id="alert-channel"><option>SMS</option><option>WhatsApp</option><option>Patient portal</option></select></label>
          </div>
          <label>Message<textarea id="alert-message" maxlength="320"></textarea></label>
          <div class="preview" aria-live="polite"><b>Preview</b><div id="alert-preview"></div></div>
          <button type="submit" class="btn primary">Send alert</button>
          <p id="alert-result" class="note" hidden></p>
        </form>` : `<p class="note">You can view alerts. Ask an admin or a doctor to send one.</p>`}
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>Alert levels</h3><span class="muted">Send an alert to a group when the forecast AQI goes above its level</span></div>
      <form id="thresholds-form">
        <div class="thresholds">${GROUPS.map((g) => `<label>${esc(g)}
          <input type="number" min="51" max="300" step="1" name="${esc(g)}" value="${limits[g]}" ${editable ? "" : "readonly"}></label>`).join("")}</div>
        ${editable ? `<p style="margin-top:12px"><button type="submit" class="btn ghost">Save alert levels</button> <span id="thresholds-result" class="muted" aria-live="polite"></span></p>`
          : `<p class="muted" style="margin-top:12px">Only admins and doctors can change these.</p>`}
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Alerts sent</h3><span class="muted">Last 30 days</span></div>
      ${history.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Sent</th><th>To</th><th>How</th><th class="num">Patients reached</th><th class="num">AQI that day</th></tr></thead>
        <tbody>${history.map((h) => `<tr><td>${esc(fmtDateTime(h.sentAt))}</td><td>${esc(h.group)}</td><td>${esc(h.channel)}</td>
          <td class="num">${num(h.reached)}</td><td class="num">${h.aqi}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="muted">No alerts were needed in the last 30 days.</p>`}
    </section>`;

  makeChart($("groups-chart"), {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, type: "scroll" },
    grid: { left: 110, right: 16, top: 34, bottom: 24 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#eef2f7" } } },
    yAxis: { type: "category", data: GROUPS },
    series: areas.map((area, i) => ({ name: area, type: "bar", stack: "all", color: ["#1d4ed8", "#0f766e", "#7c3aed", "#d97706"][i % 4],
      data: GROUPS.map((g) => groups.find((r) => r.area === area && r.group === g).count) })),
  });

  if (can("sendAlerts")) {
    const message = $("alert-message");
    message.value = `Air alert from ${session.center.name}: the air is expected to be ${tomorrow.category.toLowerCase()} around ${fmtHour(tomorrow.time)} (AQI about ${tomorrow.aqi}). `
      + "If you have a breathing or heart condition, keep your medicines with you, limit long time outdoors, and contact us if you feel unwell.";
    const preview = () => {
      const who = $("alert-group").value;
      const count = who === "All at-risk groups" ? sum(totals.map((t) => t.count)) : totals.find((t) => t.group === who).count;
      $("alert-preview").innerHTML = `<p><b style="display:inline;text-transform:none;letter-spacing:0">To:</b> ${num(count)} patients · ${esc(who)} · by ${esc($("alert-channel").value)}</p><p>${esc(message.value)}</p>`;
    };
    ["alert-group", "alert-channel", "alert-message"].forEach((el) => $(el).addEventListener("input", preview));
    preview();
    $("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.target.querySelector("button");
      button.disabled = true;
      const r = await api.sendAlert(id, { group: $("alert-group").value, channel: $("alert-channel").value, message: message.value });
      button.disabled = false;
      $("alert-result").hidden = false;
      $("alert-result").textContent = r.preview
        ? "Preview only: nothing was sent. Sending will work once the backend is connected."
        : "Alert queued.";
    });
  }
  if (editable) {
    $("thresholds-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = {};
      for (const input of event.target.querySelectorAll("input")) {
        const v = Number(input.value);
        if (!Number.isFinite(v) || v < 51 || v > 300) {
          $("thresholds-result").textContent = `${input.name}: use a number from 51 to 300.`;
          input.focus();
          return;
        }
        values[input.name] = Math.round(v);
      }
      await api.saveThresholds(id, values);
      $("thresholds-result").textContent = "Saved.";
    });
  }
}

// ---------- 4. Unusual periods ----------
async function renderUnusual(view, fresh) {
  const periods = await api.unusualPeriods(session.center.id);
  if (!fresh()) return;
  let filter = "all";
  const draw = () => {
    const shown = periods.filter((p) => filter === "all" || p.label === filter);
    $("filters").innerHTML = [["all", `All (${periods.length})`], ...Object.entries(LABELS).map(([k, [name]]) =>
      [k, `${name} (${periods.filter((p) => p.label === k).length})`])]
      .map(([k, text]) => `<button type="button" data-k="${k}" aria-pressed="${k === filter}">${esc(text)}</button>`).join("");
    $("events").innerHTML = shown.map((p) => {
      const [name, cls] = LABELS[p.label];
      const higher = p.peak >= p.expected;
      return `<article class="event ${cls}">
        <div class="top"><b>${esc(fmtDateTime(p.start))}</b><span class="muted">to ${esc(clock(new Date(p.end)))}</span><span class="pill">${esc(name)}</span></div>
        <p>${esc(p.pollutant)} reached <b>${p.peak} µg/m³</b>; the model expected about ${p.expected}
          (${higher ? "+" : "−"}${round1(Math.abs(p.peak - p.expected))}).</p>
        <p>${esc(p.reason)}</p></article>`;
    }).join("") || `<p class="muted">None of this kind.</p>`;
  };
  view.innerHTML = `
    <p class="note">These are hours when the fine dust level was far from what the model expected. Each one is checked:
      if other pollutants moved too, it was probably <b>real pollution</b>; if the readings were stuck, missing or jumped on
      their own, it was probably <b>a sensor problem</b> (worth a call to the data team); otherwise we say <b>not sure</b>.</p>
    <section class="card">
      <div class="card-head"><h3>Last 30 days</h3></div>
      <div id="filters" class="filters" role="group" aria-label="Filter by type"></div>
      <div id="events" class="events" style="margin-top:14px"></div>
    </section>`;
  $("filters").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    filter = b.dataset.k;
    draw();
  });
  draw();
}

// ---------- 5. Reports ----------
async function renderReports(view, fresh) {
  const months = [0, 1, 2].map((i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return dateKey(d).slice(0, 7); });
  const chosen = store.get("ahp-report-month", months[0]);
  const month = months.includes(chosen) ? chosen : months[0];
  const report = await api.monthlyReport(session.center.id, month);
  if (!fresh()) return;
  const s = report.summary;
  view.innerHTML = `
    <section class="card no-print">
      <div class="card-head" style="margin:0">
        <label style="flex-direction:row;align-items:center;gap:8px">Month
          <select id="report-month">${months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${esc(fmtMonth(m))}</option>`).join("")}</select></label>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="report-csv" class="btn ghost small" ${report.days.length ? "" : "disabled"}>Download CSV</button>
          <button type="button" id="report-print" class="btn ghost small">Print / save as PDF</button>
        </span>
      </div>
    </section>
    <h3>${esc(session.center.name)} · ${esc(fmtMonth(month))}</h3>
    ${report.days.length ? `
    <div class="grid cols-4">
      <section class="card kpi"><span class="label">Average fine dust</span><span class="value">${s.avgPm25} <small>µg/m³</small></span>
        <span class="sub">${aqiPill(aqiOf(s.avgPm25))}</span></section>
      <section class="card kpi"><span class="label">Worst day</span><span class="value">${esc(fmtDay(s.worst.date))}</span>
        <span class="sub">${aqiPill(s.worst)}</span></section>
      <section class="card kpi"><span class="label">Days alerts were sent</span><span class="value">${s.alertsSent}</span>
        <span class="sub">of ${report.days.length} days so far</span></section>
      <section class="card kpi"><span class="label">Extra visits expected</span><span class="value">${num(s.extraVisits)}</span>
        <span class="sub">Above a normal month's level</span></section>
    </div>
    <div class="grid cols-3">
      <section class="card span-2"><div class="card-head"><h3>Daily fine dust</h3><span class="muted">Coloured by air quality level</span></div>
        <div id="daily-chart" class="chart"></div></section>
      <section class="card"><div class="card-head"><h3>Days at each level</h3></div><div id="level-chart" class="chart"></div></section>
    </div>` : `<p class="note">No data for this month yet.</p>`}`;
  $("report-month").addEventListener("change", (event) => { store.set("ahp-report-month", event.target.value); show(); });
  $("report-print").addEventListener("click", () => window.print());
  if (!report.days.length) return;
  $("report-csv").addEventListener("click", () => {
    const rows = report.days.map((d) => ({ date: d.date, pm25_ugm3: d.pm25, aqi: d.aqi, air_quality: d.category,
      expected_visits: d.expectedVisits, usual_visits: d.usualVisits, alert_sent: d.alertsSent ? "yes" : "no" }));
    downloadCsv(`${session.center.id}-${month}-report.csv`, rows);
  });
  makeChart($("daily-chart"), {
    tooltip: { trigger: "axis", formatter: (items) => { const d = report.days[items[0].dataIndex];
      return `<b>${esc(fmtDay(d.date))}</b><br>Fine dust ${d.pm25} µg/m³<br>AQI ${d.aqi}, ${esc(d.category)}`; } },
    grid: { left: 40, right: 10, top: 12, bottom: 26 },
    xAxis: { type: "category", data: report.days.map((d) => String(parseKey(d.date).getDate())) },
    yAxis: { type: "value", name: "µg/m³", splitLine: { lineStyle: { color: "#eef2f7" } } },
    series: [{ type: "bar", barWidth: "65%", data: report.days.map((d) => ({ value: d.pm25, itemStyle: { color: d.color, borderRadius: [3, 3, 0, 0] } })) }],
  });
  const used = s.byCategory.filter((c) => c.days > 0);
  makeChart($("level-chart"), {
    tooltip: { trigger: "item", formatter: (p) => `${esc(p.name)}: ${p.value} day${p.value === 1 ? "" : "s"}` },
    series: [{ type: "pie", radius: ["45%", "72%"], label: { formatter: "{c}" },
      data: used.map((c) => ({ name: c.category, value: c.days, itemStyle: { color: c.color } })) }],
    legend: { bottom: 0, type: "scroll" },
  });
}

function downloadCsv(name, rows) {
  const cell = (v) => { const t = String(v ?? ""); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const cols = Object.keys(rows[0]);
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));   // BOM so Excel reads µ
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- 6. Settings ----------
async function renderSettings(view, fresh) {
  const [c, users] = await Promise.all([api.center(session.center.id), can("manageUsers") ? api.users(session.center.id) : []]);
  if (!fresh()) return;
  view.innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <div class="card-head"><h3>Center</h3></div>
        <div class="table-wrap"><table><tbody>
          <tr><th>Name</th><td>${esc(c.name)}</td></tr>
          <tr><th>City</th><td>${esc(c.city)}</td></tr>
          <tr><th>Location</th><td>${c.lat}, ${c.lon}</td></tr>
          <tr><th>Beds</th><td>${c.beds} (ER: ${c.erBeds})</td></tr>
          <tr><th>Usual breathing-related visits</th><td>${c.usualVisits} a day</td></tr>
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Data sources</h3></div>
        <div class="table-wrap"><table><tbody>
          <tr><th>Air quality</th><td>Nearest monitoring station or air quality model</td><td><span class="sample-badge">Sample</span></td></tr>
          <tr><th>Visit counts</th><td>Hospital system, daily totals only</td><td><span class="sample-badge">Sample</span></td></tr>
          <tr><th>At-risk patients</th><td>Hospital registry, counts by area only</td><td><span class="sample-badge">Sample</span></td></tr>
          <tr><th>Alerts</th><td>SMS / WhatsApp / portal provider</td><td><span class="sample-badge">Sample</span></td></tr>
        </tbody></table></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>Users and roles</h3>${can("manageUsers") ? `<button type="button" class="btn ghost small" disabled title="Invites are handled by the backend">Invite user</button>` : ""}</div>
      ${can("manageUsers") ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last active</th></tr></thead>
        <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(ROLE_NAMES[u.role])}</td><td>${esc(fmtDateTime(u.lastActive))}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="muted" style="margin-top:10px">Admins see everything and manage users. Doctors can send alerts and change alert levels. Viewers can only look.</p>`
      : `<p class="muted">Only admins can see and manage users. You are signed in as <b>${esc(ROLE_NAMES[session.user.role])}</b>.</p>`}
    </section>`;
}

// ---------- start ----------
async function start() {
  await startSignIn();
  $("signout").addEventListener("click", signOut);
  $("menu-toggle").addEventListener("click", () => openMenu(!$("shell").classList.contains("menu-open")));
  $("scrim").addEventListener("click", () => openMenu(false));
  $("center-switch").addEventListener("change", async (event) => {
    if (!can("switchCenter")) return;
    const c = (await api.centers()).find((x) => x.id === event.target.value);
    if (!c) return;
    session.center = c;
    store.set("ahp-session", session);
    show();
  });
  window.addEventListener("hashchange", show);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") openMenu(false); });
  if (session) await setupShell();
  show();
}

start();
