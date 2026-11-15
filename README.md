# Air Quality Prediction and Pollution Episode Detection

This is a real-data ML analytics app for the UCI Air Quality dataset. The product model is a Ridge CO virtual-sensor nowcast (estimated vs observed, not a forecast). Episode labels are candidates and always include evidence reasons.

## Run locally

From PowerShell:

```powershell
./scripts/run_local.ps1
```

The script builds the frontend and starts one FastAPI server. It prints `http://localhost:8000`; use the machine LAN address for another device. API docs are at `/docs`.

## Deploy publicly on Render

1. Push this repository to GitHub.
2. In Render, choose New → Web Service and connect the repository.
3. Render detects `render.yaml`, builds the Dockerfile, and supplies the public HTTPS URL.

For a temporary tunnel, install a tunnel tool separately and run it against port 8000; no tunnel tool is bundled here.

## Evidence

Research outputs are in `research/output/`; the saved product pipeline is `research/models/co_nowcast.joblib`; the step mapping is `docs/PIPELINE.md`. The validated research verification script passes 10 integrity checks.
