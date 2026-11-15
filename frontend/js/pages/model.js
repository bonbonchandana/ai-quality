import { api } from '../api.js';
import * as C from '../charts.js';
import { $, $$, UNIT, chartCard, emptyState, esc, fmt, fmtInt, fmtMonth, icon } from '../ui.js';

export const meta = { title: 'Model performance', subtitle: 'Cross-validated and held-out test accuracy for every candidate model' };

const METRICS = [['MAE', 'MAE', UNIT], ['RMSE', 'RMSE', UNIT], ['R2', 'R²', '']];
let metricKey = 'MAE';

const famColor = (fam, t) => (fam === 'baseline' ? t.baseline : fam === 'team' ? t.team : t.model);
const famLabel = (fam) => (fam === 'baseline' ? 'Baseline' : fam === 'team' ? 'Team model' : 'Model');
const foldLabel = (f) => String(f).replace(/^fold_(\d+)$/, 'Fold $1');

export async function render(root, _params, ctx) {
  const [metrics, summary] = await Promise.all([api.metrics(), api.summary().catch(() => null)]);
  if (!ctx.alive()) return;

  const models = metrics.models || [];
  const selected = metrics.selected_model;
  const notes = summary?.notes || [];
  const hasCoef = Array.isArray(metrics.coefficients) && metrics.coefficients.length > 0;
  const sel = models.find((m) => m.model === selected);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Model performance</h2>
        <p>All candidates were compared on rolling validation folds; the winner was then checked once on the untouched test period. Lower MAE/RMSE and higher R² are better.</p>
      </div>
      <div class="model-badge"><span class="muted">Selected</span><strong>${esc(selected || '—')}</strong>${sel ? `<span class="badge badge--accent">Test MAE ${fmt(sel.test?.MAE, 3)} ${UNIT}</span>` : ''}</div>
    </div>
    ${metrics.selection_rule ? `<div class="callout" style="margin-bottom:16px">${icon('info', 18)}<div><strong style="color:var(--text)">Selection rule.</strong> ${esc(metrics.selection_rule)}</div></div>` : ''}
    ${notes.length ? `<div class="callout callout--warn" style="margin-bottom:16px">${icon('alert', 18)}<div><strong style="color:var(--text)">Caveats.</strong><ul style="margin:4px 0 0;padding-left:18px">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div></div>` : ''}

    <div class="grid">
      ${chartCard({
        id: 'm-compare', span: 12, h: 380, title: 'Model comparison',
        subtitle: 'Validation-fold mean (lighter) vs test period (solid). ★ marks the selected model.',
        tools: `<div class="seg" role="group" aria-label="Metric">${METRICS.map(([k, l]) => `<button type="button" data-metric="${k}" aria-pressed="${k === metricKey}">${l}</button>`).join('')}</div>`,
        extra: `<div class="legend-inline" style="margin-bottom:8px"><span><i style="--c:var(--fam-model)"></i>Model</span><span><i style="--c:var(--fam-baseline)"></i>Baseline</span><span><i style="--c:var(--fam-team)"></i>Team model</span><span>★ Selected</span></div>`,
      })}
      <section class="card span-12" aria-labelledby="m-table-t">
        <div class="card-head"><div><h3 class="card-title" id="m-table-t">All models</h3><p class="card-sub">Validation mean across folds and held-out test scores (CO in ${UNIT}).</p></div></div>
        <div class="table-wrap">${modelTable(models, selected)}</div>
      </section>
      ${chartCard({ id: 'm-folds', span: 6, h: 320, title: 'MAE per validation fold', subtitle: `Mean absolute error (${UNIT}) on each rolling fold. Stable lines mean consistent performance across seasons.` })}
      ${chartCard({ id: 'm-framing', span: 6, h: 320, title: 'Nowcast vs forecast framing', subtitle: 'Estimating the current hour (nowcast, uses current sensors) vs predicting the next hour (forecast).' })}
      ${chartCard({ id: 'm-tuning', span: 6, h: 320, title: 'Hyperparameter tuning', subtitle: `Validation MAE (${UNIT}) with default vs tuned settings. Hover for the best parameters.` })}
      ${chartCard({ id: 'm-coverage', span: 6, h: 320, title: 'Prediction interval coverage', subtitle: 'Share of test hours where observed CO fell inside the interval vs the nominal target.' })}
      ${chartCard({ id: 'm-scatter', span: 6, h: 360, title: 'Estimated vs observed (test)', subtitle: 'Each dot is one test hour. Points on the dashed y = x line are perfect estimates.' })}
      ${chartCard({ id: 'm-resid', span: 6, h: 360, title: 'Residual distribution', subtitle: 'Observed − estimated on the test period. Bins beyond the flag threshold are highlighted.' })}
      ${chartCard({ id: 'm-hour', span: 6, h: 280, title: 'Error by hour of day', subtitle: `Test MAE (${UNIT}) per hour. Rush hours are typically harder.` })}
      ${chartCard({ id: 'm-month', span: 6, h: 280, title: 'Error by month', subtitle: `MAE (${UNIT}) per calendar month. Later months sit further from the training data.` })}
      ${chartCard({ id: 'm-imp', span: hasCoef ? 6 : 12, h: 420, title: 'Feature importance', subtitle: `Permutation importance: increase in MAE (${UNIT}) when a feature is shuffled. Top 15.` })}
      ${hasCoef ? chartCard({ id: 'm-coef', span: 6, h: 420, title: 'Standardized coefficients', subtitle: 'Effect of a one-standard-deviation change in each feature. Green raises the estimate, red lowers it.' }) : ''}
    </div>`;

  if (!models.length) $('#m-compare').innerHTML = emptyState('No models in the metrics file.');
  else drawCompare(models, selected);
  $$('[data-metric]', root).forEach((b) => b.addEventListener('click', () => {
    metricKey = b.dataset.metric;
    $$('[data-metric]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawCompare(models, selected);
  }));

  drawFolds(models, selected);
  drawFraming(metrics.framing_comparison || []);
  drawTuning(metrics.tuning || []);
  drawCoverage(metrics.interval_coverage);
  drawScatter(metrics.scatter_test || []);
  drawResidHist(metrics.residual_histogram, summary?.model?.threshold);
  drawErrBars('#m-hour', (metrics.error_by_hour || []).map((r) => [String(r.hour).padStart(2, '0'), r.MAE]), 'Hour of day', 'error-by-hour');
  drawErrBars('#m-month', (metrics.error_by_month || []).map((r) => [fmtMonth(r.month), r.MAE]), '', 'error-by-month');
  drawImportance(metrics.feature_importance || []);
  if (hasCoef) drawCoefficients(metrics.coefficients);
}

function modelTable(models, selected) {
  if (!models.length) return emptyState('No models to list.', { h: 120 });
  const best = {};
  for (const key of ['MAE', 'RMSE']) best[key] = Math.min(...models.map((m) => m.test?.[key] ?? Infinity));
  best.R2 = Math.max(...models.map((m) => m.test?.R2 ?? -Infinity));
  const cell = (v, d, isBest) => `<td class="n">${isBest ? `<strong style="color:var(--accent)">${fmt(v, d)}</strong>` : fmt(v, d)}</td>`;
  return `<table class="data"><thead><tr>
      <th>Model</th><th>Family</th><th>Tuned</th><th>Device</th>
      <th class="n">Val MAE</th><th class="n">Val RMSE</th><th class="n">Val R²</th>
      <th class="n">Test MAE</th><th class="n">Test RMSE</th><th class="n">Test R²</th><th class="n">Test n</th>
    </tr></thead><tbody>
    ${models.map((m) => `<tr class="${m.model === selected ? 'is-selected' : ''}">
      <td><strong>${m.model === selected ? '★ ' : ''}${esc(m.model)}</strong></td>
      <td><span class="badge" style="color:var(--fam-${m.family === 'baseline' ? 'baseline' : m.family === 'team' ? 'team' : 'model'})"><span class="dot"></span>${famLabel(m.family)}</span></td>
      <td>${m.tuned ? 'Yes' : '—'}</td>
      <td>${m.device === 'cuda' ? '<span class="gpu-chip">CUDA</span>' : esc(m.device || '—')}</td>
      ${cell(m.validation_mean?.MAE, 3)}${cell(m.validation_mean?.RMSE, 3)}${cell(m.validation_mean?.R2, 3)}
      ${cell(m.test?.MAE, 3, m.test?.MAE === best.MAE)}${cell(m.test?.RMSE, 3, m.test?.RMSE === best.RMSE)}${cell(m.test?.R2, 3, m.test?.R2 === best.R2)}
      <td class="n">${fmtInt(m.test?.n)}</td>
    </tr>`).join('')}
    </tbody></table>`;
}

function drawCompare(models, selected) {
  const [key, label, unit] = METRICS.find((m) => m[0] === metricKey);
  const names = models.map((m) => m.model);
  C.mount($('#m-compare'), (t) => {
    const bar = (m, value, solid) => ({
      value,
      itemStyle: {
        color: solid ? famColor(m.family, t) : C.alpha(famColor(m.family, t), 0.4),
        borderColor: m.model === selected ? t.text : 'transparent',
        borderWidth: m.model === selected ? 1.5 : 0,
        borderRadius: [4, 4, 0, 0],
        decal: m.family === 'baseline' && !solid ? { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4, color: C.alpha(t.text, 0.12) } : undefined,
      },
    });
    return {
      ...C.base(t, `model-comparison-${key}`),
      legend: C.legend(t, { data: ['Validation mean', 'Test'] }),
      grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
      xAxis: C.xCat(t, names, '', {
        axisLabel: {
          color: t.muted, fontSize: 11, interval: 0, rotate: names.length > 6 ? 30 : 0,
          formatter: (n) => (n === selected ? `{sel|★ ${n}}` : n),
          rich: { sel: { color: t.text, fontWeight: 700, fontSize: 11 } },
        },
      }),
      yAxis: C.yVal(t, unit ? `${label} (${unit})` : label),
      tooltip: C.tip(t, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const m = models[p[0].dataIndex];
          return `<b>${esc(m.model)}</b> <span style="color:${t.faint}">· ${famLabel(m.family)}${m.model === selected ? ' · selected' : ''}</span><br>${p.map((x) => `${C.dot(x.color)}${x.seriesName}: <b>${fmt(x.value, 3)}</b> ${unit}`).join('<br>')}`;
        },
      }),
      series: [
        { name: 'Validation mean', type: 'bar', barGap: '15%', barMaxWidth: 36, itemStyle: { color: C.alpha(t.model, 0.4) }, data: models.map((m) => bar(m, m.validation_mean?.[key] ?? null, false)) },
        { name: 'Test', type: 'bar', barMaxWidth: 36, itemStyle: { color: t.model }, data: models.map((m) => bar(m, m.test?.[key] ?? null, true)), label: { show: true, position: 'top', color: t.muted, fontSize: 10, formatter: (p) => (p.value == null ? '' : fmt(p.value, key === 'R2' ? 2 : 2)) } },
      ],
    };
  });
}

function drawFolds(models, selected) {
  const folds = [...new Set(models.flatMap((m) => (m.folds || []).map((f) => f.fold)))].sort();
  if (!folds.length) { $('#m-folds').innerHTML = emptyState('No per-fold results.'); return; }
  C.mount($('#m-folds'), (t) => ({
    ...C.base(t, 'mae-per-fold'),
    legend: C.legend(t, { data: models.map((m) => m.model) }),
    grid: { left: 8, right: 24, top: 44, bottom: 8, containLabel: true },
    xAxis: C.xCat(t, folds.map(foldLabel), '', { boundaryGap: false }),
    yAxis: C.yVal(t, `MAE (${UNIT})`, { scale: true }),
    tooltip: C.tip(t, { trigger: 'axis', formatter: C.simpleTooltip(t, { digits: 3 }) }),
    series: models.map((m) => {
      const c = m.model === selected ? t.estimate : famColor(m.family, t);
      return {
        name: m.model, type: 'line', symbolSize: m.model === selected ? 8 : 5,
        data: folds.map((f) => (m.folds || []).find((x) => x.fold === f)?.MAE ?? null),
        lineStyle: { width: m.model === selected ? 3 : 1.4, color: c, type: m.family === 'baseline' ? 'dashed' : 'solid', opacity: m.model === selected ? 1 : 0.75 },
        itemStyle: { color: c }, z: m.model === selected ? 5 : 2,
      };
    }),
  }));
}

function drawFraming(rows) {
  if (!rows.length) { $('#m-framing').innerHTML = emptyState('No framing comparison available.'); return; }
  C.mount($('#m-framing'), (t) => ({
    ...C.base(t, 'nowcast-vs-forecast'),
    legend: C.legend(t, { data: ['Validation MAE', 'Test MAE'] }),
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    xAxis: C.xCat(t, rows.map((r) => `${r.framing === 'nowcast' ? 'Nowcast' : 'Forecast'}\n${r.model}`), '', { axisLabel: { color: t.muted, fontSize: 11, lineHeight: 16, interval: 0 } }),
    yAxis: C.yVal(t, `MAE (${UNIT})`),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { digits: 3, header: (p) => p.name.replace('\n', ' · ') }) }),
    series: [
      { name: 'Validation MAE', type: 'bar', barMaxWidth: 44, data: rows.map((r) => r.validation_MAE), itemStyle: { color: C.alpha(t.accent, 0.45), borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: t.muted, fontSize: 10, formatter: (p) => fmt(p.value, 3) } },
      { name: 'Test MAE', type: 'bar', barMaxWidth: 44, data: rows.map((r) => r.test_MAE), itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: t.muted, fontSize: 10, formatter: (p) => fmt(p.value, 3) } },
    ],
  }));
}

function drawTuning(rows) {
  if (!rows.length) { $('#m-tuning').innerHTML = emptyState('No tuning runs recorded.'); return; }
  C.mount($('#m-tuning'), (t) => ({
    ...C.base(t, 'hyperparameter-tuning'),
    legend: C.legend(t, { data: ['Default', 'Tuned'] }),
    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
    xAxis: C.xCat(t, rows.map((r) => r.model), '', { axisLabel: { color: t.muted, fontSize: 11, interval: 0, rotate: rows.length > 4 ? 25 : 0 } }),
    yAxis: C.yVal(t, `Validation MAE (${UNIT})`, { scale: true }),
    tooltip: C.tip(t, {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (p) => {
        const r = rows[p[0].dataIndex];
        const gain = r.default_validation_MAE ? ((r.default_validation_MAE - r.tuned_validation_MAE) / r.default_validation_MAE) * 100 : null;
        const params = Object.entries(r.best_params || {}).map(([k, v]) => `<span style="color:${t.faint}">${esc(k)}</span> ${esc(typeof v === 'number' ? +v.toPrecision(4) : v)}`).join('<br>');
        return `<b>${esc(r.model)}</b><br>Default <b>${fmt(r.default_validation_MAE, 3)}</b> → Tuned <b>${fmt(r.tuned_validation_MAE, 3)}</b> ${UNIT}${gain != null ? `<br><span style="color:${gain >= 0 ? t.pos : t.neg}">${gain >= 0 ? '−' : '+'}${fmt(Math.abs(gain), 1)}% MAE</span>` : ''}${params ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${t.border}">${params}</div>` : ''}`;
      },
    }),
    series: [
      { name: 'Default', type: 'bar', barMaxWidth: 36, data: rows.map((r) => r.default_validation_MAE), itemStyle: { color: C.alpha(t.baseline, 0.8), borderRadius: [4, 4, 0, 0] } },
      { name: 'Tuned', type: 'bar', barMaxWidth: 36, data: rows.map((r) => r.tuned_validation_MAE), itemStyle: { color: t.model, borderRadius: [4, 4, 0, 0] } },
    ],
  }));
}

function drawCoverage(cov) {
  if (!cov || cov.test_actual == null) { $('#m-coverage').innerHTML = emptyState('Interval coverage not reported.'); return; }
  const nominal = (cov.nominal ?? 0.9) * 100;
  const actual = cov.test_actual * 100;
  C.mount($('#m-coverage'), (t) => {
    const good = Math.abs(actual - nominal) <= 3;
    const color = good ? t.pos : actual < nominal ? t.unusual : t.accent;
    return {
      ...C.base(t, 'interval-coverage'),
      tooltip: C.tip(t, { trigger: 'item', formatter: (p) => `${esc(p.name)}: <b>${fmt(p.value, 1)}%</b>` }),
      series: [
        {
          type: 'gauge', min: 0, max: 100, startAngle: 210, endAngle: -30, radius: '92%', center: ['50%', '58%'],
          progress: { show: true, width: 14, roundCap: true, itemStyle: { color } },
          axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, t.surface3]] } },
          axisTick: { show: false },
          splitLine: { distance: -22, length: 6, lineStyle: { color: t.borderStrong, width: 1 } },
          axisLabel: { distance: -8, color: t.faint, fontSize: 10, formatter: (v) => (v % 20 === 0 ? `${v}` : '') },
          anchor: { show: false },
          pointer: { show: false },
          title: { show: true, color: t.muted, fontSize: 12, offsetCenter: [0, '32%'] },
          detail: { valueAnimation: true, fontSize: 30, fontWeight: 650, color: t.text, formatter: (v) => `${fmt(v, 1)}%`, offsetCenter: [0, '10%'] },
          data: [{ value: actual, name: 'Actual (test)' }],
        },
        {
          type: 'gauge', min: 0, max: 100, startAngle: 210, endAngle: -30, radius: '92%', center: ['50%', '58%'],
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
          progress: { show: false }, anchor: { show: false },
          pointer: { show: true, icon: 'rect', length: '20%', width: 3, offsetCenter: [0, '-80%'], itemStyle: { color: t.text } },
          title: { show: true, color: t.faint, fontSize: 11, offsetCenter: [0, '48%'] },
          detail: { show: false },
          data: [{ value: nominal, name: `Nominal target ${fmt(nominal, 0)}%` }],
        },
      ],
    };
  });
}

function drawScatter(pts) {
  if (!pts.length) { $('#m-scatter').innerHTML = emptyState('No test scatter points.'); return; }
  let max = 0;
  for (const [o, e] of pts) max = Math.max(max, o ?? 0, e ?? 0);
  max = Math.ceil(max);
  C.mount($('#m-scatter'), (t) => ({
    ...C.base(t, 'estimated-vs-observed-scatter'),
    legend: C.legend(t, { data: ['Test hours', 'y = x'] }),
    grid: { left: 8, right: 20, top: 44, bottom: 30, containLabel: true },
    xAxis: C.xVal(t, `Observed CO (${UNIT})`, { min: 0, max }),
    yAxis: C.yVal(t, `Estimated CO (${UNIT})`, { min: 0, max }),
    tooltip: C.tip(t, { trigger: 'item', formatter: (p) => (p.seriesType === 'scatter' ? `Observed <b>${fmt(p.value[0])}</b><br>Estimated <b>${fmt(p.value[1])}</b><br><span style="color:${t.faint}">Residual ${fmt(p.value[0] - p.value[1])} ${UNIT}</span>` : 'Perfect estimate') }),
    series: [
      { name: 'Test hours', type: 'scatter', data: pts, symbolSize: 4, large: true, largeThreshold: 2000, itemStyle: { color: C.alpha(t.estimate, 0.4) } },
      { name: 'y = x', type: 'line', data: [[0, 0], [max, max]], symbol: 'none', lineStyle: { color: t.muted, type: 'dashed', width: 1.5 }, itemStyle: { color: t.muted } },
    ],
  }));
}

function drawResidHist(h, threshold) {
  const edges = h?.edges || [];
  const counts = h?.counts || [];
  if (!counts.length) { $('#m-resid').innerHTML = emptyState('No residual histogram.'); return; }
  const centers = counts.map((_, i) => (edges[i] + edges[i + 1]) / 2);
  C.mount($('#m-resid'), (t) => ({
    ...C.base(t, 'residual-histogram'),
    grid: { left: 8, right: 16, top: 36, bottom: 30, containLabel: true },
    xAxis: C.xCat(t, centers.map((c) => fmt(c, 2)), `Residual (${UNIT})`),
    yAxis: C.yVal(t, 'Hours'),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `<span style="color:${t.faint}">${fmt(edges[p[0].dataIndex], 2)} to ${fmt(edges[p[0].dataIndex + 1], 2)} ${UNIT}</span><br><b>${fmtInt(p[0].value)}</b> hours` }),
    series: [{
      type: 'bar', name: 'Hours', barCategoryGap: '6%',
      data: counts.map((c, i) => ({ value: c, itemStyle: { color: threshold != null && Math.abs(centers[i]) > threshold ? t.flag : C.alpha(t.accent, 0.75), borderRadius: [3, 3, 0, 0] } })),
    }],
  }));
}

function drawErrBars(sel, rows, xName, file) {
  if (!rows.length) { $(sel).innerHTML = emptyState('No breakdown available.'); return; }
  C.mount($(sel), (t) => ({
    ...C.base(t, file),
    grid: { left: 8, right: 16, top: 36, bottom: xName ? 24 : 8, containLabel: true },
    xAxis: C.xCat(t, rows.map((r) => r[0]), xName, { axisLabel: { color: t.muted, fontSize: 10, rotate: rows.length > 12 && !xName ? 40 : 0 } }),
    yAxis: C.yVal(t, `MAE (${UNIT})`),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { digits: 3 }) }),
    visualMap: { show: false, min: Math.min(...rows.map((r) => r[1])), max: Math.max(...rows.map((r) => r[1])), dimension: 1, inRange: { color: [C.alpha(t.accent, 0.5), t.estimate] } },
    series: [{ type: 'bar', name: 'MAE', data: rows.map((r) => r[1]), barCategoryGap: '25%', itemStyle: { borderRadius: [4, 4, 0, 0] } }],
  }));
}

function drawImportance(rows) {
  const top = rows.slice(0, 15);
  if (!top.length) { $('#m-imp').innerHTML = emptyState('No feature importance computed.'); return; }
  C.mount($('#m-imp'), (t) => ({
    ...C.base(t, 'feature-importance'),
    grid: { left: 8, right: 48, top: 30, bottom: 24, containLabel: true },
    yAxis: { ...C.xCat(t, top.map((r) => r.feature), ''), inverse: true, axisLabel: { color: t.text, fontSize: 11, interval: 0 } },
    xAxis: C.xVal(t, `MAE increase (${UNIT})`),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { digits: 4 }) }),
    series: [{
      type: 'bar', name: 'MAE increase', barCategoryGap: '30%',
      data: top.map((r, i) => ({ value: r.importance, itemStyle: { color: i < 3 ? t.accent : C.alpha(t.accent, 0.55), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: t.muted, fontSize: 10, formatter: (p) => fmt(p.value, 3) },
    }],
  }));
}

function drawCoefficients(rows) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 20);
  C.mount($('#m-coef'), (t) => ({
    ...C.base(t, 'standardized-coefficients'),
    grid: { left: 8, right: 40, top: 30, bottom: 24, containLabel: true },
    yAxis: { ...C.xCat(t, sorted.map((r) => r.feature), ''), inverse: true, axisLine: { onZero: false, lineStyle: { color: t.borderStrong } }, axisLabel: { color: t.text, fontSize: 11, interval: 0 } },
    xAxis: C.xVal(t, `Coefficient (${UNIT} per SD)`),
    tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: C.simpleTooltip(t, { digits: 4 }) }),
    series: [{
      type: 'bar', name: 'Coefficient', barCategoryGap: '30%',
      data: sorted.map((r) => ({ value: r.value, itemStyle: { color: r.value >= 0 ? t.pos : t.neg, borderRadius: r.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    }],
  }));
}
