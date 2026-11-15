import { api } from '../api.js';
import * as C from '../charts.js';
import {
  $, $$, CLASSES, UNIT, WEEKDAYS, copyText, emptyState, esc, fmt, fmtTs, icon,
} from '../ui.js';

export const meta = { title: 'Virtual sensor', subtitle: 'Feed one hour of sensor and weather readings to the model and get a CO estimate' };

const FIELDS = [
  { key: 'hour', label: 'Hour of day', unit: '0–23', min: 0, max: 23, step: 1, def: 8, group: 'time', int: true },
  { key: 'weekday', label: 'Weekday', unit: 'Mon = 0', group: 'time', select: WEEKDAYS, def: 2, int: true },
  { key: 'pt08_s1_co', label: 'PT08.S1 · CO sensor', unit: 'response', min: 300, max: 2500, step: 1, def: 1100, group: 'sensor' },
  { key: 'pt08_s2_nmhc', label: 'PT08.S2 · NMHC sensor', unit: 'response', min: 300, max: 2500, step: 1, def: 940, group: 'sensor' },
  { key: 'pt08_s3_nox', label: 'PT08.S3 · NOx sensor', unit: 'response', min: 200, max: 2800, step: 1, def: 830, group: 'sensor' },
  { key: 'pt08_s4_no2', label: 'PT08.S4 · NO₂ sensor', unit: 'response', min: 300, max: 3000, step: 1, def: 1460, group: 'sensor' },
  { key: 'pt08_s5_o3', label: 'PT08.S5 · O₃ sensor', unit: 'response', min: 200, max: 2800, step: 1, def: 1020, group: 'sensor' },
  { key: 'temperature', label: 'Temperature', unit: '°C', min: -10, max: 50, step: 0.1, def: 18, group: 'weather' },
  { key: 'relative_humidity', label: 'Relative humidity', unit: '%', min: 0, max: 100, step: 0.1, def: 49, group: 'weather' },
  { key: 'absolute_humidity', label: 'Absolute humidity', unit: 'AH', min: 0, max: 3, step: 0.001, def: 1.0, group: 'weather' },
  { key: 'co_lag_1', label: 'CO 1 hour earlier', unit: UNIT, min: 0, max: 20, step: 0.1, def: 2.0, group: 'lags', optional: true },
  { key: 'co_lag_2', label: 'CO 2 hours earlier', unit: UNIT, min: 0, max: 20, step: 0.1, def: 2.0, group: 'lags', optional: true },
  { key: 'co_lag_3', label: 'CO 3 hours earlier', unit: UNIT, min: 0, max: 20, step: 0.1, def: 2.0, group: 'lags', optional: true },
  { key: 'co_lag_24', label: 'CO 24 hours earlier', unit: UNIT, min: 0, max: 20, step: 0.1, def: 2.0, group: 'lags', optional: true },
  { key: 'pt08_s1_co_prev', label: 'PT08.S1 · 1 hour earlier', unit: 'response', min: 300, max: 2500, step: 1, def: 1100, group: 'prev', optional: true },
  { key: 'pt08_s2_nmhc_prev', label: 'PT08.S2 · 1 hour earlier', unit: 'response', min: 300, max: 2500, step: 1, def: 940, group: 'prev', optional: true },
  { key: 'pt08_s3_nox_prev', label: 'PT08.S3 · 1 hour earlier', unit: 'response', min: 200, max: 2800, step: 1, def: 830, group: 'prev', optional: true },
  { key: 'pt08_s4_no2_prev', label: 'PT08.S4 · 1 hour earlier', unit: 'response', min: 300, max: 3000, step: 1, def: 1460, group: 'prev', optional: true },
  { key: 'pt08_s5_o3_prev', label: 'PT08.S5 · 1 hour earlier', unit: 'response', min: 200, max: 2800, step: 1, def: 1020, group: 'prev', optional: true },
  { key: 'observed_co', label: 'Observed CO this hour', unit: UNIT, min: 0, max: 20, step: 0.1, def: 2.0, group: 'observed', optional: true, startEmpty: true },
];
const GROUPS = [
  ['time', 'Time', ''],
  ['sensor', 'Metal-oxide sensors', 'Raw responses of the five low-cost sensors.'],
  ['weather', 'Weather', ''],
  ['lags', 'Earlier CO readings', 'Optional. Leave empty to let the model fill them with training medians.'],
  ['prev', 'Sensors one hour earlier', 'Optional. The hour-to-hour change in each sensor helps the model track changes in CO.'],
  ['observed', 'Anomaly check', 'Optional. Supply the measured CO to compare it with the estimate.'],
];

// Form state survives navigation.
const state = {
  values: Object.fromEntries(FIELDS.map((f) => [f.key, f.def])),
  empty: new Set(FIELDS.filter((f) => f.startEmpty).map((f) => f.key)),
  loaded: null,
  lastResponse: null,
  lastStatus: null,
  result: null,
  initialised: false,
};

export async function render(root, _params, ctx) {
  const summary = await api.summary().catch(() => null);
  if (!ctx.alive()) return;
  const dsStart = summary?.dataset?.start?.slice(0, 16) || '2004-03-10T18:00';
  const dsEnd = summary?.dataset?.end?.slice(0, 16) || '2005-04-04T14:00';

  root.innerHTML = `
    <div class="page-head"><div>
      <h2>Virtual sensor</h2>
      <p>This form mirrors the <code>POST /predict</code> API. Load a real hour from the dataset or set the inputs yourself, then estimate CO. Add the observed CO to see whether the hour would be flagged.</p>
    </div></div>

    <div class="sim">
      <form class="card" id="sim-form" novalidate>
        <div class="fieldset">
          <div class="loader-bar">
            <label class="inline" for="sim-t"><strong style="color:var(--text)">Load real hour</strong></label>
            <input class="input" type="datetime-local" id="sim-t" step="3600" min="${esc(dsStart)}" max="${esc(dsEnd)}" value="${esc((state.loaded?.t || '2005-01-21T17:00').slice(0, 16))}">
            <button class="btn" type="button" id="sim-load">Load</button>
            <button class="btn btn--ghost" type="button" id="sim-random">${icon('dice')} Random hour</button>
          </div>
          <p class="muted" id="sim-loaded" style="font-size:12.5px;margin-top:8px" aria-live="polite"></p>
        </div>
        <div class="callout callout--error" id="sim-errors" hidden></div>
        ${GROUPS.map(([g, label, hint]) => `
          <fieldset class="fieldset">
            <legend>${esc(label)}</legend>
            ${hint ? `<p class="muted" style="font-size:12.5px;margin:-6px 0 12px">${esc(hint)}</p>` : ''}
            <div class="fields">${FIELDS.filter((f) => f.group === g).map(fieldHtml).join('')}</div>
          </fieldset>`).join('')}
        <div class="row">
          <button class="btn btn--primary" type="submit" id="sim-go">${icon('spark')} Estimate CO</button>
          <button class="btn btn--ghost" type="button" id="sim-reset">Reset to defaults</button>
        </div>
      </form>

      <div class="sim-side">
        <section class="card" aria-labelledby="sim-res-t" id="sim-result-card">
          <div class="card-head"><div><h3 class="card-title" id="sim-res-t">Estimate</h3><p class="card-sub">Model output for the hour described by the form.</p></div></div>
          <div id="sim-result">${emptyState('Press “Estimate CO” to run the model.', { title: 'No estimate yet', h: 200 })}</div>
        </section>
        <section class="card" aria-labelledby="sim-contrib-t" id="sim-contrib-card" hidden>
          <div class="card-head"><div><h3 class="card-title" id="sim-contrib-t">Feature contributions</h3><p class="card-sub">How much each input pushed this estimate up or down (${UNIT}).</p></div></div>
          <div class="chart" id="sim-contrib" style="--h:300px"></div>
        </section>
        <section class="card" aria-labelledby="sim-api-t">
          <div class="card-head"><div><h3 class="card-title" id="sim-api-t">API call</h3><p class="card-sub">The exact request and response, as you would send them from Postman.</p></div>
            <div class="card-tools"><button class="btn btn--sm" type="button" id="sim-curl">${icon('copy', 14)} Copy as cURL</button></div></div>
          <details class="code-block" open><summary>Request · POST /predict</summary><pre class="code" id="sim-req"></pre></details>
          <details class="code-block" ${state.lastResponse ? 'open' : ''}><summary>Response <span class="muted" id="sim-status"></span></summary><pre class="code" id="sim-resp">// Run an estimate to see the response.</pre></details>
        </section>
      </div>
    </div>`;

  bindFields(root);
  updateRequestPreview();
  if (state.loaded) showLoaded(state.loaded);
  if (state.lastResponse) showResponse(state.lastStatus, state.lastResponse);
  if (state.result) renderResult(state.result);

  $('#sim-form').addEventListener('submit', (e) => { e.preventDefault(); estimate(); });
  $('#sim-reset').addEventListener('click', () => {
    for (const f of FIELDS) state.values[f.key] = f.def;
    state.empty = new Set(FIELDS.filter((f) => f.startEmpty).map((f) => f.key));
    state.loaded = null;
    $('#sim-loaded').textContent = '';
    syncInputs();
    clearErrors();
  });
  $('#sim-load').addEventListener('click', () => {
    const v = $('#sim-t').value;
    if (!v) { $('#sim-loaded').textContent = 'Pick a date and hour first.'; return; }
    loadSample(() => api.sample(`${v.slice(0, 13)}:00:00`));
  });
  $('#sim-random').addEventListener('click', () => loadSample(api.randomSample));
  $('#sim-curl').addEventListener('click', () => copyText(curlFor(buildBody())));

  if (!state.initialised) {
    state.initialised = true;
    // Pre-fill with a real hour; fall back to a random one if that hour has no sensor data.
    loadSample(() => api.sample('2005-01-21T17:00:00').catch(() => api.randomSample()), { quiet: true });
  }
}

/* ---------- Form ---------- */

function fieldHtml(f) {
  const v = state.values[f.key];
  const isEmpty = state.empty.has(f.key);
  const ctl = f.select
    ? `<select class="select" id="f-${f.key}" data-key="${f.key}" style="grid-column:1 / -1">${f.select.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>`
    : `<input type="range" id="r-${f.key}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" aria-label="${esc(f.label)} slider" ${isEmpty ? 'disabled' : ''}>
       <input class="input" type="number" id="f-${f.key}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" inputmode="decimal" ${isEmpty ? 'disabled' : ''}>`;
  return `<div class="field ${isEmpty ? 'is-empty' : ''}" data-field="${f.key}">
    <div class="field-top">
      <label for="f-${f.key}">${esc(f.label)}</label><span class="unit">${esc(f.unit)}</span>
      ${f.optional ? `<label class="empty-toggle"><input type="checkbox" data-empty="${f.key}" ${isEmpty ? 'checked' : ''}> Leave empty</label>` : ''}
    </div>
    <div class="field-ctl">${ctl}</div>
    <div class="field-err" id="e-${f.key}" hidden></div>
  </div>`;
}

function bindFields(root) {
  for (const f of FIELDS) {
    const num = $(`#f-${f.key}`, root);
    const range = $(`#r-${f.key}`, root);
    if (f.select) {
      num.value = String(state.values[f.key]);
      num.addEventListener('change', () => { state.values[f.key] = Number(num.value); updateRequestPreview(); });
      continue;
    }
    range.addEventListener('input', () => {
      num.value = range.value;
      state.values[f.key] = Number(range.value);
      clearFieldError(f.key);
      updateRequestPreview();
    });
    num.addEventListener('input', () => {
      state.values[f.key] = num.value === '' ? '' : Number(num.value);
      if (num.value !== '') range.value = String(Math.min(f.max, Math.max(f.min, Number(num.value))));
      clearFieldError(f.key);
      updateRequestPreview();
    });
  }
  $$('[data-empty]', root).forEach((cb) => cb.addEventListener('change', () => {
    const key = cb.dataset.empty;
    if (cb.checked) state.empty.add(key); else state.empty.delete(key);
    setEmptyUI(key);
    updateRequestPreview();
  }));
}

function setEmptyUI(key) {
  const isEmpty = state.empty.has(key);
  const wrap = $(`[data-field="${key}"]`);
  if (!wrap) return;
  wrap.classList.toggle('is-empty', isEmpty);
  for (const el of $$('input[type=range], input[type=number]', wrap)) el.disabled = isEmpty;
  const cb = $(`[data-empty="${key}"]`, wrap);
  if (cb) cb.checked = isEmpty;
}

function syncInputs() {
  for (const f of FIELDS) {
    const num = $(`#f-${f.key}`);
    if (!num) continue;
    num.value = String(state.values[f.key]);
    const range = $(`#r-${f.key}`);
    if (range) range.value = String(state.values[f.key]);
    if (f.optional) setEmptyUI(f.key);
  }
  updateRequestPreview();
}

function buildBody() {
  const body = {};
  for (const f of FIELDS) {
    if (f.optional && state.empty.has(f.key)) { body[f.key] = null; continue; }
    const v = state.values[f.key];
    body[f.key] = v === '' || v === null || Number.isNaN(Number(v)) ? null : f.int ? Math.round(Number(v)) : Number(v);
  }
  return body;
}

function updateRequestPreview() {
  const pre = $('#sim-req');
  if (pre) pre.textContent = JSON.stringify(buildBody(), null, 2);
}

function curlFor(body) {
  return `curl -X POST "${location.origin}/predict" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`;
}

/* ---------- Samples ---------- */

async function loadSample(fetcher, { quiet = false } = {}) {
  const status = $('#sim-loaded');
  const buttons = [$('#sim-load'), $('#sim-random')];
  buttons.forEach((b) => { if (b) b.disabled = true; });
  if (!quiet && status) status.textContent = 'Loading…';
  try {
    const s = await fetcher();
    if (!$('#sim-form')) return;
    const input = s.input || {};
    for (const f of FIELDS) {
      let v = input[f.key];
      if (f.key === 'observed_co' && (v === undefined || v === null)) v = s.observed;
      if (f.optional && (v === null || v === undefined)) { state.empty.add(f.key); continue; }
      if (v !== undefined && v !== null) { state.values[f.key] = v; state.empty.delete(f.key); }
    }
    state.loaded = { t: s.t, observed: s.observed };
    if ($('#sim-t') && s.t) $('#sim-t').value = String(s.t).slice(0, 16);
    syncInputs();
    clearErrors();
    showLoaded(state.loaded);
  } catch (err) {
    if (!quiet && status) status.innerHTML = `<span style="color:var(--danger)">${esc(err.message || 'No record for that hour. Try another time within the dataset range.')}</span>`;
  } finally {
    buttons.forEach((b) => { if (b) b.disabled = false; });
  }
}

function showLoaded(l) {
  const el = $('#sim-loaded');
  if (!el || !l) return;
  el.innerHTML = `Loaded <strong style="color:var(--text)">${esc(fmtTs(l.t))}</strong> · observed CO ${l.observed == null ? '<em>missing</em>' : `<strong style="color:var(--observed)">${fmt(l.observed)} ${UNIT}</strong>`}`;
}

/* ---------- Predict ---------- */

async function estimate() {
  const btn = $('#sim-go');
  const body = buildBody();
  clearErrors();
  btn.disabled = true;
  btn.innerHTML = `${icon('spark')} Estimating…`;
  try {
    const res = await api.predict(body);
    state.lastStatus = 200;
    state.lastResponse = res;
    state.result = { res, body };
    if (!$('#sim-form')) return;
    showResponse(200, res);
    renderResult(state.result);
  } catch (err) {
    state.lastStatus = err.status || 'network error';
    state.lastResponse = err.detail !== undefined && err.detail !== null ? { detail: err.detail } : { error: err.message };
    if (!$('#sim-form')) return;
    showResponse(state.lastStatus, state.lastResponse);
    if (err.status === 422 && Array.isArray(err.detail)) showValidation(err.detail);
    else showGeneralError(err.message);
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('spark')} Estimate CO`; }
  }
}

function showResponse(status, payload) {
  const pre = $('#sim-resp');
  if (!pre) return;
  pre.textContent = JSON.stringify(payload, null, 2);
  $('#sim-status').textContent = `· ${status}`;
  pre.closest('details').open = true;
}

function showValidation(detail) {
  const general = [];
  for (const d of detail) {
    const loc = Array.isArray(d.loc) ? d.loc : [];
    const key = [...loc].reverse().find((x) => typeof x === 'string' && FIELDS.some((f) => f.key === x));
    if (key) {
      const el = $(`#e-${key}`);
      el.textContent = d.msg;
      el.hidden = false;
      $(`#f-${key}`)?.classList.add('is-invalid');
    } else {
      general.push(`${loc.filter((x) => x !== 'body').join('.') || 'request'}: ${d.msg}`);
    }
  }
  const fieldCount = detail.length - general.length;
  showGeneralError(`The API rejected the input (422).${fieldCount ? ` ${fieldCount} field${fieldCount > 1 ? 's need' : ' needs'} attention, see the messages below each input.` : ''}`, general);
  const first = $('.field-err:not([hidden])');
  first?.closest('.field')?.scrollIntoView({ behavior: C.reducedMotion() ? 'auto' : 'smooth', block: 'center' });
}

function showGeneralError(msg, items = []) {
  const box = $('#sim-errors');
  box.innerHTML = `${icon('alert', 18)}<div><strong style="color:var(--text)">${esc(msg)}</strong>${items.length ? `<ul style="margin:6px 0 0;padding-left:18px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</div>`;
  box.hidden = false;
}

function clearFieldError(key) {
  const el = $(`#e-${key}`);
  if (el) { el.hidden = true; el.textContent = ''; }
  $(`#f-${key}`)?.classList.remove('is-invalid');
}
function clearErrors() {
  for (const f of FIELDS) clearFieldError(f.key);
  const box = $('#sim-errors');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function hintColorVar(hint) {
  const h = String(hint || '').toLowerCase();
  if (h.includes('data')) return '--datalim';
  return '--unusual';
}

function renderResult({ res, body }) {
  const el = $('#sim-result');
  if (!el) return;
  const iv = res.interval || {};
  const est = res.estimated_co_mg_m3;
  const obs = res.anomaly?.observed ?? body.observed_co;
  const scaleMax = Math.max(1, iv.upper ?? 0, est ?? 0, obs ?? 0) * 1.2;
  const pos = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const a = res.anomaly;
  let verdict;
  if (!a) {
    verdict = `<div class="verdict"><strong>Anomaly check skipped</strong><span class="muted">Add the observed CO for this hour (Anomaly check section) to compare it with the estimate.</span></div>`;
  } else if (a.flagged) {
    const clsKey = CLASSES[a.classification_hint] ? a.classification_hint
      : hintColorVar(a.classification_hint) === '--datalim' ? 'data_limitation_candidate' : 'unusual_pollution_candidate';
    const cv = CLASSES[clsKey].cssVar;
    verdict = `<div class="verdict is-flagged" style="--vc:var(${cv})">
      <div class="row"><span class="badge ${CLASSES[clsKey].badge}"><span class="dot"></span>Flagged</span><strong>${esc(CLASSES[a.classification_hint]?.label || a.classification_hint || CLASSES[clsKey].label)}</strong></div>
      <span>|Residual| <b class="num">${fmt(Math.abs(a.residual))}</b> exceeds the threshold of <b class="num">${fmt(a.threshold)}</b> ${UNIT}.</span>
      ${a.hints?.length ? `<ul>${a.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    </div>`;
  } else {
    verdict = `<div class="verdict"><div class="row"><span class="badge badge--ok"><span class="dot"></span>Consistent</span><strong>Observed matches the estimate</strong></div>
      <span>Residual <b class="num">${fmt(a.residual)}</b> ${UNIT} is within ±${fmt(a.threshold)} ${UNIT}.</span>
      ${a.hints?.length ? `<ul>${a.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  el.innerHTML = `
    <div class="row" style="align-items:baseline;justify-content:space-between">
      <div class="result-value">${fmt(est)}<small>${UNIT}</small></div>
      <span class="badge" title="Model">${esc(res.model || '')}</span>
    </div>
    <p class="muted num" style="margin-top:8px">${fmt((iv.nominal_coverage ?? 0.9) * 100, 0)}% interval: <strong style="color:var(--text)">${fmt(iv.lower)} – ${fmt(iv.upper)}</strong> ${UNIT}${obs != null ? ` · observed <strong style="color:var(--observed)">${fmt(obs)}</strong> ${UNIT}` : ''}</p>
    <div class="range-viz" aria-hidden="true">
      <div class="track"></div>
      ${iv.lower != null && iv.upper != null ? `<div class="band" style="left:${pos(iv.lower)};width:calc(${pos(iv.upper)} - ${pos(iv.lower)})"></div>` : ''}
      <div class="mark est" style="left:${pos(est)}"><span>estimate</span></div>
      ${obs != null ? `<div class="mark obs" style="left:${pos(obs)}"><span>observed</span></div>` : ''}
    </div>
    <div style="margin-top:22px">${verdict}</div>
    ${res.imputed_fields?.length ? `<div style="margin-top:12px"><p class="muted" style="font-size:12.5px;margin-bottom:6px">Filled with training medians (left empty):</p><div class="tags">${res.imputed_fields.map((f) => `<span class="badge">${esc(f)}</span>`).join('')}</div></div>` : ''}`;

  const card = $('#sim-contrib-card');
  const contrib = res.contributions;
  if (Array.isArray(contrib) && contrib.length) {
    card.hidden = false;
    const rows = [...contrib].sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 15);
    $('#sim-contrib').style.setProperty('--h', `${Math.max(220, rows.length * 24 + 60)}px`);
    C.mount($('#sim-contrib'), (t) => ({
      ...C.base(t, 'feature-contributions'),
      grid: { left: 8, right: 44, top: 30, bottom: 24, containLabel: true },
      yAxis: { ...C.xCat(t, rows.map((r) => r.feature), ''), inverse: true, axisLine: { onZero: false, lineStyle: { color: t.borderStrong } }, axisLabel: { color: t.text, fontSize: 11, interval: 0 } },
      xAxis: C.xVal(t, `Contribution (${UNIT})`),
      tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { digits: 3 }) }),
      series: [{
        type: 'bar', name: 'Contribution', barCategoryGap: '30%',
        data: rows.map((r) => ({ value: r.value, label: { position: r.value >= 0 ? 'right' : 'left' }, itemStyle: { color: r.value >= 0 ? t.pos : t.neg, borderRadius: r.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
        label: { show: true, color: t.muted, fontSize: 10, formatter: (p) => `${p.value > 0 ? '+' : ''}${fmt(p.value, 2)}` },
      }],
    }));
  } else {
    card.hidden = true;
  }
}
