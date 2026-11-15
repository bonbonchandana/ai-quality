# Air quality prediction and episode detection — research

Updated 15 November 2026. Phases 1–3 (domain, existing products, dataset findings) come from the research phase and remain valid. Phase 4 documents the first research run ([run.py](../research/run.py)), which has been **superseded**. The model and system that actually shipped are described in **Phase 5 (final model)** and **Phase 6 (final architecture)**. Read [PRD.md](PRD.md) for the product requirements and [SOURCES.md](SOURCES.md) for evidence scope. Design judgments and candidate explanations are not validated causal findings.

## Phase 1 — domain and problem

Estimate current CO using concurrent low-cost sensor and weather readings, compare it with the later reference observation, and explain why a residual flag may reflect unusual pollution or limitations in the data. The operational action is investigation, not a health alert.

| Dataset quantity | Plain meaning and health relevance | Source |
|---|---|---|
| CO | Carbon monoxide, a gas that reduces oxygen delivery in the body. | [WHO](https://www.who.int/teams/environment-climate-change-and-health/air-quality-and-health/health-impacts/types-of-pollutants) |
| NMHC | Non-methane hydrocarbons: a mixture rather than a single chemical. Health effects depend on composition; no single health interpretation of this aggregate is supported. | [EPA VOC effects](https://www.epa.gov/indoor-air-quality-iaq/volatile-organic-compounds-impact-indoor-air-quality) |
| C6H6 | Benzene; exposure can harm blood-related systems and is carcinogenic. | [WHO benzene report](https://www.who.int/europe/publications/i/item/WHO-EURO-2023-8983-48755-72523) |
| NOx | Nitrogen oxides, including NO and NO2; do not treat total NOx as a NO2 concentration. | [EPA NO2](https://www.epa.gov/no2-pollution/basic-information-about-no2) |
| NO2 | Nitrogen dioxide; irritates airways and can aggravate asthma. | [EPA NO2](https://www.epa.gov/no2-pollution/basic-information-about-no2) |
| PT08 sensor responses | Electrical sensor responses, not pollutant mass concentrations. S5 is nominally ozone-targeted; there is no ozone reference target in this file. Temperature and humidities are environmental covariates. | [UCI variable definitions](https://archive.ics.uci.edu/dataset/360/air+quality) |

| Framework | What it communicates | Selected values / implication | Source |
|---|---|---|---|
| WHO 2021 | Health-based concentration guidance, not an AQI scale | CO 24h: 4 mg/m³; NO2 annual: 10 µg/m³ and 24h: 25 µg/m³. An hourly spike cannot be compared directly with a daily guideline. | [WHO publication](https://www.who.int/publications/i/item/9789240034228), [guideline table](https://www.ncbi.nlm.nih.gov/books/NBK574591/table/ch3.tab26/) |
| US EPA AQI | Six health communication bands | Good 0–50; Moderate 51–100; Unhealthy for Sensitive Groups 101–150; Unhealthy 151–200; Very Unhealthy 201–300; Hazardous ≥301. Uses pollutant-specific averaging/conversion. | [AirNow basics](https://www.airnow.gov/aqi/aqi-basics/), [technical guidance](https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf) |
| India National AQI | Eight-pollutant index with six bands | Good 0–50; Satisfactory 51–100; Moderate 101–200; Poor 201–300; Very Poor 301–400; Severe 401–500. | [CPCB](https://airquality.cpcb.gov.in/AQI/), [government explanation](https://ies.gov.in/arthapedia/concept/national-air-quality-index) |

MVP decision: show CO in mg/m³ and residual severity. Do not label either as AQI, “safe,” or a medical advisory. AQI conversion and other pollutants are outside this deadline.

Proposed scenarios (personas and workflow hypotheses, not observed user research):

| User | Decision | Data required | Fit now |
|---|---|---|---|
| Student environmental analyst | Which historic departures deserve inspection? | Actual, prediction, interval, residual and quality evidence | Core MVP |
| Monitoring technician | Is an odd reading associated with missing inputs or sensor disagreement? | Missing streaks, sensor/reference comparison, provenance | Core MVP, candidate diagnosis only |
| College reviewer | Does the model generalize beyond training and beat a baseline? | Split dates, all model scores, reproducible scripts | Core MVP |
| Campus activity coordinator | Whether to reschedule an outdoor event | Current local observations, validated forecasts, appropriate AQI and health guidance | Motivation for a future product; this historic Italian dataset cannot support this decision |

The eight most useful sources and one-line annotations, including the original De Vito paper, are listed first in [SOURCES.md](SOURCES.md). No original-paper performance claims are imported into this report.

## Phase 2 — existing applications and differentiation

Verification means current official documentation or app listing found on the research date. We did not install apps, test paid accounts, or measure API uptime. NV = feature not verified in reviewed documentation; it does **not** mean absent. Transparency concerns available source/measurement information, not access to proprietary model weights.

| Product and status evidence | Forecasting | Episode detection | Explains anomalies | Data transparency | Open access | Target users |
|---|---|---|---|---|---|---|
| [IQAir AirVisual](https://www.iqair.com/air-quality-monitors/air-quality-app), current product page | [7-day](https://www.iqair.com/ae/support/knowledge-base/how-can-i-access-air-quality-forecasts-through-the-airvisual-app-and-website) | NV | NV for model residual vs sensor fault | Station/location information; reproducible model NV | Public app/site; [API tiers](https://api-docs.iqair.com/?version=latest) require checking | Residents and device users, inferred from product page |
| [WAQI/AQICN](https://aqicn.org/api/), current docs | 3–8 days documented | NV | NV | Station and originating agency links | Free token/quota; usage and redistribution restrictions | Public and developers |
| [PurpleAir](https://www.purpleair.com/research/quick-guide), current guide | NV | Quality-related channel comparison available; residual episodes NV | [Two-channel graph](https://community.purpleair.com/t/how-to-use-the-map-graph/1122); causal residual explanations NV | Sensor-level particle data/map/API | Public map; [API account/access terms](https://community.purpleair.com/t/about-the-purpleair-api/7145), unrestricted free API NV | Sensor owners and researchers |
| [Google Air Quality API](https://developers.google.com/maps/documentation/air-quality/overview), current docs | Up to 96 hours | NV | Health recommendations documented; residual/fault explanations NV | Pollutant/index outputs; underlying full model reproduction NV | Cloud project required; unrestricted free use NV | Developers |
| [OpenAQ](https://docs.openaq.org/resources/measurements), current API v3 docs | Forecast feature NV in measurement API | NV | NV | Measurement and sensor resources | [Registered API key](https://docs.openaq.org/using-the-api/api-key) | Researchers/developers, inferred |
| [CPCB SAMEER](https://www.data.gov.in/catalog/sameer-national-air-quality-index), [app listed](https://play.google.com/store/apps/details?id=com.cpcb) | Forecasting NV | [Pollution complaints](https://app.cpcbccr.com/cpcb_new_marquee), automated residual episodes NV | Model residual vs fault explanation NV | Official hourly AQI context | Public app listing; reuse terms NV | Indian residents |

Three proposed differentiators, scoped to gaps **in this evidence review**, not claims of market exclusivity:

1. Each flagged episode has a readable, evidence-specific candidate classification. All six rows lack verified residual-plus-fault explanation; PurpleAir's channel context inspires rather than negates this feature. Ship as deterministic rules and an explanation panel.
2. Show estimate uncertainty, imputed-input counts and gaps together. The table's transparency column documents measurements but does not establish a comparable end-to-end residual audit. Ship one synchronized chart and quality badges.
3. Publish chronological baseline comparisons and reproducible artifacts. The table does not verify an equivalent reproducible educational benchmark in these user interfaces. Ship a performance table, split dates and source links.

## Phase 3 — hands-on dataset findings

Computed from the actual CSV, not copied from repository metadata. Source archive SHA256: `d4a64013fb385288a8a48d9d193ca7079b2e1bbddf6f8d458feb8c08ab2b8a2a`.

- Parsing: semicolon delimiter, comma decimals, `-200` to missing, explicit `%d/%m/%Y %H.%M.%S` timestamp parsing. Empty trailing columns and 114 undated trailing rows removed. Raw pandas rows: 9,471; valid dated measurements: **9,357**. This differs from UCI's stated 9,358.
- Actual bounds: **10 March 2004 18:00 to 4 April 2005 14:00**, wider than the repository's March–February description. No duplicate timestamp and no missing hourly grid slot; missing measurements exist within otherwise present hours. Source timezone/DST are [unverified]; preserve wall time without inventing UTC offsets.
- Clean output: [clean.csv](../research/data/clean.csv), 9,357 timestamped rows, 13 measurement columns, sorted. Blank cells remain missing; the reusable clean file does not contain fitted imputations.

| column | missing | percent | longest_gap_hours |
|---|---|---|---|
| CO(GT) | 1683 | 17.99% | 173 |
| PT08.S1(CO) | 366 | 3.91% | 76 |
| NMHC(GT) | 8443 | 90.23% | 8126 |
| C6H6(GT) | 366 | 3.91% | 76 |
| PT08.S2(NMHC) | 366 | 3.91% | 76 |
| NOx(GT) | 1639 | 17.52% | 173 |
| PT08.S3(NOx) | 366 | 3.91% | 76 |
| NO2(GT) | 1642 | 17.55% | 173 |
| PT08.S4(NO2) | 366 | 3.91% | 76 |
| PT08.S5(O3) | 366 | 3.91% | 76 |
| T | 366 | 3.91% | 76 |
| RH | 366 | 3.91% | 76 |
| AH | 366 | 3.91% | 76 |

Long gaps: CO has 173 consecutive missing hours from 13 October 2004 11:00 through 20 October 15:00, and 146 hours from 17 April 03:00 through 23 April 04:00. NMHC is missing for the final 8,126 hours, starting 1 May 2004 01:00. Sensor/weather channels share a 76-hour gap, 8 February 2005 17:00–11 February 20:00. These are missing-reading stretches, not proven hardware outages. Full ≥24-hour gaps per column: [gaps.json](../research/output/gaps.json).

Computed calendar patterns, using observed CO only: mean at 05:00 = 0.713 mg/m³; 09:00 = 2.972; 19:00 = 3.733. Friday mean = 2.543, Sunday = 1.438. August mean = 1.280; December = 2.751. This is consistent with within-day and seasonal variation but cannot establish traffic or weather causation. Calendar-month pooling combines partial March/April across two years; the daily chart preserves the actual chronology. Missingness can bias every aggregated pattern.

Computed pairwise-complete Pearson correlations: S1/CO = 0.879; S2/NMHC = 0.878; S3/NOx = −0.656; S4/NO2 = 0.157. The S2/NMHC figure covers only its short observed period. Negative response is not automatically a faulty sensor. See [correlations.csv](../research/output/correlations.csv) for all pairs.

Drift signs: monthly CO-versus-S1 linear slopes range approximately 0.00441 in August to 0.00675 in September; correlations include 0.947 in April 2004 and 0.843 in January 2005. This is a computed stability warning, confounded by concentration range, weather and composition; it does not isolate sensor aging. [drift_proxy.csv](../research/output/drift_proxy.csv) records monthly counts and values. The [original paper](https://doi.org/10.1016/j.snb.2007.09.060) addresses field calibration, but our proxy is not a replication.

Notable calendar window: 24–26 December 2004 has 71 observed CO hours, mean 3.552 mg/m³. A “holiday effect” is [unverified]: no holiday/event labels or causal controls are present. Do not describe Christmas, fireworks or traffic as confirmed explanations. The long October gaps and February shared-channel gap are stronger actionable evidence for this MVP than event speculation.

Choose **CO(GT)**. It has 7,674 observed reference hours (82.01%), whereas NMHC is largely unusable. Benzene is more complete, but CO offers a directly interpretable reference quantity and a public-health rationale ([WHO](https://www.who.int/teams/environment-climate-change-and-health/air-quality-and-health/health-impacts/types-of-pollutants)). Its nowcast and one-hour forecast performance are evaluated below. We did not compare ML predictability across all pollutants and do not claim CO is statistically the best target.

### Seven saved figures

![Missingness](../research/figures/01_missingness.png)
![Daily CO](../research/figures/02_daily.png)
![Calendar patterns](../research/figures/03_calendar.png)
![Correlations](../research/figures/04_correlations.png)
![Monthly stability proxy](../research/figures/05_drift_proxy.png)
![Test predictions, intervals and episode flags](../research/figures/06_episodes.png)
![Validation feature importance](../research/figures/07_importance.png)

## Phase 4 — research-phase experiments: forecast vs virtual sensor (superseded)

> **Superseded.** This section records the first research run (`research/run.py`, 89 engineered features, Ridge selected).
> It established that the virtual-sensor nowcast framing beats a one-hour forecast. It is kept for traceability.
> The deployed model was retrained with a compact, API-friendly feature set; see [Phase 5](#phase-5--final-model-shipped-in-the-app).

The virtual sensor estimates CO at time t using PT08 sensor responses and weather at t, plus CO only from t−1 and earlier. Forecast uses sensor and weather data only through t−1 to predict CO at t. Same timestamps and same two baselines for both. A nowcast is not a future forecast, and concurrent sensor readings must actually be available before the estimate can be produced. Historical data cannot demonstrate live availability or performance at a new location.

Each framing uses CO lags 1, 2, 3, 24, 168 hours; past-only rolling means/std and lag difference; sensor and weather lags, rolling means/std and lag differences; cyclic hour and weekday. Forecast sensor/weather rolling windows end at t−1; nowcast ends at t. No reference pollutant at t is included as a feature. Median imputers and Ridge scalers are fit on training rows only. Rolling features are created from past/concurrent observations only; no backfill. Seasonal and persistence baselines use CO at t−24 and t−1, respectively. Actual past targets in the evaluated period become available sequentially, which is a practical limitation when a reference analyzer is unavailable for a long stretch.

Three expanding chronological evaluation folds end at the original 60% training boundary. XGBoost early stopping uses a chronological tail of each fold's **training** period; it is then refit on that fold's full training period with the chosen number of trees. The scored outer fold never controls its own stopping. Final XGBoost tree count is the median of fold selections; Ridge alpha=10. The sole selection criterion is the **unweighted mean of the three fold MAEs**, across both framings and both learned models. The pipeline writes selection.json before predicting the test period. No models are retrained on calibration or test data. The 10% threshold is applied against the better baseline under the selected framing, using the same fold average.

### Validation: unweighted mean across three rolling folds

| framing | model | n | MAE | RMSE | R2 |
|---|---|---|---|---|---|
| forecast | Persistence | 3 folds | 0.495 | 0.736 | 0.628 |
| forecast | Ridge | 3 folds | 0.408 | 0.566 | 0.783 |
| forecast | Seasonal naive | 3 folds | 0.732 | 1.036 | 0.285 |
| forecast | XGBoost | 3 folds | 0.367 | 0.530 | 0.811 |
| nowcast | Persistence | 3 folds | 0.495 | 0.736 | 0.628 |
| nowcast | Ridge | 3 folds | 0.197 | 0.268 | 0.947 |
| nowcast | Seasonal naive | 3 folds | 0.732 | 1.036 | 0.285 |
| nowcast | XGBoost | 3 folds | 0.204 | 0.294 | 0.940 |

Validation RMSE and R² above are the arithmetic means of the individual fold metrics, not pooled statistics. The folds have 585, 433 and 495 common eligible rows. Ridge nowcast MAE is 0.1966 against persistence 0.4952: **60.3% lower**. Forecast XGBoost also clears the validation threshold (0.3671 versus 0.4952). All fold-specific values and dates are in [metrics.csv](../research/output/metrics.csv).

### Final chronological test: same 1,689 eligible hours per method

| framing | model | n | MAE | RMSE | R2 |
|---|---|---|---|---|---|
| forecast | Persistence | 1689 | 0.527 | 0.817 | 0.646 |
| forecast | Seasonal naive | 1689 | 0.879 | 1.289 | 0.118 |
| forecast | Ridge | 1689 | 0.479 | 0.680 | 0.755 |
| forecast | XGBoost | 1689 | 0.486 | 0.738 | 0.711 |
| nowcast | Persistence | 1689 | 0.527 | 0.817 | 0.646 |
| nowcast | Seasonal naive | 1689 | 0.879 | 1.289 | 0.118 |
| nowcast | Ridge | 1689 | 0.281 | 0.449 | 0.893 |
| nowcast | XGBoost | 1689 | 0.333 | 0.575 | 0.824 |

Nowcast Ridge was selected on validation, and its test MAE is **46.7% lower** than persistence. The test compares all methods to satisfy the requested table; it did not determine the selection in this revised run. **Important limitation:** this same historical test period was examined during the earlier version of this project, before the revised experiments were designed. Therefore it is not a genuinely untouched independent test, even though this run freezes its selection before scoring. A future dataset or new later period is needed for an unbiased prospective confirmation.

The highest R² among individual reported folds and test rows is below 0.97. Feature provenance was still audited in code: only CO shifts of at least one hour are inputs; nowcast same-hour inputs are limited to PT08 and weather; forecast inputs are shifted. The model does not use same-hour reference CO or C6H6/NOx/NO2. Imputation and scaling are training-only. The analysis assumes all same-hour PT08 and meteorological measurements are available when the nowcast is issued; actual reporting latency is [unverified]. No guarantee follows for other sites, seasons or missing reference histories.

### Intervals and classified episodes

A later, separate chronological calibration block supplies a conformal-style nominal 90% symmetric interval, radius 0.932 mg/m³, and an absolute residual threshold 1.237 mg/m³. Empirical coverage on all 1,781 observed test targets was 94.9%; time-series dependence means coverage is not guaranteed ([conformal tutorial](https://arxiv.org/abs/2107.07511)). The common-baseline table uses 1,689 rows with both target lags available; all-observed export metrics have a different denominator. Missing actuals cannot be flagged.

The regenerated test output contains 48 flagged hours in 29 contiguous episodes: 26 data-limitation candidates and 3 unusual-pollution candidates. Flags are deviations, not diagnoses. A flag is classified as data-limitation candidate when any input was missing and imputed, prior CO history was missing, sensor range is exceeded, past sensor disagreement suggests drift, or current sensor/reference agreement is poor. Otherwise it is an unusual-pollution candidate. Saturation and drift are hypotheses; causes are unverified. All episodes include exact reasons in [episodes.json](../research/output/episodes.json). Missing observations are gaps, not flagged episodes.

[Model metadata](../research/output/model_metadata.json), [predictions](../research/output/predictions.json), [selection](../research/output/selection.json), and [reproducibility instructions](../research/README.md) document the artifact. Validation permutation feature importance and all seven charts were regenerated. The importance measures model reliance, not causation. Estimated intervals can extend below zero and are not AQI categories.

## Phase 5 — final model (shipped in the app)

Produced by [`train_model.py`](../train_model.py); all values are written to [`artifacts/`](../artifacts) on every run.

**Why it was retrained.** A deployed API needs inputs that a client can send in one JSON request. The 89-feature research
model needed a week of rolling history per request. The final model uses **19 raw inputs**, defined in [`aq_features.py`](../aq_features.py):
hour, weekday, the five PT08 sensor responses at *t*, temperature, relative and absolute humidity, CO at *t−1, t−2, t−3,
t−24*, and the five sensor responses at *t−1*. Inside the saved pipeline these become cyclical time, lag summaries and
**hour-to-hour sensor deltas**, followed by median imputation (with missing indicators), scaling and the estimator. The
deltas were the decisive addition: they let a linear model's validation MAE fall from 0.356 to 0.244.

**Splits (chronological, never shuffled).** Three rolling-origin validation folds (40–50%, 50–60% and 60–70% of the hourly
timeline, each trained on all earlier data), a calibration block (70–80%) and a test block (80–100%, 16 Jan – 4 Apr 2005).
All methods are scored on the same rows: observed target, sensors present, and both baseline lags available.

**Candidates and tuning (validation folds only).** Linear Regression; Ridge (alpha grid); KNN, the course's algorithm
(k and weights grid); Random Forest (depth and leaf grid); and XGBoost, **trained on an NVIDIA RTX 5050 with CUDA**
(trees, depth, learning rate). The models were compared against persistence, a seasonal-naive baseline and a faithful
re-creation of the team notebook model.

| Model | Validation MAE | Test MAE | Test RMSE | Test R² |
|---|---|---|---|---|
| **XGBoost (selected)** | **0.210** | **0.271** | **0.401** | **0.910** |
| Ridge | 0.244 | 0.252 | 0.353 | 0.931 |
| Linear Regression | 0.244 | 0.252 | 0.355 | 0.930 |
| Random Forest | 0.242 | 0.292 | 0.458 | 0.883 |
| KNN | 0.362 | 0.366 | 0.505 | 0.858 |
| Persistence | 0.579 | 0.526 | 0.814 | 0.630 |
| Seasonal naive | 1.002 | 0.878 | 1.283 | 0.083 |
| Team notebook LR (no lags) | 0.316 | 1.255 | 1.348 | −0.01 |

* XGBoost was selected by lowest mean validation MAE; tuning improved it from 0.234 to 0.210. On test it is **48.4% more accurate
  than persistence**. Ridge scored slightly better on test, but changing the selection after seeing test results would
  leak the test set, so the validation choice stands.
* Framing check with the same tuned settings: nowcast test MAE 0.271 vs forecast (sensors at *t−1*) 0.452, which confirms the Phase 4 conclusion.
* The team notebook model collapses on the test months. Its `Month` feature extrapolates into months that are unseen or
  only partly seen, and without lags it cannot follow sensor drift.
* The 90% interval half-width is 0.719 mg/m³ (conformal, from calibration residuals), with 91.8% empirical test coverage.
  The episode threshold is 1.032 mg/m³ (95th percentile of calibration |residual|).
* The test period was inspected during earlier exploratory work, so it is not a fully independent test.

**Episodes.** Hours whose |observed − estimate| exceeds the threshold are flagged across all out-of-sample periods
(walk-forward fold models, then the frozen final model). Flagged runs less than 3 hours apart are merged. That gives
**68 episodes: 35 unusual-pollution candidates and 33 data-limitation candidates**. An episode is a data-limitation candidate when any of these rules
fires: imputed CO history, a preceding CO data gap, S1 outside its training range, past-week sensor/reference
disagreement above 25% (a drift proxy), or current disagreement beyond the training 99th percentile. Otherwise it is an
unusual-pollution candidate. Each episode stores its evidence counts and a plain-language reason. Causes remain unverified.

**Saving.** The fitted pipeline is saved with joblib as [`air_quality_model.pkl`](../air_quality_model.pkl), switched
to CPU inference for portability, and checked to give identical predictions after reloading. Permutation importance
(calibration period) ranks S2, CO at *t−1* and S1 highest.

## Phase 6 — final architecture

Python trains the model offline (`train_model.py`). **FastAPI** (`main.py`) loads the saved pipeline once and serves
`GET /`, `GET /health` and `POST /predict`, with Pydantic `Field` validation and SHAP contributions from XGBoost. It also serves
`/api/*` data endpoints and the dashboard (`frontend/`: HTML, CSS and vanilla JS with Apache ECharts 5.5.1, no build step) at
`/dashboard/`, so the whole product runs from one process and one URL. Tested with pytest (10 tests) and a Postman
collection. Deployed locally with Uvicorn (`scripts/run_local.ps1`: local and LAN URLs); a temporary public URL comes from a
Cloudflare quick tunnel (`scripts/public_url.ps1`). Permanent cloud hosting is optional future work.

Future work: validate on another time period or site, measure real sensor availability and latency, add time-series-aware
uncertainty, and validate episode causes against independent event labels. [UCI](https://archive.ics.uci.edu/dataset/360/air+quality)
contains conflicting research-only and CC BY statements; clarify these before any commercial reuse.
