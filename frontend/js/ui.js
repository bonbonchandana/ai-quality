// Shared DOM helpers, formatters, badges and loading/error states.

export const UNIT = 'mg/m³';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtInt = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US'));
export const fmtPct = (v, d = 1) => (v === null || v === undefined ? '—' : `${fmt(v, d)}%`);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Format an API timestamp string "YYYY-MM-DDTHH:MM:SS" without timezone conversion. */
export function fmtTs(s, { time = true } = {}) {
  if (!s) return '—';
  const [d, tm = ''] = String(s).split(/[T ]/);
  const [y, m, dd] = d.split('-');
  if (!m) return String(s);
  const date = `${+dd || ''} ${MONTHS[+m - 1]} ${y}`.trim();
  return time && tm ? `${date} · ${tm.slice(0, 5)}` : date;
}
/** Format epoch milliseconds (as produced by ECharts time axes, parsed as local). */
export function fmtMs(ms, { time = true } = {}) {
  const d = new Date(ms);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return time ? `${date} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : date;
}
export function fmtMonth(s) {
  const [y, m] = String(s).split('-');
  return m ? `${MONTHS[+m - 1]} ${y}` : String(s);
}
export const toMs = (s) => (typeof s === 'number' ? s : new Date(s).getTime());
export const HOUR = 3600 * 1000;

/* ---------- Domain vocabulary (kept identical everywhere) ---------- */
export const CLASSES = {
  unusual_pollution_candidate: { label: 'Unusual-pollution candidate', short: 'Unusual pollution', cssVar: '--unusual', badge: 'badge--unusual' },
  data_limitation_candidate: { label: 'Data-limitation candidate', short: 'Data limitation', cssVar: '--datalim', badge: 'badge--datalim' },
};
export const CLASS_KEYS = Object.keys(CLASSES);

export function periodGroup(name) {
  if (String(name).startsWith('fold')) return 'val';
  if (name === 'calibration') return 'cal';
  if (name === 'test') return 'test';
  return 'val';
}
export function periodLabel(name) {
  const g = periodGroup(name);
  if (g === 'val') {
    const n = String(name).split('_')[1];
    return n ? `Validation ${n}` : 'Validation';
  }
  return g === 'cal' ? 'Calibration' : 'Test';
}

export function classBadge(c) {
  const m = CLASSES[c];
  if (!m) return `<span class="badge">${esc(c || 'Unclassified')}</span>`;
  return `<span class="badge ${m.badge}"><span class="dot"></span>${esc(m.label)}</span>`;
}
export function severityBadge(s) {
  return `<span class="badge ${s === 'high' ? 'badge--high' : ''}">${esc(s === 'high' ? 'High' : s === 'moderate' ? 'Moderate' : s || '—')}</span>`;
}
export function periodBadge(p) {
  return `<span class="badge badge--period-${periodGroup(p)}">${esc(periodLabel(p))}</span>`;
}

/* ---------- Icons ---------- */
const ICONS = {
  alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  retry: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  arrowLeft: '<path d="M19 12H5m7-7-7 7 7 7"/>',
  arrowRight: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  spark: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
};
export function icon(name, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------- Building blocks ---------- */
export function chartCard({ id, title, subtitle = '', h = 320, span = 12, tools = '', extra = '' }) {
  return `<section class="card span-${span}" aria-labelledby="${id}-t">
    <div class="card-head"><div><h3 class="card-title" id="${id}-t">${esc(title)}</h3>${subtitle ? `<p class="card-sub">${subtitle}</p>` : ''}</div>${tools ? `<div class="card-tools">${tools}</div>` : ''}</div>
    ${extra}
    <div class="chart" id="${id}" style="--h:${h}px" role="img" aria-label="${esc(title)}"></div>
  </section>`;
}

export function skeletonBlock(h) {
  return `<div class="skeleton sk-block" style="--h:${h || 280}px" aria-hidden="true"></div>`;
}

export function pageSkeleton() {
  const kpi = `<div class="card"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton" style="height:30px;width:60%;margin:12px 0"></div><div class="skeleton sk-line" style="width:70%"></div></div>`;
  return `<div aria-busy="true" aria-label="Loading">
    <div class="skeleton" style="height:28px;width:280px;margin-bottom:10px"></div>
    <div class="skeleton sk-line" style="width:420px;max-width:80%;margin-bottom:24px"></div>
    <div class="kpis">${kpi.repeat(4)}</div>
    <div class="grid"><div class="card span-8">${skeletonBlock(300)}</div><div class="card span-4">${skeletonBlock(300)}</div></div>
  </div>`;
}

export function errorState(err, { compact = false, title = 'Something went wrong' } = {}) {
  const offline = err && err.status === 0;
  const msg = offline
    ? 'The dashboard could not reach the API. Make sure the FastAPI backend is running, then try again.'
    : esc(err?.message || 'Unexpected error.');
  return `<div class="state state--error" role="alert" ${compact ? 'style="--h:200px"' : ''}>
    ${icon('alert', 40)}
    <h3>${esc(offline ? 'API unavailable' : title)}</h3>
    <p>${msg}</p>
    ${err?.url ? `<code>${esc(err.url)}${err.status ? ` · HTTP ${err.status}` : ''}</code>` : ''}
    <button class="btn" type="button" data-retry>${icon('retry')} Retry</button>
  </div>`;
}

export function emptyState(message, { title = 'Nothing to show', h = 220 } = {}) {
  return `<div class="state" style="--h:${h}px">${icon('inbox', 40)}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}

/**
 * Load data for one or more containers: skeletons while pending, friendly
 * error with Retry on failure, then hand the data to `render`.
 */
export async function section(els, load, render) {
  const list = (Array.isArray(els) ? els : [els]).filter(Boolean);
  for (const el of list) el.innerHTML = skeletonBlock(el.offsetHeight || parseInt(getComputedStyle(el).getPropertyValue('--h'), 10) || 280);
  try {
    const data = await load();
    if (!list.some((el) => el.isConnected)) return;
    for (const el of list) el.innerHTML = '';
    render(data);
  } catch (err) {
    console.error(err);
    for (const el of list) {
      if (!el.isConnected) continue;
      el.innerHTML = errorState(err, { compact: true });
      el.querySelector('[data-retry]')?.addEventListener('click', () => section(els, load, render));
    }
  }
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast('Copied to clipboard');
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}
