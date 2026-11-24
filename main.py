"""Air Health: forecasts air pollution 1 and 2 hours ahead and tells health organisations what to do.

Run locally:  uvicorn main:app --reload   then open http://127.0.0.1:8000
Settings (environment variables, all optional):
  ADMIN_KEY             lets the station (or the data team) send readings
  TELEGRAM_BOT_TOKEN    the bot that sends the alerts
  TELEGRAM_CHAT_ID      the chat of the health partners (hospitals, doctors, schools)
  TELEGRAM_DATA_CHAT_ID the chat of the data team (sensor problems)
"""
import io
import json
import os
import secrets
from datetime import datetime
from pathlib import Path

import httpx
import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from train import FEATURES, GASES, forecast, load

HERE = Path(__file__).parent
REPORT = json.loads((HERE / "models/report.json").read_text(encoding="utf-8"))
MODELS = {gas: joblib.load(HERE / f"models/{gas}.joblib") for gas in GASES}
LIVE, SENT = HERE / "live/readings.csv", HERE / "live/sent.txt"  # readings the station sent, and alerts already sent
LEVELS = ["none", "good", "watch", "warning"]  # from "no data" to the most serious
HOUR = pd.Timedelta(hours=1)

# ---------- what each level means, and who to tell ----------
MEANS = {  # gas: level: (what it means, what happens if it keeps rising)
    "CO": {"watch": ("Above the WHO daily safe level. Risky for people with heart disease if it lasts all day.",
                     "If it keeps rising, people with heart disease may get chest pain."),
           "warning": ("Above the WHO 8-hour safe level. People with heart disease may get chest pain.",
                       "If it keeps rising, headaches and dizziness near busy roads.")},
    "NO2": {"watch": ("Above the EU 1-hour limit. Asthma attacks become more likely.",
                      "If it keeps rising, breathing problems spread to more people."),
            "warning": ("At the EU alert level. Breathing problems for many people.",
                        "If it keeps rising, even healthy people are affected.")},
    "NOx": {"watch": ("Very heavy traffic pollution. Breathing problems are more likely near main roads.",
                      "If it keeps rising, treat it like a nitrogen dioxide alert."),
            "warning": ("Extreme traffic pollution for this area.", "If it keeps rising, reduce traffic in the area.")},
    "C6H6": {"watch": ("Unusually high benzene. Harmless for a day, harmful if it keeps happening.",
                       "If it keeps rising, find the source (traffic jams, fuel stations)."),
             "warning": ("Very high benzene for this area.", "Repeated high levels raise the long-term cancer risk.")},
}
TELL = {
    "watch": [("Hospitals and clinics", "Be ready for more asthma, heart and lung patients."),
              ("Doctors", "Tell patients with asthma, heart or lung disease to avoid busy roads and keep their medicines close."),
              ("Schools and the public", "People with asthma, heart or lung disease should spend less time outdoors near traffic.")],
    "warning": [("Hospitals and clinics", "Add emergency staff. Check oxygen and inhalers."),
                ("Doctors", "Call high-risk patients and check they have their medicines."),
                ("Schools and the public", "Stay indoors near busy roads. Move sports and breaks indoors."),
                ("City traffic office", "Reduce traffic near the station if possible.")],
}
TELL_BENZENE = {  # benzene is a long-term risk, so hospitals don't need to get ready
    "watch": [("Environment team", "Find the source (traffic jams, fuel stations)."),
              ("Schools and the public", "Avoid waiting near traffic jams and fuel stations.")],
    "warning": [("Environment team", "Find and stop the source today."),
                ("Schools and the public", "Keep windows closed near busy roads and fuel stations."),
                ("City traffic office", "Reduce traffic near the station if possible.")],
}


# ---------- small helpers ----------
def num(x, digits=2):
    return None if x is None or pd.isna(x) else round(float(x), digits)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M")


def clock(t):
    return f"{t.hour % 12 or 12} {'am' if t.hour < 12 else 'pm'}"


def grade(gas, values):
    """0 = no data, 1 = good, 2 = watch, 3 = warning, for each value."""
    watch, warning = REPORT["gases"][gas]["limits"]
    v = pd.Series(values, dtype=float)
    return pd.Series(np.select([v >= warning, v >= watch, v.notna()], [3, 2, 1], 0), index=v.index)


def runs(mask):
    """The first and last hour of each stretch where mask is True."""
    mask = mask.astype(bool)
    return list(zip(mask.index[mask & ~mask.shift(1, fill_value=False)], mask.index[mask & ~mask.shift(-1, fill_value=False)]))


def find_gas(name):
    for gas in GASES:
        if gas.lower() == str(name).lower():
            return gas
    raise HTTPException(404, f"Unknown pollutant '{name}'. Use one of: {', '.join(GASES)}.")


def advice(gas, level, peak, t):
    """What the level means, who to tell, and the message to send them."""
    if level not in ("watch", "warning"):
        return {"means": "Below the health limits.", "rising": "", "tell": [], "message": ""}
    name, unit = GASES[gas][1:]
    tell = (TELL_BENZENE if gas == "C6H6" else TELL)[level]
    means, rising = MEANS[gas][level]
    text = [f"Air quality {level.upper()}: {name}", f"Expected up to {num(peak, 1)} {unit} in the 2 hours after {clock(t)}, "
            f"{t:%a %d %b}.", means, "", *[f"{who}: {what}" for who, what in tell]]
    return {"means": means, "rising": rising, "tell": tell, "message": "\n".join(text)}


# ---------- the analysis: forecasts, alerts, sensor problems and unusual periods ----------
def sensor_problems(df, gas):
    """For each hour, why the reading looks wrong ('' when it looks fine)."""
    value, change = df[gas], df[gas].diff()
    stuck = (change == 0) & (change.shift(1) == 0) & (change.shift(2) == 0)
    others = sum((df[g].diff().abs() > 3 * REPORT["gases"][g]["typical_change"]).astype(int) for g in GASES if g != gas)
    lone_jump = (change.abs() > 6 * REPORT["gases"][gas]["typical_change"]) & (others == 0)
    return pd.Series(np.select([value.isna(), stuck, lone_jump],
                               ["no reading", "the same value for 4 hours", "a sudden jump no other gas showed"], ""), index=df.index)


def analyse(df):
    s = {"df": df, "in1": {}, "in2": {}, "ahead": {}, "problem": {}, "events": []}
    for gas, (_, name, unit) in GASES.items():
        in1, in2 = forecast(MODELS[gas], df, gas)
        problem = sensor_problems(df, gas)
        ahead = np.maximum(grade(gas, in1), grade(gas, in2)).where(problem == "", 0)  # no alerts from a broken sensor
        s["in1"][gas], s["in2"][gas], s["ahead"][gas], s["problem"][gas] = in1, in2, ahead, problem
        for start, end in runs(ahead >= 2):
            peak, level = max(in1[start:end].max(), in2[start:end].max()), LEVELS[int(ahead[start:end].max())]
            s["events"].append({"type": "alert", "gas": gas, "name": name, "start": iso(start), "end": iso(end + 2 * HOUR),
                                "level": level, "peak": num(peak), "text": advice(gas, level, peak, start)["message"]})
        for start, end in runs(problem != ""):
            if problem[start] == "no reading" and end - start < 2 * HOUR:
                continue  # a missing hour or two is normal; only longer gaps go to the data team
            s["events"].append({"type": "sensor", "gas": gas, "name": name, "start": iso(start), "end": iso(end), "why": problem[start],
                                "text": f"Data check: the {name.lower()} sensor shows {problem[start]} since {clock(start)}. "
                                        f"Health alerts for {name.lower()} are paused until it looks right."})

    # Unusual periods: the real value was much further from the forecast (made an hour before) than normal
    misses = {g: df[g] - s["in1"][g].shift(1) for g in GASES}
    flagged = {g: misses[g].abs() > REPORT["gases"][g]["unusual_miss"] for g in GASES}
    for gas, (_, name, unit) in GASES.items():
        for start, end in runs(flagged[gas]):
            hours, up = slice(start, end), misses[gas][start:end].sum() > 0
            also = [GASES[g][1].lower() for g in GASES if g != gas and (flagged[g][hours] & ((misses[g][hours] > 0) == up)).any()]
            bad = s["problem"][gas][start - 2 * HOUR:end]
            bad = bad[bad != ""]
            if len(bad):
                kind, why = "Sensor problem", f"The reading showed {bad.iloc[0]} around this time."
            elif also:
                kind, why = "Real pollution", f"{' and '.join(also).capitalize()} also changed at the same time, so it looks real."
            else:
                kind, why = "Not sure", "No other gas changed and the sensor looked fine."
            real = df[gas][hours].max() if up else df[gas][hours].min()
            s["events"].append({"type": "unusual", "gas": gas, "name": name, "start": iso(start), "end": iso(end), "kind": kind,
                                "why": why, "direction": "higher" if up else "lower", "real": num(real),
                                "expected": num(s["in1"][gas].shift(1)[hours].mean()), "unit": unit})
    s["events"].sort(key=lambda e: e["start"])
    return s


DEMO = load(HERE / "data/AirQualityUCI.csv").loc[pd.Timestamp(REPORT["test_start"]) - pd.Timedelta(days=1):]
TEST = analyse(DEMO)  # the test months (2005), shown until a station sends its own readings
STATE = {}


def read_live():
    return pd.read_csv(LIVE, index_col="time", parse_dates=True) if LIVE.exists() else None


def refresh():
    live = read_live()
    STATE.update(analyse(live.asfreq("h")) if live is not None else TEST, live=live is not None)


def current_hour():
    """Live: the latest reading. Demo: the 2005 hour with today's weekday and time, so rush hours line up."""
    df = STATE["df"]
    if STATE["live"]:
        return df.index[-1]
    now, first = pd.Timestamp.now(), df.index[0]
    monday = (first + pd.Timedelta(days=7 - first.weekday())).normalize()
    weeks = (df.index[-1] - monday).days // 7 - 1
    return monday + pd.Timedelta(weeks=now.isocalendar().week % weeks + 1, days=now.weekday(), hours=now.hour)


refresh()
app = FastAPI(title="Air Health", description="Air pollution forecasts and health alerts for health organisations.")


@app.get("/")
def home():
    return RedirectResponse("/dashboard/")


@app.get("/health")
def health():
    return {"status": "ok", "models": {gas: REPORT["gases"][gas]["model"] for gas in GASES}, "live": STATE["live"]}


@app.get("/api/today")
def today():
    s, t = STATE, current_hour()
    cards = []
    for gas, (_, name, unit) in GASES.items():
        in1, in2 = s["in1"][gas].get(t), s["in2"][gas].get(t)
        cards.append({"gas": gas, "name": name, "unit": unit, "now": num(s["df"][gas].get(t)), "in1": num(in1), "in2": num(in2),
                      "level": LEVELS[int(s["ahead"][gas].get(t, 0))], "problem": s["problem"][gas].get(t, ""),
                      "peak": max(in1 if pd.notna(in1) else 0, in2 if pd.notna(in2) else 0)})
    top = max(cards, key=lambda c: (LEVELS.index(c["level"]), c["peak"] / REPORT["gases"][c["gas"]]["limits"][1]))
    level, peak = top["level"], top["peak"]
    if level in ("watch", "warning"):
        at = t + (2 if (top["in2"] or 0) > (top["in1"] or 0) else 1) * HOUR
        headline = f"{top['name']} expected to reach {num(peak, 1)} {top['unit']} by {clock(at)}"
    else:
        headline = "Air is fine for the next 2 hours" if level == "good" else "No readings from the station right now"

    # Today so far: each hour gets the level of its worst gas
    hours = s["df"].loc[t.normalize():t]
    grades = pd.DataFrame({g: grade(g, hours[g]) for g in GASES})
    worst, cause = grades.max(axis=1), grades.idxmax(axis=1)
    silent = int((pd.Timestamp.now() - t) / HOUR) if s["live"] else 0
    return {"time": iso(t), "live": s["live"], "silent_hours": silent if silent > 2 else 0, "level": level, "headline": headline,
            **advice(top["gas"], level, peak, t), "gases": cards,
            "ventilation": "Switch building ventilation to recirculate (keep outdoor air out) for the next 2 hours."
                           if level in ("watch", "warning") else "Normal ventilation is fine.",
            "pie": {LEVELS[i]: int((worst == i).sum()) for i in range(4)},
            "causes": {GASES[g][1]: int(((worst >= 2) & (cause == g)).sum()) for g in GASES if ((worst >= 2) & (cause == g)).any()}}


@app.get("/api/days")
def days():
    df = STATE["df"].loc[:current_hour()]
    if not STATE["live"]:
        df = df.loc[REPORT["test_start"]:]
    worst = pd.DataFrame({g: grade(g, df[g]) for g in GASES}).max(axis=1).resample("D").max()
    return {"days": {str(d.date()): LEVELS[int(v)] for d, v in worst.items()}}


@app.get("/api/day/{date}")
def day(date: str):
    try:
        d = pd.Timestamp(date).normalize()
    except ValueError:
        raise HTTPException(422, "Use a date like 2005-03-14.")
    t = current_hour()
    hours = STATE["df"].loc[d:min(d + 23 * HOUR, t)]
    if hours.empty:
        raise HTTPException(404, "No readings for that day.")
    peaks = []
    for gas, (_, name, unit) in GASES.items():
        v = hours[gas]
        peaks.append({"gas": gas, "name": name, "unit": unit, "peak": num(v.max()), "level": LEVELS[int(grade(gas, [v.max()])[0])],
                      "at": clock(v.idxmax()) if v.notna().any() else None})
    events = [e for e in STATE["events"] if e["start"][:10] == str(d.date()) and e["start"] <= iso(t)]
    return {"date": str(d.date()), "peaks": peaks, "events": events}


@app.get("/api/lookup")
def lookup(time: datetime):
    """What was measured at an hour, and what had been forecast for it 1 and 2 hours before."""
    t, s = pd.Timestamp(time).floor("h"), STATE
    if t not in s["df"].index or t > current_hour():
        raise HTTPException(404, "No readings for that hour.")
    return {"time": iso(t), "gases": [{"gas": gas, "name": name, "unit": unit, "real": num(s["df"][gas][t]),
                                       "said_1h": num(s["in1"][gas].get(t - HOUR)), "said_2h": num(s["in2"][gas].get(t - 2 * HOUR)),
                                       "level": LEVELS[int(grade(gas, [s["df"][gas][t]])[0])]} for gas, (_, name, unit) in GASES.items()]}


class Manual(BaseModel):
    gas: str
    time: datetime
    now: float = Field(ge=0)
    hour_ago: float | None = Field(None, ge=0)
    two_hours_ago: float | None = Field(None, ge=0)
    temperature: float | None = None
    relative_humidity: float | None = Field(None, ge=0, le=100)


@app.post("/api/check")
def check(r: Manual):
    """Readings typed in by hand: the forecast for the next 2 hours, without saving anything."""
    gas, t = find_gas(r.gas), pd.Timestamp(r.time).floor("h")
    df = pd.DataFrame({gas: [r.two_hours_ago, r.hour_ago, r.now], "T": r.temperature, "RH": r.relative_humidity},
                      index=pd.date_range(end=t, periods=3, freq="h"), dtype=float)
    in1, in2 = (series.iloc[-1] for series in forecast(MODELS[gas], df, gas))
    level = LEVELS[int(grade(gas, [max(in1, in2)])[0])]
    return {"gas": gas, "name": GASES[gas][1], "unit": GASES[gas][2], "in1": num(in1), "in2": num(in2), "level": level,
            **advice(gas, level, max(in1, in2), t)}


@app.post("/predict")
def predict(body: dict):
    """The Postman request: a pollutant plus the model inputs (flat, or inside "features")."""
    gas = find_gas(body.get("pollutant", ""))
    row = {**body, **(body.get("features") or {})}
    x = pd.DataFrame([[row.get(f) for f in FEATURES]], columns=FEATURES).apply(pd.to_numeric, errors="coerce")
    if x["lag_1"].isna().any():
        raise HTTPException(422, "lag_1 (the last hour's value) is required.")
    value = max(0.0, float(x["lag_1"][0] + MODELS[gas].predict(x)[0]))
    return {"pollutant": gas, "prediction": round(value, 3), "unit": GASES[gas][2], "model": REPORT["gases"][gas]["model"]}


# ---------- readings from the station ----------
def check_key(key):
    expected = os.getenv("ADMIN_KEY")
    if not expected:
        raise HTTPException(503, "Adding readings is switched off. Set ADMIN_KEY on the server.")
    if not key or not secrets.compare_digest(key, expected):
        raise HTTPException(401, "Wrong key.")


def save(frame):
    """Adds readings (a time plus any of CO, NO2, NOx, C6H6, T, RH), then sends alerts for anything new."""
    try:
        frame = frame.set_index(pd.to_datetime(frame.pop("time")).dt.floor("h"))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(422, "Each reading needs a time, like 2026-11-24T14:00.")
    frame = frame[frame.index.notna()].reindex(columns=[*GASES, "T", "RH"]).apply(pd.to_numeric, errors="coerce")
    frame = frame.mask(frame == -200)
    old = read_live()
    readings = frame if old is None else pd.concat([old, frame])
    readings = readings[~readings.index.duplicated(keep="last")].sort_index()
    if frame.empty or readings.index[-1] - readings.index[0] > pd.Timedelta(days=3 * 365):
        raise HTTPException(422, "No usable readings, or they span more than 3 years.")
    LIVE.parent.mkdir(exist_ok=True)
    readings.to_csv(LIVE, index_label="time")
    refresh()
    notify()
    return {"saved": len(frame), "latest": iso(readings.index[-1])}


@app.post("/api/readings")
def add_readings(rows: list[dict], x_key: str | None = Header(None)):
    """For the station's software: a list like [{"time": "2026-11-24T14:00", "CO": 1.2, "NO2": 80, ...}]."""
    check_key(x_key)
    return save(pd.DataFrame(rows))


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), x_key: str | None = Header(None)):
    """For the data team: a CSV in the UCI format, or with a time column and gas columns."""
    check_key(x_key)
    raw = await file.read(5_000_001)  # never hold more than the limit in memory
    if len(raw) > 5_000_000:
        raise HTTPException(413, "The file is too big (5 MB at most).")
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        frame = load(io.StringIO(text)).rename_axis("time").reset_index() if text.startswith("Date;") else pd.read_csv(io.StringIO(text))
    except (ValueError, KeyError):
        raise HTTPException(422, "Could not read the file. Use the UCI format, or a CSV with a time column.")
    return save(frame)


def notify():
    """Sends new alerts to the health partners and sensor problems to the data team (Telegram), once each."""
    done = set(SENT.read_text(encoding="utf-8").splitlines()) if SENT.exists() else set()
    latest = iso(STATE["df"].index[-1])
    for e in STATE["events"]:
        key = f"{e['type']} {e['gas']} {e['start']}"
        if e["type"] != "unusual" and e["end"] >= latest and key not in done:  # still going on, and not sent yet
            token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID" if e["type"] == "alert" else "TELEGRAM_DATA_CHAT_ID")
            if token and chat:
                try:
                    httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", data={"chat_id": chat, "text": e["text"]}, timeout=10)
                except httpx.HTTPError:
                    continue  # try again with the next reading
            with SENT.open("a", encoding="utf-8") as f:
                f.write(key + "\n")


@app.get("/api/model")
def model():
    """For the data team: how the models were chosen and how they did on the test months."""
    test = TEST["df"].loc[REPORT["test_start"]:]
    out = {**REPORT, "times": [iso(t) for t in test.index], "real": {}, "forecast": {}, "unusual": {}}
    for gas in GASES:
        out["real"][gas] = [num(v, 1) for v in test[gas]]
        out["forecast"][gas] = [num(v, 1) for v in TEST["in1"][gas].shift(1).loc[test.index]]
        kinds = [e["kind"] for e in TEST["events"] if e["type"] == "unusual" and e["gas"] == gas and e["start"] >= iso(test.index[0])]
        out["unusual"][gas] = {k: kinds.count(k) for k in ("Real pollution", "Sensor problem", "Not sure")}
    return out


app.mount("/dashboard", StaticFiles(directory=HERE / "web", html=True), name="web")
