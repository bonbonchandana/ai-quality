from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "research" / "data" / "clean.csv"
OUT = ROOT / "research" / "output"
MODEL = ROOT / "research" / "models" / "co_nowcast.joblib"

df = pd.read_csv(DATA, parse_dates=["timestamp"]).set_index("timestamp")
metadata = json.loads((OUT / "model_metadata.json").read_text(encoding="utf-8"))
summary = json.loads((OUT / "summary.json").read_text(encoding="utf-8"))
model = joblib.load(MODEL)
predictions = json.loads((OUT / "predictions.json").read_text(encoding="utf-8"))
episodes = json.loads((OUT / "episodes.json").read_text(encoding="utf-8"))
metrics = pd.read_csv(OUT / "metrics.csv").replace({np.nan: None}).to_dict(orient="records")
features = metadata["features"]

app = FastAPI(title="Air Quality Analytics API", version="1.0.0", docs_url="/docs")
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])


def downsample(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    if len(rows) <= max_points:
        return rows
    ix = np.linspace(0, len(rows) - 1, max_points, dtype=int)
    return [rows[i] for i in ix]


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    y = frame["CO(GT)"]
    X = pd.DataFrame(index=frame.index)
    for lag in [1, 2, 3, 24, 168]:
        X[f"co_lag_{lag}"] = y.shift(lag)
    for w in [3, 24, 168]:
        X[f"co_mean_{w}"] = y.shift(1).rolling(w, min_periods=1).mean()
        X[f"co_std_{w}"] = y.shift(1).rolling(w, min_periods=2).std()
    X["co_diff_1_2"] = y.shift(1) - y.shift(2)
    sensors = [c for c in frame if c.startswith("PT08.")]
    for c in sensors + ["T", "RH", "AH"]:
        for lag in [0, 1, 2, 24]:
            X[f"{c}_lag_{lag}"] = frame[c].shift(lag)
        X[c + "_diff"] = frame[c].shift(1) - frame[c].shift(2)
        for w in [3, 24]:
            X[c + f"_mean_{w}"] = frame[c].rolling(w, min_periods=1).mean()
            X[c + f"_std_{w}"] = frame[c].rolling(w, min_periods=2).std()
    X["hour_sin"] = np.sin(2 * np.pi * frame.index.hour / 24)
    X["hour_cos"] = np.cos(2 * np.pi * frame.index.hour / 24)
    X["weekday_sin"] = np.sin(2 * np.pi * frame.index.dayofweek / 7)
    X["weekday_cos"] = np.cos(2 * np.pi * frame.index.dayofweek / 7)
    X["lag_missing_count"] = X.isna().sum(axis=1)
    return X.reindex(columns=features)


class PredictRequest(BaseModel):
    timestamp: datetime
    co_lag_1: float = Field(..., ge=0, le=100)
    co_lag_2: float = Field(..., ge=0, le=100)
    co_lag_3: float = Field(..., ge=0, le=100)
    co_lag_24: float = Field(..., ge=0, le=100)
    co_lag_168: float = Field(..., ge=0, le=100)
    sensors: dict[str, float] = Field(default_factory=dict)
    weather: dict[str, float] = Field(default_factory=dict)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model": metadata["model"], "rows": len(df)}


@app.get("/api/metadata")
def get_metadata() -> dict[str, Any]:
    return {"dataset": "UCI Air Quality", "pollutant": "CO(GT)", "units": "mg/m3", "periods": summary["splits"], "framing": "nowcast", "note": "Estimated vs observed; this is not a forecast."}


@app.get("/api/metrics")
def get_metrics() -> dict[str, Any]:
    return {"rows": metrics, "summary": summary, "team_models": {"co_linear_regression_no_lags": "Team baseline: Linear Regression (no lags)", "no2_random_forest": "Explored approach; not promoted until gate is recomputed"}}


@app.get("/api/predictions")
def get_predictions(start: str | None = None, end: str | None = None, split: Literal["all", "test", "validation"] = "all", max_points: int = Query(1000, ge=10, le=10000)) -> dict[str, Any]:
    rows = predictions
    if start:
        rows = [r for r in rows if r["timestamp"] >= start]
    if end:
        rows = [r for r in rows if r["timestamp"] <= end]
    if split != "all":
        period = summary["splits"][split]
        rows = [r for r in rows if period[0] <= r["timestamp"].replace("T", " ") <= period[1]]
    return {"data": downsample(rows, max_points), "total": len(rows), "downsampled": len(rows) > max_points}


@app.get("/api/episodes")
def get_episodes() -> dict[str, Any]:
    return {"data": episodes, "total": len(episodes)}


@app.get("/api/episodes/{episode_id}")
def get_episode(episode_id: str) -> dict[str, Any]:
    item = next((e for e in episodes if e["id"] == episode_id), None)
    if not item:
        raise HTTPException(404, "Episode not found")
    lo = pd.Timestamp(item["start"]) - pd.Timedelta(hours=12)
    hi = pd.Timestamp(item["end"]) + pd.Timedelta(hours=12)
    window = df.loc[lo:hi].reset_index().replace({np.nan: None}).to_dict(orient="records")
    return {"episode": item, "window": window}


@app.get("/api/explorer/series")
def series(columns: str = "CO(GT),PT08.S1(CO)", max_points: int = Query(1000, ge=10, le=10000)) -> dict[str, Any]:
    wanted = [c for c in columns.split(",") if c in df.columns]
    rows = df[wanted].reset_index().replace({np.nan: None}).to_dict(orient="records")
    return {"columns": wanted, "data": downsample(rows, max_points)}


@app.get("/api/explorer/correlation")
def correlation() -> dict[str, Any]:
    c = df.corr(numeric_only=True)
    return {"columns": list(c.columns), "values": c.round(4).replace({np.nan: None}).values.tolist()}


@app.get("/api/explorer/missing")
def missing() -> dict[str, Any]:
    return {"data": pd.read_csv(OUT / "missingness.csv").replace({np.nan: None}).to_dict(orient="records")}


@app.get("/api/explorer/profiles")
def profiles() -> dict[str, Any]:
    y = df["CO(GT)"]
    return {"hour": y.groupby(df.index.hour).mean().round(4).to_dict(), "weekday": y.groupby(df.index.dayofweek).mean().round(4).to_dict(), "month": y.groupby(df.index.month).mean().round(4).to_dict()}


@app.post("/api/predict")
def predict(request: PredictRequest) -> dict[str, Any]:
    if request.timestamp not in df.index:
        raise HTTPException(400, "timestamp must be an hourly timestamp present in the dataset")
    frame = df.copy()
    frame.loc[request.timestamp, "CO(GT)"] = request.co_lag_1
    for key, value in {**request.sensors, **request.weather}.items():
        if key not in frame.columns:
            raise HTTPException(400, f"unknown sensor or weather field: {key}")
        frame.loc[request.timestamp, key] = value
    X = feature_frame(frame).loc[[request.timestamp]]
    estimated = float(model.predict(X)[0])
    return {"timestamp": request.timestamp.isoformat(), "estimate": estimated, "unit": "mg/m3", "observed": None if pd.isna(df.loc[request.timestamp, "CO(GT)"]) else float(df.loc[request.timestamp, "CO(GT)"]), "imputed_feature_count": int(X.isna().sum(axis=1).iloc[0]), "contributions": {"model": "Ridge", "features": []}}


if (ROOT / "frontend" / "dist").exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=ROOT / "frontend" / "dist", html=True), name="frontend")
