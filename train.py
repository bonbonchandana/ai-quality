"""Trains one model per gas that forecasts the next hour, from the UCI Air Quality data (Italy, 2004-2005)
and CPCB data from 6 stations in Delhi (2018-2019, data/delhi/).

Run:  python train.py [data/AirQualityUCI.csv]
Saves models/<gas>.joblib and models/report.json (what the Model page shows).
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import make_pipeline
from xgboost import XGBRegressor

GASES = {  # key: (column in the UCI file, name, unit)
    "CO": ("CO(GT)", "Carbon monoxide", "mg/m³"),
    "NO2": ("NO2(GT)", "Nitrogen dioxide", "µg/m³"),
    "NOx": ("NOx(GT)", "Nitrogen oxides", "ppb"),
    "C6H6": ("C6H6(GT)", "Benzene", "µg/m³"),
}
FEATURES = ["hour", "weekday", "lag_1", "lag_2", "lag_3", "lag_24", "temperature", "relative_humidity"]
LIMITS = {  # official health limits; the other gases have none, so we use this station's own high levels
    "CO": ([4, 10], "WHO guideline: 4 mg/m³ over a day, 10 mg/m³ over 8 hours"),
    "NO2": ([200, 400], "EU limit: 200 µg/m³ for one hour, 400 µg/m³ alert level"),
}
MODELS = Path(__file__).parent / "models"


def load(source):
    """Reads the UCI file (';' separated, decimal commas, -200 = missing) into one row per hour."""
    raw = pd.read_csv(source, sep=";", decimal=",").dropna(subset=["Date"])
    time = pd.to_datetime(raw["Date"] + " " + raw["Time"], format="%d/%m/%Y %H.%M.%S")
    df = raw.set_index(time)[[column for column, _, _ in GASES.values()] + ["T", "RH"]]
    df.columns = [*GASES, "T", "RH"]
    return df.replace(-200, np.nan).asfreq("h")


def features(df, gas):
    """For every hour t: what is known at t when forecasting hour t+1."""
    value, target = df[gas], df.index + pd.Timedelta(hours=1)
    return pd.DataFrame({"hour": target.hour, "weekday": target.day_of_week, "lag_1": value, "lag_2": value.shift(1),
                         "lag_3": value.shift(2), "lag_24": value.shift(23), "temperature": df["T"],
                         "relative_humidity": df["RH"]}, index=df.index)


def forecast(model, df, gas):
    """Forecasts 1 and 2 hours ahead from every hour. For 2 hours the 1-hour forecast is fed back in."""
    x1 = features(df, gas)
    in1 = (x1["lag_1"] + model.predict(x1)).clip(lower=0)  # the model predicts the change from the last hour
    later = df.index + pd.Timedelta(hours=2)
    x2 = x1.assign(hour=later.hour, weekday=later.day_of_week, lag_1=in1, lag_2=x1["lag_1"], lag_3=x1["lag_2"],
                   lag_24=df[gas].shift(22))
    return in1, (in1 + model.predict(x2)).clip(lower=0)


def candidates():
    return {"Linear regression": LinearRegression(),
            "Random forest": RandomForestRegressor(n_estimators=60, max_depth=10, min_samples_leaf=5, random_state=0),
            "XGBoost": XGBRegressor(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, random_state=0)}


def load_delhi(path):
    """A CPCB station file from the 'Delhi Multi-Site Air-Quality Data Set' (Mendeley Data, CC BY 4.0)."""
    raw = pd.read_csv(path)
    time = pd.to_datetime(raw[["year", "month", "day", "hour"]].astype(int))
    df = raw.set_index(time).rename(columns={"Benzene": "C6H6", "AT": "T"})[[*GASES, "T", "RH"]]
    return df[~df.index.duplicated()].asfreq("h")


def split(df):
    """Split by time: the first 60% to learn, the next 20% to choose the model, the last 20% to test."""
    hour = np.arange(len(df))
    return np.select([hour < len(df) * 0.6, hour < len(df) * 0.8], ["train", "check"], "test")


def miss(actual, predicted):
    """Average distance between the real value and the forecast."""
    gap = (pd.Series(actual).reset_index(drop=True) - pd.Series(predicted).reset_index(drop=True)).abs()
    return round(float(gap.mean()), 3)


def test_misses(model, stations, gas):
    """How far off the forecasts were on the test months, next to simply repeating the last hour."""
    real1, real2, said1, said2, last = [], [], [], [], []
    for df in stations:
        in1, in2 = forecast(model, df, gas)
        now = df[gas]
        test = (split(df) == "test") & now.notna().to_numpy() & now.shift(-2).notna().to_numpy()
        real1.append(now.shift(-1)[test]), real2.append(now.shift(-2)[test])
        said1.append(in1[test]), said2.append(in2[test]), last.append(now[test])
    real1, real2, said1, said2, last = (pd.concat(x) for x in (real1, real2, said1, said2, last))
    return {"in_1_hour": miss(real1, said1), "in_2_hours": miss(real2, said2),
            "guess_1_hour": miss(real1, last), "guess_2_hours": miss(real2, last)}


def train(path, delhi_folder="data/delhi"):
    df = load(path)  # the Italian station: the app's demo, its test months and its Watch/Warning levels
    part = split(df)
    delhi = [load_delhi(p) for p in sorted(Path(delhi_folder).glob("*.csv"))]
    stations = [df, *delhi]
    report = {"source": Path(path).name, "hours": len(df), "test_start": str(df.index[part == "test"][0]), "gases": {},
              "periods": {p: [str(df.index[part == p][0].date()), str(df.index[part == p][-1].date()), int((part == p).sum())]
                          for p in ("train", "check", "test")},
              "also_learned_from": {"name": f"CPCB, {len(delhi)} stations in Delhi, India", "hours": sum(len(d) for d in delhi),
                                    "from": str(min(d.index[0] for d in delhi).date()), "to": str(max(d.index[-1] for d in delhi).date())}
              if delhi else None}
    MODELS.mkdir(exist_ok=True)
    for gas, (_, name, unit) in GASES.items():
        # The rows of every station together; each station is split by time on its own
        X = pd.concat([features(d, gas) for d in stations])
        y = pd.concat([d[gas].shift(-1) - d[gas] for d in stations])  # the change to the next hour
        parts = np.concatenate([split(d) for d in stations])
        usable = (y.notna() & X["lag_1"].notna()).to_numpy()
        train_rows, check_rows = usable & (parts == "train"), usable & (parts == "check")
        italy = np.arange(len(X)) < len(df)

        # Try each model on the training months and keep the one that is closest on the checking months
        scores, fitted = {"Same as last hour": miss(y[check_rows], 0 * y[check_rows])}, {}
        for label, estimator in candidates().items():
            fitted[label] = make_pipeline(SimpleImputer(strategy="median"), estimator).fit(X[train_rows], y[train_rows])
            scores[label] = miss(y[check_rows], fitted[label].predict(X[check_rows]))
        best = min(fitted, key=scores.get)
        here = check_rows & italy
        unusual = np.quantile((y[here] - fitted[best].predict(X[here])).abs(), 0.99)

        # Retrain the winner on training + checking months, then test it on the last months it has never seen
        model = make_pipeline(SimpleImputer(strategy="median"), candidates()[best])
        model.fit(X[train_rows | check_rows], y[train_rows | check_rows])
        joblib.dump(model, MODELS / f"{gas}.joblib", compress=3)
        estimator = model[-1]
        weight = getattr(estimator, "feature_importances_", None)
        if weight is None:
            weight = np.abs(estimator.coef_) * X.std().to_numpy()
        now = df[gas]
        limits, source = LIMITS.get(gas, (now[part != "test"].quantile([0.95, 0.99]).round(1).tolist(),
                                           "No short-term health limit: higher than 95 and 99 of 100 earlier hours at this station"))
        report["gases"][gas] = {
            "name": name, "unit": unit, "model": best,
            "scores": dict(sorted(scores.items(), key=lambda item: item[1])),
            "test": test_misses(model, [df], gas),
            "test_delhi": test_misses(model, delhi, gas) if delhi else None,
            "limits": limits, "limit_source": source,
            "unusual_miss": round(float(unusual), 3),
            "typical_change": round(float(now.diff().abs()[part == "train"].mean()), 3),
            "missing": round(float(now.isna().mean() * 100), 1),
            "top_inputs": [FEATURES[i] for i in np.argsort(weight)[::-1][:3]],
        }
        print(f"{gas}: {best} (1 hour off by {report['gases'][gas]['test']['in_1_hour']} {unit} in Italy, "
              f"{(report['gases'][gas]['test_delhi'] or {}).get('in_1_hour')} in Delhi)")
    (MODELS / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    train(sys.argv[1] if len(sys.argv) > 1 else "data/AirQualityUCI.csv")
