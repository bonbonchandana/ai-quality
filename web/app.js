// Air Health: one page with four views (Today, History, Check, Model) and a TV screen.
const GASES = { CO: ["Carbon monoxide", "mg/m³"], NO2: ["Nitrogen dioxide", "µg/m³"], NOx: ["Nitrogen oxides", "ppb"], C6H6: ["Benzene", "µg/m³"] };
const LEVEL = { none: "No data", good: "Good", watch: "Watch", warning: "Warning" };
const COLOR = { none: "#b8bec4", good: "#2e7d4f", watch: "#d08a1c", warning: "#b3261e" };
const INPUTS = { hour: "the hour of the day", weekday: "the day of the week", lag_1: "the last hour's value", lag_2: "the value 2 hours ago",
  lag_3: "the value 3 hours ago", lag_24: "the value a day ago", temperature: "the temperature", relative_humidity: "the humidity" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const page = document.getElementById("page");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (v) => (v == null ? "–" : Number(v).toLocaleString("en", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }));
const chip = (level, text) => `<span class="chip ${level}">${esc(text || LEVEL[level])}</span>`;
const clock = (d) => `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? "am" : "pm"}`;
const date = (iso) => { const d = new Date(iso); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const when = (iso) => `${date(iso)}, ${clock(new Date(iso))}`;
const tellList = (tell) => `<ul class="tell">${tell.map(([who, what]) => `<li><b>${esc(who)}:</b> ${esc(what)}</li>`).join("")}</ul>`;

async function get(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join(", ") : body.detail || `Error ${res.status}`);
  return body;
}

// ---------- router ----------
const views = { today: showToday, history: showHistory, check: showCheck, model: showModel, tv: showTv };
let timer = null;
let charts = [];

async function route() {
  clearInterval(timer);
  charts.forEach((c) => c.dispose());
  charts = [];
  const name = views[location.hash.slice(1)] ? location.hash.slice(1) : "today";
  document.body.classList.toggle("tv", name === "tv");
  document.querySelectorAll("nav a").forEach((a) => (a.hash === `#${name}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  page.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    await views[name]();
  } catch (err) {
    page.innerHTML = `<p class="error">Could not load this page: ${esc(err.message)}</p>`;
  }
}
window.addEventListener("hashchange", () => { route(); page.focus(); });
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));

function chart(el, option) {
  const c = echarts.init(el, null, { renderer: "svg" });
  c.setOption({ textStyle: { fontFamily: "Public Sans, sans-serif" }, animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, ...option });
  charts.push(c);
  return c;
}

function showMode(today) {
  const mode = document.getElementById("mode");
  mode.className = `mode${today.live ? " live" : ""}`;
  mode.textContent = today.live
    ? `Live: station readings, latest ${when(today.time)}.`
    : `Demo: no station is connected yet, so this shows the 2005 test data for today's weekday and time (${when(today.time)}).`;
}

// ---------- Today ----------
async function showToday() {
  const d = await get("/api/today");
  showMode(d);
  const alert = d.level === "watch" || d.level === "warning";
  page.innerHTML = `
    ${d.silent_hours ? `<p class="notice">No readings from the station for ${d.silent_hours} hours. Ask the data team to check it.</p>` : ""}
    <section class="status ${d.level}">
      <p class="status-level">Next 2 hours · ${LEVEL[d.level]}</p>
      <h1>${esc(d.headline)}</h1>
      ${alert ? `<p>${esc(d.means)}</p><p class="rising">${esc(d.rising)}</p>` : ""}
    </section>
    <div class="grid">
      <section class="panel">
        <h2>${alert ? "Who to tell" : "What to do"}</h2>
        ${alert ? tellList(d.tell) : `<p>No action needed. The forecast updates every hour, and alerts are sent automatically.</p>`}
        <h2>Ventilation</h2>
        <p>${esc(d.ventilation)}</p>
        ${alert ? `<details><summary>The message for partners</summary><pre>${esc(d.message)}</pre>
          <button type="button" class="btn plain" id="copy">Copy message</button></details>` : ""}
      </section>
      <section class="panel">
        <h2>Today so far</h2>
        <div id="pie" class="pie" role="img" aria-label="${["good", "watch", "warning"].map((l) => `${LEVEL[l]} ${d.pie[l]} hours`).join(", ")}"></div>
        <p class="muted">Each hour counts at the level of its worst gas.${Object.keys(d.causes).length
          ? ` High hours came from ${Object.entries(d.causes).map(([gas, n]) => `${esc(gas.toLowerCase())} (${n} h)`).join(" and ")}.` : ""}</p>
      </section>
    </div>
    <h2 class="section-title">Gas by gas</h2>
    <div class="gases">${d.gases.map(gasCard).join("")}</div>`;
  if (alert) document.getElementById("copy").addEventListener("click", (e) => copy(d.message, e.target));
  pie(document.getElementById("pie"), d.pie);
  timer = setInterval(route, 5 * 60 * 1000);
}

const gasCard = (g) => `
  <article class="gas ${g.level}">
    <header><h3>${esc(g.name)}</h3>${chip(g.level)}</header>
    <dl><div><dt>Now</dt><dd>${fmt(g.now)}</dd></div><div><dt>In 1 hour</dt><dd>${fmt(g.in1)}</dd></div><div><dt>In 2 hours</dt><dd>${fmt(g.in2)}</dd></div></dl>
    <p class="muted">${esc(g.unit)}${g.problem ? ` · Sensor: ${esc(g.problem)}` : ""}</p>
  </article>`;

function pie(el, counts) {
  const data = ["good", "watch", "warning", "none"].filter((l) => counts[l]).map((l) => ({ name: LEVEL[l], value: counts[l], itemStyle: { color: COLOR[l] } }));
  chart(el, {
    tooltip: { formatter: (p) => `${p.name}: ${p.value} hour${p.value === 1 ? "" : "s"}` },
    series: [{ type: "pie", radius: ["45%", "72%"], label: { formatter: "{b}\n{c} h", fontSize: 13 }, data }],
  });
}

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
  catch { button.textContent = "Select the text above and copy it"; }
}

// ---------- History ----------
async function showHistory() {
  const { days } = await get("/api/days");
  const dates = Object.keys(days);
  let month = dates.at(-1).slice(0, 7);
  page.innerHTML = `
    <h1>History</h1>
    <p class="muted">Each day shows its worst level. Pick a day to see the alerts, sensor problems and unusual periods.</p>
    <div class="grid">
      <section class="panel">
        <div class="cal-head"><button type="button" class="btn plain" id="prev" aria-label="Previous month">‹</button>
          <h2 id="month"></h2><button type="button" class="btn plain" id="next" aria-label="Next month">›</button></div>
        <div class="cal-grid" id="cal"></div>
        <p class="legend">${["good", "watch", "warning"].map((l) => chip(l)).join("")}</p>
      </section>
      <section class="panel" id="day" aria-live="polite"></section>
    </div>`;
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const draw = () => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const count = new Date(y, m, 0).getDate();
    document.getElementById("month").textContent = `${MONTHS[m - 1]} ${y}`;
    let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span class="dow">${d}</span>`).join("");
    cells += "<span></span>".repeat((first.getDay() + 6) % 7);
    for (let n = 1; n <= count; n++) {
      const key = `${month}-${String(n).padStart(2, "0")}`;
      cells += days[key] ? `<button type="button" class="day ${days[key]}" data-day="${key}" aria-label="${date(key)}: ${LEVEL[days[key]]}">${n}</button>`
        : `<button type="button" class="day" disabled>${n}</button>`;
    }
    document.getElementById("cal").innerHTML = cells;
    document.getElementById("prev").disabled = month === months[0];
    document.getElementById("next").disabled = month === months.at(-1);
  };
  document.getElementById("prev").addEventListener("click", () => { month = months[months.indexOf(month) - 1]; draw(); });
  document.getElementById("next").addEventListener("click", () => { month = months[months.indexOf(month) + 1]; draw(); });
  document.getElementById("cal").addEventListener("click", (e) => { if (e.target.dataset.day) showDay(e.target.dataset.day); });
  draw();
  showDay(dates.at(-1));
}

async function showDay(key) {
  document.querySelectorAll(".day").forEach((b) => b.setAttribute("aria-pressed", b.dataset.day === key));
  const box = document.getElementById("day");
  const d = await get(`/api/day/${key}`);
  const unit = Object.fromEntries(d.peaks.map((p) => [p.gas, p.unit]));
  const span = (e) => `${clock(new Date(e.start))} to ${clock(new Date(e.end))}`;
  const line = (e) => e.type === "alert"
    ? `<li>${chip(e.level, `${LEVEL[e.level]} alert`)}<span><b>${esc(e.name)}</b> expected up to ${fmt(e.peak)} ${esc(unit[e.gas])}, ${span(e)}.</span></li>`
    : e.type === "sensor"
      ? `<li>${chip("sensor", "Sensor")}<span><b>${esc(e.name)}</b>: ${esc(e.why)}, ${span(e)}.</span></li>`
      : `<li>${chip(e.kind === "Real pollution" ? "warning" : "none", e.kind)}<span><b>${esc(e.name)}</b> was ${e.direction} than expected, ${span(e)}
          (${fmt(e.real)} instead of about ${fmt(e.expected)} ${esc(e.unit)}). ${esc(e.why)}</span></li>`;
  box.innerHTML = `
    <h2>${date(key)}</h2>
    <table><thead><tr><th>Gas</th><th class="num">Highest</th><th>When</th><th>Level</th></tr></thead><tbody>
      ${d.peaks.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${fmt(p.peak)} <span class="muted">${esc(p.unit)}</span></td><td>${p.at || "–"}</td><td>${chip(p.level)}</td></tr>`).join("")}
    </tbody></table>
    <h3>What happened</h3>
    ${d.events.length ? `<ul class="events">${d.events.map(line).join("")}</ul>` : `<p class="muted">No alerts, sensor problems or unusual periods.</p>`}`;
}

// ---------- Check ----------
async function showCheck() {
  const now = (await get("/api/today")).time;
  page.innerHTML = `
    <h1>Check</h1>
    <div class="grid">
      <section class="panel">
        <h2>Look up an hour</h2>
        <p class="muted">What was measured, and what the forecast said 1 and 2 hours before.</p>
        <form id="lookup" class="form"><label>Date and time<input type="datetime-local" name="time" step="3600" value="${now}" required></label>
          <button class="btn">Look up</button></form>
        <div id="lookup-out" class="result" aria-live="polite"></div>
      </section>
      <section class="panel">
        <h2>Enter readings by hand</h2>
        <p class="muted">When the station is down or a reading comes from a hand-held meter. Nothing is saved.</p>
        <form id="manual" class="form">
          <label>Gas<select name="gas">${Object.entries(GASES).map(([k, [n, u]]) => `<option value="${k}">${n} (${u})</option>`).join("")}</select></label>
          <label>Time of the reading<input type="datetime-local" name="time" step="3600" value="${now}" required></label>
          <label>Reading now<input type="number" name="now" step="any" min="0" required></label>
          <label>1 hour before<input type="number" name="hour_ago" step="any" min="0"></label>
          <label>2 hours before<input type="number" name="two_hours_ago" step="any" min="0"></label>
          <label>Temperature (°C)<input type="number" name="temperature" step="any"></label>
          <label>Humidity (%)<input type="number" name="relative_humidity" step="any" min="0" max="100"></label>
          <button class="btn">Forecast</button>
        </form>
        <div id="manual-out" class="result" aria-live="polite"></div>
      </section>
    </div>`;

  document.getElementById("lookup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("lookup-out");
    try {
      const r = await get(`/api/lookup?time=${encodeURIComponent(e.target.time.value)}`);
      out.innerHTML = `<table><thead><tr><th>Gas</th><th class="num">Measured</th><th class="num">Said 1 h before</th><th class="num">Said 2 h before</th><th>Level</th></tr></thead><tbody>
        ${r.gases.map((g) => `<tr><td>${esc(g.name)} <span class="muted">${esc(g.unit)}</span></td><td class="num">${fmt(g.real)}</td><td class="num">${fmt(g.said_1h)}</td>
          <td class="num">${fmt(g.said_2h)}</td><td>${chip(g.level)}</td></tr>`).join("")}</tbody></table>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });

  document.getElementById("manual").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("manual-out");
    const body = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v === "" ? null : k === "gas" || k === "time" ? v : Number(v)]));
    try {
      const r = await get("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const alert = r.level === "watch" || r.level === "warning";
      out.innerHTML = `
        <div class="status ${r.level}"><p class="status-level">${LEVEL[r.level]}</p>
          <h2>${esc(r.name)}: ${fmt(r.in1)} in 1 hour, ${fmt(r.in2)} in 2 hours (${esc(r.unit)})</h2><p>${esc(r.means)}</p></div>
        ${alert ? `<h3>Who to tell</h3>${tellList(r.tell)}<pre>${esc(r.message)}</pre>` : ""}`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

// ---------- Model (for the data team) ----------
async function showModel() {
  const m = await get("/api/model");
  const [train, check, test] = ["train", "check", "test"].map((p) => m.periods[p]);
  const span = ([from, to, hours]) => `${fmt(hours)} hours, ${date(from)} to ${date(to)}`;
  page.innerHTML = `
    <h1>How the model works</h1>
    <p class="muted">For the data team. Built from ${esc(m.source)}: ${fmt(m.hours)} hourly readings from one street station in Italy${m.also_learned_from
      ? `, plus ${fmt(m.also_learned_from.hours)} hours from ${esc(m.also_learned_from.name)} (${date(m.also_learned_from.from)} to ${date(m.also_learned_from.to)})` : ""}.
      The dates below are the Italian station's; each Delhi station is split the same way.</p>
    <section class="panel">
      <h2>How it was trained</h2>
      <ol class="steps">
        <li><b>Learn.</b> Each model learns from the first months: ${span(train)}.</li>
        <li><b>Choose.</b> Three models (linear regression, random forest and XGBoost) and a simple guess ("same as last hour") are compared on the next months: ${span(check)}. The one that is closest wins.</li>
        <li><b>Test.</b> The winner is retrained on both, then tested on the last months, which it never saw: ${span(test)}.</li>
      </ol>
      <p>Every hour it forecasts the <b>change</b> from the last reading, using the hour of the day, the day of the week, the last 3 hours, the same hour yesterday,
        and the temperature and humidity. For 2 hours ahead, it feeds its own 1-hour forecast back in.</p>
    </section>
    <div class="pills" role="group" aria-label="Gas">${Object.keys(m.gases).map((k) => `<button type="button" class="pill" data-gas="${k}">${esc(m.gases[k].name)}</button>`).join("")}</div>
    <section class="panel" id="gas"></section>
    <section class="panel"><h2>Forecast and real values, test months</h2><p class="muted">Drag the slider to move through the months.</p><div id="chart" class="chart"></div></section>
    <section class="panel">
      <h2>Adding readings</h2>
      <p>The station's software sends each new hour to <code>POST /api/readings</code> with the key in the <code>X-Key</code> header, for example
        <code>[{"time": "2026-11-24T14:00", "CO": 1.2, "NO2": 80, "NOx": 150, "C6H6": 4.5, "T": 12, "RH": 60}]</code>. Or upload a day's file here
        (the UCI format, or a CSV with a <code>time</code> column).</p>
      <form id="upload" class="form"><label>Key<input type="password" name="key" required autocomplete="off"></label>
        <label>CSV file<input type="file" name="file" accept=".csv,.txt" required></label><button class="btn">Upload</button></form>
      <div id="upload-out" aria-live="polite"></div>
    </section>`;

  const pick = (gas) => {
    const g = m.gases[gas];
    const worst = Math.max(...Object.values(g.scores));
    const better = (model, guess) => Math.round((1 - model / guess) * 100);
    const u = m.unusual[gas];
    document.querySelectorAll(".pill").forEach((p) => p.setAttribute("aria-pressed", p.dataset.gas === gas));
    document.getElementById("gas").innerHTML = `
      <h2>${esc(g.name)}: ${esc(g.model)} was chosen</h2>
      <p class="muted">Average miss on the choosing months (${esc(g.unit)} per hour, shorter is better):</p>
      <div class="bars">${Object.entries(g.scores).map(([name, v]) => `<div class="bar${name === g.model ? " best" : ""}"><b>${esc(name)}</b>
        <span style="width:${(v / worst) * 100}%"></span>${Number(v).toPrecision(3)}</div>`).join("")}</div>
      <dl class="facts">
        <div><dt>On the test months</dt><dd>Usually off by ±${fmt(g.test.in_1_hour)} ${esc(g.unit)} one hour ahead and ±${fmt(g.test.in_2_hours)} two hours ahead.</dd></div>
        <div><dt>Compared with "same as last hour"</dt><dd>${better(g.test.in_1_hour, g.test.guess_1_hour)}% closer at 1 hour and ${better(g.test.in_2_hours, g.test.guess_2_hours)}% closer at 2 hours.</dd></div>
        ${g.test_delhi ? `<div><dt>On the Delhi test months</dt><dd>Off by ±${fmt(g.test_delhi.in_1_hour)} ${esc(g.unit)} at 1 hour and ±${fmt(g.test_delhi.in_2_hours)} at 2 hours,
          ${better(g.test_delhi.in_1_hour, g.test_delhi.guess_1_hour)}% and ${better(g.test_delhi.in_2_hours, g.test_delhi.guess_2_hours)}% closer than "same as last hour".</dd></div>` : ""}
        <div><dt>What it relies on most</dt><dd>${g.top_inputs.map((i) => INPUTS[i]).join(", ")}.</dd></div>
        <div><dt>Watch and Warning levels</dt><dd>${fmt(g.limits[0])} and ${fmt(g.limits[1])} ${esc(g.unit)}. ${esc(g.limit_source)}.</dd></div>
        <div><dt>Missing readings</dt><dd>${fmt(g.missing)}% of hours.</dd></div>
        <div><dt>Unusual periods in the test months</dt><dd>${u["Real pollution"]} real pollution, ${u["Sensor problem"]} sensor problems, ${u["Not sure"]} not sure.
          An hour is unusual when the forecast missed by more than ${fmt(g.unusual_miss)} ${esc(g.unit)}.</dd></div>
      </dl>`;
    charts.forEach((c) => c.dispose());
    charts = [];
    const end = Math.round((24 * 14 / m.times.length) * 100);
    chart(document.getElementById("chart"), {
      tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "no reading" : `${fmt(v)} ${g.unit}`) },
      legend: { data: ["Real", "Forecast 1 hour before"], top: 0 },
      grid: { left: 50, right: 70, top: 36, bottom: 64 },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: g.unit, splitLine: { lineStyle: { color: "#eee" } } },
      dataZoom: [{ type: "inside", start: 0, end }, { type: "slider", start: 0, end, height: 20 }],
      series: [
        { name: "Real", type: "line", showSymbol: false, color: "#18212b", lineStyle: { width: 1.5 }, data: m.times.map((t, i) => [t, m.real[gas][i]]),
          markLine: { silent: true, symbol: "none", data: [["Watch", g.limits[0], COLOR.watch], ["Warning", g.limits[1], COLOR.warning]]
            .map(([label, y, color]) => ({ yAxis: y, label: { formatter: label, color }, lineStyle: { color, type: "dashed" } })) } },
        { name: "Forecast 1 hour before", type: "line", showSymbol: false, color: "#0f5f6e", lineStyle: { width: 1.5, type: "dashed" },
          data: m.times.map((t, i) => [t, m.forecast[gas][i]]) },
      ],
    });
  };
  document.querySelector(".pills").addEventListener("click", (e) => { if (e.target.dataset.gas) pick(e.target.dataset.gas); });
  pick("CO");

  document.getElementById("upload").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("upload-out");
    const form = new FormData();
    form.append("file", e.target.file.files[0]);
    try {
      const r = await get("/api/upload", { method: "POST", headers: { "X-Key": e.target.key.value }, body: form });
      out.innerHTML = `<p>Saved ${fmt(r.saved)} hours. Latest reading: ${when(r.latest)}. The app now shows live data.</p>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

// ---------- TV screen (no menus, refreshes every minute) ----------
async function showTv() {
  const d = await get("/api/today");
  page.innerHTML = `
    <div class="screen">
      <section class="status ${d.level}">
        <p class="status-level">Air for the next 2 hours · ${LEVEL[d.level]}</p>
        <h1>${esc(d.headline)}</h1>
        ${d.level === "watch" || d.level === "warning" ? `<p>${esc(d.means)}</p>` : ""}
      </section>
      <div class="gases">${d.gases.map(gasCard).join("")}</div>
      <p class="muted">Updated ${when(d.time)}${d.live ? "" : " (demo data)"} · Air Health</p>
    </div>`;
  timer = setInterval(route, 60 * 1000);
}

route();
