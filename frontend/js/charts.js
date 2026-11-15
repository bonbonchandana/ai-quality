// ECharts glue: instance registry (resize / dispose / re-theme), theme tokens
// read from CSS custom properties, and shared option builders.
/* global echarts */

import { CLASSES, HOUR, UNIT, esc, fmt, fmtMs, periodGroup, periodLabel, toMs } from './ui.js';

const registry = new Set();

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Snapshot of the current theme's colors. */
export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    dark: document.documentElement.getAttribute('data-theme') !== 'light',
    bg: v('--bg'), surface: v('--surface'), surface2: v('--surface-2'), surface3: v('--surface-3'),
    border: v('--border'), borderStrong: v('--border-strong'), grid: v('--grid-line'),
    text: v('--text'), muted: v('--text-muted'), faint: v('--text-faint'),
    accent: v('--accent'), observed: v('--observed'), estimate: v('--estimate'), flag: v('--flag'),
    unusual: v('--unusual'), datalim: v('--datalim'),
    val: v('--period-val'), cal: v('--period-cal'), test: v('--period-test'),
    model: v('--fam-model'), baseline: v('--fam-baseline'), team: v('--fam-team'),
    pos: v('--pos'), neg: v('--neg'),
    seq: [v('--seq-0'), v('--seq-1'), v('--seq-2'), v('--seq-3'), v('--seq-4')],
    div: [v('--div-neg'), v('--div-mid'), v('--div-pos')],
    palette: [v('--observed'), v('--estimate'), '#a3e635', '#60a5fa', '#fb923c', '#34d399', '#e879f9', '#f87171'],
    font: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  };
}

export function alpha(color, a) {
  const c = String(color).trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

export const classColor = (cls, t) => (CLASSES[cls] ? t[CLASSES[cls].cssVar === '--unusual' ? 'unusual' : 'datalim'] : t.flag);
export const periodColor = (name, t) => t[periodGroup(name)];

/* ---------- Registry ---------- */

function apply(entry) {
  const t = tokens();
  const option = entry.build(t);
  entry.inst.setOption({ animation: !reducedMotion(), animationDuration: 650, animationEasing: 'cubicOut', ...option }, { notMerge: true });
}

/**
 * Mount a chart. `build(t)` returns an option for theme tokens `t`; it is
 * re-run on theme change. `setup(inst)` binds events once.
 */
export function mount(el, build, { setup, group } = {}) {
  if (!el || !el.isConnected) return null;
  const prev = echarts.getInstanceByDom(el);
  if (prev) {
    for (const e of registry) if (e.el === el) registry.delete(e);
    prev.dispose();
  }
  el.innerHTML = '';
  const inst = echarts.init(el, null, { renderer: 'canvas' });
  const entry = { el, build, inst };
  registry.add(entry);
  apply(entry);
  if (setup) setup(inst);
  if (group) { inst.group = group; echarts.connect(group); }
  return inst;
}

export function resizeAll() {
  for (const e of registry) {
    if (!e.el.isConnected) { e.inst.dispose(); registry.delete(e); continue; }
    e.inst.resize();
  }
}
export function disposeAll() {
  for (const e of registry) e.inst.dispose();
  registry.clear();
}
export function rethemeAll() {
  for (const e of registry) {
    if (!e.el.isConnected) { e.inst.dispose(); registry.delete(e); continue; }
    apply(e);
  }
}

/* ---------- Option fragments ---------- */

export function tip(t, extra = {}) {
  return {
    backgroundColor: t.surface2,
    borderColor: t.borderStrong,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
    extraCssText: 'border-radius:10px;box-shadow:0 10px 30px -10px rgba(0,0,0,.45);',
    confine: true,
    ...extra,
  };
}

export function legend(t, extra = {}) {
  return {
    top: 0, left: 0, right: 40, type: 'scroll', icon: 'roundRect', itemWidth: 12, itemHeight: 8, itemGap: 14,
    textStyle: { color: t.muted, fontFamily: t.font, fontSize: 12 },
    pageTextStyle: { color: t.muted }, pageIconColor: t.muted, pageIconInactiveColor: t.faint,
    ...extra,
  };
}

export function toolbox(t, name) {
  return {
    right: 0, top: -4, itemSize: 14,
    iconStyle: { borderColor: t.faint },
    emphasis: { iconStyle: { borderColor: t.accent, textFill: t.text } },
    feature: { saveAsImage: { title: 'Save PNG', name: name || 'chart', backgroundColor: t.surface, pixelRatio: 2 } },
  };
}

/** Common top-level option keys every chart gets. */
export function base(t, name, extra = {}) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.font, color: t.muted },
    color: t.palette,
    toolbox: toolbox(t, name),
    tooltip: tip(t, { trigger: 'axis' }),
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    ...extra,
  };
}

const axisCommon = (t) => ({
  axisLine: { lineStyle: { color: t.borderStrong } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
  splitLine: { lineStyle: { color: t.grid } },
  nameTextStyle: { color: t.faint, fontSize: 11 },
});

export function xTime(t, extra = {}) {
  return { type: 'time', ...axisCommon(t), splitLine: { show: false }, axisPointer: { label: { show: false } }, ...extra };
}
export function xCat(t, data, name = '', extra = {}) {
  return { type: 'category', data, name, nameLocation: 'middle', nameGap: 28, ...axisCommon(t), splitLine: { show: false }, ...extra };
}
export function yVal(t, name = '', extra = {}) {
  return { type: 'value', name, nameLocation: 'end', nameGap: 12, ...axisCommon(t), axisLine: { show: false }, scale: false, ...extra, nameTextStyle: { color: t.faint, fontSize: 11, align: 'left', ...(extra.nameTextStyle || {}) } };
}
export function xVal(t, name = '', extra = {}) {
  return { type: 'value', name, nameLocation: 'middle', nameGap: 28, ...axisCommon(t), ...extra };
}

export function zoom(t, xAxisIndex = 0) {
  return [
    { type: 'inside', xAxisIndex, filterMode: 'none' },
    {
      type: 'slider', xAxisIndex, filterMode: 'none', height: 20, bottom: 6,
      borderColor: t.border, backgroundColor: 'transparent',
      fillerColor: alpha(t.accent, 0.12),
      dataBackground: { lineStyle: { color: t.faint, opacity: 0.6 }, areaStyle: { color: t.faint, opacity: 0.12 } },
      selectedDataBackground: { lineStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.15 } },
      handleStyle: { color: t.surface3, borderColor: t.borderStrong },
      moveHandleStyle: { color: t.borderStrong },
      textStyle: { color: t.faint, fontSize: 10 },
      labelFormatter: (v) => fmtMs(v, { time: false }),
    },
  ];
}
export const zoomGrid = (extra = {}) => ({ left: 8, right: 16, top: 44, bottom: 44, containLabel: true, ...extra });

/** Invisible helper series that only draws period bands (Validation / Calibration / Test). */
export function periodSeries(t, periods = [], { labels = true } = {}) {
  return {
    name: '_periods', type: 'line', data: [], silent: true, tooltip: { show: false },
    markArea: {
      silent: true,
      data: periods.map((p) => [
        {
          name: labels ? periodLabel(p.name) : '',
          xAxis: toMs(p.start),
          itemStyle: { color: alpha(periodColor(p.name, t), t.dark ? 0.1 : 0.08) },
          label: { color: t.faint, fontSize: 10, position: 'insideTop', distance: 4 },
        },
        { xAxis: toMs(p.end) },
      ]),
    },
  };
}

/** Helper series shading episodes in their classification color. */
export function episodeSeries(t, episodes = [], { name = 'Episodes', opacity = 0.3 } = {}) {
  return {
    name, type: 'line', data: [], silent: true, tooltip: { show: false },
    itemStyle: { color: t.unusual }, lineStyle: { opacity: 0 }, symbol: 'roundRect',
    markArea: {
      silent: true,
      data: episodes.map((e) => [
        { xAxis: toMs(e.start), itemStyle: { color: alpha(classColor(e.classification, t), opacity) } },
        { xAxis: toMs(e.end) + HOUR },
      ]),
    },
  };
}

/** Stacked pair of series drawing a lower→upper band. */
export function bandSeries(t, rows, { name = '90% interval', color } = {}) {
  const c = color || t.estimate;
  return [
    {
      name: '_lower', type: 'line', stack: 'band', symbol: 'none', silent: true, tooltip: { show: false },
      lineStyle: { opacity: 0 }, data: rows.map((p) => [p.t, p.lower]),
    },
    {
      name, type: 'line', stack: 'band', symbol: 'none', silent: true,
      lineStyle: { opacity: 0 }, itemStyle: { color: alpha(c, 0.45) }, areaStyle: { color: alpha(c, t.dark ? 0.16 : 0.14) },
      data: rows.map((p) => [p.t, p.upper != null && p.lower != null ? p.upper - p.lower : null]),
    },
  ];
}

export function lineSeries(name, data, color, extra = {}) {
  return {
    name, type: 'line', data, showSymbol: false, symbolSize: 5, sampling: 'lttb', connectNulls: false,
    lineStyle: { width: 1.6, color }, itemStyle: { color }, emphasis: { focus: 'none', lineStyle: { width: 2 } },
    ...extra,
  };
}

/** Axis tooltip for time series built from row lookups (keeps real lower/upper values). */
export function rowTooltip(t, rowsByMs, fields) {
  return (params) => {
    const arr = Array.isArray(params) ? params : [params];
    if (!arr.length) return '';
    const first = arr[0];
    const ms = Array.isArray(first.value) ? toMs(first.value[0]) : first.axisValue;
    const row = rowsByMs.get(ms) || nearest(rowsByMs, ms);
    if (!row) return '';
    const lines = fields
      .map((f) => {
        const val = typeof f.get === 'function' ? f.get(row) : row[f.key];
        if (val === undefined) return '';
        return `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><span>${dot(f.color)}${esc(f.label)}</span><b style="font-variant-numeric:tabular-nums">${typeof val === 'string' ? esc(val) : fmt(val, f.digits ?? 2)}${f.unit ? ` <span style="color:${t.faint};font-weight:400">${esc(f.unit)}</span>` : ''}</b></div>`;
      })
      .join('');
    return `<div style="min-width:200px"><div style="color:${t.faint};margin-bottom:4px">${fmtMs(row._ms ?? ms)}</div>${lines}</div>`;
  };
}

function nearest(map, ms) {
  let best = null;
  let bd = Infinity;
  for (const [k, v] of map) {
    const d = Math.abs(k - ms);
    if (d < bd) { bd = d; best = v; }
  }
  return bd <= 6 * HOUR ? best : null;
}

export function indexByMs(rows) {
  const m = new Map();
  for (const r of rows) { r._ms = toMs(r.t); m.set(r._ms, r); }
  return m;
}

export function dot(color) {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;
}

/** Generic axis tooltip formatter for category/value charts. */
export function simpleTooltip(t, { unit = UNIT, digits = 2, header } = {}) {
  return (params) => {
    const arr = (Array.isArray(params) ? params : [params]).filter((p) => !String(p.seriesName).startsWith('_'));
    if (!arr.length) return '';
    const head = header ? header(arr[0]) : arr[0].axisValueLabel ?? arr[0].name;
    const rows = arr.map((p) => {
      const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
      return `<div style="display:flex;gap:12px;justify-content:space-between"><span>${dot(p.color)}${esc(p.seriesName)}</span><b style="font-variant-numeric:tabular-nums">${fmt(v, digits)}${unit ? ` <span style="color:${t.faint};font-weight:400">${esc(unit)}</span>` : ''}</b></div>`;
    }).join('');
    return `<div style="min-width:160px"><div style="color:${t.faint};margin-bottom:4px">${esc(head)}</div>${rows}</div>`;
  };
}

/** Continuous visualMap with theme sequential ramp. */
export function seqVisualMap(t, min, max, extra = {}) {
  return {
    min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, itemHeight: 160,
    inRange: { color: t.seq }, textStyle: { color: t.muted, fontSize: 11 },
    formatter: (v) => fmt(v, max - min > 20 ? 0 : 1),
    ...extra,
  };
}

/** Minimal sparkline used inside KPI cards. */
export function sparkline(t, data, { color, type = 'line', category } = {}) {
  const c = color || t.accent;
  return {
    backgroundColor: 'transparent',
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: category ? { type: 'category', data: category, show: false } : { type: 'time', show: false },
    yAxis: { type: 'value', show: false, scale: type === 'line' },
    tooltip: tip(t, { trigger: 'axis', axisPointer: { type: 'none' }, formatter: (p) => {
      const q = p[0];
      const v = Array.isArray(q.value) ? q.value[1] : q.value;
      const lbl = category ? q.name : fmtMs(q.value[0]);
      return `<span style="color:${t.faint}">${esc(lbl)}</span><br><b>${fmt(v, 2)}</b>`;
    } }),
    series: [
      type === 'bar'
        ? { type: 'bar', data, itemStyle: { color: alpha(c, 0.75), borderRadius: [2, 2, 0, 0] }, barCategoryGap: '25%' }
        : {
          type: 'line', data, showSymbol: false, smooth: 0.3, sampling: 'lttb', connectNulls: true,
          lineStyle: { width: 1.6, color: c },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(c, 0.35) }, { offset: 1, color: alpha(c, 0) }] } },
        },
    ],
  };
}

export function quantile(values, q) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
}
