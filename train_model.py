"""Train, evaluate, tune and save the CO virtual-sensor model.

Run from the project folder:
    .venv\\Scripts\\python train_model.py

ML workflow steps covered here (see the 16-step flow):
  1 Problem definition   2 Data collection   3 Preprocessing   4 EDA
  5 Feature engineering  6 Model selection   7 Training        8 Evaluation
  9 Hyperparameter tuning                    10 Model saving (air_quality_model.pkl)
"""
from __future__ import annotations

import io
import json
import time
import warnings
import zipfile
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import ParameterGrid
from sklearn.neighbors import KNeighborsRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from aq_features import INPUT_COLUMNS, add_engineered_features, build_inputs, engineered_feature_names

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parent
RAW_ZIP = ROOT / "research" / "data" / "air-quality.zip"
ART = ROOT / "artifacts"
MODEL_PATH = ROOT / "air_quality_model.pkl"
ART.mkdir(exist_ok=True)
SOURCE_URL = "https://archive.ics.uci.edu/dataset/360/air+quality"
TARGET = "CO(GT)"
SEED = 42


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Step 1 - Problem definition
# Estimate the reference CO concentration (mg/m3) at hour t from low-cost sensor
# readings, weather and earlier CO readings ("virtual sensor" nowcast), evaluate on
# future periods, and flag/explain hours where observations differ from the estimate.
# ---------------------------------------------------------------------------

# Step 2 - Data collection (UCI Air Quality)
# Order: data/AirQualityUCI.csv (drop your copy here) -> research/data/air-quality.zip -> download from UCI.
DATA_CSV = ROOT / "data" / "AirQualityUCI.csv"
if DATA_CSV.exists():
    raw = pd.read_csv(DATA_CSV, sep=";", decimal=",")
    source = DATA_CSV
else:
    if not RAW_ZIP.exists():
        import urllib.request
        RAW_ZIP.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve("https://archive.ics.uci.edu/static/public/360/air+quality.zip", RAW_ZIP)
    raw = pd.read_csv(io.BytesIO(zipfile.ZipFile(RAW_ZIP).read("AirQualityUCI.csv")), sep=";", decimal=",")
    source = RAW_ZIP
raw.columns = raw.columns.str.strip()
missing_cols = {"Date", "Time", "CO(GT)", "PT08.S1(CO)", "T", "RH", "AH"} - set(raw.columns)
assert not missing_cols, (f"{source.name} is not in the original UCI format (missing {sorted(missing_cols)}). "
                          "Use the original AirQualityUCI.csv (';' separated, ',' decimals).")
log(f"Loaded raw data from {source.relative_to(ROOT)}: {raw.shape}")

# Step 3 - Preprocessing
df = raw.dropna(subset=["Date", "Time"]).copy()
ts = pd.to_datetime(df["Date"] + " " + df["Time"], format="%d/%m/%Y %H.%M.%S")
df = df.drop(columns=["Date", "Time"]).dropna(axis=1, how="all")
df = df.replace(-200, np.nan)                     # -200 is the dataset's missing-value code
df.index = pd.DatetimeIndex(ts, name="timestamp")
df = df.sort_index()
assert not df.index.duplicated().any()
df = df.asfreq("h")                               # continuous hourly grid (missing hours -> NaN)
df.to_csv(ART / "clean_hourly.csv")
n = len(df)
y = df[TARGET]
log(f"Hourly grid: {n} rows, {df.index.min()} -> {df.index.max()}")


def runs(mask):
    """(start, end) index pairs of consecutive True values."""
    m = np.r_[False, np.asarray(mask, dtype=bool), False].astype(int)
    edges = np.flatnonzero(np.diff(m))
    return [(int(a), int(b)) for a, b in edges.reshape(-1, 2)]


# Step 4 - EDA summary (the dashboard computes interactive EDA from clean_hourly.csv)
missing = []
for col in df.columns:
    gaps = [b - a for a, b in runs(df[col].isna())]
    missing.append({"variable": col, "missing": int(df[col].isna().sum()),
                    "percent": round(float(df[col].isna().mean() * 100), 2),
                    "longest_gap_hours": int(max(gaps or [0]))})

# Step 5 - Feature engineering (lags + cyclical time; see aq_features.py)
X_now = build_inputs(df, shift_sensors=0)         # nowcast: sensors at t
X_fc = build_inputs(df, shift_sensors=1)          # forecast: sensors at t-1 (framing comparison)
sensor_ok = df["PT08.S1(CO)"].notna().to_numpy()
y_ok = y.notna().to_numpy()
base_ok = X_now["co_lag_1"].notna().to_numpy() & X_now["co_lag_24"].notna().to_numpy()

# Chronological splits on the hourly grid (never shuffled)
P = {k: int(n * v) for k, v in {"f1": .40, "f2": .50, "f3": .60, "cal": .70, "test": .80}.items()}
FOLDS = [("fold_1", P["f1"], P["f2"]), ("fold_2", P["f2"], P["f3"]), ("fold_3", P["f3"], P["cal"])]
START = 24


def train_idx(end):
    i = np.arange(START, end)
    return i[y_ok[i] & sensor_ok[i]]


def eval_idx(lo, hi):
    """Rows scored for every method: observed target, sensors present, baselines defined."""
    i = np.arange(lo, hi)
    return i[y_ok[i] & sensor_ok[i] & base_ok[i]]


def metrics(true, pred):
    true, pred = np.asarray(true, float), np.asarray(pred, float)
    return {"MAE": float(mean_absolute_error(true, pred)),
            "RMSE": float(np.sqrt(mean_squared_error(true, pred))),
            "R2": float(r2_score(true, pred)), "n": int(len(true))}


def mean_metrics(fold_rows):
    return {k: float(np.mean([f[k] for f in fold_rows])) for k in ("MAE", "RMSE", "R2")}


def make_pipeline(estimator):
    return Pipeline([
        ("features", FunctionTransformer(add_engineered_features, feature_names_out=engineered_feature_names)),
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", estimator),
    ])


# Step 6 - Model selection: candidate algorithms, defaults and tuning grids (step 9)
GPU = True
try:
    from xgboost import XGBRegressor
    XGBRegressor(n_estimators=2, device="cuda").fit(np.random.rand(50, 3), np.random.rand(50))
except Exception as exc:  # GPU or xgboost unavailable -> CPU fallback
    log(f"CUDA XGBoost unavailable ({exc}); using CPU")
    GPU = False
    from xgboost import XGBRegressor
DEVICE = "cuda" if GPU else "cpu"

CANDIDATES = {
    "Linear Regression": dict(make=lambda **p: LinearRegression(), default={}, grid=None, device=None),
    "Ridge": dict(make=lambda **p: Ridge(**p), default={"alpha": 1.0},
                  grid={"alpha": [0.1, 1, 3, 10, 30, 100]}, device=None),
    "KNN": dict(make=lambda **p: KNeighborsRegressor(**p), default={"n_neighbors": 5, "weights": "uniform"},
                grid={"n_neighbors": [5, 10, 20, 40], "weights": ["uniform", "distance"]}, device=None),
    "Random Forest": dict(make=lambda **p: RandomForestRegressor(random_state=SEED, n_jobs=2, **p),
                          default={"n_estimators": 100},
                          grid={"n_estimators": [200], "max_depth": [8, 14, None], "min_samples_leaf": [1, 5]},
                          device=None),
    "XGBoost": dict(make=lambda **p: XGBRegressor(random_state=SEED, device=DEVICE, tree_method="hist",
                                                  n_jobs=2, verbosity=0, **p),
                    default={"n_estimators": 100},
                    grid={"n_estimators": [300, 600], "max_depth": [3, 5], "learning_rate": [0.03, 0.08],
                          "subsample": [0.8], "colsample_bytree": [0.8]},
                    device=DEVICE),
}


def run_folds(name, params, X=X_now):
    rows, preds = [], {}
    for fold, lo, hi in FOLDS:
        tr, ev = train_idx(lo), eval_idx(lo, hi)
        model = make_pipeline(CANDIDATES[name]["make"](**params))
        model.fit(X.iloc[tr], y.iloc[tr])
        p = model.predict(X.iloc[ev])
        rows.append({"fold": fold, **metrics(y.iloc[ev], p)})
        preds[fold] = (ev, p)
    return rows, preds


# Step 7/8/9 - train on each rolling fold, evaluate, tune on validation folds only
results, tuning, fold_preds = {}, [], {}
for name, spec in CANDIDATES.items():
    t0 = time.time()
    default_rows, _ = run_folds(name, spec["default"])
    best_params, best_rows = spec["default"], default_rows
    if spec["grid"]:
        for params in ParameterGrid(spec["grid"]):
            rows, _ = run_folds(name, params)
            if mean_metrics(rows)["MAE"] < mean_metrics(best_rows)["MAE"]:
                best_params, best_rows = params, rows
        tuning.append({"model": name, "default_validation_MAE": mean_metrics(default_rows)["MAE"],
                       "tuned_validation_MAE": mean_metrics(best_rows)["MAE"], "best_params": best_params})
    results[name] = {"params": best_params, "folds": best_rows, "tuned": bool(spec["grid"])}
    log(f"{name:18s} validation MAE {mean_metrics(best_rows)['MAE']:.4f}  params={best_params}  ({time.time()-t0:.1f}s)")

ranking = sorted(results, key=lambda m: mean_metrics(results[m]["folds"])["MAE"])
SELECTED = ranking[0]
sel_params = results[SELECTED]["params"]
log(f"Selected on validation only: {SELECTED} {sel_params}")

# Final model: train on everything before the calibration period, then frozen.
tr_final = train_idx(P["cal"])
final_estimators = {}
for name in results:
    m = make_pipeline(CANDIDATES[name]["make"](**results[name]["params"]))
    m.fit(X_now.iloc[tr_final], y.iloc[tr_final])
    final_estimators[name] = m
final = final_estimators[SELECTED]

# Baselines and the team's notebook model (sensors + weather + calendar, no lags)
test_ev = eval_idx(P["test"], n)
cal_ev = eval_idx(P["cal"], P["test"])
baselines = {"Persistence (previous hour)": "co_lag_1", "Seasonal naive (same hour yesterday)": "co_lag_24"}


def team_frame(idx):
    t = df.index[idx]
    out = pd.DataFrame({
        "Hour": t.hour, "Month": t.month, "IsWeekend": (t.day_of_week >= 5).astype(int),
        "Hour_sin": np.sin(2 * np.pi * t.hour / 24), "Hour_cos": np.cos(2 * np.pi * t.hour / 24),
        "Day_sin": np.sin(2 * np.pi * t.day_of_week / 7), "Day_cos": np.cos(2 * np.pi * t.day_of_week / 7),
    }, index=t)
    for c in ["T", "RH", "AH", "PT08.S1(CO)", "PT08.S2(NMHC)", "PT08.S3(NOx)", "PT08.S4(NO2)", "PT08.S5(O3)"]:
        out[c] = df[c].to_numpy()[idx]
    return out


def team_model():
    return Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()),
                     ("model", LinearRegression())])


model_rows = []
for name in results:
    model_rows.append({"model": name, "family": "model", "tuned": results[name]["tuned"],
                       "params": results[name]["params"], "device": CANDIDATES[name]["device"],
                       "folds": results[name]["folds"], "validation_mean": mean_metrics(results[name]["folds"]),
                       "test": metrics(y.iloc[test_ev], final_estimators[name].predict(X_now.iloc[test_ev]))})
for name, col in baselines.items():
    folds = [{"fold": f, **metrics(y.iloc[eval_idx(lo, hi)], X_now[col].iloc[eval_idx(lo, hi)])} for f, lo, hi in FOLDS]
    model_rows.append({"model": name, "family": "baseline", "tuned": False, "params": {}, "device": None,
                       "folds": folds, "validation_mean": mean_metrics(folds),
                       "test": metrics(y.iloc[test_ev], X_now[col].iloc[test_ev])})
team_folds = []
for f, lo, hi in FOLDS:
    tm = team_model().fit(team_frame(train_idx(lo)), y.iloc[train_idx(lo)])
    team_folds.append({"fold": f, **metrics(y.iloc[eval_idx(lo, hi)], tm.predict(team_frame(eval_idx(lo, hi))))})
tm = team_model().fit(team_frame(tr_final), y.iloc[tr_final])
model_rows.append({"model": "Team notebook: Linear Regression (no lags)", "family": "team", "tuned": False,
                   "params": {}, "device": None, "folds": team_folds, "validation_mean": mean_metrics(team_folds),
                   "test": metrics(y.iloc[test_ev], tm.predict(team_frame(test_ev)))})

# Framing comparison: same tuned settings, sensors at t (nowcast) vs t-1 (forecast)
framing = []
for name in [SELECTED, "XGBoost", "Ridge"]:
    if any(f["model"] == name for f in framing):
        continue
    for label, X in (("nowcast", X_now), ("forecast", X_fc)):
        rows, _ = run_folds(name, results[name]["params"], X)
        m = make_pipeline(CANDIDATES[name]["make"](**results[name]["params"])).fit(X.iloc[tr_final], y.iloc[tr_final])
        framing.append({"framing": label, "model": name, "validation_MAE": mean_metrics(rows)["MAE"],
                        "test_MAE": metrics(y.iloc[test_ev], m.predict(X.iloc[test_ev]))["MAE"]})

# Calibration period -> conformal 90% interval radius and episode threshold
cal_res = np.abs(y.iloc[cal_ev].to_numpy() - final.predict(X_now.iloc[cal_ev]))
k = min(len(cal_res), int(np.ceil((len(cal_res) + 1) * 0.90)))
interval_radius = float(np.sort(cal_res)[k - 1])
threshold = float(np.quantile(cal_res, 0.95))

# Out-of-sample timeline: walk-forward fold models + frozen final model on calibration/test
_, sel_fold_preds = run_folds(SELECTED, sel_params)
period = np.full(n, "", dtype=object)
estimate = np.full(n, np.nan)
for fold, lo, hi in FOLDS:
    period[lo:hi] = fold
    idx = np.arange(lo, hi)[sensor_ok[lo:hi]]
    m = make_pipeline(CANDIDATES[SELECTED]["make"](**sel_params)).fit(X_now.iloc[train_idx(lo)], y.iloc[train_idx(lo)])
    estimate[idx] = m.predict(X_now.iloc[idx])
period[P["cal"]:P["test"]] = "calibration"
period[P["test"]:] = "test"
idx = np.arange(P["cal"], n)[sensor_ok[P["cal"]:]]
estimate[idx] = final.predict(X_now.iloc[idx])

# Episode evidence (data-quality rules use the TRAINING period only for their reference values)
train_pairs = df.iloc[START:P["cal"]][["PT08.S1(CO)", TARGET]].dropna()
coef = np.polyfit(train_pairs["PT08.S1(CO)"], train_pairs[TARGET], 1)
s_res = np.abs(train_pairs[TARGET] - np.polyval(coef, train_pairs["PT08.S1(CO)"]))
disagree_thr = float(s_res.quantile(0.99))
s_min, s_max = float(train_pairs["PT08.S1(CO)"].min()), float(train_pairs["PT08.S1(CO)"].max())
sensor_est = np.polyval(coef, df["PT08.S1(CO)"].to_numpy())
observed = y.to_numpy()
residual = observed - estimate
imputed_inputs = X_now[["co_lag_1", "co_lag_2", "co_lag_3", "co_lag_24"]].isna().sum(axis=1).to_numpy()
prior_missing = np.zeros(n, dtype=int)
for j in range(1, n):
    prior_missing[j] = prior_missing[j - 1] + 1 if np.isnan(observed[j - 1]) else 0
out_of_range = (df["PT08.S1(CO)"].to_numpy() < s_min) | (df["PT08.S1(CO)"].to_numpy() > s_max)
disagreement = np.abs(observed - sensor_est) > disagree_thr
drift = (pd.Series(np.where(np.isnan(observed), np.nan, disagreement.astype(float)))
         .shift(1).rolling(168, min_periods=24).mean().fillna(0).to_numpy() > 0.25)
has_est = ~np.isnan(estimate) & (period != "")
flagged = has_est & ~np.isnan(observed) & (np.abs(residual) > threshold)

episodes = []
merged = []
for a, b in runs(flagged):                     # merge flagged runs separated by <= 2 hours
    if merged and a - merged[-1][1] <= 2:
        merged[-1] = (merged[-1][0], b)
    else:
        merged.append((a, b))
for a, b in merged:
    sl = slice(a, b)
    ev = {"imputed_input_hours": int((imputed_inputs[sl] > 0).sum()),
          "max_prior_co_missing_hours": int(prior_missing[sl].max()),
          "sensor_out_of_range_hours": int(out_of_range[sl].sum()),
          "sensor_disagreement_hours": int(disagreement[sl].sum()),
          "drift_flag_hours": int(drift[sl].sum())}
    reasons = []
    if ev["imputed_input_hours"]:
        reasons.append(f"{ev['imputed_input_hours']} h had missing CO history filled with training medians.")
    if ev["max_prior_co_missing_hours"]:
        reasons.append(f"Preceded by a CO data gap of up to {ev['max_prior_co_missing_hours']} h.")
    if ev["sensor_out_of_range_hours"]:
        reasons.append("Sensor PT08.S1 outside its training range (possible saturation or fault).")
    if ev["drift_flag_hours"]:
        reasons.append("Sensor and reference disagreed for >25% of the previous 7 days (possible drift).")
    elif ev["sensor_disagreement_hours"]:
        reasons.append("Reference CO disagrees with the sensor's own calibration line beyond the training 99th percentile.")
    cls = "data_limitation_candidate" if reasons else "unusual_pollution_candidate"
    if not reasons:
        reasons = ["Inputs complete and sensors consistent, yet observed CO departs from the estimate: "
                   "a genuine unusual pollution event is the leading explanation (cause unverified)."]
    peak = float(np.nanmax(np.abs(residual[sl])))
    episodes.append({"id": f"EP{len(episodes)+1:03d}", "start": df.index[a].isoformat(), "end": df.index[b-1].isoformat(),
                     "hours": b - a, "severity": "high" if peak > 2 * threshold else "moderate",
                     "classification": cls, "reason": " ".join(reasons), "peak_abs_residual": peak,
                     "period": str(period[a]), "direction": "above" if np.nanmean(residual[sl]) > 0 else "below",
                     "evidence": ev})

# Test diagnostics for the dashboard
t_true, t_pred = y.iloc[test_ev].to_numpy(), final.predict(X_now.iloc[test_ev])
t_res = t_true - t_pred
test_times = df.index[test_ev]
err_hour = pd.Series(np.abs(t_res)).groupby(test_times.hour).mean()
err_month = pd.Series(np.abs(t_res)).groupby(test_times.to_period("M").astype(str)).mean()
counts, edges = np.histogram(t_res, bins=40)
in_band = np.abs(t_res) <= interval_radius

# Permutation importance on the calibration period (model was fitted before it)
imp = permutation_importance(final, X_now.iloc[cal_ev], y.iloc[cal_ev], scoring="neg_mean_absolute_error",
                             n_repeats=5, random_state=SEED, n_jobs=1)
importance = sorted([{"feature": c, "importance": float(v)} for c, v in zip(INPUT_COLUMNS, imp.importances_mean)],
                    key=lambda r: -r["importance"])
coefficients = None
if hasattr(final.named_steps["model"], "coef_"):
    names = final[:-1].get_feature_names_out()
    coefficients = sorted([{"feature": str(f), "value": float(v)} for f, v in zip(names, final.named_steps["model"].coef_)],
                          key=lambda r: -abs(r["value"]))

# Step 10 - Model saving (serve on CPU for portability)
if SELECTED == "XGBoost":
    final.named_steps["model"].set_params(device="cpu")
joblib.dump(final, MODEL_PATH)
reloaded = joblib.load(MODEL_PATH)
check = X_now.iloc[test_ev[:20]]
assert np.allclose(reloaded.predict(check), final.predict(check), atol=1e-6), "Reloaded model mismatch"
log(f"Saved {MODEL_PATH.name} and verified reload")

sel_row = next(r for r in model_rows if r["model"] == SELECTED)
pers_row = next(r for r in model_rows if r["family"] == "baseline" and "Persistence" in r["model"])
improvement = (1 - sel_row["test"]["MAE"] / pers_row["test"]["MAE"]) * 100
periods = [{"name": f, "label": f"Validation {f[-1]}", "start": df.index[lo].isoformat(), "end": df.index[hi-1].isoformat()}
           for f, lo, hi in FOLDS]
periods += [{"name": "calibration", "label": "Calibration", "start": df.index[P["cal"]].isoformat(), "end": df.index[P["test"]-1].isoformat()},
            {"name": "test", "label": "Test", "start": df.index[P["test"]].isoformat(), "end": df.index[-1].isoformat()}]
trained_at = datetime.now().isoformat(timespec="seconds")
last_obs = y.dropna()

model_info = {
    "name": SELECTED, "params": sel_params, "framing": "nowcast", "target": TARGET, "units": "mg/m³",
    "input_columns": INPUT_COLUMNS, "features": list(final[:-1].get_feature_names_out()),
    "train_period": [df.index[START].isoformat(), df.index[P["cal"]-1].isoformat()],
    "threshold": threshold, "interval_radius": interval_radius, "interval_nominal": 0.9,
    "intercept": float(np.ravel(final.named_steps["model"].intercept_)[0]) if hasattr(final.named_steps["model"], "intercept_") else None,
    "sensor_fit": {"slope": float(coef[0]), "intercept": float(coef[1]), "disagreement_threshold": disagree_thr,
                   "training_range": [s_min, s_max]},
    "gpu_used": GPU, "trained_at": trained_at, "test": sel_row["test"], "validation_mean": sel_row["validation_mean"],
}
summary = {
    "project": "Air Quality Prediction and Pollution Episode Detection", "target": TARGET, "units": "mg/m³",
    "dataset": {"source_url": SOURCE_URL, "rows": n, "start": df.index.min().isoformat(), "end": df.index.max().isoformat(),
                "variables": list(df.columns)},
    "missing": missing,
    "model": {"name": SELECTED, "framing": "nowcast", "features": INPUT_COLUMNS, "train_period": model_info["train_period"],
              "threshold": threshold, "interval_radius": interval_radius, "gpu_used": GPU, "trained_at": trained_at},
    "metrics": {"test": sel_row["test"], "persistence_test": pers_row["test"], "improvement_pct": improvement,
                "validation_mean": sel_row["validation_mean"]},
    "periods": periods,
    "episodes": {"total": len(episodes),
                 "unusual_pollution_candidate": sum(e["classification"] == "unusual_pollution_candidate" for e in episodes),
                 "data_limitation_candidate": sum(e["classification"] == "data_limitation_candidate" for e in episodes)},
    "kpi": {"latest_observed": float(last_obs.iloc[-1]), "latest_time": last_obs.index[-1].isoformat(),
            "mean_observed": float(y.mean()), "coverage_pct": float(y.notna().mean() * 100)},
    "notes": [
        "Model and hyperparameters were selected on validation folds only; the test period was scored once with the frozen model.",
        "The test period was also inspected during earlier exploratory research, so it is not a fully independent test.",
        "Episode labels are candidates produced by transparent rules; causes are not verified against external records.",
        "Low-cost sensors drift over time, so accuracy degrades further from the training period.",
    ],
}
metrics_out = {
    "selected_model": SELECTED,
    "selection_rule": "Lowest mean MAE across three rolling-origin validation folds (test never used for selection).",
    "models": model_rows, "framing_comparison": framing, "tuning": tuning,
    "feature_importance": importance, "coefficients": coefficients,
    "error_by_hour": [{"hour": int(h), "MAE": float(v)} for h, v in err_hour.items()],
    "error_by_month": [{"month": m, "MAE": float(v)} for m, v in err_month.items()],
    "interval_coverage": {"nominal": 0.9, "test_actual": float(in_band.mean())},
    "residual_histogram": {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]},
    "scatter_test": [[float(a), float(b)] for a, b in zip(t_true, t_pred)][:3000],
}
pred = pd.DataFrame({
    "t": df.index, "observed": observed, "estimated": estimate,
    "lower": estimate - interval_radius, "upper": estimate + interval_radius,
    "residual": residual, "period": period, "flagged": flagged, "imputed_inputs": imputed_inputs,
    "sensor_estimate": sensor_est,
})
pred[has_est].to_csv(ART / "predictions.csv", index=False)
for name, obj in (("model_info", model_info), ("summary", summary), ("metrics", metrics_out), ("episodes", episodes)):
    (ART / f"{name}.json").write_text(json.dumps(obj, indent=2, allow_nan=False), encoding="utf-8")

log(f"Test: {sel_row['test']}  persistence MAE {pers_row['test']['MAE']:.4f}  improvement {improvement:.1f}%")
log(f"Episodes: {summary['episodes']}  interval coverage (test) {in_band.mean():.3f}")
log("Done. Artifacts written to ./artifacts and model to ./air_quality_model.pkl")
