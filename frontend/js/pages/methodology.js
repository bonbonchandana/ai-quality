import { api } from '../api.js';
import { $, UNIT, copyText, esc, fmt, fmtInt, fmtTs, icon } from '../ui.js';

export const meta = { title: 'Methodology', subtitle: 'The 16-step pipeline from problem statement to a live URL' };

const PHASES = [
  ['data', 'Data', 'var(--observed)'],
  ['model', 'Modelling', 'var(--estimate)'],
  ['ship', 'Delivery', 'var(--period-cal)'],
];

export async function render(root, _params, ctx) {
  const [summary, metrics] = await Promise.all([api.summary().catch(() => null), api.metrics().catch(() => null)]);
  if (!ctx.alive()) return;
  const s = summary || {};
  const ds = s.dataset || {};
  const mdl = s.model || {};
  const test = s.metrics?.test || {};
  const target = (s.missing || []).find((r) => r.variable === s.target);
  const tuning = metrics?.tuning || [];
  const tuneSel = tuning.find((r) => r.model === metrics?.selected_model) || tuning[0];
  const gain = tuneSel && tuneSel.default_validation_MAE
    ? ((tuneSel.default_validation_MAE - tuneSel.tuned_validation_MAE) / tuneSel.default_validation_MAE) * 100 : null;
  const appUrl = `${location.origin}/dashboard/`;
  const lagCount = (mdl.features || []).filter((f) => /lag/i.test(f)).length;

  const steps = [
    ['data', 'Problem definition', 'Estimate the true CO concentration each hour from cheap sensors, and flag hours where reality departs from the estimate.', `Target <code>${esc(s.target || 'CO(GT)')}</code> in ${esc(s.units || UNIT)} · ${esc(mdl.framing || 'nowcast')}`],
    ['data', 'Data collection', 'UCI Air Quality dataset: hourly readings from a multisensor device in an Italian city.', ds.rows ? `${fmtInt(ds.rows)} hourly rows · ${esc(fmtTs(ds.start, { time: false }))} → ${esc(fmtTs(ds.end, { time: false }))}` : 'UCI repository'],
    ['data', 'Data preprocessing', 'The raw file marks missing values as −200; these become true gaps. Timestamps are combined and sorted.', target ? `${esc(s.target)} missing: ${fmt(target.percent, 1)}% · longest gap ${fmtInt(target.longest_gap_hours)} h` : '−200 → missing'],
    ['data', 'Exploratory analysis', 'Distributions, daily and weekly cycles, correlations, missing-data patterns and sensor drift.', '<a href="#/explorer">Open the Data explorer →</a>'],
    ['data', 'Feature engineering', 'Sensor responses, weather, hour and weekday, plus CO readings from 1, 2, 3 and 24 hours earlier.', mdl.features ? `${mdl.features.length} features · ${lagCount} lag features` : '—'],
    ['model', 'Model selection', 'Several model families compared against simple baselines on rolling, time-ordered validation folds.', metrics ? `${metrics.models?.length || 0} candidates · selected <code>${esc(metrics.selected_model)}</code>` : esc(mdl.name || '—')],
    ['model', 'Model training', 'Models fit only on data before each validation fold, so no future information leaks in.', `${mdl.train_period ? `${esc(fmtTs(mdl.train_period[0], { time: false }))} → ${esc(fmtTs(mdl.train_period[1], { time: false }))}` : ''}${mdl.gpu_used ? ' · trained on GPU' : ''}`],
    ['model', 'Model evaluation', 'MAE, RMSE and R² on the untouched test period, compared with a persistence baseline.', `Test MAE ${fmt(test.MAE, 3)} ${UNIT} · R² ${fmt(test.R2, 3)}`],
    ['model', 'Hyperparameter tuning', 'Search over model settings using validation folds only; the test period is never used for tuning.', gain != null ? `${esc(tuneSel.model)}: ${gain >= 0 ? '−' : '+'}${fmt(Math.abs(gain), 1)}% validation MAE` : 'See Model performance'],
    ['model', 'Model saving', 'The fitted pipeline, imputation medians, threshold and interval radius are serialized together.', 'Saved as <code>air_quality_model.pkl</code>'],
    ['ship', 'Backend (FastAPI)', 'A Python API loads the model once and serves predictions and dashboard data as JSON.', '<code>GET /</code> · <code>GET /health</code> · <code>POST /predict</code>'],
    ['ship', 'Frontend', 'This dashboard: plain HTML, CSS and JavaScript with Apache ECharts, no build step.', '8 pages · dark & light themes'],
    ['ship', 'Model integration', '/predict returns the estimate, a prediction interval and an anomaly verdict when an observed value is supplied.', mdl.interval_radius != null ? `Interval ±${fmt(mdl.interval_radius, 2)} ${UNIT} · threshold ${fmt(mdl.threshold, 2)} ${UNIT}` : '<a href="#/simulator">Try the Virtual sensor →</a>'],
    ['ship', 'Testing', 'Endpoints exercised with Postman and cURL, including invalid inputs that must return 422 errors.', '<a href="#/simulator">Copy a request as cURL →</a>'],
    ['ship', 'Deployment', 'Uvicorn serves the API and mounts this folder as static files.', 'Served at <code>/dashboard</code>'],
    ['ship', 'URL generation', 'The running service exposes a shareable link to the dashboard.', `<button type="button" class="btn btn--sm" id="copy-url" style="max-width:100%;overflow:hidden;text-overflow:ellipsis">${icon('copy', 14)} ${esc(appUrl)}</button>`],
  ];

  root.innerHTML = `
    <div class="page-head"><div>
      <h2>How the system was built</h2>
      <p>Sixteen steps, each with a fact pulled live from the trained model and API where possible.</p>
    </div></div>
    <div class="phase-legend">${PHASES.map(([, l, c]) => `<span style="--pc:${c}"><i></i>${l}</span>`).join('')}</div>
    <ol class="pipeline">
      ${steps.map(([phase, title, desc, fact], i) => {
        const color = PHASES.find((p) => p[0] === phase)[2];
        return `<li class="step" style="--pc:${color}">
          <div class="step-top"><span class="step-num">${i + 1}</span><h3>${esc(title)}</h3></div>
          <p>${esc(desc)}</p>
          <div class="fact">${fact || '—'}</div>
        </li>`;
      }).join('')}
    </ol>`;

  $('#copy-url')?.addEventListener('click', () => copyText(appUrl));
}
