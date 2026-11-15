"""FastAPI app for the air quality models.

Start the server from the project folder:
    python -m uvicorn main:app --reload

    GET  /            -> checks that the API is running
    GET  /health      -> health status
    POST /predict     -> next-hour prediction for the selected pollutant
    GET  /docs        -> interactive API documentation
    GET  /dashboard/  -> web dashboard
"""
import json
from pathlib import Path
from typing import Literal, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
POLLUTANTS = ["CO", "NO2", "NOx", "C6H6"]
FEATURES = ["hour", "weekday", "lag_1", "lag_2", "lag_3", "lag_24",
            "temperature", "relative_humidity", "absolute_humidity"]

app = FastAPI(title="Air Quality Prediction API",
              description="Predicts the next-hour level of a selected pollutant and flags unusual readings.")

# Load the saved models and their results once, when the server starts.
models = {p: joblib.load(BASE / "models" / f"{p}.pkl") for p in POLLUTANTS}
results = {p: json.loads((BASE / "artifacts" / f"{p}.json").read_text(encoding="utf-8")) for p in POLLUTANTS}
hourly = pd.read_csv(BASE / "artifacts" / "clean_hourly.csv", parse_dates=["timestamp"], index_col="timestamp")


class PredictInput(BaseModel):
    """Readings known before the hour we want to predict."""
    pollutant: Literal["CO", "NO2", "NOx", "C6H6"] = Field(..., description="Pollutant to predict")
    hour: int = Field(..., ge=0, le=23, description="Hour being predicted (0-23)")
    weekday: int = Field(..., ge=0, le=6, description="Day of week (0 = Monday)")
    lag_1: float = Field(..., ge=0, le=2000, description="Pollutant level 1 hour earlier")
    lag_2: Optional[float] = Field(None, ge=0, le=2000, description="Pollutant level 2 hours earlier")
    lag_3: Optional[float] = Field(None, ge=0, le=2000, description="Pollutant level 3 hours earlier")
    lag_24: Optional[float] = Field(None, ge=0, le=2000, description="Pollutant level 24 hours earlier")
    temperature: float = Field(..., ge=-10, le=50, description="Temperature in the previous hour (°C)")
    relative_humidity: float = Field(..., ge=0, le=100, description="Relative humidity in the previous hour (%)")
    absolute_humidity: float = Field(..., ge=0, le=3, description="Absolute humidity in the previous hour")
    observed: Optional[float] = Field(None, ge=0, le=2000, description="Optional: the actual measured value, to check for an episode")

    model_config = {"json_schema_extra": {"examples": [{
        "pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
        "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}]}}


@app.get("/")
def root():
    return {"message": "Air Quality Prediction API is running", "pollutants": POLLUTANTS,
            "docs": "/docs", "dashboard": "/dashboard/"}


@app.get("/health")
def health():
    return {"status": "ok", "models_loaded": list(models)}


@app.post("/predict")
def predict(data: PredictInput):
    row = pd.DataFrame([{f: getattr(data, f) for f in FEATURES}]).astype(float)  # None -> NaN (filled by the model)
    prediction = max(0.0, float(models[data.pollutant].predict(row)[0]))
    info = results[data.pollutant]
    response = {"pollutant": data.pollutant, "name": info["name"], "unit": info["unit"],
                "prediction": round(prediction, 3), "model": info["selected_model"]}
    if data.observed is not None:
        deviation = data.observed - prediction
        response["episode_check"] = {"observed": data.observed, "deviation": round(deviation, 3),
                                     "threshold": round(info["threshold"], 3),
                                     "flagged": abs(deviation) > info["threshold"]}
    return response


# ---- Data for the dashboard ------------------------------------------------------------------
@app.get("/api/pollutants")
def list_pollutants():
    return [{"key": p, "name": results[p]["name"], "unit": results[p]["unit"],
             "model": results[p]["selected_model"]} for p in POLLUTANTS]


@app.get("/api/results/{pollutant}")
def get_results(pollutant: str):
    if pollutant not in results:
        raise HTTPException(status_code=404, detail=f"Unknown pollutant '{pollutant}'. Use one of {POLLUTANTS}")
    return results[pollutant]


@app.get("/api/sample/{pollutant}")
def get_sample(pollutant: str):
    """A real hour from the test period, ready to send to /predict."""
    if pollutant not in results:
        raise HTTPException(status_code=404, detail=f"Unknown pollutant '{pollutant}'. Use one of {POLLUTANTS}")
    column = results[pollutant]["column"]
    for point in pd.DataFrame(results[pollutant]["test_predictions"]).sample(frac=1).itertuples():
        t = pd.Timestamp(point.t)
        lags = {k: hourly[column].get(t - pd.Timedelta(hours=k)) for k in (1, 2, 3, 24)}
        prev = hourly.loc[t - pd.Timedelta(hours=1), ["T", "RH", "AH"]]
        if pd.notna(list(lags.values())).all() and prev.notna().all():
            return {"time": t.isoformat(), "input": {
                "pollutant": pollutant, "hour": t.hour, "weekday": t.day_of_week,
                **{f"lag_{k}": float(v) for k, v in lags.items()},
                "temperature": float(prev["T"]), "relative_humidity": float(prev["RH"]),
                "absolute_humidity": float(prev["AH"]), "observed": float(point.actual)}}
    raise HTTPException(status_code=404, detail="No complete sample found")


app.mount("/dashboard", StaticFiles(directory=BASE / "frontend", html=True), name="dashboard")
