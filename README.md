# Air Quality Prediction and Pollution Episode Detection

This is a real-data ML analytics app for the supplied UCI Italy Air Quality dataset. Select a pollutant and an exact date/time to make a specific prediction. The dashboard compares actual and predicted values, filters episodes for the selected pollutant, and reports model performance. Other datasets and uploads are disabled so predictions stay within the supplied data domain.

## Run locally

From PowerShell:

```powershell
./scripts/run_local.ps1
```

The script starts one FastAPI server serving the dashboard and API. It prints `http://localhost:8000`; use the machine LAN address for another device. API docs are at `/docs`.

## Deploy publicly on Render

1. Push this repository to GitHub.
2. In Render, choose New → Web Service and connect the repository.
3. Render detects `render.yaml`, builds the Dockerfile, and supplies the public HTTPS URL.

For a temporary tunnel, install a tunnel tool separately and run it against port 8000; no tunnel tool is bundled here.

## Evidence

Research outputs are in `research/output/`. The selected-pollutant models and dashboard artifacts are in `models/` and `artifacts/`. The downloadable report includes the methodology, episode evidence, and model metrics.
