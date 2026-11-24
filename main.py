"""Small JSON-backed API for the supplied UCI Air Quality dataset.

Run from the project folder:
    python -m uvicorn main:app --reload

The app intentionally exposes one dataset only. Trained models and all
dashboard values are read from artifacts/uci-italy/*.json and models/uci-italy/.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
DATASET_ID = "uci-italy"
DATASET_TITLE = "UCI Air Quality — Italy"
ARTIFACTS = BASE / "artifacts" / DATASET_ID
MODELS = BASE / "models" / DATASET_ID


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(
    title="UCI Air Quality Prediction API",
    version="1.0.0",
    default_response_class=UTF8JSONResponse,
    description="JSON API for the supplied UCI Air Quality dataset only.",
)


@lru_cache(maxsize=8)
def load_results(pollutant: str) -> dict:
    path = ARTIFACTS / f"{pollutant}.json"
    if not path.exists():
        raise HTTPException(404, f"Unknown UCI pollutant: {pollutant}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=8)
def load_model(pollutant: str):
    path = MODELS / f"{pollutant}.pkl"
    if not path.exists():
        raise HTTPException(404, f"No trained model for pollutant: {pollutant}")
    return joblib.load(path)


POLLUTANTS = ("CO", "NO2", "NOx", "C6H6")


def pollutant_info(pollutant: str) -> dict:
    # Match the name in any case (nox, NOX, NOx). File names are case-sensitive on the Linux server.
    key = next((k for k in POLLUTANTS if k.lower() == pollutant.strip().lower()), None)
    if key is None:
        raise HTTPException(404, f"Unknown UCI pollutant: {pollutant}. Available: {', '.join(POLLUTANTS)}")
    return load_results(key)


def make_features(frame: pd.DataFrame, column: str, weather: dict[str, str]) -> pd.DataFrame:
    features = pd.DataFrame(index=frame.index)
    features["hour"] = frame.index.hour
    features["weekday"] = frame.index.dayofweek
    for lag in (1, 2, 3, 24):
        features[f"lag_{lag}"] = frame[column].shift(lag)
    for name, source in weather.items():
        features[name] = frame[source].shift(1)
    return features


class PredictInput(BaseModel):
    """Named feature values used by one UCI Italy pollutant model.

    Two ways to send them: flat, as in the Postman request ({"pollutant": "CO", "hour": 18, "lag_1": 2.4, ...}),
    or grouped under "features" as the web page does.
    """

    model_config = {"extra": "allow", "json_schema_extra": {"examples": [{
        "pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
        "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}]}}

    pollutant: str = Field(..., description="CO, NO2, NOx, or C6H6")
    features: dict[str, Optional[float]] = Field(default_factory=dict, description="Feature names and values from the selected model JSON")
    observed: Optional[float] = Field(None, ge=0, le=100000)


@app.get("/")
def root():
    return {"message": "UCI Air Quality Prediction API is running", "dataset": DATASET_ID,
            "docs": "/docs", "dashboard": "/dashboard/"}


@app.get("/health")
def health():
    return {"status": "ok", "dataset": DATASET_ID, "pollutants": [p["key"] for p in list_datasets()["pollutants"]]}


@app.get("/api/datasets")
def list_datasets():
    dataset = json.loads((ARTIFACTS / "dataset.json").read_text(encoding="utf-8"))
    dataset["id"] = DATASET_ID
    return {"id": DATASET_ID, "title": DATASET_TITLE, "rows": dataset.get("rows"),
            "start": dataset.get("start"), "end": dataset.get("end"),
            "weather": dataset.get("weather", {}), "pollutants": [
                {"pollutant": load_results(key)["pollutant"], "key": key,
                 "unit": load_results(key)["unit"], "model": load_results(key)["model"],
                 "test_MAE": round(next(m for m in load_results(key)["models"] if m["model"] == load_results(key)["model"])["test"]["MAE"], 3),
                 "test_R2": round(next(m for m in load_results(key)["models"] if m["model"] == load_results(key)["model"])["test"]["R2"], 3)}
                for key in ("CO", "NO2", "NOx", "C6H6") if (ARTIFACTS / f"{key}.json").exists()
            ]}


@app.post("/predict")
def predict(data: PredictInput):
    info = pollutant_info(data.pollutant)
    given = {k: v for k, v in (data.model_extra or {}).items() if k and k != "dataset"}   # flat (Postman) style
    given.update({k: v for k, v in data.features.items() if k})                           # grouped (web page) style
    unknown = sorted(set(given) - set(info["features"]))
    if unknown:
        raise HTTPException(422, f"Unknown feature name(s): {', '.join(unknown)}. Expected: {', '.join(info['features'])}")
    try:
        given = {k: None if v is None else float(v) for k, v in given.items()}
    except (TypeError, ValueError):
        raise HTTPException(422, "Every feature value must be a number (or null).")
    required = ["hour", "weekday", "lag_1"]
    missing = [feature for feature in required if given.get(feature) is None]
    if missing:
        raise HTTPException(422, f"Missing required feature name(s): {', '.join(missing)}")
    values = {feature: given.get(feature) for feature in info["features"]}
    if not 0 <= values["hour"] <= 23 or not 0 <= values["weekday"] <= 6:
        raise HTTPException(422, "hour must be 0–23 and weekday must be 0–6")
    row = pd.DataFrame([values]).astype(float)
    model = load_model(info["pollutant"])
    prediction = max(0.0, float(row["lag_1"].iloc[0] + model.predict(row)[0]))
    answer = {"dataset": DATASET_ID, "pollutant": info["pollutant"], "unit": info["unit"],
              "prediction": round(prediction, 3), "model": info["model"]}
    if data.observed is not None:
        deviation = data.observed - prediction
        answer["episode_check"] = {"observed": data.observed, "deviation": round(deviation, 3),
                                    "threshold": round(info["threshold"], 3),
                                    "flagged": abs(deviation) > info["threshold"]}
    return answer


@app.get("/api/results/{pollutant}")
def get_results(pollutant: str):
    return pollutant_info(pollutant)


@app.get("/api/report/{pollutant}")
def get_report(pollutant: str, download: bool = False):
    report = pollutant_info(pollutant) | {"dataset": DATASET_TITLE}
    if not download:
        return report
    return Response(json.dumps(report, indent=2, ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="uci-italy-{pollutant}-report.json"'})


@lru_cache(maxsize=1)
def dataset_frame() -> pd.DataFrame:
    return pd.read_csv(ARTIFACTS / "data.csv", parse_dates=["timestamp"], index_col="timestamp").asfreq("h")


@lru_cache(maxsize=4)
def forecast_table(key: str) -> dict:
    """Forecasts 1, 2 and 3 hours ahead from every hour of the test period, using only what was known then.

    The model predicts one hour ahead. For 2 and 3 hours ahead, its own forecast is fed back in as the
    "value 1 hour before", and the weather stays at the last known hour (no peeking at future weather).
    """
    info = load_results(key)
    df = dataset_frame()
    y = df[info["column"]]
    weather = json.loads((ARTIFACTS / "dataset.json").read_text(encoding="utf-8"))["weather"]
    model = load_model(key)
    hour = pd.Timedelta(hours=1)
    test_from, test_to = (pd.Timestamp(t) for t in info["periods"]["test"])
    origins = pd.date_range(test_from - hour, test_to - hour, freq="h")    # "now" moments; targets fall in the test period
    known = lambda steps: y.reindex(origins + steps * hour).to_numpy()   # real value `steps` hours from now (0 = now)

    forecasts = {}
    for step in (1, 2, 3):
        target = origins + step * hour
        X = pd.DataFrame({"hour": target.hour, "weekday": target.dayofweek}, index=origins)
        for lag in (1, 2, 3, 24):
            ahead = step - lag                     # >= 1 means that hour is still in the future: use our forecast
            X[f"lag_{lag}"] = forecasts[ahead] if ahead >= 1 else known(ahead)
        for name, column in weather.items():
            X[name] = df[column].reindex(origins).to_numpy()
        X = X[info["features"]].astype(float)
        forecasts[step] = (X["lag_1"].to_numpy() + model.predict(X)).clip(min=0)

    def mae(predicted, actual):
        ok = ~(np.isnan(predicted) | np.isnan(actual))
        return round(float(np.abs(predicted[ok] - actual[ok]).mean()), 4)

    clean = lambda values: [None if np.isnan(v) else round(float(v), 4) for v in values]
    now = known(0)
    return {
        "pollutant": info["pollutant"], "unit": info["unit"], "model": info["model"],
        "times": [t.strftime("%Y-%m-%dT%H:%M") for t in origins],
        "now": clean(now), "f1": clean(forecasts[1]), "f2": clean(forecasts[2]), "f3": clean(forecasts[3]),
        "mae": {str(s): mae(forecasts[s], known(s)) for s in (1, 2, 3)},
        "simple_guess_mae": {str(s): mae(now, known(s)) for s in (1, 2, 3)},
    }


@app.get("/api/forecast/{pollutant}")
def get_forecast(pollutant: str):
    """1, 2 and 3 hours ahead for every hour of the test period (the part the model never saw)."""
    return forecast_table(pollutant_info(pollutant)["pollutant"])


@app.get("/api/sample/{pollutant}")
def get_sample(pollutant: str):
    info = pollutant_info(pollutant)
    df = dataset_frame()
    weather = json.loads((ARTIFACTS / "dataset.json").read_text(encoding="utf-8"))["weather"]
    features = make_features(df, info["column"], weather)
    test_times = pd.to_datetime([p["t"] for p in info["test_predictions"]])
    complete = features.loc[features.index.intersection(test_times)].dropna()
    if complete.empty:
        raise HTTPException(404, "No complete sample found")
    t = complete.index[0]
    values = {key: (int(value) if key in ("hour", "weekday") else float(value)) for key, value in complete.loc[t].items()}
    return {"time": t.isoformat(), "pollutant": info["pollutant"], "features": values,
            "observed": float(df.at[t, info["column"]])}


@app.get("/api/episodes/{pollutant}")
def episodes_csv(pollutant: str):
    info = pollutant_info(pollutant)
    rows = pd.DataFrame([{
        "start": e["start"], "end": e["end"], "hours_flagged": e.get("flagged_hours"),
        "type": e.get("type"), "confidence": e.get("confidence"),
        "peak_value": e.get("peak_value"), "expected_value": e.get("expected_value"),
        "why": e.get("explanation") or e.get("reason"),
    } for e in info["episodes"]])
    return Response("\ufeff" + rows.to_csv(index=False), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="uci-italy-{pollutant}-episodes.csv"'})


app.mount("/dashboard", StaticFiles(directory=BASE / "frontend", html=True), name="dashboard")
