"""Live air quality for any city, using free Open-Meteo data (no API key, no sign-up).

For the chosen place we:
  1. download the last 92 days of hourly air quality and weather, plus the weather forecast for the next 2 days
  2. train our model on that history (same method as train_model.py: predict the change from the last hour)
  3. forecast fine dust (PM2.5) hour by hour for the next 24 hours, with a likely range
  4. check how good those forecasts are on the last 10 days, and look for unusual hours in the last month

Data: Open-Meteo (https://open-meteo.com), which serves the CAMS air quality model. It estimates pollution on an
~11 km grid everywhere, so it is not a reading from one street sensor. Free for non-commercial use, with attribution.
"""
import time

import httpx
import numpy as np
import pandas as pd
from sklearn.base import clone

import train_model as tm

AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

POLLUTANTS = {  # Open-Meteo name -> (short name, plain description)
    "pm2_5": ("PM2.5", "Tiny particles that reach deep into the lungs. The main thing the air quality index looks at."),
    "pm10": ("PM10", "Coarse dust from roads, building work and soil."),
    "nitrogen_dioxide": ("NO2", "A gas mostly from vehicle exhaust."),
    "ozone": ("O3", "Ground-level ozone. Forms in sunlight and is usually highest in the afternoon."),
    "sulphur_dioxide": ("SO2", "A gas mostly from burning coal and from industry."),
    "carbon_monoxide": ("CO", "A gas from incomplete burning, such as traffic and stoves."),
}
WEATHER = {
    "temperature_2m": "temperature", "relative_humidity_2m": "relative_humidity", "surface_pressure": "pressure",
    "dew_point_2m": "dew_point", "precipitation": "rain", "wind_speed_10m": "wind_speed",
}

# US EPA air quality index for PM2.5 (2024 breakpoints), with plain-language advice.
AQI_BANDS = [
    (0.0, 9.0, 0, 50, "Good", "#16a34a", "Air is clean. A good time to be outside."),
    (9.1, 35.4, 51, 100, "Moderate", "#ca8a04", "Fine for most people. Very sensitive people may want to take it easy."),
    (35.5, 55.4, 101, 150, "Unhealthy for sensitive groups", "#ea580c",
     "Children, older people and anyone with asthma or heart problems should limit long outdoor activity."),
    (55.5, 125.4, 151, 200, "Unhealthy", "#dc2626", "Everyone should cut down on long or heavy outdoor activity."),
    (125.5, 225.4, 201, 300, "Very unhealthy", "#9333ea", "Avoid outdoor activity. Keep windows closed if you can."),
    (225.5, 500.4, 301, 500, "Hazardous", "#7f1d1d", "Stay indoors and keep activity low."),
]

CACHE = {}               # (lat, lon) -> (time saved, result)
CACHE_SECONDS = 3600
HISTORY_DAYS = 92


def aqi_from_pm25(pm):
    """Turns a PM2.5 value (µg/m³) into the 0-500 air quality index and its category."""
    pm = max(0.0, float(pm))
    for lo, hi, a_lo, a_hi, name, color, advice in AQI_BANDS:
        if pm <= hi or hi == AQI_BANDS[-1][1]:
            pm_c = min(pm, hi)
            aqi = round(a_lo + (a_hi - a_lo) * (pm_c - lo) / (hi - lo)) if pm_c >= lo else a_lo
            return {"aqi": int(aqi), "category": name, "color": color, "advice": advice}
    last = AQI_BANDS[-1]
    return {"aqi": 500, "category": last[4], "color": last[5], "advice": last[6]}


def search_places(query, count=6):
    r = httpx.get(GEOCODE_URL, params={"name": query, "count": count, "language": "en"}, timeout=20)
    r.raise_for_status()
    return [{"name": p["name"], "region": p.get("admin1", ""), "country": p.get("country", ""),
             "lat": round(p["latitude"], 4), "lon": round(p["longitude"], 4)} for p in r.json().get("results", [])]


def fetch(lat, lon):
    """Hourly air quality + weather: the last 92 days and the next 2 days, in local time."""
    common = {"latitude": lat, "longitude": lon, "past_days": HISTORY_DAYS, "forecast_days": 2, "timezone": "auto"}
    air = httpx.get(AIR_URL, params={**common, "hourly": ",".join(POLLUTANTS)}, timeout=60)
    weather = httpx.get(WEATHER_URL, params={**common, "hourly": ",".join(WEATHER)}, timeout=60)
    air.raise_for_status()
    weather.raise_for_status()
    a, w = air.json(), weather.json()
    df = pd.DataFrame(a["hourly"]).merge(pd.DataFrame(w["hourly"]), on="time", how="outer")
    df["time"] = pd.to_datetime(df["time"])
    df = df.set_index("time").sort_index().asfreq("h")
    df = df.rename(columns=WEATHER)
    now = pd.Timestamp.now(tz=w.get("timezone", "UTC")).tz_localize(None).floor("h")
    return df, now, w.get("timezone", "UTC")


def features_at(t, series, df):
    """The model inputs for hour t, using `series` for the pollutant values (real or already forecast)."""
    row = {"hour": t.hour, "weekday": t.day_of_week}
    for k in (1, 2, 3, 24):
        row[f"lag_{k}"] = series.get(t - pd.Timedelta(hours=k), np.nan)
    for name in WEATHER.values():
        prev = t - pd.Timedelta(hours=1)
        row[name] = df[name].get(prev, np.nan) if name in df.columns else np.nan
    return row


def roll_forward(model, cols, start, hours, history, df):
    """Forecasts `hours` steps from `start`, feeding each forecast back in as the next hour's 'last value'."""
    series = history.copy()
    out = []
    for step in range(hours):
        t = start + pd.Timedelta(hours=step)
        x = pd.DataFrame([features_at(t, series, df)])[cols].astype(float)
        if np.isnan(x["lag_1"].iloc[0]):
            break
        value = max(0.0, float(tm.predict_level(model, x)[0]))
        series[t] = value
        out.append((t, value))
    return out


def weather_reasons(df, now, worst_hour):
    """Plain sentences on how the next 24 hours of weather will push pollution up or down."""
    nxt = df.loc[now + pd.Timedelta(hours=1):now + pd.Timedelta(hours=24)]
    reasons = []
    if "wind_speed" in nxt and nxt["wind_speed"].notna().any():
        wind = float(nxt["wind_speed"].mean())
        if wind < 8:
            reasons.append(f"Light winds (about {wind:.0f} km/h), so pollution isn't blown away and can build up.")
        elif wind > 20:
            reasons.append(f"Strong winds (about {wind:.0f} km/h) will help blow pollution away.")
        else:
            reasons.append(f"Moderate winds (about {wind:.0f} km/h) will move some pollution along.")
    if "rain" in nxt and nxt["rain"].notna().any():
        rain = float(nxt["rain"].sum())
        reasons.append(f"Rain is expected (about {rain:.0f} mm), which washes dust out of the air." if rain >= 1
                       else "No real rain expected, so nothing will wash the dust out.")
    if "relative_humidity" in nxt and nxt["relative_humidity"].notna().any() and nxt["relative_humidity"].mean() > 75:
        reasons.append("The air is humid, which helps fine particles form and hang around.")
    if worst_hour is not None and (worst_hour.hour >= 21 or worst_hour.hour <= 9):
        reasons.append("At night and early morning the air near the ground is still and cool, "
                       "so smoke and exhaust collect. That's why levels often peak then.")
    return reasons


def compare_with_normal(pm, now):
    """How the last 24 hours compare with every day of the last 3 months."""
    daily = pm.loc[:now].resample("D").mean().dropna()
    last_day = float(pm.loc[now - pd.Timedelta(hours=23):now].mean())
    worse_than = float((daily < last_day).mean() * 100)
    typical = float(daily.median())
    if worse_than >= 80:
        verdict = "much worse than usual"
    elif worse_than >= 60:
        verdict = "a bit worse than usual"
    elif worse_than > 40:
        verdict = "about normal"
    elif worse_than > 20:
        verdict = "a bit better than usual"
    else:
        verdict = "much better than usual"
    return {
        "last_24h_avg": round(last_day, 1), "typical_day": round(typical, 1), "worse_than_pct": round(worse_than),
        "verdict": verdict, "days": len(daily),
        # Berkeley Earth's rough rule: breathing 22 µg/m³ of PM2.5 for a day is like smoking one cigarette
        "cigarettes": round(last_day / 22, 1),
        "daily": [{"date": d.strftime("%Y-%m-%d"), "pm25": round(float(v), 1), **aqi_from_pm25(v)} for d, v in daily.items()],
    }


def analyse(lat, lon, name=""):
    key = (round(lat, 2), round(lon, 2))
    saved = CACHE.get(key)
    if saved and time.time() - saved[0] < CACHE_SECONDS:
        return saved[1]

    df, now, tz = fetch(lat, lon)
    target = "pm2_5"
    past = df.loc[:now]
    y = past[target]
    weather = {n: n for n in WEATHER.values() if n in df.columns}
    X = tm.make_features(past, target, weather)
    change = y - X["lag_1"]
    cols = list(X.columns)
    ok = (y.notna() & X["lag_1"].notna()).to_numpy()
    rows = np.arange(24, len(past))
    n = len(past)
    check_from = n - 24 * 10            # last 10 days: measure how good the forecasts are
    pick_from = check_from - 24 * 14    # 14 days before that: choose the model

    # 1) choose between Linear Regression and a small XGBoost on the 14 days before the check period
    train = rows[(rows < pick_from) & ok[rows]]
    pick = rows[(rows >= pick_from) & (rows < check_from) & ok[rows]]
    best = None
    for model_name, options in tm.candidate_models("cpu", light=True).items():
        m = tm.make_pipeline(clone(options[0])).fit(X.iloc[train], change.iloc[train])
        err = np.abs(y.iloc[pick].to_numpy() - tm.predict_level(m, X.iloc[pick])).mean()
        if best is None or err < best[0]:
            best = (err, model_name, options[0])
    model_name = best[1]

    # 2) how good are 24-hour forecasts? replay one forecast per day over the last 10 days
    before_check = rows[(rows < check_from) & ok[rows]]
    check_model = tm.make_pipeline(clone(best[2])).fit(X.iloc[before_check], change.iloc[before_check])
    errors = {h: [] for h in range(1, 25)}
    same_errors = {h: [] for h in range(1, 25)}
    for day in range(10):
        start = past.index[check_from] + pd.Timedelta(hours=24 * day)
        history = y.loc[:start - pd.Timedelta(hours=1)]
        for step, (t, value) in enumerate(roll_forward(check_model, cols, start, 24, history, df), start=1):
            if t in y.index and not np.isnan(y[t]):
                errors[step].append(abs(y[t] - value))
                same_errors[step].append(abs(y[t] - history.iloc[-1]))
    typical = {h: float(np.median(v)) for h, v in errors.items() if v}
    range80 = {h: float(np.quantile(v, 0.8)) for h, v in errors.items() if v}
    same = {h: float(np.median(v)) for h, v in same_errors.items() if v}

    # 3) unusual hours in the last month (same checks as the research datasets)
    month_from = n - 24 * 30
    base = rows[(rows < month_from) & ok[rows]]
    month_model = tm.make_pipeline(clone(best[2])).fit(X.iloc[base], change.iloc[base])
    ref = rows[(rows >= month_from - 24 * 14) & (rows < month_from) & ok[rows]]
    limit = float(np.quantile(np.abs(y.iloc[ref].to_numpy() - tm.predict_level(month_model, X.iloc[ref])), 0.95))
    month = rows[(rows >= month_from) & ok[rows]]
    pred = pd.DataFrame({"actual": y.iloc[month], "predicted": tm.predict_level(month_model, X.iloc[month])})
    pred["residual"] = pred["actual"] - pred["predicted"]
    pred["flagged"] = pred["residual"].abs() > limit
    miss = X.iloc[month].isna()
    pred["missing_inputs"] = miss.sum(axis=1)
    pred["missing_names"] = [list(miss.columns[r]) for r in miss.to_numpy()]
    pred["gap_before"] = y.isna().rolling(6, min_periods=1).sum().shift(1).reindex(pred.index).fillna(0)
    pred["same_for_hours"] = (y.groupby((y != y.shift()).cumsum()).cumcount() + 1).reindex(pred.index).fillna(0)
    pred["jump_size"] = (y.diff().abs() / y.diff().iloc[:month_from].std()).reindex(pred.index).fillna(0)
    agree = pd.DataFrame(index=pred.index)
    for col, (short, _) in POLLUTANTS.items():
        if col != target and col in past.columns:
            prior = past[col].shift(1).rolling(24, min_periods=12)
            agree[short] = ((past[col] - prior.mean()) / prior.std()).reindex(pred.index)
    episodes = tm.find_episodes(pred, "PM2.5", "µg/m³", agree, limit)

    # 4) final model on all history, then forecast the next 24 hours
    everything = rows[ok[rows]]
    final = tm.make_pipeline(clone(best[2])).fit(X.iloc[everything], change.iloc[everything])
    forecast = roll_forward(final, cols, now + pd.Timedelta(hours=1), 24, y.loc[:now].dropna(), df)

    current = float(y.dropna().iloc[-1])
    now_info = aqi_from_pm25(current)
    fc = []
    for step, (t, value) in enumerate(forecast, start=1):
        band = range80.get(step, range80[max(range80)])
        fc.append({"time": t.isoformat(), "hours_ahead": step, "pm25": round(value, 1),
                   "low": round(max(0.0, value - band), 1), "high": round(value + band, 1), **aqi_from_pm25(value)})

    best_hour = min(fc, key=lambda f: f["pm25"]) if fc else None
    worst_hour = max(fc, key=lambda f: f["pm25"]) if fc else None
    trend = fc[-1]["pm25"] - current if fc else 0
    direction = "get worse" if trend > 5 else "improve" if trend < -5 else "stay about the same"
    headline = (f"The air in {name or 'this area'} is {now_info['category'].lower()} right now "
                f"(air quality index {now_info['aqi']}). Over the next 24 hours it is expected to {direction}.")

    gain_24 = (1 - typical.get(24, 0) / same[24]) * 100 if same.get(24) else 0
    accuracy = {
        "typical_error_1h": round(typical.get(1, 0), 1), "typical_error_6h": round(typical.get(6, 0), 1),
        "typical_error_24h": round(typical.get(24, 0), 1), "same_value_error_24h": round(same.get(24, 0), 1),
        "better_than_no_change_24h_pct": round(gain_24, 1), "days_checked": 10,
        "plain": (f"We replayed our forecast on each of the last 10 days and compared it with what really happened. "
                  f"One hour ahead it was usually within {typical.get(1, 0):.0f} µg/m³, and 24 hours ahead within "
                  f"{typical.get(24, 0):.0f} µg/m³. "
                  + (f"That is {gain_24:.0f}% closer than simply assuming the air stays the same."
                     if gain_24 > 0 else "Here the air changes slowly, so it is about as good as assuming it stays the same.")),
    }

    pollutants_now = []
    for col, (short, plain) in POLLUTANTS.items():
        if col in past.columns and past[col].notna().any():
            pollutants_now.append({"key": short, "value": round(float(past[col].dropna().iloc[-1]), 1), "unit": "µg/m³",
                                   "about": plain})

    result = {
        "place": name, "lat": lat, "lon": lon, "timezone": tz, "updated": now.isoformat(),
        "now": {"time": y.dropna().index[-1].isoformat(), "pm25": round(current, 1), **now_info},
        "headline": headline, "forecast": fc,
        "best_time": best_hour and {"time": best_hour["time"], "aqi": best_hour["aqi"], "category": best_hour["category"]},
        "worst_time": worst_hour and {"time": worst_hour["time"], "aqi": worst_hour["aqi"], "category": worst_hour["category"]},
        "last_48h": [{"time": t.isoformat(), "pm25": None if np.isnan(v) else round(float(v), 1)}
                     for t, v in y.loc[now - pd.Timedelta(hours=47):now].items()],
        "pollutants": pollutants_now, "accuracy": accuracy, "model": model_name,
        "normal": compare_with_normal(y, now),
        "reasons": weather_reasons(df, now, pd.Timestamp(worst_hour["time"]) if worst_hour else None),
        "episodes": sorted(episodes, key=lambda e: -e["severity"])[:6], "episode_count": len(episodes),
        "episode_counts": {k: sum(e["type"] == k for e in episodes) for k in tm.KINDS},
        "source": "Open-Meteo (CAMS air quality model, about 11 km resolution). Estimated values, not a single street sensor.",
    }
    CACHE[key] = (time.time(), result)
    return result
