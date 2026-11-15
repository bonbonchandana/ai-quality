"""Air quality prediction and pollution episode detection.

This one file does the whole ML part, so it can also be run on Kaggle as is.

    python train_model.py                     uses the UCI Air Quality data (Italy)
    python train_model.py my_city.csv         uses any hourly air-quality CSV

How it works:
  - read the hourly data (-200 or empty cells count as missing)
  - for every pollutant in the file, predict the next hour from its last few values
    (1, 2, 3 and 24 hours back) and the previous hour's weather
  - split by time: first 60% to train, next 20% to pick the model, last 20% to test
  - try Linear Regression, Random Forest and XGBoost, and compare them with simply
    repeating the last hour's value
  - flag test hours where the real value was far from the prediction, group them into
    episodes and label each one "Data limitation" or "Unusual pollution"
"""
import glob
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

UCI_URL = "https://archive.ics.uci.edu/static/public/360/air+quality.zip"

# Column names we treat as pollutants (the first name found in the file is used), plus units.
POLLUTANTS = {
    "CO":    ["CO(GT)", "CO"],
    "NO2":   ["NO2(GT)", "NO2"],
    "NOx":   ["NOx(GT)", "NOx"],
    "C6H6":  ["C6H6(GT)", "C6H6", "Benzene"],
    "PM2.5": ["PM2.5", "PM25", "pm2_5"],
    "PM10":  ["PM10", "pm10"],
    "SO2":   ["SO2"],
    "O3":    ["O3"],
}
UNITS = {"CO(GT)": "mg/m³", "NO2(GT)": "µg/m³", "NOx(GT)": "ppb", "C6H6(GT)": "µg/m³",
         "PM2.5": "µg/m³", "PM10": "µg/m³", "SO2": "µg/m³", "O3": "µg/m³", "NO2": "µg/m³", "CO": "µg/m³"}
# Weather columns. Whatever the file has gets used, the rest is skipped.
WEATHER = {
    "temperature":       ["T", "TEMP", "temperature", "Temperature"],
    "relative_humidity": ["RH", "humidity", "relative_humidity"],
    "absolute_humidity": ["AH", "absolute_humidity"],
    "pressure":          ["PRES", "pressure"],
    "dew_point":         ["DEWP", "dew_point"],
    "rain":              ["RAIN", "rain"],
    "wind_speed":        ["WSPM", "wind_speed"],
}


# ---------------------------------------------------------------- 1. load the data
def read_csv_any(path):
    """Reads a CSV, an Excel file, or the first CSV inside a ZIP. For CSVs it tries ';' first (UCI style), then ','."""
    if str(path).lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(path)
    if str(path).lower().endswith(".zip"):
        z = zipfile.ZipFile(path)
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        path = io.BytesIO(z.read(name))
    for options in ({"sep": ";", "decimal": ","}, {}):
        if hasattr(path, "seek"):
            path.seek(0)
        table = pd.read_csv(path, **options)
        if table.shape[1] >= 2:                                    # at least a time column and one pollutant
            return table
    raise ValueError("Could not read the file as a CSV table.")


def load_data(path):
    raw = read_csv_any(path)
    raw.columns = [str(c).strip() for c in raw.columns]
    raw = raw.loc[:, ~raw.columns.str.startswith("Unnamed")]
    cols = set(raw.columns)

    if {"Date", "Time"} <= cols:                                   # UCI Italy format
        raw = raw.dropna(subset=["Date", "Time"])
        day = pd.to_datetime(raw["Date"], format="%d/%m/%Y", errors="coerce")
        if day.isna().all():                                       # Excel version stores real dates
            day = pd.to_datetime(raw["Date"], errors="coerce")
        clock = raw["Time"].astype(str).str.replace(".", ":", regex=False)
        time = pd.to_datetime(day.dt.strftime("%Y-%m-%d") + " " + clock, errors="coerce")
    elif {"year", "month", "day", "hour"} <= cols:                 # Beijing format
        time = pd.to_datetime(raw[["year", "month", "day", "hour"]], errors="coerce")
    else:                                                          # one datetime column
        tcol = next((c for c in raw.columns if c.lower() in ("datetime", "date_time", "timestamp", "date", "time")), None)
        if tcol is None:
            raise ValueError("No time column found. Use 'Date'+'Time', 'year/month/day/hour' or a 'datetime' column.")
        time = pd.to_datetime(raw[tcol], errors="coerce")

    if "station" in cols and raw["station"].nunique() > 1:         # several stations -> use the biggest one
        keep = raw["station"].value_counts().index[0]
        mask = raw["station"] == keep
        raw, time = raw[mask], time[mask]
        print(f"File has several stations; using '{keep}'.")

    df = raw.apply(pd.to_numeric, errors="coerce").replace(-200, np.nan)
    df.index = pd.DatetimeIndex(time, name="timestamp")
    df = df[df.index.notna()]
    df = df[~df.index.duplicated()].sort_index()
    df = df.dropna(axis=1, how="all").asfreq("h")                  # one row per hour; gaps become NaN
    return df


def find_columns(df):
    """Works out which pollutant and weather columns this file has."""
    pollutants = {}
    for name, aliases in POLLUTANTS.items():
        col = next((a for a in aliases if a in df.columns), None)
        if col and df[col].notna().mean() >= 0.5:                  # skip mostly-empty columns
            pollutants[name] = col
    weather = {name: next(a for a in aliases if a in df.columns)
               for name, aliases in WEATHER.items() if any(a in df.columns for a in aliases)}
    if not pollutants:
        raise ValueError(f"No pollutant column found. Expected one of: {sum(POLLUTANTS.values(), [])}")
    return pollutants, weather


# ---------------------------------------------------------------- 2. lagged features
def make_features(df, column, weather):
    """Inputs for predicting hour t: the pollutant at t-1, t-2, t-3 and t-24, and the weather at t-1."""
    X = pd.DataFrame(index=df.index)
    X["hour"] = df.index.hour
    X["weekday"] = df.index.day_of_week
    for k in (1, 2, 3, 24):
        X[f"lag_{k}"] = df[column].shift(k)
    for name, col in weather.items():
        X[name] = df[col].shift(1)
    return X


# ---------------------------------------------------------------- 3. models
def device():
    """XGBoost trains on the GPU if there is one, otherwise on the CPU."""
    try:
        XGBRegressor(n_estimators=2, device="cuda").fit(np.random.rand(20, 2), np.random.rand(20))
        return "cuda"
    except Exception:
        return "cpu"


def candidate_models(dev, light=False):
    if light:   # small and quick, for a free online server with little memory and CPU
        return {"Linear Regression": [LinearRegression()],
                "XGBoost": [XGBRegressor(n_estimators=200, max_depth=4, learning_rate=0.1, n_jobs=1, verbosity=0, random_state=42)]}
    return {
        "Linear Regression": [LinearRegression()],
        "Random Forest": [RandomForestRegressor(n_estimators=150, max_depth=d, min_samples_leaf=5, n_jobs=2, random_state=42)
                          for d in (10, None)],
        "XGBoost": [XGBRegressor(n_estimators=400, max_depth=d, learning_rate=0.05, device=dev, verbosity=0, random_state=42)
                    for d in (4, 6)],
    }


def make_pipeline(model):
    return Pipeline([("fill_missing", SimpleImputer(strategy="median")), ("scale", StandardScaler()), ("model", model)])


def predict_level(model, X):
    """The prediction is last hour's value plus the change the model expects."""
    return X["lag_1"].to_numpy() + model.predict(X)


def scores(y_true, y_pred):
    return {"MAE": float(mean_absolute_error(y_true, y_pred)), "RMSE": float(np.sqrt(mean_squared_error(y_true, y_pred))),
            "R2": float(r2_score(y_true, y_pred)), "n": int(len(y_true))}


# ---------------------------------------------------------------- 4-6. train, flag, analyze
def train_pollutant(df, name, column, weather, dev="cpu", light=False, others=None):
    X, y = make_features(df, column, weather), df[column]
    change = y - X["lag_1"]               # we train on the hour-to-hour change, not the level itself
    n = len(df)
    train_end, val_end = int(n * 0.6), int(n * 0.8)
    rows = np.arange(24, n)
    has_y = y.notna().to_numpy()[rows]
    has_lag = X["lag_1"].notna().to_numpy()[rows]
    train = rows[(rows < train_end) & has_y & has_lag]
    val = rows[(rows >= train_end) & (rows < val_end) & has_y & has_lag]
    test = rows[(rows >= val_end) & has_y & has_lag]
    train_val = rows[(rows < val_end) & has_y & has_lag]

    # Try each model's settings and keep whichever does best on the validation period
    results = []
    for model_name, options in candidate_models(dev, light).items():
        best = None
        for model in options:
            fitted = make_pipeline(model).fit(X.iloc[train], change.iloc[train])
            s = scores(y.iloc[val], predict_level(fitted, X.iloc[val]))
            if best is None or s["MAE"] < best["validation"]["MAE"]:
                best = {"model": model_name, "validation": s, "estimator": model, "fitted": fitted}
        results.append(best)
    chosen = min(results, key=lambda r: r["validation"]["MAE"])

    # Anything worse than 95% of the validation errors counts as a big miss
    val_errors = np.abs(y.iloc[val].to_numpy() - predict_level(chosen["fitted"], X.iloc[val]))
    threshold = float(np.quantile(val_errors, 0.95))

    # Retrain on train + validation, then check once on the test period
    for r in results:
        r["final"] = make_pipeline(clone(r["estimator"])).fit(X.iloc[train_val], change.iloc[train_val])
        r["test"] = scores(y.iloc[test], predict_level(r["final"], X.iloc[test]))
    baseline = {"model": "Persistence (same as previous hour)", "validation": scores(y.iloc[val], X["lag_1"].iloc[val]),
                "test": scores(y.iloc[test], X["lag_1"].iloc[test])}
    final = chosen["final"]

    pred = pd.DataFrame({"actual": y.iloc[test], "predicted": predict_level(final, X.iloc[test])})
    pred["residual"] = pred["actual"] - pred["predicted"]
    pred["flagged"] = pred["residual"].abs() > threshold
    missing = X.iloc[test].isna()
    pred["missing_inputs"] = missing.sum(axis=1)
    pred["missing_names"] = [list(missing.columns[row]) for row in missing.to_numpy()]
    pred["gap_before"] = y.isna().rolling(6, min_periods=1).sum().shift(1).reindex(pred.index).fillna(0)

    # Evidence used to explain each flagged episode
    # 1) how many hours in a row the reading has stayed exactly the same (a stuck sensor repeats itself)
    runs_id = (y != y.shift()).cumsum()
    same_for = y.groupby(runs_id).cumcount() + 1
    pred["same_for_hours"] = same_for.where(y.notna()).reindex(pred.index).fillna(0).astype(int)
    # 2) how big the jump from the previous hour is, compared with normal hourly changes in the training period
    usual_step = y.diff().iloc[:train_end].std()
    pred["jump_size"] = (y.diff().abs() / usual_step).reindex(pred.index).fillna(0)
    # 3) whether the other pollutants were also unusually high or low (compared with their previous 24 hours)
    agree = pd.DataFrame(index=pred.index)
    for other, col in (others or {}).items():
        past = df[col].shift(1).rolling(24, min_periods=12)
        z = ((df[col] - past.mean()) / past.std()).reindex(pred.index)
        agree[other] = z
    episodes = find_episodes(pred, name, UNITS.get(column, ""), agree, threshold)
    imp = final.named_steps["model"]
    imp = imp.feature_importances_ if hasattr(imp, "feature_importances_") else np.abs(imp.coef_)
    info = {
        "pollutant": name, "column": column, "unit": UNITS.get(column, ""), "features": list(X.columns),
        "model": chosen["model"], "threshold": threshold, "device": dev,
        "improvement_vs_persistence_pct": float((1 - chosen["test"]["MAE"] / baseline["test"]["MAE"]) * 100),
        "periods": {"train": [str(df.index[24]), str(df.index[train_end - 1])],
                    "validation": [str(df.index[train_end]), str(df.index[val_end - 1])],
                    "test": [str(df.index[val_end]), str(df.index[-1])]},
        "models": [{"model": r["model"], "validation": r["validation"], "test": r["test"]} for r in results] + [baseline],
        "feature_importance": sorted(({"feature": f, "importance": float(v / imp.sum())} for f, v in zip(X.columns, imp)),
                                     key=lambda d: -d["importance"]),
        "data": {"observed_pct": float(y.notna().mean() * 100),
                 "daily": [[d.strftime("%Y-%m-%d"), None if np.isnan(v) else round(float(v), 3)]
                           for d, v in y.resample("D").mean().items()],
                 "hourly_profile": [round(float(v), 3) for v in y.groupby(df.index.hour).mean()]},
        "test_predictions": [{"t": t.isoformat(), "actual": float(r.actual), "predicted": round(float(r.predicted), 4),
                              "flagged": bool(r.flagged)} for t, r in pred.iterrows()],
        "episodes": episodes,
        "episode_counts": {"total": len(episodes), **{kind: sum(e["type"] == kind for e in episodes) for kind in KINDS}},
        "patterns": episode_patterns(episodes),
        "flagged_share_pct": float(pred["flagged"].mean() * 100),
    }
    if hasattr(final.named_steps["model"], "set_params") and chosen["model"] == "XGBoost":
        final.named_steps["model"].set_params(device="cpu")          # predict on any machine
    return final, info, pred


READABLE = {
    "lag_1": "the reading 1 hour before", "lag_2": "the reading 2 hours before", "lag_3": "the reading 3 hours before",
    "lag_24": "the reading at the same time the day before", "temperature": "temperature",
    "relative_humidity": "relative humidity", "absolute_humidity": "absolute humidity", "pressure": "air pressure",
    "dew_point": "dew point", "rain": "rain", "wind_speed": "wind speed", "hour": "hour", "weekday": "weekday",
}


def when_text(start, end):
    """Turns two timestamps into something like 'Tue 1 Feb 2005, 08:00 to 11:00'."""
    day = f"{start:%a} {start.day} {start:%b %Y}"
    if start == end:
        return f"{day}, {start:%H:%M}"
    if start.date() == end.date():
        return f"{day}, {start:%H:%M} to {end:%H:%M}"
    return f"{day} {start:%H:%M} to {end:%a} {end.day} {end:%b} {end:%H:%M}"


KINDS = ["Unusual pollution", "Data limitation", "Unclear"]


def listing(words):
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def find_episodes(pred, pollutant="", unit="", agree=None, threshold=1.0):
    """Joins flagged hours that are under 3 hours apart, then decides what each group most likely was.

    Order of the checks:
      1. data problems: missing inputs, a gap just before, a stuck reading, or a sudden jump nothing else shares
      2. other pollutants moved the same way at the same time -> unusual pollution (they come from separate instruments)
      3. otherwise -> unclear (could be a local event, or the model simply missing a normal change)
    """
    agree = agree if agree is not None else pd.DataFrame(index=pred.index)
    episodes, group = [], []
    for t in list(pred.index[pred["flagged"]]) + [None]:
        if group and (t is None or t - group[-1] > pd.Timedelta(hours=3)):
            hits = pred.loc[group]
            hits = hits[hits["flagged"]]
            peak = hits["residual"].abs().idxmax()
            actual, expected = float(pred.at[peak, "actual"]), float(pred.at[peak, "predicted"])
            direction = "higher" if actual > expected else "lower"
            what = (f"{when_text(group[0], group[-1])}: {pollutant} was {actual:.2f} {unit} at {peak:%H:%M}, but the model "
                    f"expected about {expected:.2f} {unit}, so it was {abs(actual - expected):.2f} {direction}.").replace("  ", " ")

            # other pollutants that were also unusual in the same direction during the flagged hours
            agreeing = []
            for other in agree.columns:
                z = agree.loc[hits.index, other]
                same_way = (z * np.sign(hits["residual"])) >= 1.5
                if same_way.any():
                    agreeing.append(other)

            problems = []
            missing = sorted({name for names in hits["missing_names"] for name in names})
            if missing:
                problems.append(listing([READABLE.get(m, m) for m in missing]) + (" was" if len(missing) == 1 else " were") + " missing")
            gap = int(hits["gap_before"].max())
            if gap:
                problems.append(f"the {pollutant} data had a gap of {gap} hour{'s' if gap > 1 else ''} just before")
            stuck = int(hits["same_for_hours"].max())
            if stuck >= 6:
                problems.append(f"the reading stayed at exactly the same value for {stuck} hours in a row "
                                "(a stuck sensor, or readings recorded in very coarse steps)")
            jump = float(hits["jump_size"].max())
            if jump >= 6 and not agreeing:
                problems.append(f"the value jumped about {jump:.0f} times more than a normal hourly change while no other "
                                "pollutant moved, which looks like a glitch")

            if problems:
                kind = "Data limitation"
                confidence = "high" if len(problems) >= 2 or stuck >= 6 or (jump >= 6 and not agreeing) else "medium"
                reason = "Something was wrong with the data around this time."
                explanation = (what + " But " + " and ".join(problems) + ". So this is more likely a problem with the data "
                               "than real pollution.")
            elif agreeing:
                kind = "Unusual pollution"
                confidence = "high" if len(agreeing) >= 2 else "medium"
                reason = f"{listing(agreeing)} also moved the same way at the same time."
                explanation = (what + f" The inputs were complete, and {listing(agreeing)} "
                               f"{'was' if len(agreeing) == 1 else 'were'} also unusually {'high' if direction == 'higher' else 'low'} "
                               "at the same time. These come from separate instruments, so this looks like a real "
                               f"{'rise' if direction == 'higher' else 'drop'} in pollution.")
            else:
                kind = "Unclear"
                confidence = "low"
                if agree.shape[1] == 0:
                    reason = "No other pollutants in the file to cross-check with."
                    explanation = (what + " The inputs were complete, but the file has no other pollutants to compare with, "
                                   "so we can't tell whether this was real pollution or the model missing a normal change.")
                else:
                    reason = "The data looked fine, but no other pollutant moved with it."
                    explanation = (what + " The inputs were complete, but none of the other pollutants moved with it. It "
                                   "could be a short local event, or the model simply missed a normal change.")

            episodes.append({
                "id": len(episodes) + 1, "start": group[0].isoformat(), "end": group[-1].isoformat(),
                "when": when_text(group[0], group[-1]), "flagged_hours": len(hits), "peak_time": peak.isoformat(),
                "peak_value": round(actual, 3), "expected_value": round(expected, 3), "difference": round(actual - expected, 3),
                "max_deviation": float(hits["residual"].abs().max()), "severity": round(float(hits["residual"].abs().max()) / threshold, 2),
                "direction": direction, "type": kind, "confidence": confidence,
                "checks": {"other_pollutants_agreeing": agreeing, "missing_inputs": [READABLE.get(m, m) for m in missing],
                           "gap_hours_before": gap, "same_value_hours": stuck, "jump_vs_normal": round(jump, 1)},
                "reason": reason, "explanation": explanation,
            })
            group = []
        if t is not None:
            group.append(t)
    return episodes


def episode_patterns(episodes):
    """When do the episodes happen? Counts by hour, weekday and month, plus one plain sentence."""
    if not episodes:
        return {"by_hour": {k: [0] * 24 for k in KINDS}, "by_weekday": [0] * 7, "by_month": {}, "text": "No episodes were flagged."}
    peaks = pd.to_datetime([e["peak_time"] for e in episodes])
    kinds = [e["type"] for e in episodes]
    by_hour = {k: [int(sum(1 for t, kk in zip(peaks, kinds) if t.hour == h and kk == k)) for h in range(24)] for k in KINDS}
    by_weekday = [int((peaks.day_of_week == d).sum()) for d in range(7)]
    by_month = {str(m): int(c) for m, c in pd.Series(1, index=peaks).groupby(peaks.to_period("M")).sum().items()}
    hours = pd.Series(peaks.hour).value_counts()
    top_hours = sorted(hours.index[:3])
    weekday_share = sum(by_weekday[:5]) / len(episodes) * 100
    busiest = max(by_month, key=by_month.get)
    if weekday_share >= 79:
        week = f"{weekday_share:.0f}% fell on weekdays, more than the 71% you'd expect, so they lean towards working days"
    elif weekday_share <= 63:
        week = f"only {weekday_share:.0f}% fell on weekdays, so they lean towards weekends"
    else:
        week = f"{weekday_share:.0f}% fell on weekdays, about what you'd expect, so they are spread across the week"
    text = (f"Most episodes peaked around {listing([f'{h:02d}:00' for h in top_hours])}, and {week}. "
            f"The busiest month was {pd.Period(busiest):%b %Y} with {by_month[busiest]} episode"
            f"{'s' if by_month[busiest] != 1 else ''}.")
    return {"by_hour": by_hour, "by_weekday": by_weekday, "by_month": by_month, "text": text}


def nice_date(text):
    t = pd.Timestamp(text)
    return f"{t.day} {t:%b %Y}"


def short_episode(e):
    return {"id": e["id"], "when": e.get("when", f"{e['start']} to {e['end']}"), "type": e["type"],
            "confidence": e.get("confidence", ""), "severity": e.get("severity"), "peak_value": e.get("peak_value"),
            "expected_value": e.get("expected_value"), "explanation": e.get("explanation", e["reason"])}


def build_report(info, dataset_title=""):
    """A readable summary of one pollutant's results. This is what the JSON download contains."""
    unit = info.get("unit") or "units"
    best = next(m for m in info["models"] if m["model"] == info["model"])
    persistence = info["models"][-1]
    gain = info["improvement_vs_persistence_pct"]
    counts = info["episode_counts"]
    test_from, test_to = info["periods"]["test"]
    top = [READABLE.get(f["feature"], f["feature"]) for f in info["feature_importance"][:3]]
    summary = (f"We predicted {info['pollutant']} one hour ahead using the {dataset_title or 'selected'} data. "
               f"{info['model']} did best on the validation period, so we used it. On the test period "
               f"({nice_date(test_from)} to {nice_date(test_to)}) its average error was {best['test']['MAE']:.3f} {unit}. "
               f"Just repeating the last hour's value gave {persistence['test']['MAE']:.3f} {unit}, so the model was "
               f"{abs(gain):.1f}% {'better' if gain >= 0 else 'worse'}. "
               f"{counts['total']} episodes were flagged: {counts.get('Unusual pollution', 0)} look like unusual pollution, "
               f"{counts.get('Data limitation', 0)} look like data problems and {counts.get('Unclear', 0)} are unclear.")
    return {
        "title": f"{info['pollutant']} next-hour prediction" + (f" - {dataset_title}" if dataset_title else ""),
        "dataset": dataset_title, "pollutant": info["pollutant"], "unit": info.get("unit", ""),
        "summary": summary,
        "how_it_was_made": [
            "Read the hourly data and treated empty cells and -200 as missing.",
            f"Built the inputs: {', '.join(READABLE.get(f, f) for f in info['features'])}.",
            "Split the timeline in order: first 60% to train, next 20% to choose the model, last 20% to test.",
            "Tried Linear Regression, Random Forest and XGBoost. Each predicts how much the level changes in the next hour.",
            f"Flagged test hours where the miss was more than {info['threshold']:.2f} {unit} "
            "(bigger than 95% of the misses on the validation period).",
            f"By design this limit flags 5% of the validation hours; on the test period it flagged "
            f"{info.get('flagged_share_pct', 0):.1f}% of hours. So the number of episodes partly depends on where the limit is set.",
            "Grouped flagged hours that were less than 3 hours apart and checked each group: missing inputs or a gap, "
            "a stuck reading, or a sudden jump that nothing else shared mean a data problem; other pollutants moving the "
            "same way at the same time mean unusual pollution; anything else is unclear.",
        ],
        "results": {"chosen_model": info["model"], "test_period": f"{nice_date(test_from)} to {nice_date(test_to)}",
                    "average_error": round(best["test"]["MAE"], 3), "average_error_if_repeating_last_hour":
                    round(persistence["test"]["MAE"], 3), "better_than_repeating_last_hour_percent": round(gain, 1),
                    "r2": round(best["test"]["R2"], 3), "test_hours": best["test"]["n"]},
        "models_compared": [{"model": m["model"], "validation_error": round(m["validation"]["MAE"], 3),
                             "test_error": round(m["test"]["MAE"], 3)} for m in info["models"]],
        "most_important_inputs": top,
        "episode_counts": counts,
        "patterns": info.get("patterns", {}).get("text", ""),
        "most_severe": [short_episode(e) for e in sorted(info["episodes"], key=lambda e: -e.get("severity", 0))[:10]],
        "episodes": [short_episode(e) for e in info["episodes"]],
        "limitations": [
            "Results come from one place and period, so they may not hold elsewhere.",
            "Episode labels come from simple rules. Nobody checked them against real events.",
        ],
    }


def train_dataset(path, dataset_id, title, out_root=".", light=False):
    """Trains a model for every pollutant in the file. Models go to models/<id>/, results to artifacts/<id>/."""
    df = load_data(path)
    if light and len(df) > 24 * 365 * 2:     # light mode keeps the last two years to save memory and time
        df = df.iloc[-24 * 365 * 2:]
    pollutants, weather = find_columns(df)
    dev = "cpu" if light else device()
    print(f"[{title}] {len(df)} hourly rows {df.index.min()} -> {df.index.max()} | "
          f"pollutants {list(pollutants)} | weather {list(weather)} | XGBoost on {dev}")
    model_dir, art_dir = Path(out_root, "models", dataset_id), Path(out_root, "artifacts", dataset_id)
    model_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)
    summary, preds = [], {}
    for name, column in pollutants.items():
        others = {n: c for n, c in pollutants.items() if n != name}
        model, info, pred = train_pollutant(df, name, column, weather, dev, light, others)
        key = re.sub(r"[^A-Za-z0-9]", "", name)                    # PM2.5 -> PM25 for file names
        joblib.dump(model, model_dir / f"{key}.pkl", compress=3)
        (art_dir / f"{key}.json").write_text(json.dumps(info, allow_nan=False), encoding="utf-8")
        (art_dir / f"{key}_report.json").write_text(json.dumps(build_report(info, title), indent=2, ensure_ascii=False),
                                                     encoding="utf-8")
        best = next(m for m in info["models"] if m["model"] == info["model"])
        summary.append({"pollutant": name, "key": key, "unit": info["unit"], "model": info["model"],
                        "test_MAE": round(best["test"]["MAE"], 3), "test_R2": round(best["test"]["R2"], 3),
                        "better_than_persistence_%": round(info["improvement_vs_persistence_pct"], 1),
                        "episodes": info["episode_counts"]["total"]})
        preds[name] = (info, pred)
        print(f"  {name:6s} {info['model']:17s} test MAE {best['test']['MAE']:9.3f} R2 {best['test']['R2']:.3f} "
              f"| {info['improvement_vs_persistence_pct']:5.1f}% better than persistence | {info['episode_counts']}")
    df.to_csv(art_dir / "data.csv")
    (art_dir / "dataset.json").write_text(json.dumps({
        "id": dataset_id, "title": title, "rows": len(df), "start": str(df.index.min()), "end": str(df.index.max()),
        "weather": weather, "pollutants": summary}, allow_nan=False), encoding="utf-8")
    return summary, preds


def find_data_file():
    """Looks in /kaggle/input and ./data for a dataset. If there is none, downloads the UCI one."""
    for pattern in ["/kaggle/input/**/*.csv", "/kaggle/input/**/*.xlsx", "/kaggle/input/**/*.zip", "data/*.csv"]:
        files = sorted(glob.glob(pattern, recursive=True))
        if files:
            print("Using", files[0])
            return files[0]
    found = [f for f in glob.glob("/kaggle/input/**/*", recursive=True) if os.path.isfile(f)]
    print("No CSV, Excel or ZIP file found under /kaggle/input." + (f" Files there: {found[:10]}" if found else ""))
    print("Downloading the UCI Air Quality data instead (this needs Internet switched on)...")
    Path("data").mkdir(exist_ok=True)
    import urllib.request
    try:
        urllib.request.urlretrieve(UCI_URL, "data/air-quality.zip")
    except OSError:
        raise SystemExit("No dataset found and no Internet. In Kaggle: click '+ Add Input' and add an air quality "
                         "dataset (or upload AirQualityUCI.csv), or turn on Settings > Internet. Then run again.")
    return "data/air-quality.zip"


def plot(preds):
    import matplotlib.pyplot as plt
    for name, (info, pred) in preds.items():
        part = pred.iloc[:24 * 21]                                 # first three weeks of the test period
        plt.figure(figsize=(14, 3.5))
        plt.plot(part.index, part["actual"], lw=1, label="actual")
        plt.plot(part.index, part["predicted"], lw=1, label="predicted")
        flagged = part[part["flagged"]]
        plt.scatter(flagged.index, flagged["actual"], color="red", s=18, zorder=3, label="flagged")
        plt.title(f"{name}: actual vs predicted ({info['model']})")
        plt.ylabel(info["unit"])
        plt.legend()
        plt.show()


if __name__ == "__main__":
    files = [a for a in sys.argv[1:] if a.lower().endswith((".csv", ".xlsx", ".zip"))]   # ignores Jupyter/Kaggle kernel args
    path = files[0] if files else find_data_file()
    dataset_id = "uci-italy" if "airquality" in os.path.basename(path).lower().replace("-", "").replace("_", "") \
        else re.sub(r"[^a-z0-9]+", "-", Path(path).stem.lower()).strip("-")
    titles = {"uci-italy": "Italy (UCI Air Quality)", "beijing-aotizhongxin": "Beijing, Aotizhongxin station (UCI)"}
    title = titles.get(dataset_id, Path(path).stem.replace("_", " "))
    summary, preds = train_dataset(path, dataset_id, title)
    print(pd.DataFrame(summary).to_string(index=False))
    if os.path.isdir("/kaggle") or "--plot" in sys.argv:
        plot(preds)
