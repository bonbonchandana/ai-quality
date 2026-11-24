import pandas as pd
import pytest
from fastapi.testclient import TestClient

import main
from train import GASES, features

client = TestClient(main.app)
POSTMAN = {"pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
           "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}


@pytest.fixture
def station(tmp_path, monkeypatch):
    """A station with a key, saving its readings in a temporary folder; back to the demo afterwards."""
    monkeypatch.setattr(main, "LIVE", tmp_path / "readings.csv")
    monkeypatch.setattr(main, "SENT", tmp_path / "sent.txt")
    monkeypatch.setenv("ADMIN_KEY", "test-key")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    yield
    main.LIVE.unlink(missing_ok=True)
    main.refresh()


def test_health_and_page():
    assert client.get("/health").json()["status"] == "ok"
    assert "Air Health" in client.get("/dashboard/").text


def test_postman_predict_with_a_flat_body_and_any_case():
    r = client.post("/predict", json=POSTMAN).json()
    assert r["pollutant"] == "CO" and r["prediction"] > 0
    assert client.post("/predict", json={**POSTMAN, "pollutant": "nox", "lag_1": 240}).json()["pollutant"] == "NOx"
    assert client.post("/predict", json={"pollutant": "CO", "hour": 18}).status_code == 422
    assert client.post("/predict", json={**POSTMAN, "pollutant": "O3"}).status_code == 404


def test_features_never_look_into_the_future():
    df = main.DEMO.copy()
    t = df.index[100]
    before = features(df, "CO").loc[t]
    df.loc[t + pd.Timedelta(hours=1):, "CO"] = 999  # change everything after t
    pd.testing.assert_series_equal(before, features(df, "CO").loc[t])


def test_today_has_every_gas_a_level_and_advice():
    d = client.get("/api/today").json()
    assert [g["gas"] for g in d["gases"]] == list(GASES)
    assert d["level"] in main.LEVELS and sum(d["pie"].values()) <= 24
    assert d["ventilation"] and d["headline"]


def test_history_days_and_a_day():
    days = client.get("/api/days").json()["days"]
    assert set(days.values()) <= set(main.LEVELS)
    d = client.get(f"/api/day/{list(days)[-2]}").json()
    assert len(d["peaks"]) == 4 and all(e["type"] in ("alert", "sensor", "unusual") for e in d["events"])
    assert client.get("/api/day/not-a-date").status_code == 422


def test_unusual_periods_are_labelled():
    kinds = {e["kind"] for e in main.TEST["events"] if e["type"] == "unusual"}
    assert kinds and kinds <= {"Real pollution", "Sensor problem", "Not sure"}


def test_lookup_and_manual_check():
    t = client.get("/api/today").json()["time"]
    assert client.get("/api/lookup", params={"time": t}).json()["gases"][0]["real"] is not None
    r = client.post("/api/check", json={"gas": "CO", "time": t, "now": 16, "hour_ago": 14, "two_hours_ago": 12}).json()
    assert r["level"] == "warning" and r["message"].startswith("Air quality WARNING")


def test_readings_need_the_key(station):
    reading = [{"time": "2026-11-24T10:00", "CO": 1.0}]
    assert client.post("/api/readings", json=reading).status_code == 401
    assert client.post("/api/readings", json=reading, headers={"X-Key": "wrong"}).status_code == 401


def test_station_readings_switch_to_live_and_raise_an_alert(station):
    hours = pd.date_range("2026-11-24T00:00", periods=30, freq="h")
    rows = [{"time": t.isoformat(), "CO": 1.0 + i * 0.5, "NO2": 60, "NOx": 120, "C6H6": 3, "T": 10, "RH": 60} for i, t in enumerate(hours)]
    r = client.post("/api/readings", json=rows, headers={"X-Key": "test-key"}).json()
    assert r["saved"] == 30
    d = client.get("/api/today").json()
    assert d["live"] and d["time"] == "2026-11-25T05:00" and d["level"] == "warning"
    assert "alert CO" in main.SENT.read_text()  # handed to Telegram once (no token in tests, so nothing really goes out)


def test_upload_the_original_uci_file(station):
    text = open("data/AirQualityUCI.csv", encoding="utf-8").read().splitlines()
    sample = "\n".join(text[:49]).encode()  # header + 48 hours
    r = client.post("/api/upload", files={"file": ("day.csv", sample)}, headers={"X-Key": "test-key"}).json()
    assert r["saved"] == 48 and r["latest"].startswith("2004-03-12")
