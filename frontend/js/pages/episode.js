import { api } from '../api.js';
import * as C from '../charts.js';
import {
  $, CLASSES, UNIT, chartCard, classBadge, emptyState, esc, fmt, fmtInt, fmtTs, icon, periodBadge, severityBadge,
} from '../ui.js';

export const meta = { title: 'Episode detail', subtitle: 'Estimated vs observed CO around one flagged episode' };

const EVIDENCE = [
  ['imputed_input_hours', 'Hours with imputed model inputs'],
  ['max_prior_co_missing_hours', 'Longest gap in earlier CO readings (h)'],
  ['sensor_out_of_range_hours', 'Hours with sensors out of range'],
  ['sensor_disagreement_hours', 'Hours where sensors disagree'],
  ['drift_flag_hours', 'Hours flagged for sensor drift'],
];

export async function render(root, params, ctx) {
  let detail;
  try {
    detail = await api.episode(params.id);
  } catch (err) {
    if (err.status === 404) {
      if (!ctx.alive()) return;
      ctx.setTitle('Episode not found', '');
      root.innerHTML = `<div class="card">${emptyState(`There is no episode with ID “${params.id}”. It may have been renumbered after retraining.`, { title: 'Episode not found', h: 320 })}<div class="row" style="justify-content:center;margin-bottom:24px"><a class="btn" href="#/episodes">${icon('arrowLeft')} Back to all episodes</a></div></div>`;
      return;
    }
    throw err;
  }
  const [list, summary] = await Promise.all([api.episodes().catch(() => null), api.summary().catch(() => null)]);
  if (!ctx.alive()) return;

  const e = detail.episode || {};
  const rows = detail.window || [];
  const ev = e.evidence || {};
  const threshold = summary?.model?.threshold;
  const byMs = C.indexByMs(rows);
  ctx.setTitle(`Episode ${e.id}`, `${CLASSES[e.classification]?.label || ''} · ${fmtTs(e.start)} → ${fmtTs(e.end)}`);

  const sorted = (list?.episodes || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const idx = sorted.findIndex((x) => x.id === e.id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/episodes" class="muted" style="display:inline-flex;gap:6px;align-items:center;font-size:13px;margin-bottom:8px">${icon('arrowLeft', 14)} All episodes</a>
        <h2>${esc(e.id)} <span class="muted" style="font-weight:500;font-size:16px">· ${fmtInt(e.hours)} hour${e.hours === 1 ? '' : 's'}</span></h2>
        <div class="ep-head" style="margin-top:10px">${classBadge(e.classification)}${severityBadge(e.severity)}${periodBadge(e.period)}<span class="muted num" style="font-size:13px">${esc(fmtTs(e.start))} → ${esc(fmtTs(e.end))}</span></div>
      </div>
      <div class="pager">
        ${prev ? `<a class="btn btn--sm" href="#/episodes/${encodeURIComponent(prev.id)}" title="Previous episode">${icon('arrowLeft')} ${esc(prev.id)}</a>` : ''}
        ${next ? `<a class="btn btn--sm" href="#/episodes/${encodeURIComponent(next.id)}" title="Next episode">${esc(next.id)} ${icon('arrowRight')}</a>` : ''}
      </div>
    </div>

    <div class="grid">
      <section class="card span-12" aria-labelledby="ed-ev-t" style="border-color:color-mix(in srgb, var(${CLASSES[e.classification]?.cssVar || '--border'}) 35%, transparent)">
        <div class="card-head"><div><h3 class="card-title" id="ed-ev-t">Why this was flagged</h3><p class="card-sub">Classification evidence computed over the episode hours.</p></div>
          <div class="card-tools"><span class="badge">Peak |residual| <strong class="num" style="color:var(--text)">${fmt(e.peak_abs_residual)} ${UNIT}</strong></span>${threshold != null ? `<span class="badge">Threshold ${fmt(threshold)} ${UNIT}</span>` : ''}</div>
        </div>
        <p class="reason-text" style="margin-bottom:16px">${esc(e.reason || 'No reason recorded.')}</p>
        <div class="evidence">${EVIDENCE.map(([k, label]) => `<div><b class="${ev[k] > 0 ? 'hot' : ''}">${fmtInt(ev[k] ?? 0)}</b><span>${esc(label)}</span></div>`).join('')}</div>
      </section>
      ${chartCard({ id: 'ed-main', span: 12, h: 380, title: 'Estimated vs observed CO', subtitle: `±48 hours around the episode (shaded). The band is the model's 90% interval; red dots exceed the flag threshold.` })}
      ${chartCard({ id: 'ed-resid', span: 12, h: 230, title: 'Residual', subtitle: `Observed − estimated CO (${UNIT}) with the ± threshold.` })}
      ${chartCard({ id: 'ed-sensor', span: 6, h: 300, title: 'Sensor cross-check', subtitle: 'Observed CO vs the CO implied by the PT08.S1 sensor alone, with the raw sensor response on the right axis.' })}
      ${chartCard({ id: 'ed-weather', span: 6, h: 300, title: 'Weather context', subtitle: 'Temperature (°C), relative humidity (%) and absolute humidity during the window.' })}
    </div>`;

  if (!rows.length) {
    for (const id of ['#ed-main', '#ed-resid', '#ed-sensor', '#ed-weather']) $(id).innerHTML = emptyState('No data window returned for this episode.');
    return;
  }
  const epArr = [e];
  const group = `episode-${e.id}`;
  const series = (key) => rows.map((r) => [r.t, r[key] ?? null]);

  C.mount($('#ed-main'), (t) => ({
    ...C.base(t, `episode-${e.id}-estimated-vs-observed`),
    legend: C.legend(t, { data: ['Observed', 'Estimated', '90% interval', 'Flagged'] }),
    grid: C.zoomGrid(),
    xAxis: C.xTime(t),
    yAxis: C.yVal(t, `CO (${UNIT})`, { min: 0 }),
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: C.rowTooltip(t, byMs, [
        { key: 'observed', label: 'Observed', color: t.observed, unit: UNIT },
        { key: 'estimated', label: 'Estimated', color: t.estimate, unit: UNIT },
        { label: '90% interval', color: C.alpha(t.estimate, 0.4), get: (r) => `${fmt(r.lower)} – ${fmt(r.upper)}` },
        { key: 'residual', label: 'Residual', color: t.faint, unit: UNIT },
      ]),
    }),
    series: [
      C.lineSeries('Observed', series('observed'), t.observed, { z: 4, showSymbol: true, symbolSize: 4, sampling: undefined, lineStyle: { width: 2, color: t.observed } }),
      C.lineSeries('Estimated', series('estimated'), t.estimate, { z: 3, sampling: undefined, lineStyle: { width: 2, color: t.estimate } }),
      ...C.bandSeries(t, rows),
      { name: 'Flagged', type: 'scatter', symbolSize: 8, z: 6, itemStyle: { color: t.flag, borderColor: t.surface, borderWidth: 1 }, data: threshold == null ? [] : rows.filter((r) => r.residual != null && Math.abs(r.residual) > threshold).map((r) => [r.t, r.observed]) },
      C.episodeSeries(t, epArr, { name: '_episode', opacity: 0.16 }),
    ],
  }), { group });

  C.mount($('#ed-resid'), (t) => ({
    ...C.base(t, `episode-${e.id}-residual`),
    grid: C.zoomGrid({ top: 28, right: 40 }),
    xAxis: C.xTime(t),
    yAxis: C.yVal(t, `Residual (${UNIT})`),
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, { trigger: 'axis', formatter: C.rowTooltip(t, byMs, [{ key: 'residual', label: 'Residual', color: t.accent, unit: UNIT }]) }),
    series: [
      {
        name: 'Residual', type: 'bar', barMaxWidth: 8,
        data: rows.map((r) => ({ value: [r.t, r.residual], itemStyle: { color: threshold != null && Math.abs(r.residual ?? 0) > threshold ? t.flag : C.alpha(t.accent, 0.7) } })),
        markLine: threshold != null ? { silent: true, symbol: 'none', lineStyle: { color: t.flag, type: 'dashed' }, label: { color: t.flag, fontSize: 10 }, data: [{ yAxis: threshold }, { yAxis: -threshold }] } : undefined,
      },
      C.episodeSeries(t, epArr, { name: '_episode', opacity: 0.16 }),
    ],
  }), { group });

  C.mount($('#ed-sensor'), (t) => ({
    ...C.base(t, `episode-${e.id}-sensor`),
    legend: C.legend(t, { data: ['Observed CO', 'Sensor-implied CO', 'PT08.S1 response'] }),
    grid: C.zoomGrid(),
    xAxis: C.xTime(t),
    yAxis: [C.yVal(t, `CO (${UNIT})`), C.yVal(t, 'PT08.S1', { position: 'right', scale: true, splitLine: { show: false }, nameTextStyle: { align: 'right' } })],
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: C.rowTooltip(t, byMs, [
        { key: 'observed', label: 'Observed CO', color: t.observed, unit: UNIT },
        { key: 'sensor_estimate', label: 'Sensor-implied CO', color: '#a3e635', unit: UNIT },
        { key: 'PT08.S1(CO)', label: 'PT08.S1 response', color: t.faint, digits: 0 },
      ]),
    }),
    series: [
      C.lineSeries('Observed CO', series('observed'), t.observed, { sampling: undefined, lineStyle: { width: 2, color: t.observed } }),
      C.lineSeries('Sensor-implied CO', series('sensor_estimate'), '#a3e635', { sampling: undefined, lineStyle: { width: 1.8, color: '#a3e635', type: 'dashed' } }),
      C.lineSeries('PT08.S1 response', series('PT08.S1(CO)'), t.faint, { yAxisIndex: 1, sampling: undefined, lineStyle: { width: 1.2, color: t.faint } }),
      C.episodeSeries(t, epArr, { name: '_episode', opacity: 0.16 }),
    ],
  }), { group });

  C.mount($('#ed-weather'), (t) => ({
    ...C.base(t, `episode-${e.id}-weather`),
    legend: C.legend(t, { data: ['Temperature', 'Relative humidity', 'Absolute humidity'] }),
    grid: C.zoomGrid({ right: 64 }),
    xAxis: C.xTime(t),
    yAxis: [
      C.yVal(t, '°C', { scale: true }),
      C.yVal(t, 'RH %', { position: 'right', min: 0, max: 100, splitLine: { show: false }, nameTextStyle: { align: 'right' } }),
      C.yVal(t, 'AH', { position: 'right', offset: 48, scale: true, splitLine: { show: false }, nameTextStyle: { align: 'right' } }),
    ],
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: C.rowTooltip(t, byMs, [
        { key: 'T', label: 'Temperature', color: '#fb923c', unit: '°C', digits: 1 },
        { key: 'RH', label: 'Relative humidity', color: '#60a5fa', unit: '%', digits: 1 },
        { key: 'AH', label: 'Absolute humidity', color: '#34d399', digits: 3 },
      ]),
    }),
    series: [
      C.lineSeries('Temperature', series('T'), '#fb923c', { sampling: undefined }),
      C.lineSeries('Relative humidity', series('RH'), '#60a5fa', { yAxisIndex: 1, sampling: undefined }),
      C.lineSeries('Absolute humidity', series('AH'), '#34d399', { yAxisIndex: 2, sampling: undefined }),
      C.episodeSeries(t, epArr, { name: '_episode', opacity: 0.16 }),
    ],
  }), { group });
}
