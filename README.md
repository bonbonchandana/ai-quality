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

- **Live forecast**: replays the test period as if it were live, with the forecast 1, 2 and 3 hours ahead.
- **Health alerts**: for nearby hospitals, doctors and public health organisations: the health risk, what to prepare,
  and advice for the public. Sending is a preview for now.
- **Unusual changes**: which gas jumped, by how much, which others moved with it, and a possible reason (real
  pollution or a sensor problem). Downloadable as CSV.
- **Model results**: the best model for each pollutant, how well it does on data it never saw, and the report download.
- **Dataset**: graphs of the data itself, with the learning / choosing / test split.

## How the forecast works

The model does not guess the pollution level directly. It guesses the change from the last hour, and the level is the
last hour plus that change. It uses the hour, the weekday, the level 1, 2, 3 and 24 hours earlier, and the previous
hour's temperature and humidity. Data is split by time: 60% to train, 20% to choose the model, 20% to test.

To look 2 and 3 hours ahead, the model's own forecast is fed back in as the "previous hour" value, and the weather is
held at the last known hour, because the future weather is not known. For CO on the test period the typical miss is
0.39, 0.55 and 0.63 mg/m³ at 1, 2 and 3 hours, against 0.52, 0.86 and 1.08 for simply guessing "no change".

## Warnings

For each pollutant the app looks at the worst forecast for the next 3 hours:

- **High**: above 95 in 100 of the earlier hours at this station.
- **Very high**: above 99 in 100.

Both levels come from the data before the test period, so they use nothing the model couldn't have known. Where an
official value applies it is mentioned too (for NO2, the EU 1-hour limit of 200 µg/m³). Each warning explains the health
risk in plain words and gives planning guidance for four audiences: hospitals and doctors (readiness level 1 or 2),
sensitive groups, schools and sports, and the public. It can be printed as an advisory. It's a planning aid, not a
replacement for official warnings or clinical judgement.

## API

- `GET /health`
- `GET /api/datasets`
- `GET /api/results/{pollutant}`
- `GET /api/report/{pollutant}`
- `GET /api/sample/{pollutant}`
- `GET /api/forecast/{pollutant}`: 1, 2 and 3 hours ahead for every hour of the test period
- `GET /api/episodes/{pollutant}`: unusual periods, as CSV
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
