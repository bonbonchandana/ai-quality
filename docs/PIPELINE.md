# Air quality prediction pipeline

This project uses the extracted project root `D:\air-quality-research`. The shipped product model is a Ridge CO virtual-sensor nowcast: it estimates CO at hour *t* from concurrent low-cost sensor/weather readings and earlier CO readings. It is not described as a forecast.

| Step | Implementation | Evidence/output |
|---|---|---|
| 1. Problem definition | Product framing and integrity rules in `docs/PRD.md` | CO nowcast and candidate episode detection |
| 2. Data collection | UCI archive validation in `research/run.py` | `research/data/air-quality.zip`, `research/data/clean.csv` |
| 3. Preprocessing | Sentinel replacement, chronological hourly index, train-only pipeline imputation | `research/run.py`, `research/output/missingness.csv` |
| 4. EDA | Missingness, calendar, correlation and drift exports | `research/figures/`, `research/output/correlations.csv` |
| 5. Feature engineering | `features()` in `research/run.py` | `research/output/model_metadata.json` |
| 6. Model selection | Rolling validation against persistence, seasonal naive, Ridge and XGBoost | `research/output/validation_mean.csv`, `selection.json` |
| 7. Training | Chronological training in `fitmodel()` | `research/output/selected_model.joblib` |
| 8. Evaluation | Validation and holdout metrics on originally observed targets | `research/output/metrics.csv`, `summary.json` |
| 9. Hyperparameter tuning | Ridge selection and XGBoost early-stopping rounds are frozen before test scoring | `research/output/selection.json` |
| 10. Model saving | Product pipeline and explicit configuration contract | `research/models/co_nowcast.joblib`, `co_nowcast_config.json` |
| 11. FastAPI backend | API application in `backend/app.py` | `/api/health`, metadata, metrics, predictions, episodes and explorer routes |
| 12. Frontend | React/Vite/TypeScript shell in `frontend/` | Dashboard routes and typed API client |
| 13. Model integration | Backend loads the saved pipeline once and serves `/api/predict` | `backend/app.py` |
| 14. Testing | Pytest backend checks and frontend Vitest checks | `backend/tests/`, `frontend/src/*.test.ts` |
| 15. Deployment | Docker multi-stage build and local runner | `Dockerfile`, `scripts/run_local.ps1` |
| 16. URLs | Local/network URL printing and Render deployment recipe | `README.md`, `render.yaml` |

## Integrity notes

Splits are chronological. Features use past or concurrent values only. Targets are scored only when originally observed. Episode labels are candidates and include reasons; imputed predictor inputs are exposed through `imputed_feature_count`.

NO2 is retained as an explored team approach until its validation comparison is recomputed. It is not promoted to a product page by default.
