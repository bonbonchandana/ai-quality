# PRD: Air Quality Prediction and Pollution Episode Detection

**Status:** built and tested (15 November 2026). Methods and full metrics: [RESEARCH.md](RESEARCH.md). How to run: [README](../README.md).

## Problem

> Predict a selected pollutant measurement using historical pollutant readings and relevant environmental variables.
> Engineer lagged features if timestamps permit, evaluate on future periods, and flag periods where observations differ
> substantially from model expectations. Analyze whether flagged episodes reflect unusual pollution behavior or data limitations.

Reference analyzers are accurate but expensive and often offline; low-cost metal-oxide sensors are cheap but noisy,
cross-sensitive and drift over time. The product is a **virtual sensor**. It estimates the reference CO concentration at
hour *t* from cheap sensor readings, weather and recent CO history, and it explains the hours where reality departs from the estimate.

## Solution summary

| Item | Decision |
|---|---|
| Pollutant | CO(GT), mg/m³ (82% of hours observed; NMHC is 90% missing) |
| Framing | Nowcast at hour *t* (sensors and weather at *t*; CO history up to *t−1*). It beats a 1-hour forecast (test MAE 0.271 vs 0.452) |
| Lag features | CO at *t−1, t−2, t−3, t−24*; sensors at *t−1*; sensor deltas; cyclical hour and weekday |
| Model | XGBoost trained on a CUDA GPU, selected on 3 rolling validation folds, served on CPU |
| Accuracy (test, Jan–Apr 2005) | MAE 0.271 mg/m³, RMSE 0.401, R² 0.910; **48% better than persistence** |
| Uncertainty | Conformal 90% interval of ±0.719 mg/m³ (91.8% test coverage) |
| Episodes | 68 out-of-sample episodes: 35 unusual-pollution and 33 data-limitation candidates, each with a reason |

## Users (proposed personas)

* **Ananya, student environmental analyst:** wants to find which historical departures deserve inspection, and why.
* **Ravi, faculty reviewer:** wants proof that the model generalizes to future periods and beats simple baselines, with reproducible code.
* **A monitoring technician:** wants to know whether an odd reading comes from missing inputs or sensor trouble rather than real pollution.

## Goals and non-goals

**Goals:** accurate, honest estimates with uncertainty; transparent episode classification; a reproducible ML pipeline;
a working REST API (testable in Postman); and a visual dashboard that a non-expert can understand.

**Non-goals:** live sensor feeds, future forecasts, AQI or health advice, confirmed causes of pollution or faults, and user accounts.

## Features and acceptance criteria

| # | Feature | Acceptance criteria | Status |
|---|---|---|---|
| 1 | Training pipeline (`train_model.py`) | Raw UCI data → cleaned hourly grid → features → 5 models tuned on validation → single test pass → `air_quality_model.pkl`; rerunnable | ✅ |
| 2 | `GET /` and `GET /health` | Return a running message and the health status of the loaded model | ✅ |
| 3 | `POST /predict` | Pydantic-validated JSON → estimate, 90% interval, imputed fields, SHAP contributions; optional `observed_co` returns an anomaly verdict and hints | ✅ |
| 4 | Error handling | 422 for invalid or missing fields, 404 for unknown paths or episodes, 500 without a stack trace | ✅ |
| 5 | Overview page | KPIs, estimated vs observed with interval and episode shading, residuals, calendar heatmap, classification donut | ✅ |
| 6 | Data explorer | Multi-variable series, correlation, distributions, hour × weekday heatmap, missing-data heatmap, sensor vs reference, drift, profiles | ✅ |
| 7 | Model performance | All models vs baselines (validation and test), folds, framing comparison, tuning gains, scatter, residuals, error by hour and month, importance, interval coverage | ✅ |
| 8 | Episodes and episode detail | Timeline, filterable table, monthly counts; detail view with window charts and an evidence panel | ✅ |
| 9 | Virtual sensor simulator | Load a real or random hour, edit inputs, call `/predict`, show the verdict and contributions, copy as cURL | ✅ |
| 10 | Methodology and About pages | 16-step pipeline with live facts; plain-language explanation of the data, method and limitations | ✅ |
| 11 | Responsive, themed UI | Dark and light themes; works from 375px to desktop width; reduced-motion respected | ✅ |
| 12 | Testing | pytest suite (10 tests, including API = saved-model reproducibility) and a Postman collection | ✅ |
| 13 | Deployment and URLs | Local (`127.0.0.1:8000`), LAN, and a temporary public URL via a Cloudflare tunnel | ✅ (permanent hosting is optional) |

## API contract (summary)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Confirms the API is running |
| GET | `/health` | Health status |
| POST | `/predict` | CO estimate (+ anomaly check) from one hour of readings |
| GET | `/docs` | Interactive OpenAPI documentation |
| GET | `/api/summary`, `/api/metrics`, `/api/predictions`, `/api/episodes[/{id}]` | Dashboard data |
| GET | `/api/explorer/*`, `/api/samples[/random]` | EDA data and real input rows |
| GET | `/dashboard/` | Web dashboard |

Required `/predict` fields: `hour`, `weekday`, `pt08_s1_co` … `pt08_s5_o3`, `temperature`, `relative_humidity`, `absolute_humidity`.
Optional fields: `co_lag_1/2/3/24`, `pt08_*_prev` and `observed_co`. Missing optional inputs are imputed with training medians and reported back.

## Architecture

`train_model.py` → `air_quality_model.pkl` + `artifacts/*.json|csv` → `main.py` (FastAPI) → `frontend/` (served at `/dashboard/`).
One Python process serves both the API and the UI.

## Risks and limitations

* The data come from one Italian site in 2004–2005; results may not transfer to other sites, seasons or newer sensors.
* The test period was viewed during exploratory research, so it is not a fully independent holdout.
* Episode labels are rule-based candidates; causes are not verified against external records.
* The sensors drift, so accuracy degrades further from the training period and periodic retraining would be needed.
* The public URL is temporary while the server runs on a laptop.

## Future work

Permanent cloud deployment, validation on a later period or another site, time-series-aware uncertainty, more pollutants
(for example NO2), and episode labels checked against event records.
