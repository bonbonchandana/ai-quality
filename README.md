# UCI Air Quality Prediction

A small FastAPI + JSON dashboard for the supplied UCI Air Quality dataset from Italy. The running application uses no live-city service, uploads, or additional datasets.

Live dashboard: https://ai-quality.onrender.com/dashboard/

## Run locally

From PowerShell:

```powershell
cd D:\air-quality-research
powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1
```

Open `http://127.0.0.1:8000/dashboard/`. API documentation is at `http://127.0.0.1:8000/docs`.

The app reads trained model files from `models/uci-italy/` and prediction, metric, and episode JSON from `artifacts/uci-italy/`.

## API

- `GET /health`
- `GET /api/datasets`
- `GET /api/results/{pollutant}`
- `GET /api/report/{pollutant}`
- `GET /api/sample/{pollutant}`
- `GET /api/episodes/{pollutant}` for CSV export
- `POST /predict`

Supported pollutants are CO, NO2, NOx, and C6H6. The model uses only the UCI features stored in each JSON artifact: hour, weekday, lagged pollutant values, temperature, relative humidity, and absolute humidity.
