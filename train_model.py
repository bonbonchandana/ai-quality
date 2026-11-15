"""Train one next-hour model per pollutant and flag pollution episodes.

Run from the project folder:
    .venv\\Scripts\\python train_model.py

Problem statement, step by step:
  * Predict a selected pollutant (CO, NO2, NOx or benzene) one hour ahead
  * using historical pollutant readings and environmental variables (temperature, humidity),
  * with lagged features (1, 2, 3 and 24 hours earlier),
  * evaluated on a future period (chronological split, never shuffled),
  * flag hours where the observation differs substantially from the prediction,
  * and analyze whether each flagged episode reflects unusual pollution or a data limitation.
"""
import io
import json
import zipfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import ParameterGrid
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parent
DATA_CSV = ROOT / "data" / "AirQualityUCI.csv"
DATA_ZIP = ROOT / "research" / "data" / "air-quality.zip"
MODELS = ROOT / "models"
ART = ROOT / "artifacts"

# Pollutants the user can select (NMHC is left out: 90% of its values are missing).
POLLUTANTS = {
    "CO":   {"column": "CO(GT)",   "unit": "mg/m³", "name": "Carbon monoxide"},
    "NO2":  {"column": "NO2(GT)",  "unit": "µg/m³", "name": "Nitrogen dioxide"},
    "NOx":  {"column": "NOx(GT)",  "unit": "ppb",   "name": "Nitrogen oxides"},
    "C6H6": {"column": "C6H6(GT)", "unit": "µg/m³", "name": "Benzene"},
}
# Model inputs = the fields of POST /predict. Everything is known before the hour being predicted.
FEATURES = ["hour", "weekday", "lag_1", "lag_2", "lag_3", "lag_24",
            "temperature", "relative_humidity", "absolute_humidity"]


# 1. Load the data -------------------------------------------------------------------------
def load_data():
    if DATA_CSV.exists():
        raw = pd.read_csv(DATA_CSV, sep=";", decimal=",")
    else:
        if not DATA_ZIP.exists():
            import urllib.request
            DATA_ZIP.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve("https://archive.ics.uci.edu/static/public/360/air+quality.zip", DATA_ZIP)
        raw = pd.read_csv(io.BytesIO(zipfile.ZipFile(DATA_ZIP).read("AirQualityUCI.csv")), sep=";", decimal=",")
    raw.columns = raw.columns.str.strip()
    raw = raw.dropna(subset=["Date", "Time"])
    time = pd.to_datetime(raw["Date"] + " " + raw["Time"], format="%d/%m/%Y %H.%M.%S")
    df = raw.drop(columns=["Date", "Time"]).dropna(axis=1, how="all")
    df = df.replace(-200, np.nan)                  # -200 means "missing" in this dataset
    df.index = pd.DatetimeIndex(time, name="timestamp")
    return df.sort_index().asfreq("h")             # one row per hour; gaps become NaN


# 2. Lagged features ------------------------------------------------------------------------
def make_features(df, column):
    """Inputs for predicting hour t: pollutant at t-1, t-2, t-3, t-24 and weather at t-1."""
    s = df[column]
    X = pd.DataFrame(index=df.index)
    X["hour"] = df.index.hour
    X["weekday"] = df.index.day_of_week
    for k in (1, 2, 3, 24):
        X[f"lag_{k}"] = s.shift(k)
    X["temperature"] = df["T"].shift(1)
    X["relative_humidity"] = df["RH"].shift(1)
    X["absolute_humidity"] = df["AH"].shift(1)
    return X[FEATURES], s


def metrics(y_true, y_pred):
    return {"MAE": float(mean_absolute_error(y_true, y_pred)),
            "RMSE": float(np.sqrt(mean_squared_error(y_true, y_pred))),
            "R2": float(r2_score(y_true, y_pred)), "n": int(len(y_true))}


def gpu_available():
    try:
        XGBRegressor(n_estimators=2, device="cuda").fit(np.random.rand(20, 2), np.random.rand(20))
        return True
    except Exception:
        return False


DEVICE = "cuda" if gpu_available() else "cpu"

# 3. Candidate models and their tuning grids ------------------------------------------------
CANDIDATES = {
    "Linear Regression": (lambda p: LinearRegression(), [{}]),
    "Random Forest": (lambda p: RandomForestRegressor(random_state=42, n_jobs=2, **p),
                      list(ParameterGrid({"n_estimators": [200], "max_depth": [8, 12, None],
                                          "min_samples_leaf": [1, 5]}))),
    "XGBoost": (lambda p: XGBRegressor(random_state=42, device=DEVICE, tree_method="hist", verbosity=0, **p),
                list(ParameterGrid({"n_estimators": [300, 600], "max_depth": [3, 5],
                                    "learning_rate": [0.05, 0.1]}))),
}


def pipeline(estimator):
    # Missing inputs (gaps in the data) are filled with the training median.
    return Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()),
                     ("model", estimator)])


def train_pollutant(df, key):
    info = POLLUTANTS[key]
    X, y = make_features(df, info["column"])
    n = len(df)
    train_end, val_end = int(n * 0.6), int(n * 0.8)

    # Score only hours where the true value and the previous hour exist (so persistence is defined).
    usable = (y.notna() & X["lag_1"].notna()).to_numpy()
    rows = np.arange(24, n)
    train = rows[(rows < train_end) & y.notna().to_numpy()[rows]]
    val = rows[(rows >= train_end) & (rows < val_end) & usable[rows]]
    test = rows[(rows >= val_end) & usable[rows]]
    train_val = rows[(rows < val_end) & y.notna().to_numpy()[rows]]

    # 4. Tune each model on the validation period (train on the training period only)
    results, tuning = [], []
    for name, (make, grid) in CANDIDATES.items():
        scored = []
        for params in grid:
            m = pipeline(make(params)).fit(X.iloc[train], y.iloc[train])
            scored.append((metrics(y.iloc[val], m.predict(X.iloc[val])), params, m))
        best = min(scored, key=lambda s: s[0]["MAE"])
        if len(grid) > 1:
            tuning.append({"model": name, "first_setting_MAE": scored[0][0]["MAE"],
                           "tuned_MAE": best[0]["MAE"], "best_params": best[1]})
        results.append({"model": name, "params": best[1], "validation": best[0], "fitted_on_train": best[2]})

    # 5. Select on validation, then retrain the winners on train + validation and test once
    selected = min(results, key=lambda r: r["validation"]["MAE"])
    finals = {}
    for r in results:
        finals[r["model"]] = pipeline(CANDIDATES[r["model"]][0](r["params"])).fit(X.iloc[train_val], y.iloc[train_val])
        r["test"] = metrics(y.iloc[test], finals[r["model"]].predict(X.iloc[test]))
    baseline = {"model": "Persistence (same as previous hour)", "params": {},
                "validation": metrics(y.iloc[val], X["lag_1"].iloc[val]),
                "test": metrics(y.iloc[test], X["lag_1"].iloc[test])}
    final = finals[selected["model"]]

    # 6. Flag threshold = 95th percentile of the selected model's validation errors (out-of-sample)
    val_err = np.abs(y.iloc[val].to_numpy() - selected["fitted_on_train"].predict(X.iloc[val]))
    threshold = float(np.quantile(val_err, 0.95))

    # 7. Predict the test period, flag large deviations, group them into episodes and classify them
    pred = pd.DataFrame({"actual": y.iloc[test], "predicted": final.predict(X.iloc[test])})
    pred["residual"] = pred["actual"] - pred["predicted"]
    pred["flagged"] = pred["residual"].abs() > threshold
    pred["missing_inputs"] = X.iloc[test].isna().sum(axis=1)
    missing_before = y.isna().rolling(6, min_periods=1).sum().shift(1)  # missing values in previous 6 h
    pred["missing_before"] = missing_before.reindex(pred.index).fillna(0).astype(int)

    episodes, current = [], []
    flagged_times = list(pred.index[pred["flagged"]])
    for t in flagged_times + [None]:
        if current and (t is None or t - current[-1] > pd.Timedelta(hours=3)):
            ep = pred.loc[current[0]:current[-1]]
            hits = ep[ep["flagged"]]
            reasons = []
            if hits["missing_inputs"].sum() > 0:
                reasons.append("some input readings were missing and had to be filled in")
            if hits["missing_before"].max() > 0:
                reasons.append(f"the pollutant data had a gap in the 6 hours before ({int(hits['missing_before'].max())} missing hours)")
            direction = "higher" if hits["residual"].mean() > 0 else "lower"
            if reasons:
                kind = "Data limitation"
                reason = "Probably a data problem: " + "; ".join(reasons) + "."
            else:
                kind = "Unusual pollution"
                reason = (f"All inputs were complete, yet the observed level was {direction} than expected "
                          f"by up to {hits['residual'].abs().max():.2f} {info['unit']}: a genuine unusual pollution event.")
            episodes.append({"id": len(episodes) + 1, "start": current[0].isoformat(), "end": current[-1].isoformat(),
                             "flagged_hours": int(len(hits)), "peak_actual": float(hits["actual"].max()),
                             "max_deviation": float(hits["residual"].abs().max()), "direction": direction,
                             "type": kind, "reason": reason})
            current = []
        if t is not None:
            current.append(t)

    # 8. Save the model (CPU inference, so it runs anywhere) and the results for the API/dashboard
    if selected["model"] == "XGBoost":
        final.named_steps["model"].set_params(device="cpu")
    joblib.dump(final, MODELS / f"{key}.pkl", compress=3)
    assert np.allclose(joblib.load(MODELS / f"{key}.pkl").predict(X.iloc[test[:10]]), final.predict(X.iloc[test[:10]]))

    est = final.named_steps["model"]
    raw_imp = est.feature_importances_ if hasattr(est, "feature_importances_") else np.abs(est.coef_)
    importance = sorted(({"feature": f, "importance": float(v / raw_imp.sum())} for f, v in zip(FEATURES, raw_imp)),
                        key=lambda d: -d["importance"])
    s = y.dropna()
    sel_test, base_test = selected["test"]["MAE"], baseline["test"]["MAE"]
    out = {
        "key": key, **info, "features": FEATURES, "device_used": DEVICE,
        "selected_model": selected["model"], "selected_params": selected["params"], "threshold": threshold,
        "improvement_vs_persistence_pct": float((1 - sel_test / base_test) * 100),
        "periods": {"train": [df.index[24].isoformat(), df.index[train_end - 1].isoformat()],
                    "validation": [df.index[train_end].isoformat(), df.index[val_end - 1].isoformat()],
                    "test": [df.index[val_end].isoformat(), df.index[-1].isoformat()]},
        "models": [{k: v for k, v in r.items() if k != "fitted_on_train"} for r in results] + [baseline],
        "tuning": tuning, "feature_importance": importance,
        "data": {"observed_pct": float(y.notna().mean() * 100), "mean": float(s.mean()), "max": float(s.max()),
                 "daily": [[d.strftime("%Y-%m-%d"), None if np.isnan(v) else round(float(v), 3)]
                           for d, v in y.resample("D").mean().items()],
                 "hourly_profile": [round(float(v), 3) for v in y.groupby(df.index.hour).mean()]},
        "test_predictions": [{"t": t.isoformat(), "actual": float(r.actual), "predicted": round(float(r.predicted), 4),
                              "flagged": bool(r.flagged)} for t, r in pred.iterrows()],
        "episodes": episodes,
        "episode_counts": {"total": len(episodes),
                           "Unusual pollution": sum(e["type"] == "Unusual pollution" for e in episodes),
                           "Data limitation": sum(e["type"] == "Data limitation" for e in episodes)},
    }
    (ART / f"{key}.json").write_text(json.dumps(out, indent=1, allow_nan=False), encoding="utf-8")
    print(f"{key:5s} {selected['model']:17s} test MAE {sel_test:8.3f} vs persistence {base_test:8.3f} "
          f"({out['improvement_vs_persistence_pct']:5.1f}% better) | episodes {out['episode_counts']}")


if __name__ == "__main__":
    MODELS.mkdir(exist_ok=True)
    ART.mkdir(exist_ok=True)
    data = load_data()
    data.to_csv(ART / "clean_hourly.csv")
    print(f"Data: {len(data)} hourly rows, {data.index.min()} -> {data.index.max()} | XGBoost device: {DEVICE}")
    for pollutant in POLLUTANTS:
        train_pollutant(data, pollutant)
    print("Saved models/*.pkl and artifacts/*.json")
