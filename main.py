"""FastAPI service for the Air Quality virtual-sensor model.

Start (from the project folder):
    python -m uvicorn main:app --reload

    GET  /          -> confirms the API is running
    GET  /health    -> health status
    POST /predict   -> CO estimate (+ optional anomaly check) from sensor JSON
    GET  /docs      -> interactive API documentation
    GET  /dashboard -> web dashboard (frontend/)
    GET  /api/...   -> data endpoints used by the dashboard
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from aq_features import INPUT_COLUMNS, build_inputs

BASE = Path(__file__).resolve().parent
ART = BASE / "artifacts"
log = logging.getLogger("air_quality_api")

app = FastAPI(
    title="Air Quality Prediction API",
    description="Virtual-sensor CO estimation and pollution episode detection on the UCI Air Quality dataset.",
    version="1.0.0",
)

# ---------------------------------------------------------------- load model + data once
model = joblib.load(BASE / "air_quality_model.pkl")
MODEL_INFO = json.loads((ART / "model_info.json").read_text(encoding="utf-8"))
SUMMARY = json.loads((ART / "summary.json").read_text(encoding="utf-8"))
METRICS = json.loads((ART / "metrics.json").read_text(encoding="utf-8"))
EPISODES = json.loads((ART / "episodes.json").read_text(encoding="utf-8"))
EPISODE_BY_ID = {e["id"]: e for e in EPISODES}
HOURLY = pd.read_csv(ART / "clean_hourly.csv", parse_dates=["timestamp"], index_col="timestamp").asfreq("h")
PRED = pd.read_csv(ART / "predictions.csv", parse_dates=["t"]).set_index("t")
INPUTS = build_inputs(HOURLY)
THRESHOLD = MODEL_INFO["threshold"]
RADIUS = MODEL_INFO["interval_radius"]
SENSOR_FIT = MODEL_INFO["sensor_fit"]

VARIABLES = {
    "CO(GT)": ("CO (reference)", "mg/m³", "pollutant"), "NMHC(GT)": ("NMHC (reference)", "µg/m³", "pollutant"),
    "C6H6(GT)": ("Benzene (reference)", "µg/m³", "pollutant"), "NOx(GT)": ("NOx (reference)", "ppb", "pollutant"),
    "NO2(GT)": ("NO2 (reference)", "µg/m³", "pollutant"), "PT08.S1(CO)": ("Sensor S1 (CO)", "sensor response", "sensor"),
    "PT08.S2(NMHC)": ("Sensor S2 (NMHC)", "sensor response", "sensor"), "PT08.S3(NOx)": ("Sensor S3 (NOx)", "sensor response", "sensor"),
    "PT08.S4(NO2)": ("Sensor S4 (NO2)", "sensor response", "sensor"), "PT08.S5(O3)": ("Sensor S5 (O3)", "sensor response", "sensor"),
    "T": ("Temperature", "°C", "weather"), "RH": ("Relative humidity", "%", "weather"), "AH": ("Absolute humidity", "g/m³", "weather"),
}


def clean(value):
    """JSON-safe conversion (NaN/inf -> None, numpy -> python)."""
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (np.floating, float)):
        return None if not np.isfinite(value) else float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


# ---------------------------------------------------------------- request schema (Pydantic)
class AirQualityInput(BaseModel):
    """One hour of readings. Field names must match the features used in training."""
    hour: int = Field(..., ge=0, le=23, description="Hour of day (0-23)")
    weekday: int = Field(..., ge=0, le=6, description="Day of week (0 = Monday)")
    pt08_s1_co: float = Field(..., ge=300, le=2500, description="Sensor S1 (CO) response at hour t")
    pt08_s2_nmhc: float = Field(..., ge=300, le=2500, description="Sensor S2 (NMHC) response")
    pt08_s3_nox: float = Field(..., ge=200, le=2800, description="Sensor S3 (NOx) response")
    pt08_s4_no2: float = Field(..., ge=300, le=3000, description="Sensor S4 (NO2) response")
    pt08_s5_o3: float = Field(..., ge=200, le=2800, description="Sensor S5 (O3) response")
    temperature: float = Field(..., ge=-10, le=50, description="Temperature (°C)")
    relative_humidity: float = Field(..., ge=0, le=100, description="Relative humidity (%)")
    absolute_humidity: float = Field(..., ge=0, le=3, description="Absolute humidity")
    co_lag_1: Optional[float] = Field(None, ge=0, le=20, description="Reference CO 1 h earlier (mg/m³)")
    co_lag_2: Optional[float] = Field(None, ge=0, le=20, description="Reference CO 2 h earlier")
    co_lag_3: Optional[float] = Field(None, ge=0, le=20, description="Reference CO 3 h earlier")
    co_lag_24: Optional[float] = Field(None, ge=0, le=20, description="Reference CO 24 h earlier")
    pt08_s1_co_prev: Optional[float] = Field(None, ge=300, le=2500, description="Sensor S1 1 h earlier")
    pt08_s2_nmhc_prev: Optional[float] = Field(None, ge=300, le=2500, description="Sensor S2 1 h earlier")
    pt08_s3_nox_prev: Optional[float] = Field(None, ge=200, le=2800, description="Sensor S3 1 h earlier")
    pt08_s4_no2_prev: Optional[float] = Field(None, ge=300, le=3000, description="Sensor S4 1 h earlier")
    pt08_s5_o3_prev: Optional[float] = Field(None, ge=200, le=2800, description="Sensor S5 1 h earlier")
    observed_co: Optional[float] = Field(None, ge=0, le=20, description="Optional observed reference CO at hour t; enables the anomaly check")

    model_config = {"json_schema_extra": {"examples": [{
        "hour": 8, "weekday": 3, "pt08_s1_co": 1310, "pt08_s2_nmhc": 1080, "pt08_s3_nox": 720, "pt08_s4_no2": 1350,
        "pt08_s5_o3": 1240, "temperature": 9.8, "relative_humidity": 62.0, "absolute_humidity": 0.75,
        "co_lag_1": 1.9, "co_lag_2": 1.4, "co_lag_3": 1.1, "co_lag_24": 2.3,
        "pt08_s1_co_prev": 1180, "pt08_s2_nmhc_prev": 960, "pt08_s3_nox_prev": 800, "pt08_s4_no2_prev": 1290,
        "pt08_s5_o3_prev": 1050, "observed_co": 2.6}]}}


def contributions(row: pd.DataFrame):
    """Per-feature contributions to the estimate (XGBoost SHAP values or linear terms)."""
    est = model.named_steps["model"]
    transformed = model[:-1].transform(row)
    names = list(model[:-1].get_feature_names_out())
    if hasattr(est, "get_booster"):
        import xgboost as xgb
        contrib = est.get_booster().predict(xgb.DMatrix(transformed), pred_contribs=True)[0]
        values, bias = contrib[:-1], float(contrib[-1])
    elif hasattr(est, "coef_"):
        values, bias = np.ravel(est.coef_) * transformed[0], float(np.ravel(est.intercept_)[0])
    else:
        return None
    rows = sorted(({"feature": n, "value": float(v)} for n, v in zip(names, values)), key=lambda r: -abs(r["value"]))
    return [{"feature": "baseline (average estimate)", "value": bias}] + rows[:14]


@app.get("/")
def root():
    return {"message": "Air Quality Prediction API is running", "model": MODEL_INFO["name"],
            "docs": "/docs", "dashboard": "/dashboard/", "endpoints": ["GET /", "GET /health", "POST /predict"]}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None, "model": MODEL_INFO["name"],
            "trained_at": MODEL_INFO["trained_at"]}


@app.post("/predict")
def predict(data: AirQualityInput):
    payload = data.model_dump()
    observed = payload.pop("observed_co")
    row = pd.DataFrame([{c: (np.nan if payload[c] is None else payload[c]) for c in INPUT_COLUMNS}])
    estimate = max(0.0, float(model.predict(row)[0]))      # concentrations cannot be negative
    imputed = [c for c in INPUT_COLUMNS if payload[c] is None]
    result = {
        "estimated_co_mg_m3": round(estimate, 4),
        "interval": {"lower": round(max(0.0, estimate - RADIUS), 4), "upper": round(estimate + RADIUS, 4),
                     "nominal_coverage": MODEL_INFO["interval_nominal"]},
        "model": MODEL_INFO["name"], "imputed_fields": imputed, "contributions": contributions(row), "anomaly": None,
    }
    if observed is not None:
        residual = observed - estimate
        flagged = abs(residual) > THRESHOLD
        hints = []
        if any(f.startswith("co_lag") for f in imputed):
            hints.append("Some earlier CO readings were missing and were filled with training medians.")
        lo, hi = SENSOR_FIT["training_range"]
        if not lo <= data.pt08_s1_co <= hi:
            hints.append("Sensor S1 is outside the range seen in training (possible saturation or fault).")
        sensor_line = SENSOR_FIT["slope"] * data.pt08_s1_co + SENSOR_FIT["intercept"]
        if abs(observed - sensor_line) > SENSOR_FIT["disagreement_threshold"]:
            hints.append("Observed CO disagrees with sensor S1's own calibration line (possible drift or fault).")
        hint = ("data_limitation_candidate" if hints else "unusual_pollution_candidate") if flagged else "normal"
        result["anomaly"] = {"observed": observed, "residual": round(residual, 4), "threshold": round(THRESHOLD, 4),
                             "flagged": bool(flagged), "classification_hint": hint, "hints": hints}
    return result


# ---------------------------------------------------------------- dashboard data endpoints
def parse_time(value: Optional[str], name: str):
    if value in (None, ""):
        return None
    try:
        return pd.Timestamp(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"Invalid {name}: use ISO format like 2005-02-10T08:00:00")


def thin(frame: pd.DataFrame, max_points: int, keep: Optional[pd.Series] = None):
    """Even-stride downsampling that always keeps flagged rows."""
    if len(frame) <= max_points:
        return frame, False
    step = int(np.ceil(len(frame) / max_points))
    mask = np.zeros(len(frame), dtype=bool)
    mask[::step] = True
    if keep is not None:
        mask |= keep.to_numpy(dtype=bool)
    return frame[mask], True


@app.get("/api/summary")
def api_summary():
    return SUMMARY


@app.get("/api/metrics")
def api_metrics():
    return METRICS


@app.get("/api/predictions")
def api_predictions(start: Optional[str] = None, end: Optional[str] = None,
                    max_points: int = Query(1500, ge=50, le=10000)):
    frame = PRED.loc[parse_time(start, "start"):parse_time(end, "end")]
    frame, downsampled = thin(frame, max_points, frame["flagged"])
    points = [clean({"t": t.isoformat(), **row}) for t, row in frame.iterrows()]
    for p in points:
        p.pop("sensor_estimate", None)
    return {"threshold": THRESHOLD, "downsampled": downsampled, "points": points}


@app.get("/api/episodes")
def api_episodes():
    return {"episodes": [{k: v for k, v in e.items() if k != "evidence"} for e in EPISODES]}


@app.get("/api/episodes/{episode_id}")
def api_episode(episode_id: str):
    ep = EPISODE_BY_ID.get(episode_id)
    if ep is None:
        raise HTTPException(status_code=404, detail=f"Episode {episode_id} not found")
    lo, hi = pd.Timestamp(ep["start"]) - pd.Timedelta(hours=48), pd.Timestamp(ep["end"]) + pd.Timedelta(hours=48)
    window = PRED.loc[lo:hi].join(HOURLY[["PT08.S1(CO)", "T", "RH", "AH"]], how="left")
    return {"episode": ep, "window": [clean({"t": t.isoformat(), **row}) for t, row in window.iterrows()]}


@app.get("/api/explorer/variables")
def api_variables():
    return {"variables": [{"key": k, "label": v[0], "unit": v[1], "group": v[2]} for k, v in VARIABLES.items()
                          if k in HOURLY.columns]}


def check_var(var: str):
    if var not in HOURLY.columns:
        raise HTTPException(status_code=422, detail=f"Unknown variable '{var}'. Use /api/explorer/variables.")
    return var


@app.get("/api/explorer/series")
def api_series(vars: str = "CO(GT)", start: Optional[str] = None, end: Optional[str] = None,
               max_points: int = Query(2000, ge=50, le=10000)):
    cols = [check_var(v.strip()) for v in vars.split(",") if v.strip()][:6]
    frame, _ = thin(HOURLY.loc[parse_time(start, "start"):parse_time(end, "end"), cols], max_points)
    return clean({"t": [t.isoformat() for t in frame.index], "series": {c: frame[c].tolist() for c in cols}})


@app.get("/api/explorer/correlation")
@lru_cache(maxsize=1)
def api_correlation():
    corr = HOURLY.corr()
    return clean({"variables": list(corr.columns), "matrix": corr.round(3).values.tolist()})


@app.get("/api/explorer/distribution")
def api_distribution(var: str = "CO(GT)"):
    return _distribution(check_var(var))


@lru_cache(maxsize=32)
def _distribution(var):
    s = HOURLY[var].dropna()
    counts, edges = np.histogram(s, bins=40)
    box = []
    for month, g in s.groupby(s.index.to_period("M")):
        q = g.quantile([0, .25, .5, .75, 1]).tolist()
        box.append({"month": str(month), "min": q[0], "q1": q[1], "median": q[2], "q3": q[3], "max": q[4]})
    return clean({"var": var, "unit": VARIABLES.get(var, ("", ""))[1], "histogram": {"edges": edges.tolist(),
                  "counts": counts.tolist()}, "monthly_box": box})


@app.get("/api/explorer/heatmap")
def api_heatmap(var: str = "CO(GT)"):
    s = HOURLY[check_var(var)]
    g = s.groupby([s.index.hour, s.index.day_of_week]).mean()
    return clean({"var": var, "cells": [[int(h), int(d), v] for (h, d), v in g.items()]})


@app.get("/api/explorer/calendar")
def api_calendar(var: str = "CO(GT)"):
    s = HOURLY[check_var(var)].resample("D").mean()
    return clean({"var": var, "days": [[d.strftime("%Y-%m-%d"), v] for d, v in s.items()]})


@app.get("/api/explorer/missing")
@lru_cache(maxsize=1)
def api_missing():
    weekly = HOURLY.isna().resample("W-MON", label="left", closed="left").mean() * 100
    cols = list(HOURLY.columns)
    cells = [[i, j, round(float(weekly.iloc[i, j]), 1)] for i in range(len(weekly)) for j in range(len(cols))]
    return {"variables": cols, "weeks": [w.strftime("%Y-%m-%d") for w in weekly.index], "cells": cells}


@app.get("/api/explorer/profiles")
def api_profiles(var: str = "CO(GT)"):
    s = HOURLY[check_var(var)]
    return clean({
        "hourly": [{"hour": int(k), "mean": v} for k, v in s.groupby(s.index.hour).mean().items()],
        "weekday": [{"weekday": int(k), "mean": v} for k, v in s.groupby(s.index.day_of_week).mean().items()],
        "monthly": [{"month": str(k), "mean": v} for k, v in s.groupby(s.index.to_period("M")).mean().items()],
    })


@app.get("/api/explorer/sensor_vs_reference")
@lru_cache(maxsize=1)
def api_sensor_vs_reference():
    pairs = HOURLY[["PT08.S1(CO)", "CO(GT)"]].dropna()
    slope, intercept = np.polyfit(pairs.iloc[:, 0], pairs.iloc[:, 1], 1)
    r2 = float(np.corrcoef(pairs.iloc[:, 0], pairs.iloc[:, 1])[0, 1] ** 2)
    sample = pairs.sample(n=min(3000, len(pairs)), random_state=42)
    drift = []
    for month, g in pairs.groupby(pairs.index.to_period("M")):
        if len(g) > 10:
            m_slope = np.polyfit(g.iloc[:, 0], g.iloc[:, 1], 1)[0]
            drift.append({"month": str(month), "slope": m_slope, "correlation": g.iloc[:, 0].corr(g.iloc[:, 1]), "n": len(g)})
    return clean({"points": sample.values.tolist(), "fit": {"slope": slope, "intercept": intercept, "r2": r2},
                  "drift": drift})


def sample_at(ts: pd.Timestamp):
    if ts not in INPUTS.index:
        raise HTTPException(status_code=404, detail=f"No data for {ts.isoformat()} (range {SUMMARY['dataset']['start']} – {SUMMARY['dataset']['end']})")
    row = INPUTS.loc[ts]
    if pd.isna(row["pt08_s1_co"]):
        raise HTTPException(status_code=404, detail=f"Sensors were offline at {ts.isoformat()}; pick another hour")
    values = {c: row[c] for c in INPUT_COLUMNS}
    values["hour"], values["weekday"] = int(values["hour"]), int(values["weekday"])
    return clean({"t": ts.isoformat(), "observed": HOURLY.at[ts, "CO(GT)"], "input": values})


@app.get("/api/samples")
def api_sample(t: str = Query(..., description="ISO timestamp, e.g. 2005-02-10T08:00:00")):
    return sample_at(parse_time(t, "t").floor("h"))


@app.get("/api/samples/random")
def api_sample_random():
    test = PRED[(PRED["period"] == "test") & PRED["observed"].notna()]
    return sample_at(test.sample(n=1).index[0])


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. Check the server log."})


FRONTEND = BASE / "frontend"
if FRONTEND.exists():
    app.mount("/dashboard", StaticFiles(directory=FRONTEND, html=True), name="dashboard")
