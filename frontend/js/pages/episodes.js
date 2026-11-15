/* global echarts */
import { api } from '../api.js';
import * as C from '../charts.js';
import {
  $, $$, CLASSES, CLASS_KEYS, HOUR, UNIT, chartCard, classBadge, emptyState, esc, fmt, fmtInt, fmtMonth, fmtTs,
  periodBadge, periodLabel, severityBadge, toMs,
} from '../ui.js';

export const meta = { title: 'Episodes', subtitle: 'Stretches where observed CO departs substantially from the estimate' };

// Filters survive navigating to a detail page and back.
const state = { cls: '', sev: '', period: '', q: '', sort: 'start', dir: 1 };

const COLS = [
  ['id', 'ID'], ['start', 'Start'], ['end', 'End'], ['hours', 'Hours', 'n'], ['peak_abs_residual', 'Peak |resid.|', 'n'],
  ['severity', 'Severity'], ['classification', 'Classification'], ['reason', 'Reason', 'nosort'], ['period', 'Period'],
];

export async function render(root, _params, ctx) {
  const [data, summary] = await Promise.all([api.episodes(), api.summary().catch(() => null)]);
  if (!ctx.alive()) return;
  const all = data.episodes || [];
  const periods = summary?.periods || [];
  const periodNames = [...new Set(all.map((e) => e.period))];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Pollution episodes</h2>
        <p>An episode is a run of hours where |observed − estimated| exceeds the flag threshold${summary?.model?.threshold != null ? ` (${fmt(summary.model.threshold, 2)} ${UNIT})` : ''}. Each is classified as a likely real pollution event or a likely data problem, with the reason.</p>
      </div>
      <div class="legend-inline">${CLASS_KEYS.map((k) => `<span><i style="--c:var(${CLASSES[k].cssVar})"></i>${CLASSES[k].label}</span>`).join('')}</div>
    </div>
    <div class="grid">
      ${chartCard({ id: 'ep-gantt', span: 12, h: 240, title: 'Episode timeline', subtitle: 'Each bar spans one episode, colored by classification; faded bars are moderate severity. Click a bar for details.' })}
      ${chartCard({ id: 'ep-month', span: 8, h: 280, title: 'Episodes per month', subtitle: 'Count of episodes starting in each month, stacked by classification.' })}
      ${chartCard({ id: 'ep-sev', span: 4, h: 280, title: 'Severity', subtitle: 'High vs moderate episodes by classification.' })}
      <section class="card span-12" aria-labelledby="ep-table-t">
        <div class="card-head"><div><h3 class="card-title" id="ep-table-t">All episodes</h3><p class="card-sub">Filter, sort by any column, and click a row to open the episode.</p></div></div>
        <div class="filters">
          <input class="input" type="search" id="f-q" placeholder="Search ID or reason…" value="${esc(state.q)}" aria-label="Search episodes">
          <select class="select" id="f-cls" aria-label="Classification"><option value="">All classifications</option>${CLASS_KEYS.map((k) => `<option value="${k}">${CLASSES[k].label}</option>`).join('')}</select>
          <select class="select" id="f-sev" aria-label="Severity"><option value="">All severities</option><option value="high">High</option><option value="moderate">Moderate</option></select>
          <select class="select" id="f-period" aria-label="Period"><option value="">All periods</option>${periodNames.map((p) => `<option value="${esc(p)}">${esc(periodLabel(p))}</option>`).join('')}</select>
          <span class="spacer"></span><span class="count-pill" id="f-count"></span>
        </div>
        <div class="table-wrap table-scroll" id="ep-table"></div>
      </section>
    </div>`;

  $('#f-cls').value = state.cls;
  $('#f-sev').value = state.sev;
  $('#f-period').value = state.period;

  if (!all.length) {
    for (const id of ['#ep-gantt', '#ep-month', '#ep-sev']) $(id).innerHTML = emptyState('No episodes were flagged in the out-of-sample timeline.', { title: 'No episodes' });
    $('#ep-table').innerHTML = emptyState('No episodes to list.', { h: 160 });
    return;
  }

  drawGantt(all, periods);
  drawMonthly(all);
  drawSeverity(all);

  const refresh = () => renderTable(all);
  $('#f-q').addEventListener('input', (e) => { state.q = e.target.value; refresh(); });
  for (const [id, key] of [['#f-cls', 'cls'], ['#f-sev', 'sev'], ['#f-period', 'period']]) {
    $(id).addEventListener('change', (e) => { state[key] = e.target.value; refresh(); });
  }
  refresh();
}

function filtered(all) {
  const q = state.q.trim().toLowerCase();
  const rows = all.filter((e) => (!state.cls || e.classification === state.cls)
    && (!state.sev || e.severity === state.sev)
    && (!state.period || e.period === state.period)
    && (!q || `${e.id} ${e.reason}`.toLowerCase().includes(q)));
  const k = state.sort;
  rows.sort((a, b) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.dir;
    return String(x ?? '').localeCompare(String(y ?? '')) * state.dir;
  });
  return rows;
}

function renderTable(all) {
  const rows = filtered(all);
  $('#f-count').textContent = `${rows.length} of ${all.length} episodes`;
  const el = $('#ep-table');
  if (!rows.length) { el.innerHTML = emptyState('No episodes match these filters.', { title: 'No matches', h: 160 }); return; }
  el.innerHTML = `<table class="data"><thead><tr>${COLS.map(([k, l, cls]) => {
    const sortAttr = state.sort === k ? ` aria-sort="${state.dir > 0 ? 'ascending' : 'descending'}"` : '';
    const inner = cls === 'nosort' ? l : `<button type="button" data-sort="${k}">${l}</button>`;
    return `<th class="${cls === 'n' ? 'n' : ''}"${sortAttr} scope="col">${inner}</th>`;
  }).join('')}</tr></thead><tbody>${rows.map((e) => `
    <tr class="clickable" tabindex="0" data-id="${esc(e.id)}" aria-label="Open episode ${esc(e.id)}">
      <td><strong>${esc(e.id)}</strong></td>
      <td class="nowrap">${esc(fmtTs(e.start))}</td>
      <td class="nowrap">${esc(fmtTs(e.end))}</td>
      <td class="n">${fmtInt(e.hours)}</td>
      <td class="n">${fmt(e.peak_abs_residual)}</td>
      <td>${severityBadge(e.severity)}</td>
      <td>${classBadge(e.classification)}</td>
      <td class="reason">${esc(e.reason)}</td>
      <td>${periodBadge(e.period)}</td>
    </tr>`).join('')}</tbody></table>`;

  $$('[data-sort]', el).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    state.dir = state.sort === k ? -state.dir : (k === 'hours' || k === 'peak_abs_residual' ? -1 : 1);
    state.sort = k;
    renderTable(all);
  }));
  $$('tr[data-id]', el).forEach((tr) => {
    const go = () => { location.hash = `#/episodes/${encodeURIComponent(tr.dataset.id)}`; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  });
}

function drawGantt(all, periods) {
  const cats = CLASS_KEYS.map((k) => CLASSES[k].short);
  C.mount($('#ep-gantt'), (t) => ({
    ...C.base(t, 'episode-timeline'),
    grid: C.zoomGrid({ top: 28, left: 20 }),
    xAxis: C.xTime(t),
    yAxis: { ...C.xCat(t, cats, ''), axisLabel: { color: t.text, fontSize: 11 }, splitLine: { show: true, lineStyle: { color: t.grid } } },
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'item',
      formatter: (p) => {
        const e = p.data.ep;
        return `<b>${esc(e.id)}</b> · ${esc(CLASSES[e.classification]?.label || e.classification)}<br><span style="color:${t.faint}">${esc(fmtTs(e.start))} → ${esc(fmtTs(e.end))}</span><br>${fmtInt(e.hours)} h · ${esc(e.severity)} · peak |residual| ${fmt(e.peak_abs_residual)} ${UNIT}`;
      },
    }),
    series: [
      {
        type: 'custom', name: 'Episodes',
        renderItem: (params, apiR) => {
          const y = apiR.value(0);
          const s = apiR.coord([apiR.value(1), y]);
          const e = apiR.coord([apiR.value(2), y]);
          const h = apiR.size([0, 1])[1] * 0.5;
          const rect = echarts.graphic.clipRectByRect(
            { x: s[0], y: s[1] - h / 2, width: Math.max(e[0] - s[0], 4), height: h },
            { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height },
          );
          return rect && { type: 'rect', shape: { ...rect, r: 2 }, style: apiR.style(), emphasis: { style: { stroke: t.text, lineWidth: 1 } } };
        },
        encode: { x: [1, 2], y: 0 },
        data: all.map((ep) => ({
          ep,
          value: [CLASS_KEYS.indexOf(ep.classification), toMs(ep.start), toMs(ep.end) + HOUR, ep.hours],
          itemStyle: { color: C.alpha(C.classColor(ep.classification, t), ep.severity === 'high' ? 0.95 : 0.5) },
        })),
      },
      C.periodSeries(t, periods),
    ],
  }), {
    setup: (inst) => inst.on('click', (p) => { if (p.data?.ep) location.hash = `#/episodes/${encodeURIComponent(p.data.ep.id)}`; }),
  });
}

function drawMonthly(all) {
  const months = [...new Set(all.map((e) => String(e.start).slice(0, 7)))].sort();
  C.mount($('#ep-month'), (t) => ({
    ...C.base(t, 'episodes-per-month'),
    legend: C.legend(t, { data: CLASS_KEYS.map((k) => CLASSES[k].label) }),
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    xAxis: C.xCat(t, months.map(fmtMonth), '', { axisLabel: { color: t.muted, fontSize: 10, rotate: months.length > 8 ? 40 : 0 } }),
    yAxis: C.yVal(t, 'Episodes', { minInterval: 1 }),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { unit: '', digits: 0 }) }),
    series: CLASS_KEYS.map((k, i) => ({
      name: CLASSES[k].label, type: 'bar', stack: 'cls', barMaxWidth: 34,
      itemStyle: { color: C.classColor(k, t), borderRadius: i === CLASS_KEYS.length - 1 ? [4, 4, 0, 0] : 0 },
      data: months.map((m) => all.filter((e) => e.classification === k && String(e.start).startsWith(m)).length),
    })),
  }));
}

function drawSeverity(all) {
  const sevs = ['high', 'moderate'];
  C.mount($('#ep-sev'), (t) => ({
    ...C.base(t, 'episode-severity'),
    legend: C.legend(t, { data: CLASS_KEYS.map((k) => CLASSES[k].short) }),
    grid: { left: 8, right: 24, top: 44, bottom: 8, containLabel: true },
    yAxis: { ...C.xCat(t, ['High', 'Moderate'], ''), axisLabel: { color: t.text, fontSize: 12 } },
    xAxis: C.xVal(t, '', { minInterval: 1 }),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { unit: 'episodes', digits: 0 }) }),
    series: CLASS_KEYS.map((k) => ({
      name: CLASSES[k].short, type: 'bar', stack: 'sev', barWidth: '45%',
      itemStyle: { color: C.classColor(k, t) },
      label: { show: true, color: '#fff', fontSize: 11, formatter: (p) => (p.value >= 3 ? p.value : '') },
      data: sevs.map((s) => all.filter((e) => e.classification === k && e.severity === s).length),
    })),
  }));
}
