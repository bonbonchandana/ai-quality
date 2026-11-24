# Air Health Portal: pollution forecasts for healthcare

Hospitals, doctors and public health organisations usually hear about a bad-air day when patients start arriving. This project
tries to give them a few hours of warning instead, so they can get staff and supplies ready and tell the public.

It is a small FastAPI app that serves trained models for the UCI Air Quality dataset (Italy, hourly, March 2004 to
April 2005), plus a web portal on top of it. For each of CO, NO2, NOx and C6H6 there is one model that predicts the
next hour.

Live portal: https://ai-quality.onrender.com/dashboard/
Demo sign-in (a stand-in, not real security): `admin@demo.health`, `doctor@demo.health` or `viewer@demo.health`,
password `demo123`.

## Screens

- **Dashboard**: pick a pollutant. See one big status (Good, Watch or Warning) with what it means, the value now, in 1 hour
  and in 2 hours, a chart of actual vs predicted, and what to do now.
- **Add data**: for new readings from your own station. Type in the latest readings to get the level in 1 and 2 hours,
  who to tell (hospitals, doctors, schools and the public) and an alert message ready to copy, send or print. Or upload a
  CSV of hourly readings (same columns as the UCI file) to see actual vs predicted, the alerts you would have sent, and how
  many high hours the forecast warned about one hour before. Only the trained models are used; nothing is retrained.
- **Alerts**: all pollutants for the next 2 hours, active alerts with what to do (send, copy the message or print), recent alerts and a daily
  checklist for public health teams.
- **Unusual changes**: when a pollutant jumped or dropped, by how much, and the likely cause (real pollution or a sensor problem).
- **Model**: how the model works and how accurate it is, with a chart of actual vs predicted on the test period.

## How the forecast works

The model does not guess the pollution level directly. It guesses the change from the last hour, and the level is the
last hour plus that change. It uses the hour, the weekday, the level 1, 2, 3 and 24 hours earlier, and the previous
hour's temperature and humidity. Data is split by time: 60% to train, 20% to choose the model, 20% to test.

To look 2 and 3 hours ahead, the model's own forecast is fed back in as the "previous hour" value, and the weather is
held at the last known hour, because the future weather is not known. For CO on the test period the typical miss is
0.39, 0.55 and 0.63 mg/m³ at 1, 2 and 3 hours, against 0.52, 0.86 and 1.08 for simply guessing "no change".

## Warning levels

The app looks at the highest forecast for the next 2 hours and places it on a simple ladder:

| Pollutant | Watch | Warning | Based on |
|---|---|---|---|
| CO | 4 mg/m³ | 10 mg/m³ | WHO guidelines (24-hour and 8-hour) |
| NO2 | 200 µg/m³ | 400 µg/m³ | EU 1-hour limit and EU alert threshold |
| NOx | above 95 in 100 earlier hours | above 99 in 100 | this station (no official health limit) |
| C6H6 | above 95 in 100 earlier hours | above 99 in 100 | this station (no short-term health limit) |

Each level explains the health effects, what happens if the level keeps rising, and what each team should do. Over the
test period a warning is active in about 18% of hours (about 1.4 new warnings a day, mostly at rush hour). It's a planning
aid, not a replacement for official warnings or clinical judgement.

## API

- `GET /health`
- `GET /api/datasets`
- `GET /api/results/{pollutant}`
- `GET /api/report/{pollutant}`
- `GET /api/sample/{pollutant}`
- `GET /api/forecast/{pollutant}`: 1, 2 and 3 hours ahead for every hour of the test period
- `GET /api/episodes/{pollutant}`: unusual periods, as CSV
- `GET /api/example-file`: one week of readings in the format the upload accepts
- `POST /api/check/{pollutant}`: upload a CSV of hourly readings (form field `file`, up to 5 MB); returns actual vs predicted
- `POST /predict`

Pollutants are CO, NO2, NOx and C6H6. `POST /predict` takes flat JSON, the way the Postman collections in `postman/`
send it:

```json
{"pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
 "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}
```

Docs for every endpoint are at `/docs`. Models are in `models/uci-italy/`, results in `artifacts/uci-italy/`.

## Run locally

```powershell
cd D:\Projects\air-quality-research
powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1
```

Open `http://127.0.0.1:8000/dashboard/`. The portal is plain HTML, CSS and JS in `frontend/`, with no build step.

## Notebook

`notebooks/air_quality_16_steps.ipynb` walks through the whole method in 16 steps and ends with the 1-3 hour
forecast and the alert rule. It runs on Kaggle with the UCI file added as input.

## What the backend team still needs to build

- Real sign-in and user accounts. The demo accounts are hard-coded in the frontend.
- Delivery of alerts (email, SMS or whatever each organisation uses). Today the Health alerts screen only shows a preview.
- Role checks on the server. Hiding a button for the viewer role is not security; the server must check every request
  against the user's role and organisation. Patient data should only reach the frontend as counts, never names.
