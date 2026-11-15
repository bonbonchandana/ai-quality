# Air Quality Prediction and Pollution Episode Detection

Our task was to predict a selected pollutant from its past readings and the weather, use lagged features, test on a
later time period, flag the hours where the real value was far from the prediction, and work out whether those
episodes were real pollution or just problems in the data.

This project does exactly that. You pick a dataset and a pollutant, and you get a next-hour prediction model, its test
results and a list of flagged episodes, each with a reason.

## Datasets

| Dataset | Rows (hourly) | Pollutants | Weather used |
|---|---|---|---|
| [UCI Air Quality](https://archive.ics.uci.edu/dataset/360/air+quality), Italy, 2004–2005 | 9,357 | CO, NO2, NOx, C6H6 (benzene) | temperature, relative and absolute humidity |
| [UCI Beijing Multi-Site](https://archive.ics.uci.edu/dataset/501/beijing+multi+site+air+quality+data), Aotizhongxin station, 2013–2017 | 35,064 | CO, NO2, PM2.5, PM10, SO2, O3 | temperature, pressure, dew point, rain, wind speed |
| Your own file | any | any of the above | any of the above |

You can upload your own hourly CSV from the dashboard. It needs a time column (`Date` + `Time`, `year/month/day/hour`
or `datetime`) and at least one pollutant column. The other 11 Beijing stations from the UCI link work as they are.

## Method

1. Read the hourly data. Empty cells and the UCI code `-200` count as missing.
2. Lagged features: the pollutant 1, 2, 3 and 24 hours earlier, the previous hour's weather, and the hour and weekday.
3. Split by time and never shuffle: the first 60% is for training, the next 20% for picking the model, the last 20% for testing.
4. Try Linear Regression, Random Forest and XGBoost (XGBoost uses the GPU if there is one). Each model predicts how much
   the level will change in the next hour, and that change is added to the last reading. Every model is compared with
   simply repeating the last hour's value ("persistence").
5. A test hour is flagged when the miss is bigger than 95% of the misses on the validation period.
6. Flagged hours less than 3 hours apart form an episode. If inputs were missing or the data had a gap just before, it is
   labelled **Data limitation**. If not, it is labelled **Unusual pollution**.

## Results on the test period

Italy (test period 16 Jan – 4 Apr 2005):

| Pollutant | Model | Test MAE | Persistence MAE | Better by | R² | Episodes (unusual / data) |
|---|---|---|---|---|---|---|
| CO | Random Forest | 0.393 mg/m³ | 0.519 | 24.2% | 0.82 | 25 (20 / 5) |
| NO2 | Random Forest | 15.9 µg/m³ | 19.8 | 19.5% | 0.83 | 85 (58 / 27) |
| NOx | Random Forest | 57.6 ppb | 72.7 | 20.9% | 0.83 | 25 (16 / 9) |
| C6H6 | Random Forest | 1.72 µg/m³ | 2.29 | 25.1% | 0.83 | 33 (33 / 0) |

Beijing, Aotizhongxin (test period 12 May 2016 – 28 Feb 2017):

| Pollutant | Model | Test MAE (µg/m³) | Persistence MAE | Better by | R² |
|---|---|---|---|---|---|
| O3 | XGBoost | 8.47 | 11.19 | 24.3% | 0.96 |
| NO2 | Random Forest | 6.95 | 7.53 | 7.7% | 0.90 |
| PM2.5 | XGBoost | 9.69 | 10.34 | 6.2% | 0.96 |
| PM10 | XGBoost | 14.8 | 15.0 | 0.8% | 0.92 |
| CO | XGBoost | 192 | 191 | −0.3% | 0.90 |
| SO2 | XGBoost | 1.78 | 1.70 | −4.6% | 0.92 |

In Beijing, CO, SO2 and PM10 change slowly and are recorded in coarse steps (CO in steps of 100), so last hour's
value is already a very good guess and no model really beats it. The high R² there mostly comes from that.

## Files

```
train_model.py            the whole ML part (also runs on Kaggle)
main.py                   FastAPI: GET /, GET /health, POST /predict, dataset upload and dashboard data
notebooks/                the same work as a Kaggle notebook, one section per step of the 16-step flow
frontend/                 the report page (HTML, CSS, JavaScript, one ECharts chart)
data/                     the two built-in datasets
models/<dataset>/         saved models, one .pkl per pollutant
artifacts/<dataset>/      results the dashboard reads
tests/test_api.py         API tests
postman/                  Postman collection
research/, docs/          planning-phase research and project documents
```

## Run it

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn main:app --reload
```

Then open http://127.0.0.1:8000/dashboard/ (API docs at http://127.0.0.1:8000/docs). The trained models are already
in the repo. To retrain:

```powershell
.\.venv\Scripts\python train_model.py data\AirQualityUCI.csv
.\.venv\Scripts\python train_model.py data\Beijing_Aotizhongxin.csv
```

The page shows a written summary, the model results, one chart, every flagged episode explained in a sentence or
two, a prediction form and an upload box. "Download report (JSON)" saves the same information as a JSON file. The API
has it too, at `/api/report/<dataset>/<pollutant>`, for example `/api/report/uci-italy/CO`.

## Run it on Kaggle

The notebook `notebooks/air_quality_16_steps.ipynb` goes through the 16 steps one by one:

| Steps | What the cells do |
|---|---|
| 1–4 | define the problem, find and load the data, clean it, look at it |
| 5–10 | build the lag features, compare models, train, evaluate, tune, flag and explain episodes, save the model and a JSON report |
| 11–14 | write a FastAPI app and a small web page, call `/predict` the way the page does, and run tests |
| 15–16 | start the server with Uvicorn and print the URLs |

1. On Kaggle: **File → Import Notebook** and upload `air_quality_16_steps.ipynb`.
2. **+ Add Input** and add an air quality dataset (UCI Air Quality CSV or Excel, or a UCI Beijing station file). A GPU is optional.
3. **Run All**. Change `POLLUTANT` in the first code cell to try another pollutant.

If you'd rather use one plain script, paste the whole of `train_model.py` into a single cell instead. It trains every
pollutant in the file at once.

## Test with Postman

Method **POST**, URL **http://127.0.0.1:8000/predict**, Body → raw → JSON:

```json
{
  "pollutant": "CO",
  "hour": 18, "weekday": 2,
  "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
  "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8
}
```

You get back the predicted value for the next hour, for example `{"pollutant": "CO", "prediction": 2.948, "unit": "mg/m³", ...}`.
To use the Beijing models, add `"dataset": "beijing-aotizhongxin"` and send its weather fields (`temperature`,
`pressure`, `dew_point`, `rain`, `wind_speed`). Optional fields can be left out. If you add `"observed"`, the reply also
says whether that hour would be flagged.

| Status | Meaning |
|---|---|
| 200 | It worked |
| 404 | Wrong URL, or a dataset/pollutant that doesn't exist |
| 422 | A field is missing, has the wrong type or is out of range |
| 500 | Server error (check the terminal) |

Run the automated tests with `.\.venv\Scripts\python -m pytest -q`.

## Sharing

* Same Wi-Fi: `powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1` prints a network address.
* Temporary public link: install `cloudflared` (`winget install --id Cloudflare.cloudflared`), keep the server running
  and run `scripts\public_url.ps1`. Add `/dashboard/` to the `trycloudflare.com` address it prints.
