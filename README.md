# Air Health

Air pollution forecasts and health alerts for health organisations.

Every hour the station's reading comes in. The app forecasts carbon monoxide, nitrogen dioxide, nitrogen oxides and
benzene 1 and 2 hours ahead. When a level is about to become harmful, it sends a ready-made message to hospitals,
doctors and schools. A broken or silent sensor goes to the data team instead, so it never causes a false alarm.

Live: https://ai-quality.onrender.com

## What people see

- **Today**: one sentence for the next 2 hours (Good, Watch or Warning), who to tell, ventilation advice, a pie of
  today's hours by level, and each gas now, in 1 hour and in 2 hours.
- **History**: a calendar coloured by each day's worst level. Pick a day to see its alerts, sensor problems and
  unusual periods (real pollution, sensor problem or not sure).
- **Check**: look up any hour (what was measured and what had been forecast), or type in readings by hand when the
  station is down.
- **TV screen** (`#tv`): one big status for a waiting room. It refreshes itself.
- **How the model works** (`#model`, for the data team): which models were tried, why the winner was chosen, how
  accurate it is, and a chart of forecast vs real values.

Until a station sends readings, the app shows the 2005 test months as a demo, at today's weekday and time.

## Files

| File | What it does |
|---|---|
| `train.py` | Reads `data/AirQualityUCI.csv`, trains and compares the models, saves `models/` |
| `main.py` | The server: forecasts, alerts, sensor checks, unusual periods, and the API |
| `web/` | The web page (plain HTML, CSS and JavaScript, ECharts for the two charts) |
| `tests/test_app.py` | Tests |
| `notebooks/` | The full analysis, step by step |
| `postman/` | Postman requests for `/predict` |

## How the forecast works

The data is split by time: the first 60% to learn, the next 20% to choose the model, the last 20% to test. For each
gas, linear regression, random forest and XGBoost are compared with simply repeating the last hour, and the closest one
wins. The model forecasts the change from the last hour, using the hour, the weekday, the last 3 hours, the same hour
yesterday, temperature and humidity. For 2 hours ahead it feeds its own 1-hour forecast back in.

Levels: CO 4 and 10 mg/m³ (WHO), NO2 200 and 400 µg/m³ (EU). NOx and benzene have no short-term health limit, so
Watch and Warning mean higher than 95 and 99 of 100 earlier hours at the station.

An hour is unusual when the forecast missed by much more than normal. It counts as real pollution when other gases
also moved, and as a sensor problem when the reading was missing, stuck or jumped alone.

## Run it

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python train.py
.venv\Scripts\uvicorn main:app --reload
```

Then open http://127.0.0.1:8000. Run the tests with `.venv\Scripts\python -m pytest`.

## Connect a station

Set `ADMIN_KEY` on the server. The station's software sends each new hour:

```
POST /api/readings      header X-Key: <ADMIN_KEY>
[{"time": "2026-11-24T14:00", "CO": 1.2, "NO2": 80, "NOx": 150, "C6H6": 4.5, "T": 12, "RH": 60}]
```

Or the data team uploads a CSV on the model page. To send alerts by Telegram, also set `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` (health partners) and `TELEGRAM_DATA_CHAT_ID` (data team). Building systems can read
`GET /api/today` to switch ventilation automatically.

After a few months of the station's own readings, retrain on them: `python train.py <their file>`.
On Render's free plan, saved readings are lost when the server restarts.

## API

`GET /health` · `GET /api/today` · `GET /api/days` · `GET /api/day/{date}` · `GET /api/lookup?time=` ·
`POST /api/check` · `POST /predict` · `POST /api/readings` · `POST /api/upload` · `GET /api/model` · docs at `/docs`
