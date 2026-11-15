# PRD: Air Quality Prediction and Pollution Episode Detection

## Problem

Predict a selected pollutant measurement using historical pollutant readings and relevant environmental variables.
Engineer lagged features if timestamps permit, evaluate on future periods, and flag periods where observations differ
substantially from model expectations. Analyze whether flagged episodes reflect unusual pollution behavior or data limitations.

## Users

* **A student analyst** who picks a pollutant, sees how well it can be predicted, and inspects unusual periods.
* **A reviewer** who checks that the model is evaluated on future data and beats a simple baseline.

## Requirements

| # | Requirement | Acceptance criteria |
|---|---|---|
| 1 | Select a pollutant | The dashboard dropdown and the `pollutant` field of `/predict` accept CO, NO2, NOx and C6H6 |
| 2 | Lagged features | Lags 1, 2, 3 and 24 h of the pollutant, plus the previous hour's temperature and humidity, hour and weekday |
| 3 | Future-period evaluation | Chronological 60/20/20 split; models chosen on validation and scored once on test; compared with persistence |
| 4 | Flag deviations | Test hours with \|actual − predicted\| above the 95th percentile of validation errors are flagged and shown in red |
| 5 | Analyze episodes | Flagged hours are grouped into episodes; each is labelled *Data limitation* or *Unusual pollution*, with a reason |
| 6 | Save the model | One `models/<pollutant>.pkl` per pollutant, saved with joblib |
| 7 | API | FastAPI with `GET /`, `GET /health` and `POST /predict` (Pydantic validation), testable in Postman |
| 8 | Dashboard | One page: pollutant picker, summary cards, actual vs predicted chart, model comparison, input importance, daily and hourly patterns, episodes table, prediction form |
| 9 | Tests | Automated API tests pass; the API reproduces the training script's predictions |

## Architecture

`train_model.py` → `models/*.pkl` + `artifacts/*.json` → `main.py` (FastAPI) → `frontend/` (served at `/dashboard/`).

## Limitations

* The data come from one city in 2004–2005; results may not transfer elsewhere.
* Persistence is a strong baseline for hourly data. For NOx, the models did not beat it on the validation period.
* Episode labels come from simple rules; real causes are not verified against external records.
