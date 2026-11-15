# PRD: Air Quality Prediction and Pollution Episode Detection

## The problem

Predict a selected pollutant measurement using historical pollutant readings and relevant environmental variables.
Engineer lagged features if timestamps permit, evaluate on future periods, and flag periods where observations differ
substantially from model expectations. Analyze whether flagged episodes reflect unusual pollution behavior or data limitations.

## Who uses it

A student or analyst who wants to pick a pollutant, see how well its next hour can be predicted and look at the odd
periods. A reviewer who wants to check that the model was tested on later data and actually beats a simple guess.

## What it has to do

| # | Requirement | Done when |
|---|---|---|
| 1 | Choose the pollutant | The dashboard has dataset and pollutant dropdowns, and `/predict` takes `dataset` and `pollutant` fields |
| 2 | Lagged features | The pollutant at 1, 2, 3 and 24 hours back, the previous hour's weather, hour and weekday |
| 3 | Test on a later period | 60/20/20 split in time order; the model is chosen on validation and tested once; it is compared with repeating the last value |
| 4 | Flag big misses | Test hours with a miss bigger than 95% of the validation misses show up in red |
| 5 | Explain the episodes | Flagged hours are grouped; each group is labelled data limitation or unusual pollution, with the reason |
| 6 | Other datasets | An hourly CSV can be uploaded from the dashboard, and it gets trained the same way |
| 7 | Save models | One `.pkl` per pollutant per dataset (joblib) |
| 8 | API | FastAPI with `GET /`, `GET /health` and `POST /predict`, with Pydantic checks; works in Postman |
| 9 | Dashboard | One page: summary cards, actual vs predicted, model comparison, input importance, daily and hourly patterns, episodes table, prediction form, upload |
| 10 | Tests | API tests pass, and the API gives the same numbers as the training script |

## How it fits together

`train_model.py` trains and saves `models/<dataset>/*.pkl` and `artifacts/<dataset>/*.json`. `main.py` loads them and
serves the API and the dashboard in `frontend/` at `/dashboard/`.

## Limits

The data covers one Italian city (2004–2005) and one Beijing station (2013–2017), so results may not carry over to
other places. Repeating the last hour is a strong guess for hourly data; for slow pollutants like PM10, CO and SO2 in
Beijing, the models don't beat it. The episode labels come from simple rules, and nobody checked them against real events.
