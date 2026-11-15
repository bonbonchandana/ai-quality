import { api } from '../api.js';
import * as C from '../charts.js';
import {
  $, CLASSES, CLASS_KEYS, HOUR, UNIT, chartCard, debounce, emptyState, esc, fmt, fmtInt, fmtMonth, fmtPct, fmtTs, periodLabel, toMs,
} from '../ui.js';

export const meta = { title: 'Overview', subtitle: 'Estimated vs observed CO across the out-of-sample timeline' };

function kpi({ label, value, unit = '', sub = '', color, spark = '', extra = '' }) {
  return `<article class="card lift kpi" style="--kc:${color}">
    <div class="kpi-label"><span class="kdot"></span>${esc(label)}</div>
    <div class="kpi-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    <div class="kpi-sub">${sub}</div>
    ${extra}
    ${spark ? `<div class="kpi-spark" id="${spark}"></div>` : ''}
  </article>`;
}

export async function render(root, _params, ctx) {
  const [summary, preds, epData, cal, metrics] = await Promise.all([
    api.summary(),
    api.predictions({ max_points: 1500 }),
    api.episodes(),
    api.calendar('CO(GT)').catch(() => null),
    api.metrics().catch(() => null),
  ]);
  if (!ctx.alive()) return;

  const m = summary.metrics || {};
  const k = summary.kpi || {};
  const ep = summary.episodes || {};
  const episodes = epData.episodes || [];
  const points = preds.points || [];
  const threshold = preds.threshold ?? summary.model?.threshold;
  const byMs = C.indexByMs(points);

  // Sparkline data
  const lastMs = points.length ? points[points.length - 1]._ms : 0;
  const recent = points.filter((p) => p._ms >= lastMs - 7 * 24 * HOUR).map((p) => [p.t, p.observed]);
  const daily = cal?.days?.map((d) => [d[0], d[1]]) || [];
  const errMonth = metrics?.error_by_month || [];
  const epMonths = monthlyCounts(episodes);
  const persist = m.persistence_test?.MAE;
  const imp = m.improvement_pct;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>${esc(summary.project || 'Air quality nowcast')}</h2>
        <p>A virtual sensor that estimates true CO (${esc(summary.units || UNIT)}) each hour from low-cost metal-oxide sensors, weather and recent readings, then flags hours where the observed value departs from the estimate.</p>
      </div>
      <div class="model-badge" title="Trained ${esc(fmtTs(summary.model?.trained_at))}">
        <span class="muted">Model</span><strong>${esc(summary.model?.name || '—')}</strong>
        <span class="badge badge--accent">${esc(summary.model?.framing || 'nowcast')}</span>
        ${summary.model?.gpu_used ? '<span class="gpu-chip">⚡ Trained on GPU</span>' : '<span class="badge">CPU</span>'}
      </div>
    </div>

    <div class="kpis">
      ${kpi({ label: 'Latest observed CO', value: fmt(k.latest_observed), unit: UNIT, sub: `at ${esc(fmtTs(k.latest_time))}`, color: 'var(--observed)', spark: 'sp-latest' })}
      ${kpi({ label: 'Mean observed CO', value: fmt(k.mean_observed), unit: UNIT, sub: 'Daily means, whole record', color: 'var(--observed)', spark: 'sp-mean' })}
      ${kpi({ label: 'Test MAE', value: fmt(m.test?.MAE, 3), unit: UNIT, sub: `n = ${fmtInt(m.test?.n)} hours · monthly MAE below`, color: 'var(--estimate)', spark: errMonth.length ? 'sp-mae' : '' })}
      ${kpi({ label: 'Test RMSE', value: fmt(m.test?.RMSE, 3), unit: UNIT, sub: `Validation mean ${fmt(m.validation_mean?.RMSE, 3)}`, color: 'var(--estimate)' })}
      ${kpi({ label: 'Test R²', value: fmt(m.test?.R2, 3), sub: `Validation mean ${fmt(m.validation_mean?.R2, 3)}`, color: 'var(--estimate)', extra: `<div class="meter"><span style="width:${Math.max(0, Math.min(1, m.test?.R2 || 0)) * 100}%"></span></div>` })}
      ${kpi({ label: 'Improvement vs persistence', value: fmt(Math.abs(imp ?? 0), 1), unit: '%', sub: `${imp != null && imp < 0 ? 'Higher' : 'Lower'} test MAE than "same as last hour"`, color: 'var(--success)', extra: miniBars(m.test?.MAE, persist) })}
      ${kpi({ label: 'Episodes detected', value: fmtInt(ep.total), sub: `<span style="color:var(--unusual-text)">● ${fmtInt(ep.unusual_pollution_candidate)} unusual</span> · <span style="color:var(--datalim-text)">● ${fmtInt(ep.data_limitation_candidate)} data-limitation</span>`, color: 'var(--unusual)', spark: epMonths.labels.length ? 'sp-ep' : '' })}
      ${kpi({ label: 'Data coverage', value: fmt(k.coverage_pct, 1), unit: '%', sub: 'Hours with an observed CO reading', color: 'var(--period-cal)', extra: `<div class="meter"><span style="width:${Math.max(0, Math.min(100, k.coverage_pct || 0))}%"></span></div>` })}
    </div>

    <div class="grid">
      ${chartCard({ id: 'ov-hero', span: 12, h: 440, title: 'Estimated vs observed CO', subtitle: `Hourly out-of-sample estimates with the 90% interval, flagged hours (|residual| > ${fmt(threshold, 2)} ${UNIT}), episode shading and evaluation periods. ${preds.downsampled ? 'Zoom in to load full hourly resolution.' : ''}` })}
      ${chartCard({ id: 'ov-resid', span: 12, h: 260, title: 'Residuals over time', subtitle: `Observed − estimated CO. Dashed lines mark the ±${fmt(threshold, 2)} ${UNIT} flag threshold.` })}
      ${chartCard({ id: 'ov-cal', span: 8, h: 250, title: 'Daily mean CO calendar', subtitle: `Average observed CO per day (${UNIT}). Grey cells have no reference reading.` })}
      ${chartCard({ id: 'ov-donut', span: 4, h: 250, title: 'Episode classifications', subtitle: 'How flagged episodes split between likely real pollution and data problems.' })}
    </div>`;

  // KPI sparklines
  if (recent.length) C.mount($('#sp-latest'), (t) => C.sparkline(t, recent, { color: t.observed }));
  if (daily.length) C.mount($('#sp-mean'), (t) => C.sparkline(t, daily, { color: t.observed }));
  else $('#sp-mean').remove();
  if (errMonth.length) C.mount($('#sp-mae'), (t) => C.sparkline(t, errMonth.map((d) => d.MAE), { color: t.estimate, type: 'bar', category: errMonth.map((d) => fmtMonth(d.month)) }));
  if (epMonths.labels.length) C.mount($('#sp-ep'), (t) => C.sparkline(t, epMonths.total, { color: t.unusual, type: 'bar', category: epMonths.labels.map(fmtMonth) }));

  if (!points.length) {
    $('#ov-hero').innerHTML = emptyState('The API returned no prediction points.');
    $('#ov-resid').innerHTML = emptyState('No residuals to show.');
  } else {
    const view = { points, base: points, byMs, downsampled: !!preds.downsampled, key: '' };
    const hero = drawHero(view, episodes, summary.periods || []);
    const resid = drawResiduals(view, threshold, summary.periods || []);
    enableDetailOnDemand(view, [hero, resid], ctx);
  }
  if (daily.length) drawCalendar(daily);
  else $('#ov-cal').innerHTML = emptyState('Daily calendar data is unavailable.');
  drawDonut(ep);
}

function miniBars(model, persist) {
  if (model == null || persist == null) return '';
  const max = Math.max(model, persist) || 1;
  return `<div class="mini-bars">
    <div><span>Model</span><i style="--c:var(--estimate);width:${(model / max) * 100}%"></i><span>${fmt(model, 3)}</span></div>
    <div><span>Persistence</span><i style="--c:var(--fam-baseline);width:${(persist / max) * 100}%"></i><span>${fmt(persist, 3)}</span></div>
  </div>`;
}

function monthlyCounts(episodes) {
  const map = new Map();
  for (const e of episodes) {
    const key = String(e.start).slice(0, 7);
    const row = map.get(key) || { total: 0 };
    row.total += 1;
    row[e.classification] = (row[e.classification] || 0) + 1;
    map.set(key, row);
  }
  const labels = [...map.keys()].sort();
  return { labels, total: labels.map((l) => map.get(l).total), rows: labels.map((l) => map.get(l)) };
}

function episodeAt(episodes, ms) {
  for (const e of episodes) if (ms >= toMs(e.start) && ms <= toMs(e.end) + HOUR - 1) return e;
  return null;
}

function drawHero(view, episodes, periods) {
  const build = (t) => {
    const pts = view.points;
    const flagged = pts.filter((p) => p.flagged && p.observed != null).map((p) => {
      const e = episodeAt(episodes, p._ms);
      return { value: [p.t, p.observed], itemStyle: { color: e ? C.classColor(e.classification, t) : t.flag } };
    });
    return {
      ...C.base(t, 'estimated-vs-observed-co'),
      legend: C.legend(t, { data: ['Observed', 'Estimated', '90% interval', 'Flagged', 'Episodes'] }),
      grid: C.zoomGrid(),
      xAxis: C.xTime(t),
      yAxis: C.yVal(t, `CO (${UNIT})`, { min: 0 }),
      dataZoom: C.zoom(t),
      tooltip: C.tip(t, {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.borderStrong } },
        formatter: C.rowTooltip(t, view.byMs, [
          { key: 'observed', label: 'Observed', color: t.observed, unit: UNIT },
          { key: 'estimated', label: 'Estimated', color: t.estimate, unit: UNIT },
          { label: '90% interval', color: C.alpha(t.estimate, 0.4), get: (r) => `${fmt(r.lower)} – ${fmt(r.upper)}` },
          { key: 'residual', label: 'Residual', color: t.faint, unit: UNIT },
          { label: 'Period', color: t.faint, get: (r) => (r.period ? periodLabel(r.period) : '—') },
          { label: 'Status', color: t.faint, get: (r) => (r.flagged ? 'Flagged' : r.observed == null ? 'No observation' : 'Within threshold') },
        ]),
      }),
      // Data series first so the zoom slider previews observed CO; helpers last.
      series: [
        C.lineSeries('Observed', pts.map((p) => [p.t, p.observed]), t.observed, { z: 4, lineStyle: { width: 1.3, color: t.observed } }),
        C.lineSeries('Estimated', pts.map((p) => [p.t, p.estimated]), t.estimate, { z: 3, lineStyle: { width: 1.3, color: t.estimate, opacity: 0.9 } }),
        ...C.bandSeries(t, pts),
        { name: 'Flagged', type: 'scatter', data: flagged, symbolSize: 6, z: 5, itemStyle: { color: t.flag, borderColor: t.surface, borderWidth: 1 } },
        C.episodeSeries(t, episodes),
        C.periodSeries(t, periods),
      ],
    };
  };
  return { build, inst: C.mount($('#ov-hero'), build, { group: 'overview-ts' }) };
}

function drawResiduals(view, threshold, periods) {
  const build = (t) => ({
    ...C.base(t, 'residuals-over-time'),
    legend: C.legend(t, { data: ['Residual', 'Flagged'] }),
    grid: C.zoomGrid({ right: 40 }),
    xAxis: C.xTime(t),
    yAxis: C.yVal(t, `Residual (${UNIT})`),
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: C.rowTooltip(t, view.byMs, [
        { key: 'residual', label: 'Residual', color: t.accent, unit: UNIT },
        { key: 'imputed_inputs', label: 'Imputed inputs', color: t.faint, digits: 0 },
      ]),
    }),
    series: [
      C.lineSeries('Residual', view.points.map((p) => [p.t, p.residual]), t.accent, {
        lineStyle: { width: 1.1, color: t.accent },
        areaStyle: { color: C.alpha(t.accent, 0.08), origin: 0 },
        markLine: threshold != null ? {
          silent: true, symbol: 'none',
          lineStyle: { color: t.flag, type: 'dashed', width: 1 },
          label: { color: t.flag, fontSize: 10, formatter: (p) => `${p.value > 0 ? '+' : ''}${fmt(p.value, 2)}` },
          data: [{ yAxis: threshold }, { yAxis: -threshold }],
        } : undefined,
      }),
      { name: 'Flagged', type: 'scatter', symbolSize: 5, itemStyle: { color: t.flag }, data: view.points.filter((p) => p.flagged && p.residual != null).map((p) => [p.t, p.residual]) },
      C.periodSeries(t, periods, { labels: false }),
    ],
  });
  return { build, inst: C.mount($('#ov-resid'), build, { group: 'overview-ts' }) };
}

/**
 * The full timeline is server-downsampled. When the user zooms into a
 * narrower window, fetch that window at full hourly resolution and splice it in.
 */
function enableDetailOnDemand(view, charts, ctx) {
  if (!view.downsampled || !view.base.length) return;
  const fullStart = view.base[0]._ms;
  const fullEnd = view.base[view.base.length - 1]._ms;
  let pending = 0;
  const update = debounce(async (inst) => {
    const dz = inst.getOption().dataZoom?.[0];
    if (!dz) return;
    const s = Math.max(fullStart, Math.floor(dz.startValue ?? fullStart));
    const e = Math.min(fullEnd, Math.ceil(dz.endValue ?? fullEnd));
    const zoomed = e - s < (fullEnd - fullStart) * 0.6;
    const key = zoomed ? `${s}-${e}` : 'full';
    if (key === view.key) return;
    view.key = key;
    const my = ++pending;
    let pts = view.base;
    if (zoomed) {
      try {
        const res = await api.predictions({ start: isoLocal(s - 6 * HOUR), end: isoLocal(e + 6 * HOUR), max_points: 1500 });
        const detail = res.points || [];
        for (const r of detail) { r._ms = toMs(r.t); view.byMs.set(r._ms, r); }
        const lo = detail.length ? detail[0]._ms : s;
        const hi = detail.length ? detail[detail.length - 1]._ms : e;
        pts = [...view.base.filter((p) => p._ms < lo), ...detail, ...view.base.filter((p) => p._ms > hi)];
      } catch (err) {
        console.warn('Detail fetch failed; keeping downsampled data.', err);
        return;
      }
    }
    if (my !== pending || !ctx.alive()) return;
    view.points = pts;
    const t = C.tokens();
    for (const c of charts) {
      if (!c.inst || c.inst.isDisposed()) continue;
      c.inst.setOption({ series: c.build(t).series.map((x) => ({ data: x.data })) });
    }
  }, 350);
  for (const c of charts) c.inst?.on('datazoom', () => update(c.inst));
}

function isoLocal(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00:00`;
}

function drawCalendar(days) {
  const values = days.map((d) => d[1]);
  const first = days[0][0];
  const last = days[days.length - 1][0];
  C.mount($('#ov-cal'), (t) => ({
    ...C.base(t, 'daily-co-calendar'),
    tooltip: C.tip(t, {
      trigger: 'item',
      formatter: (p) => `<span style="color:${t.faint}">${esc(fmtTs(p.value[0], { time: false }))}</span><br><b>${fmt(p.value[1])}</b> ${UNIT}`,
    }),
    visualMap: C.seqVisualMap(t, 0, Math.ceil(C.quantile(values, 0.97) * 10) / 10, { itemHeight: 140, show: true }),
    calendar: {
      range: [first, last], top: 36, left: 34, right: 12, cellSize: ['auto', 15],
      itemStyle: { color: t.surface2, borderColor: t.surface, borderWidth: 2 },
      splitLine: { show: false },
      dayLabel: { color: t.faint, fontSize: 10, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
      monthLabel: {
        color: t.muted, fontSize: 10,
        formatter: (p) => {
          const narrow = ($('#ov-cal')?.clientWidth || 800) < 640;
          if (narrow && Number(p.M) % 3 !== 1) return '';
          return Number(p.M) === 1 || `${p.yyyy}-${String(p.MM)}` === first.slice(0, 7) ? `${p.nameMap} ’${p.yy}` : p.nameMap;
        },
      },
      yearLabel: { show: false },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: days }],
  }));
}

function drawDonut(ep) {
  const data = CLASS_KEYS.map((key) => ({ key, name: CLASSES[key].label, value: ep[key] || 0 }));
  const total = ep.total ?? data.reduce((s, d) => s + d.value, 0);
  if (!total) { $('#ov-donut').innerHTML = emptyState('No episodes were flagged.', { title: 'No episodes' }); return; }
  C.mount($('#ov-donut'), (t) => ({
    ...C.base(t, 'episode-classifications'),
    tooltip: C.tip(t, { trigger: 'item', formatter: (p) => `${C.dot(p.color)}${esc(p.name)}<br><b>${p.value}</b> episodes · ${fmtPct(p.percent)}` }),
    legend: C.legend(t, { top: 'auto', bottom: 0, left: 'center', right: 'auto', orient: 'horizontal' }),
    title: {
      text: String(total), subtext: 'episodes', left: 'center', top: '35%',
      textStyle: { color: t.text, fontSize: 26, fontWeight: 650, fontFamily: t.font },
      subtextStyle: { color: t.muted, fontSize: 12 }, itemGap: 2,
    },
    series: [{
      type: 'pie', radius: ['58%', '80%'], center: ['50%', '45%'], padAngle: 2,
      itemStyle: { borderRadius: 6, borderColor: t.surface, borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scaleSize: 4 },
      data: data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: C.classColor(d.key, t) } })),
    }],
  }));
}
