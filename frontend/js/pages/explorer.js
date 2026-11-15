import { api } from '../api.js';
import * as C from '../charts.js';
import {
  $, $$, UNIT, WEEKDAYS, chartCard, debounce, emptyState, esc, fmt, fmtInt, fmtMonth, fmtMs, fmtTs, section,
} from '../ui.js';

export const meta = { title: 'Data explorer', subtitle: 'Raw hourly measurements, distributions, missing data and sensor behaviour' };

// Theme-independent categorical palette so chips and lines always match.
const PALETTE = ['#22d3ee', '#f472b6', '#a3e635', '#60a5fa', '#fb923c', '#34d399', '#e879f9', '#f87171', '#2dd4bf', '#c084fc', '#facc15', '#94a3b8', '#fda4af'];
const GROUPS = [['pollutant', 'Pollutants'], ['sensor', 'Sensors'], ['weather', 'Weather']];
const MAX_VARS = 6;

// Persist choices across navigation within the session.
const state = { vars: null, start: '', end: '', focus: 'CO(GT)' };

export async function render(root, _params, ctx) {
  const [vres, summary] = await Promise.all([api.variables(), api.summary().catch(() => null)]);
  if (!ctx.alive()) return;
  const variables = vres.variables || [];
  if (!variables.length) { root.innerHTML = emptyState('The API did not return any variables.', { h: 400 }); return; }

  const byKey = new Map(variables.map((v, i) => [v.key, { ...v, color: PALETTE[i % PALETTE.length] }]));
  if (!state.vars) state.vars = ['CO(GT)', 'PT08.S1(CO)'].filter((k) => byKey.has(k));
  state.vars = state.vars.filter((k) => byKey.has(k));
  if (!state.vars.length) state.vars = [variables[0].key];
  if (!byKey.has(state.focus)) state.focus = variables[0].key;

  const dsStart = summary?.dataset?.start?.slice(0, 10) || '';
  const dsEnd = summary?.dataset?.end?.slice(0, 10) || '';
  const options = GROUPS.map(([g, label]) => {
    const vs = variables.filter((v) => v.group === g);
    return vs.length ? `<optgroup label="${label}">${vs.map((v) => `<option value="${esc(v.key)}">${esc(v.label || v.key)}</option>`).join('')}</optgroup>` : '';
  }).join('') + variables.filter((v) => !GROUPS.some(([g]) => g === v.group)).map((v) => `<option value="${esc(v.key)}">${esc(v.label || v.key)}</option>`).join('');

  const picker = GROUPS.map(([g, label]) => {
    const vs = variables.filter((v) => v.group === g);
    if (!vs.length) return '';
    return `<div class="chip-group"><span class="chip-group-label">${label}</span>${vs.map((v) => chip(byKey.get(v.key))).join('')}</div>`;
  }).join('');

  root.innerHTML = `
    <div class="page-head"><div>
      <h2>Data explorer</h2>
      <p>Hourly records from ${esc(fmtTs(summary?.dataset?.start, { time: false }))} to ${esc(fmtTs(summary?.dataset?.end, { time: false }))}${summary?.dataset?.rows ? ` · ${fmtInt(summary.dataset.rows)} rows` : ''}. Missing readings (coded −200 in the raw file) appear as gaps.</p>
    </div></div>

    <div class="grid">
      <section class="card span-12" aria-labelledby="ex-ts-t">
        <div class="card-head">
          <div><h3 class="card-title" id="ex-ts-t">Time series</h3><p class="card-sub">Pick up to ${MAX_VARS} variables. Each unit gets its own y-axis; drag the slider or scroll to zoom.</p></div>
          <div class="card-tools date-range">
            <label class="inline">From <input class="input" type="date" id="ex-start" value="${esc(state.start)}" min="${dsStart}" max="${dsEnd}"></label>
            <label class="inline">To <input class="input" type="date" id="ex-end" value="${esc(state.end)}" min="${dsStart}" max="${dsEnd}"></label>
            <button class="btn btn--ghost btn--sm" type="button" id="ex-reset">Full range</button>
          </div>
        </div>
        <div class="var-picker" role="group" aria-label="Variables">${picker}</div>
        <div class="chart" id="ex-ts" style="--h:400px"></div>
      </section>
    </div>

    <div class="focus-section">
    <div class="toolbar">
      <label class="inline" for="ex-focus"><strong style="color:var(--text)">Variable analysis</strong></label>
      <select class="select" id="ex-focus">${options}</select>
      <span class="muted" style="font-size:12.5px">Drives the distribution, box plot, hour × weekday heatmap and profiles below.</span>
    </div>
    <div class="grid">
      ${chartCard({ id: 'ex-hist', span: 6, h: 300, title: 'Distribution', subtitle: 'Histogram of all hourly values.' })}
      ${chartCard({ id: 'ex-box', span: 6, h: 300, title: 'Monthly spread', subtitle: 'Box plot per month: min, quartiles, median and max.' })}
      ${chartCard({ id: 'ex-heat', span: 12, h: 300, title: 'Hour × weekday pattern', subtitle: 'Mean value for each hour of day and day of week (Mon–Sun).' })}
      ${chartCard({ id: 'ex-p-hour', span: 4, h: 240, title: 'Daily profile', subtitle: 'Mean by hour of day.' })}
      ${chartCard({ id: 'ex-p-week', span: 4, h: 240, title: 'Weekly profile', subtitle: 'Mean by weekday.' })}
      ${chartCard({ id: 'ex-p-month', span: 4, h: 240, title: 'Seasonal profile', subtitle: 'Mean by month.' })}
    </div>
    </div>

    <h3 class="section-title">Relationships & data quality</h3>
    <div class="grid">
      ${chartCard({ id: 'ex-corr', span: 6, h: 460, title: 'Correlation matrix', subtitle: 'Pearson correlation between variables over hours where both are present.' })}
      ${chartCard({ id: 'ex-missing', span: 6, h: 460, title: 'Missing data by week', subtitle: 'Share of hours missing per variable and week. Darker means more data is missing.' })}
      ${chartCard({ id: 'ex-sensor', span: 6, h: 360, title: 'Sensor PT08.S1 vs reference CO', subtitle: 'Each dot is one hour. The line is a least-squares fit of reference CO on the tin-oxide sensor response.' })}
      ${chartCard({ id: 'ex-drift', span: 6, h: 360, title: 'Monthly sensor drift', subtitle: 'Fit slope (CO per sensor unit) and correlation per month. Changing values hint at sensor drift.' })}
    </div>`;

  $('#ex-focus').value = state.focus;

  // ----- Time series -----
  const loadSeries = () => {
    const el = $('#ex-ts');
    const vars = [...state.vars];
    section(el, () => api.series(vars, {
      start: state.start ? `${state.start}T00:00:00` : undefined,
      end: state.end ? `${state.end}T23:00:00` : undefined,
      max_points: 2000,
    }), (data) => drawSeries(el, data, vars, byKey));
  };
  const reload = debounce(loadSeries, 250);

  $$('.chip', root).forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    const on = state.vars.includes(key);
    if (on && state.vars.length === 1) return;
    if (!on && state.vars.length >= MAX_VARS) { btn.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 200); return; }
    state.vars = on ? state.vars.filter((k) => k !== key) : [...state.vars, key];
    btn.setAttribute('aria-pressed', String(!on));
    reload();
  }));
  const onDate = () => { state.start = $('#ex-start').value; state.end = $('#ex-end').value; reload(); };
  $('#ex-start').addEventListener('change', onDate);
  $('#ex-end').addEventListener('change', onDate);
  $('#ex-reset').addEventListener('click', () => { $('#ex-start').value = ''; $('#ex-end').value = ''; onDate(); });
  loadSeries();

  // ----- Focus-variable analysis -----
  const loadFocus = () => {
    const v = byKey.get(state.focus);
    section([$('#ex-hist'), $('#ex-box')], () => api.distribution(v.key), (d) => drawDistribution(d, v));
    section($('#ex-heat'), () => api.heatmap(v.key), (d) => drawHeat(d, v));
    section([$('#ex-p-hour'), $('#ex-p-week'), $('#ex-p-month')], () => api.profiles(v.key), (d) => drawProfiles(d, v));
  };
  $('#ex-focus').addEventListener('change', (e) => { state.focus = e.target.value; loadFocus(); });
  loadFocus();

  // ----- Static analyses -----
  section($('#ex-corr'), api.correlation, drawCorrelation);
  section($('#ex-missing'), api.missing, drawMissing);
  section([$('#ex-sensor'), $('#ex-drift')], api.sensorVsReference, drawSensor);
}

function chip(v) {
  const on = state.vars.includes(v.key);
  return `<button type="button" class="chip" data-key="${esc(v.key)}" aria-pressed="${on}" style="--chip-c:${v.color}" title="${esc(v.key)}${v.unit ? ` · ${esc(v.unit)}` : ''}"><span class="dot"></span>${esc(v.label || v.key)}</button>`;
}

const unitOf = (v) => v?.unit || '';
const axisName = (v) => (v.unit ? `${v.label || v.key} (${v.unit})` : v.label || v.key);

function drawSeries(el, data, vars, byKey) {
  const t0 = data.t || [];
  if (!t0.length) { el.innerHTML = emptyState('No data in the selected range.'); return; }
  const units = [];
  for (const k of vars) { const u = unitOf(byKey.get(k)); if (!units.includes(u)) units.push(u); }
  const nLeft = Math.ceil(units.length / 2);
  const nRight = Math.floor(units.length / 2);

  C.mount(el, (t) => ({
    ...C.base(t, 'explorer-time-series'),
    legend: C.legend(t, { data: vars.map((k) => byKey.get(k).label || k) }),
    grid: C.zoomGrid({ left: 8 + (nLeft - 1) * 64, right: 16 + Math.max(0, nRight - 1) * 64 }),
    xAxis: C.xTime(t),
    yAxis: units.map((u, i) => {
      const owners = vars.filter((k) => unitOf(byKey.get(k)) === u);
      const name = owners.length === 1 ? axisName(byKey.get(owners[0])) : u || 'value';
      const color = owners.length === 1 ? byKey.get(owners[0]).color : t.faint;
      return C.yVal(t, name, {
        position: i % 2 === 0 ? 'left' : 'right',
        offset: Math.floor(i / 2) * 64,
        scale: true,
        splitLine: { show: i === 0, lineStyle: { color: t.grid } },
        axisLabel: { color, fontSize: 11 },
        nameTextStyle: { color, align: i % 2 === 0 ? 'left' : 'right' },
      });
    }),
    dataZoom: C.zoom(t),
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        if (!arr.length) return '';
        const head = fmtMs(new Date(arr[0].value[0]).getTime());
        return `<div style="color:${t.faint};margin-bottom:4px">${head}</div>${arr.map((p) => {
          const v = byKey.get(vars[p.seriesIndex]);
          return `<div style="display:flex;gap:12px;justify-content:space-between"><span>${C.dot(p.color)}${esc(p.seriesName)}</span><b>${fmt(p.value[1])} <span style="color:${t.faint};font-weight:400">${esc(v?.unit || '')}</span></b></div>`;
        }).join('')}`;
      },
    }),
    series: vars.map((k) => {
      const v = byKey.get(k);
      const arr = data.series?.[k] || [];
      return C.lineSeries(v.label || k, t0.map((x, i) => [x, arr[i] ?? null]), v.color, { yAxisIndex: units.indexOf(unitOf(v)), lineStyle: { width: 1.3, color: v.color } });
    }),
  }));
}

function drawDistribution(d, v) {
  const unit = d.unit || v.unit || '';
  const edges = d.histogram?.edges || [];
  const counts = d.histogram?.counts || [];
  if (!counts.length) $('#ex-hist').innerHTML = emptyState('No histogram data.');
  else {
    C.mount($('#ex-hist'), (t) => ({
      ...C.base(t, `histogram-${v.key}`),
      grid: { left: 8, right: 16, top: 36, bottom: 30, containLabel: true },
      xAxis: C.xCat(t, counts.map((_, i) => fmt(edges[i], 1)), `${v.label || v.key}${unit ? ` (${unit})` : ''}`, { axisLabel: { color: t.muted, fontSize: 10, hideOverlap: true } }),
      yAxis: C.yVal(t, 'Hours'),
      tooltip: C.tip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `<span style="color:${t.faint}">${fmt(edges[p[0].dataIndex], 2)} – ${fmt(edges[p[0].dataIndex + 1], 2)} ${esc(unit)}</span><br><b>${fmtInt(p[0].value)}</b> hours` }),
      series: [{ type: 'bar', name: 'Hours', data: counts, barCategoryGap: '8%', itemStyle: { color: C.alpha(v.color, 0.8), borderRadius: [3, 3, 0, 0] } }],
    }));
  }
  const box = d.monthly_box || [];
  if (!box.length) $('#ex-box').innerHTML = emptyState('No monthly statistics.');
  else {
    C.mount($('#ex-box'), (t) => ({
      ...C.base(t, `monthly-box-${v.key}`),
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      xAxis: C.xCat(t, box.map((b) => fmtMonth(b.month)), '', { axisLabel: { color: t.muted, fontSize: 10, rotate: box.length > 8 ? 40 : 0 } }),
      yAxis: C.yVal(t, unit ? `${v.label || v.key} (${unit})` : v.label || v.key, { scale: true }),
      tooltip: C.tip(t, {
        trigger: 'item',
        formatter: (p) => {
          const b = box[p.dataIndex];
          return `<span style="color:${t.faint}">${fmtMonth(b.month)}</span><br>Max <b>${fmt(b.max)}</b><br>Q3 <b>${fmt(b.q3)}</b><br>Median <b>${fmt(b.median)}</b><br>Q1 <b>${fmt(b.q1)}</b><br>Min <b>${fmt(b.min)}</b> ${esc(unit)}`;
        },
      }),
      series: [{ type: 'boxplot', name: v.label || v.key, data: box.map((b) => [b.min, b.q1, b.median, b.q3, b.max]), itemStyle: { color: C.alpha(v.color, 0.18), borderColor: v.color, borderWidth: 1.4 }, boxWidth: ['30%', '60%'] }],
    }));
  }
}

function drawHeat(d, v) {
  const cells = d.cells || [];
  if (!cells.length) { $('#ex-heat').innerHTML = emptyState('No heatmap data.'); return; }
  const vals = cells.map((c) => c[2]).filter((x) => x != null);
  const unit = v.unit || '';
  C.mount($('#ex-heat'), (t) => ({
    ...C.base(t, `hour-weekday-${v.key}`),
    grid: { left: 8, right: 16, top: 36, bottom: 64, containLabel: true },
    xAxis: C.xCat(t, Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), 'Hour of day', { splitArea: { show: false } }),
    yAxis: { ...C.xCat(t, WEEKDAYS, ''), inverse: true, nameLocation: 'end' },
    visualMap: C.seqVisualMap(t, Math.min(...vals), Math.max(...vals), { itemHeight: 200 }),
    tooltip: C.tip(t, { trigger: 'item', formatter: (p) => `<span style="color:${t.faint}">${WEEKDAYS[p.value[1]]} · ${String(p.value[0]).padStart(2, '0')}:00</span><br><b>${fmt(p.value[2])}</b> ${esc(unit)}` }),
    series: [{ type: 'heatmap', data: cells.map((c) => [c[0], c[1], c[2]]), itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } } }],
  }));
}

function drawProfiles(d, v) {
  const unit = v.unit || '';
  const yName = unit ? `Mean (${unit})` : 'Mean';
  const mk = (id, cats, vals, name, type) => {
    if (!vals.length) { $(id).innerHTML = emptyState('No profile data.', { h: 180 }); return; }
    C.mount($(id), (t) => ({
      ...C.base(t, `${name}-${v.key}`),
      grid: { left: 8, right: 12, top: 36, bottom: 24, containLabel: true },
      xAxis: C.xCat(t, cats, name, { boundaryGap: type === 'bar' }),
      yAxis: C.yVal(t, yName, { scale: type !== 'bar' }),
      tooltip: C.tip(t, { trigger: 'axis', formatter: C.simpleTooltip(t, { unit }) }),
      series: [type === 'bar'
        ? { type: 'bar', name: 'Mean', data: vals, barWidth: '55%', itemStyle: { color: C.alpha(v.color, 0.8), borderRadius: [4, 4, 0, 0] } }
        : { type: 'line', name: 'Mean', data: vals, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: v.color }, itemStyle: { color: v.color }, areaStyle: { color: C.alpha(v.color, 0.12) } }],
    }));
  };
  const hourly = d.hourly || [];
  const weekday = d.weekday || [];
  const monthly = d.monthly || [];
  mk('#ex-p-hour', hourly.map((r) => String(r.hour).padStart(2, '0')), hourly.map((r) => r.mean), 'Hour', 'line');
  mk('#ex-p-week', weekday.map((r) => WEEKDAYS[r.weekday] ?? r.weekday), weekday.map((r) => r.mean), 'Weekday', 'bar');
  mk('#ex-p-month', monthly.map((r) => fmtMonth(r.month)), monthly.map((r) => r.mean), 'Month', 'line');
}

function drawCorrelation(d) {
  const vars = d.variables || [];
  const matrix = d.matrix || [];
  if (!vars.length) { $('#ex-corr').innerHTML = emptyState('No correlation data.'); return; }
  const data = [];
  matrix.forEach((row, i) => row.forEach((val, j) => data.push([j, i, val])));
  C.mount($('#ex-corr'), (t) => ({
    ...C.base(t, 'correlation-matrix'),
    grid: { left: 8, right: 12, top: 30, bottom: 50, containLabel: true },
    xAxis: { ...C.xCat(t, vars, ''), axisLabel: { color: t.muted, fontSize: 10, rotate: 45, interval: 0 } },
    yAxis: { ...C.xCat(t, vars, ''), inverse: true, axisLabel: { color: t.muted, fontSize: 10, interval: 0 } },
    visualMap: { min: -1, max: 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 200, itemWidth: 12, inRange: { color: t.div }, textStyle: { color: t.muted, fontSize: 11 } },
    tooltip: C.tip(t, { trigger: 'item', formatter: (p) => `${esc(vars[p.value[1]])} × ${esc(vars[p.value[0]])}<br>r = <b>${fmt(p.value[2], 3)}</b>` }),
    series: [{
      type: 'heatmap', data,
      label: { show: vars.length <= 14, fontSize: 9, color: t.text, formatter: (p) => (p.value[2] == null ? '' : fmt(p.value[2], 2)) },
      itemStyle: { borderColor: t.surface, borderWidth: 1 },
    }],
  }));
}

function drawMissing(d) {
  const cells = d.cells || [];
  if (!cells.length) { $('#ex-missing').innerHTML = emptyState('No missing-data summary.'); return; }
  const weeks = d.weeks || [];
  const vars = d.variables || [];
  C.mount($('#ex-missing'), (t) => ({
    ...C.base(t, 'missing-data-by-week'),
    grid: { left: 8, right: 12, top: 30, bottom: 50, containLabel: true },
    xAxis: { ...C.xCat(t, weeks, ''), axisLabel: { color: t.muted, fontSize: 10, formatter: (s) => fmtTs(s, { time: false }) } },
    yAxis: { ...C.xCat(t, vars, ''), inverse: true, axisLabel: { color: t.muted, fontSize: 10, interval: 0 } },
    visualMap: C.seqVisualMap(t, 0, 100, { itemHeight: 200, formatter: (v) => `${Math.round(v)}%` }),
    tooltip: C.tip(t, { trigger: 'item', formatter: (p) => `<span style="color:${t.faint}">Week of ${esc(fmtTs(weeks[p.value[0]], { time: false }))}</span><br>${esc(vars[p.value[1]])}: <b>${fmt(p.value[2], 1)}%</b> missing` }),
    series: [{ type: 'heatmap', data: cells, itemStyle: { borderColor: t.surface, borderWidth: 0.5 }, progressive: 0 }],
  }));
}

function drawSensor(d) {
  const pts = d.points || [];
  const fit = d.fit || {};
  if (!pts.length) $('#ex-sensor').innerHTML = emptyState('No paired sensor/reference readings.');
  else {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; }
    const line = [[lo, fit.intercept + fit.slope * lo], [hi, fit.intercept + fit.slope * hi]];
    C.mount($('#ex-sensor'), (t) => ({
      ...C.base(t, 'sensor-vs-reference'),
      legend: C.legend(t, { data: ['Hourly readings', 'Linear fit'] }),
      grid: { left: 8, right: 16, top: 44, bottom: 30, containLabel: true },
      xAxis: C.xVal(t, 'PT08.S1(CO) sensor response', { scale: true }),
      yAxis: C.yVal(t, `Reference CO (${UNIT})`),
      tooltip: C.tip(t, { trigger: 'item', formatter: (p) => (p.seriesType === 'scatter' ? `Sensor <b>${fmt(p.value[0], 0)}</b><br>CO <b>${fmt(p.value[1])}</b> ${UNIT}` : `CO = ${fmt(fit.slope, 4)} × S1 ${fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(fit.intercept), 2)}`) }),
      graphic: [{
        type: 'text', right: 24, top: 52, z: 10,
        style: { text: `R² = ${fmt(fit.r2, 3)}\nslope = ${fmt(fit.slope, 4)}`, fill: t.text, font: `600 12px ${t.font}`, lineHeight: 18, align: 'right', backgroundColor: C.alpha(t.surface, 0.85), padding: [6, 10], borderRadius: 8 },
      }],
      series: [
        { name: 'Hourly readings', type: 'scatter', data: pts, symbolSize: 3, large: true, largeThreshold: 1500, itemStyle: { color: C.alpha(t.observed, 0.35) } },
        { name: 'Linear fit', type: 'line', data: line, symbol: 'none', lineStyle: { color: t.estimate, width: 2 }, itemStyle: { color: t.estimate }, z: 5 },
      ],
    }));
  }
  const drift = d.drift || [];
  if (!drift.length) { $('#ex-drift').innerHTML = emptyState('No monthly drift statistics.'); return; }
  C.mount($('#ex-drift'), (t) => ({
    ...C.base(t, 'monthly-sensor-drift'),
    legend: C.legend(t, { data: ['Slope', 'Correlation'] }),
    grid: { left: 8, right: 8, top: 44, bottom: 8, containLabel: true },
    xAxis: C.xCat(t, drift.map((r) => fmtMonth(r.month)), '', { axisLabel: { color: t.muted, fontSize: 10, rotate: drift.length > 8 ? 40 : 0 } }),
    yAxis: [
      C.yVal(t, `Slope (${UNIT} per unit)`, { axisLabel: { color: t.muted, fontSize: 11, formatter: (x) => fmt(x, 4) } }),
      C.yVal(t, 'Correlation r', { min: 0, max: 1, position: 'right', splitLine: { show: false }, nameTextStyle: { align: 'right' } }),
    ],
    tooltip: C.tip(t, {
      trigger: 'axis',
      formatter: (p) => {
        const r = drift[p[0].dataIndex];
        return `<span style="color:${t.faint}">${fmtMonth(r.month)}</span><br>${C.dot(t.accent)}Slope <b>${fmt(r.slope, 5)}</b><br>${C.dot(t.estimate)}Correlation <b>${fmt(r.correlation, 3)}</b><br><span style="color:${t.faint}">n = ${fmtInt(r.n)} hours</span>`;
      },
    }),
    series: [
      { name: 'Slope', type: 'bar', data: drift.map((r) => r.slope), barWidth: '50%', itemStyle: { color: C.alpha(t.accent, 0.75), borderRadius: [4, 4, 0, 0] } },
      { name: 'Correlation', type: 'line', yAxisIndex: 1, data: drift.map((r) => r.correlation), smooth: 0.2, symbolSize: 6, lineStyle: { color: t.estimate, width: 2 }, itemStyle: { color: t.estimate } },
    ],
  }));
}
