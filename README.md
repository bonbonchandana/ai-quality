# UCI Air Quality Prediction

A small FastAPI app for the supplied UCI Air Quality dataset from Italy, plus the **Air Health Portal**: the frontend
for healthcare centers.

Live portal: https://ai-quality.onrender.com/dashboard/ (sample accounts: `admin@demo.health`, `doctor@demo.health`,
`viewer@demo.health`, password `demo123`)

## Air Health Portal (frontend for healthcare centers)

Helps a healthcare center get ready for high-pollution days: plan staff and beds, warn at-risk patients, and see
whether an unusual reading was real pollution or a sensor problem. Only signed-in center staff can use it.

It is plain HTML/CSS/JS with no build step, in three files: `frontend/index.html`, `frontend/style.css` and
`frontend/app.js` (charts use the bundled `frontend/vendor/echarts.min.js`). Open it through the server above, or host
the `frontend/` folder anywhere.

Screens: Overview, Surge planning, Patient alerts (with alert levels), Unusual periods, Reports (CSV and PDF), Settings.
Roles: **admin** (everything, including users and switching center), **doctor** (send alerts, change alert levels),
**viewer** (read only).

**For the backend team.** Everything on screen comes from sample data at the top of `frontend/app.js`. Each `api.*`
function there names the endpoint it stands for (the full list is in the comment above it): replace them one by one
with `fetch()` calls that return the same shapes, and the screens keep working. The backend must do the real sign-in
and check every request against the user's role and center; hiding a button in the UI is not security. Patient data
should only ever reach the frontend as counts, never names.

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
