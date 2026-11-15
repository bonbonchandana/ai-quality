# Air Quality Prediction and Pollution Episode Detection

**Problem statement:** predict a selected pollutant measurement using historical pollutant readings and relevant
environmental variables. Engineer lagged features if timestamps permit, evaluate on future periods, and flag periods where
observations differ substantially from model expectations. Analyze whether flagged episodes reflect unusual pollution
behavior or data limitations.

**Dataset:** [UCI Air Quality](https://archive.ics.uci.edu/dataset/360/air+quality): 9,357 hourly readings from an Italian city, Mar 2004 – Apr 2005.

## How the problem is solved

| Requirement | What the project does |
|---|---|
| Selected pollutant | Choose **CO, NO2, NOx or benzene (C6H6)**, each with its own model (NMHC is skipped because 90% of it is missing) |
| Historical readings + environmental variables | Predict the **next hour** from the pollutant's past values and the previous hour's temperature and humidity |
| Lagged features | Pollutant value 1, 2, 3 and 24 hours earlier, plus hour of day and weekday |
| Evaluate on future periods | Time-ordered split: **train 60% → validation 20% → test 20%** (never shuffled) |
| Flag large differences | A test hour is flagged when \|actual − predicted\| > the 95th percentile of validation errors |
| Analyze flagged episodes | **Data limitation** if inputs were missing or the data had a gap in the 6 hours before; otherwise **unusual pollution** |

Models compared: Linear Regression, Random Forest and XGBoost (trained on the GPU when available). Each is tuned on the
validation period, the best one is retrained on train + validation, and the test period is scored once. Every model is
compared with a **persistence baseline** ("same as the previous hour").

## Results (test period: 16 Jan – 4 Apr 2005)

| Pollutant | Unit | Chosen model | Test MAE | Persistence MAE | Better by | R² | Episodes (unusual / data) |
|---|---|---|---|---|---|---|---|
| CO | mg/m³ | Random Forest | 0.403 | 0.519 | 22.4% | 0.81 | 34 (29 / 5) |
| NO2 | µg/m³ | Random Forest | 17.0 | 19.8 | 14.1% | 0.80 | 68 (42 / 26) |
| NOx | ppb | Linear Regression | 66.2 | 72.7 | 8.9% | 0.77 | 48 (30 / 18) |
| C6H6 | µg/m³ | XGBoost | 1.85 | 2.29 | 19.1% | 0.80 | 46 (45 / 1) |

For NOx, no model beat persistence on the validation period, so the NOx improvement is the least reliable.

## Project files

```
data/AirQualityUCI.csv     the dataset (original UCI file)
train_model.py             cleans data, builds lag features, trains/tunes/evaluates, flags and analyzes episodes
models/<pollutant>.pkl     saved models (one per pollutant)
artifacts/<pollutant>.json results used by the dashboard (metrics, test predictions, episodes)
main.py                    FastAPI: GET /, GET /health, POST /predict + dashboard data
frontend/                  one-page dashboard (HTML, CSS, JavaScript, ECharts)
tests/test_api.py          automated API tests
postman/                   Postman collection
notebooks/                 the same ML code as a Kaggle notebook
research/, docs/           planning-phase research and the project documents
```

## Run it

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python train_model.py            # optional: the trained models are already included
.\.venv\Scripts\python -m uvicorn main:app --reload
```

* API: http://127.0.0.1:8000
* API docs: http://127.0.0.1:8000/docs
* Dashboard: http://127.0.0.1:8000/dashboard/

## Test with Postman

Import `postman/AirQuality.postman_collection.json`, or create the request by hand:

* Method **POST**, URL **http://127.0.0.1:8000/predict**, Body → **raw** → **JSON**:

```json
{
  "pollutant": "CO",
  "hour": 18, "weekday": 2,
  "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
  "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8
}
```

The response is the predicted next-hour value, for example `{"pollutant": "CO", "prediction": 2.851, "unit": "mg/m³", ...}`.
Change `"pollutant"` to `"NO2"`, `"NOx"` or `"C6H6"`; the lag values must then be in that pollutant's unit.
`lag_2`, `lag_3` and `lag_24` are optional. If you add `"observed"` (the actual value), the response also says whether that hour would be flagged.

| Status | Meaning |
|---|---|
| 200 | Success |
| 404 | Wrong URL |
| 422 | Missing field, wrong type or value out of range |
| 500 | Server error (see the terminal) |

Automated tests: `.\.venv\Scripts\python -m pytest -q`

## Share it (optional)

* Same Wi-Fi: `powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1` prints a network URL.
* Temporary public link: install `cloudflared` (`winget install --id Cloudflare.cloudflared`), keep the server running,
  then run `scripts\public_url.ps1`. Add `/dashboard/` to the printed `trycloudflare.com` address.
