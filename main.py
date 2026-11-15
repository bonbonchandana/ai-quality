"""FastAPI app for the air quality models.

Start the server from the project folder:
    python -m uvicorn main:app --reload

    GET  /            check that the API is running
    GET  /health      health status
    POST /predict     next-hour prediction for a selected pollutant
    GET  /docs        interactive API documentation
    GET  /dashboard/  the web dashboard
"""
import json
import os
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import train_model

BASE = Path(__file__).resolve().parent
ARTIFACTS = BASE / "artifacts"
UPLOADS = BASE / "uploads"
MAX_UPLOAD_MB = 30
# Training needs more memory than a free host has, so the online demo turns uploads off (ALLOW_UPLOAD=false).
ALLOW_UPLOAD = os.environ.get("ALLOW_UPLOAD", "true").lower() != "false"

class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"     # so units like mg/m³ show correctly in every client


app = FastAPI(default_response_class=UTF8JSONResponse, title="Air Quality Prediction API",
              description="Predicts the next-hour level of a selected pollutant and flags unusual readings.")


# ---------- loading saved results and models ----------
def datasets():
    """Each trained dataset, built-in or uploaded, has a dataset.json in artifacts/<id>/."""
    found = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(ARTIFACTS.glob("*/dataset.json"))]
    return sorted(found, key=lambda d: d["id"] != "uci-italy")      # Italy first


def find_pollutant(dataset_id, pollutant):
    for d in datasets():
        if d["id"] == dataset_id:
            for p in d["pollutants"]:
                if pollutant in (p["pollutant"], p["key"]):
                    return p["key"]
            raise HTTPException(404, f"Pollutant '{pollutant}' not in dataset '{dataset_id}'. "
                                     f"Available: {[p['pollutant'] for p in d['pollutants']]}")
    raise HTTPException(404, f"Dataset '{dataset_id}' not found. Available: {[d['id'] for d in datasets()]}")


@lru_cache(maxsize=2)          # keep only the last couple of models in memory
def load_model(dataset_id, key):
    return joblib.load(BASE / "models" / dataset_id / f"{key}.pkl")


@lru_cache(maxsize=4)
def load_results(dataset_id, key):
    return json.loads((ARTIFACTS / dataset_id / f"{key}.json").read_text(encoding="utf-8"))


# ---------- request body for /predict ----------
class PredictInput(BaseModel):
    """What we know before the hour we want to predict. Weather fields a model doesn't use are ignored."""
    dataset: str = Field("uci-italy", description="Dataset id (see /api/datasets)")
    pollutant: str = Field(..., description="Pollutant to predict, e.g. CO, NO2, NOx, C6H6, PM2.5")
    hour: int = Field(..., ge=0, le=23, description="Hour being predicted (0-23)")
    weekday: int = Field(..., ge=0, le=6, description="Day of week (0 = Monday)")
    lag_1: float = Field(..., ge=0, le=100000, description="Pollutant level 1 hour earlier")
    lag_2: Optional[float] = Field(None, ge=0, le=100000, description="Level 2 hours earlier")
    lag_3: Optional[float] = Field(None, ge=0, le=100000, description="Level 3 hours earlier")
    lag_24: Optional[float] = Field(None, ge=0, le=100000, description="Level 24 hours earlier")
    temperature: Optional[float] = Field(None, ge=-40, le=55, description="Previous hour temperature (°C)")
    relative_humidity: Optional[float] = Field(None, ge=0, le=100, description="Previous hour relative humidity (%)")
    absolute_humidity: Optional[float] = Field(None, ge=0, le=5, description="Previous hour absolute humidity")
    pressure: Optional[float] = Field(None, ge=800, le=1100, description="Previous hour air pressure (hPa)")
    dew_point: Optional[float] = Field(None, ge=-60, le=40, description="Previous hour dew point (°C)")
    rain: Optional[float] = Field(None, ge=0, le=300, description="Previous hour rain (mm)")
    wind_speed: Optional[float] = Field(None, ge=0, le=60, description="Previous hour wind speed (m/s)")
    observed: Optional[float] = Field(None, ge=0, le=100000, description="Optional: the measured value, to check for an episode")

    model_config = {"json_schema_extra": {"examples": [{
        "pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
        "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}]}}


@app.get("/")
def root():
    return {"message": "Air Quality Prediction API is running", "docs": "/docs", "dashboard": "/dashboard/"}


@app.get("/health")
def health():
    return {"status": "ok", "datasets": [d["id"] for d in datasets()], "upload_enabled": ALLOW_UPLOAD}


@app.post("/predict")
def predict(data: PredictInput):
    key = find_pollutant(data.dataset, data.pollutant)
    info = load_results(data.dataset, key)
    row = pd.DataFrame([{f: getattr(data, f) for f in info["features"]}]).astype(float)   # None -> filled in by the model
    prediction = max(0.0, float(train_model.predict_level(load_model(data.dataset, key), row)[0]))
    answer = {"dataset": data.dataset, "pollutant": info["pollutant"], "unit": info["unit"],
              "prediction": round(prediction, 3), "model": info["model"]}
    if data.observed is not None:
        deviation = data.observed - prediction
        answer["episode_check"] = {"observed": data.observed, "deviation": round(deviation, 3),
                                   "threshold": round(info["threshold"], 3), "flagged": abs(deviation) > info["threshold"]}
    return answer


# ---------- data for the dashboard ----------
@app.get("/api/datasets")
def list_datasets():
    return datasets()


@app.get("/api/results/{dataset_id}/{pollutant}")
def get_results(dataset_id: str, pollutant: str):
    return load_results(dataset_id, find_pollutant(dataset_id, pollutant))


@app.get("/api/report/{dataset_id}/{pollutant}")
def get_report(dataset_id: str, pollutant: str, download: bool = False):
    """The results in plain words, as JSON. Add ?download=true to save it as a file."""
    key = find_pollutant(dataset_id, pollutant)
    title = next(d["title"] for d in datasets() if d["id"] == dataset_id)
    report = train_model.build_report(load_results(dataset_id, key), title)
    if not download:
        return report
    return Response(json.dumps(report, indent=2, ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{dataset_id}-{key}-report.json"'})


@lru_cache(maxsize=1)
def dataset_frame(dataset_id):
    return pd.read_csv(ARTIFACTS / dataset_id / "data.csv", parse_dates=["timestamp"], index_col="timestamp").asfreq("h")


@app.get("/api/sample/{dataset_id}/{pollutant}")
def get_sample(dataset_id: str, pollutant: str):
    """Picks a real hour from the test period that has every input, so it can be sent straight to /predict."""
    key = find_pollutant(dataset_id, pollutant)
    info = load_results(dataset_id, key)
    df = dataset_frame(dataset_id)
    weather = {name: col for name, col in json.loads((ARTIFACTS / dataset_id / "dataset.json")
                                                       .read_text(encoding="utf-8"))["weather"].items()}
    X = train_model.make_features(df, info["column"], weather)
    test_times = pd.to_datetime([p["t"] for p in info["test_predictions"]])
    complete = X.loc[X.index.intersection(test_times)].dropna()
    if complete.empty:
        raise HTTPException(404, "No complete sample found")
    t = complete.sample(1).index[0]
    values = {k: (int(v) if k in ("hour", "weekday") else float(v)) for k, v in complete.loc[t].items()}
    return {"time": t.isoformat(), "input": {"dataset": dataset_id, "pollutant": info["pollutant"], **values,
                                             "observed": float(df.at[t, info["column"]])}}


@app.post("/api/upload")
def upload_dataset(file: UploadFile = File(...), name: str = Form("")):
    """Trains models on your own hourly CSV or ZIP. The file needs a time column and at least one pollutant."""
    if not ALLOW_UPLOAD:
        raise HTTPException(403, "Uploading is turned off on the online version. Run the app on your own computer to train on your own file.")
    content = file.file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB")
    suffix = ".zip" if (file.filename or "").lower().endswith(".zip") else ".csv"
    title = (name or Path(file.filename or "my-data").stem).strip()[:60]
    dataset_id = "upload-" + (re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:30] or "data") + "-" + uuid.uuid4().hex[:6]
    UPLOADS.mkdir(exist_ok=True)
    path = UPLOADS / f"{dataset_id}{suffix}"
    path.write_bytes(content)
    try:
        summary, _ = train_model.train_dataset(path, dataset_id, title, out_root=BASE)
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not train on this file: {exc}")
    return {"id": dataset_id, "title": title, "pollutants": summary}


app.mount("/dashboard", StaticFiles(directory=BASE / "frontend", html=True), name="dashboard")
