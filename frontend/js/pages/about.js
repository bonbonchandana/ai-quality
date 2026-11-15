import { api } from '../api.js';
import { CLASSES, UNIT, esc, fmt, fmtInt, fmtTs, icon, periodBadge, periodLabel } from '../ui.js';

export const meta = { title: 'About', subtitle: 'What this dashboard shows, in plain language' };

export async function render(root, _params, ctx) {
  const summary = await api.summary();
  if (!ctx.alive()) return;
  const ds = summary.dataset || {};
  const mdl = summary.model || {};
  const periods = summary.periods || [];
  const missing = summary.missing || [];
  const notes = summary.notes || [];

  root.innerHTML = `
    <div class="page-head"><div>
      <h2>About this project</h2>
      <p>${esc(summary.project || 'Air Quality Prediction and Pollution Episode Detection')}</p>
    </div></div>

    <div class="grid">
      <section class="card span-7 prose">
        <h3>The data</h3>
        <p>The <a href="${esc(ds.source_url || 'https://archive.ics.uci.edu/dataset/360/air+quality')}" target="_blank" rel="noopener noreferrer">UCI Air Quality dataset</a> holds <strong>${fmtInt(ds.rows)}</strong> hourly records from ${esc(fmtTs(ds.start, { time: false }))} to ${esc(fmtTs(ds.end, { time: false }))}, collected by a gas multisensor device at road level in an Italian city. Next to it, a certified reference analyser measured true pollutant concentrations.</p>
        <p>Our target is <strong>carbon monoxide (CO)</strong>, a colourless gas mostly produced by traffic and heating. It is measured in <strong>${esc(summary.units || UNIT)}</strong> (milligrams per cubic metre of air). Typical urban hourly values here range from about 0.5 to 5 ${UNIT}.</p>

        <h3 style="margin-top:20px">What is a virtual sensor?</h3>
        <p>Reference analysers are accurate but expensive and need regular maintenance, so they break down and leave gaps. Low-cost metal-oxide sensors are cheap but noisy and drift over time. A <strong>virtual sensor</strong> is a model that turns the cheap sensor readings, the weather and recent history into an <strong>estimate</strong> of what the reference analyser would read. It can fill gaps, check the reference instrument, and extend monitoring to places with no analyser at all.</p>

        <h3 style="margin-top:20px">How estimates work</h3>
        <p>For each hour the model (<strong>${esc(mdl.name || '—')}</strong>) looks at the five sensor responses (PT08.S1–S5), temperature, relative and absolute humidity, the hour and weekday, and CO readings from 1, 2, 3 and 24 hours earlier. It returns an <strong>estimated</strong> CO value plus a 90% interval${mdl.interval_radius != null ? ` (about ±${fmt(mdl.interval_radius, 2)} ${UNIT})` : ''}. This is a <em>nowcast</em>: it estimates the current hour, not the future.</p>

        <h3 style="margin-top:20px">How episodes work</h3>
        <p>When the <strong>observed</strong> CO differs from the estimate by more than ${mdl.threshold != null ? `<strong>${fmt(mdl.threshold, 2)} ${UNIT}</strong>` : 'a set threshold'}, the hour is flagged. Consecutive flagged hours form an <strong>episode</strong>, which is classified as:</p>
        <ul>
          <li><span class="badge ${CLASSES.unusual_pollution_candidate.badge}"><span class="dot"></span>${CLASSES.unusual_pollution_candidate.label}</span> the inputs look healthy, so the gap may be a real, unexpected pollution event.</li>
          <li><span class="badge ${CLASSES.data_limitation_candidate.badge}"><span class="dot"></span>${CLASSES.data_limitation_candidate.label}</span> the inputs were imputed, out of range, drifting or inconsistent, so the gap is more likely a data problem.</li>
        </ul>
        <p>Each episode lists the reason, so a person can check it. These are candidates for review, not confirmed events.</p>

        <h3 style="margin-top:20px">Missing values</h3>
        <p>The raw file uses <code>−200</code> to mean "no reading"; we convert these to missing values. Hours with no observed CO cannot be scored, but the model can still produce an estimate: any missing input is filled with its <strong>median from the training data</strong>, and the API reports which fields were filled.</p>
      </section>

      <div class="span-5 stack">
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Data periods</h3><p class="card-sub">Time-ordered splits used for validation, calibration and testing.</p></div></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Period</th><th>Start</th><th>End</th></tr></thead><tbody>
            ${periods.map((p) => `<tr><td>${periodBadge(p.name)}${p.label && p.label !== p.name && p.label !== periodLabel(p.name) ? `<div class="faint" style="font-size:12px;margin-top:4px">${esc(p.label)}</div>` : ''}</td><td>${esc(fmtTs(p.start, { time: false }))}</td><td>${esc(fmtTs(p.end, { time: false }))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No periods reported.</td></tr>'}
          </tbody></table></div>
          ${mdl.train_period ? `<p class="muted" style="font-size:12.5px;margin-top:10px">Final model trained on ${esc(fmtTs(mdl.train_period[0], { time: false }))} → ${esc(fmtTs(mdl.train_period[1], { time: false }))}.</p>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Missing data by variable</h3><p class="card-sub">Share of hours without a reading.</p></div></div>
          <div class="table-wrap table-scroll" style="max-height:360px"><table class="data"><thead><tr><th>Variable</th><th class="n">Missing</th><th class="n">%</th><th class="n">Longest gap</th></tr></thead><tbody>
            ${missing.map((r) => `<tr><td>${esc(r.variable)}</td><td class="n">${fmtInt(r.missing)}</td><td class="n">${fmt(r.percent, 1)}%</td><td class="n">${fmtInt(r.longest_gap_hours)} h</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No missing-data summary.</td></tr>'}
          </tbody></table></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Limitations</h3><p class="card-sub">Read these before drawing conclusions.</p></div></div>
          <div class="notes">
            ${notes.map((n) => `<div class="callout callout--warn">${icon('alert', 18)}<div>${esc(n)}</div></div>`).join('')}
            <div class="callout">${icon('info', 18)}<div>One site, one year, one device: results may not transfer to other cities or newer sensors without retraining.</div></div>
          </div>
        </section>
      </div>
    </div>`;
}
