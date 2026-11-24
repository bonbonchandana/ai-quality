"""Tests for the UCI-only JSON API."""
import sys
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402

client = TestClient(main.app)


def test_health_is_uci_only():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["dataset"] == "uci-italy"


def test_dataset_metadata_is_json_backed():
    body = client.get("/api/datasets")
    assert body.status_code == 200
    assert body.json()["id"] == "uci-italy"
    assert {p["key"] for p in body.json()["pollutants"]} == {"CO", "NO2", "NOx", "C6H6"}


def test_results_report_and_sample_are_available():
    assert client.get("/api/results/CO").status_code == 200
    assert client.get("/api/report/CO").status_code == 200
    assert client.get("/api/sample/CO").status_code == 200


def test_predict_uses_saved_model():
    sample = client.get("/api/sample/CO").json()
    response = client.post("/predict", json={"pollutant": "CO", "features": sample["features"], "observed": sample["observed"]})
    assert response.status_code == 200
    assert response.json()["dataset"] == "uci-italy"
    assert response.json()["prediction"] >= 0


def test_only_uci_routes_are_exposed():
    assert client.get("/api/results/beijing-aotizhongxin/CO").status_code == 404
    assert client.get("/api/live").status_code == 404
    assert client.post("/api/upload").status_code == 404


def test_invalid_prediction_is_rejected():
    sample = client.get("/api/sample/CO").json()
    sample["features"]["hour"] = 25
    assert client.post("/predict", json={"pollutant": "CO", "features": sample["features"]}).status_code == 422


def test_episode_csv_is_available():
    response = client.get("/api/episodes/CO")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.decode("utf-8-sig").startswith("start,end,hours_flagged")


def test_dashboard_is_served():
    page = client.get("/dashboard/")
    assert page.status_code == 200
    assert "Air Health Portal" in page.text


def test_postman_request_from_the_pdf_works():
    body = {"pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7, "lag_24": 2.9,
            "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}
    response = client.post("/predict", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["prediction"] >= 0


def test_pollutant_names_in_any_case():
    for name in ("NOx", "nox", "NOX"):
        assert client.get(f"/api/results/{name}").status_code == 200
    assert client.post("/predict", json={"pollutant": "nox", "hour": 8, "weekday": 1, "lag_1": 120}).status_code == 200


def test_page_style_predict_ignores_unnamed_fields():
    sample = client.get("/api/sample/CO").json()
    features = {**sample["features"], "": None}      # a form button has no name
    assert client.post("/predict", json={"pollutant": "CO", "features": features}).status_code == 200


def test_portal_uses_only_the_real_dataset():
    script = client.get("/dashboard/app.js").text
    for made_up in ("Hyderabad", "Delhi", "Bengaluru", "SAMPLE_GROUPS", "pm25At", "Sample data"):
        assert made_up not in script, made_up
    for endpoint in ("/api/datasets", "/api/results/", "/api/forecast/", "/api/episodes/", "/api/report/"):
        assert endpoint in script, endpoint


def test_forecast_one_to_three_hours_ahead():
    r = client.get("/api/forecast/CO")
    assert r.status_code == 200
    f = r.json()
    n = len(f["times"])
    assert n > 1000 and all(len(f[k]) == n for k in ("now", "f1", "f2", "f3"))
    # the 1-hour forecast is exactly the model's own test prediction for that hour
    results = client.get("/api/results/CO").json()
    predicted = {p["t"][:16]: p["predicted"] for p in results["test_predictions"]}
    checked = 0
    for t, f1 in zip(f["times"][:200], f["f1"][:200]):
        nxt = (pd.Timestamp(t) + pd.Timedelta(hours=1)).isoformat()[:16]
        if f1 is not None and nxt in predicted:
            assert abs(f1 - predicted[nxt]) < 1e-2
            checked += 1
    assert checked > 50
    # forecasts further ahead are harder: the typical miss grows with the horizon
    assert f["mae"]["1"] < f["mae"]["3"]


def test_forecast_unknown_pollutant():
    assert client.get("/api/forecast/XYZ").status_code == 404


def test_forecast_alert_levels_come_from_training_data():
    for p in ("CO", "NO2", "NOx", "C6H6"):
        levels = client.get(f"/api/forecast/{p}").json()["levels"]
        assert 0 < levels["high"] < levels["very_high"]


def test_forecast_uses_no_future_data(monkeypatch):
    import numpy as np
    real = main.dataset_frame()
    cut = pd.Timestamp("2005-02-20 10:00")
    noisy = real.copy()
    later = noisy.index > cut
    noisy.loc[later, :] = noisy.loc[later, :] * np.random.default_rng(0).uniform(0.2, 5, size=noisy.loc[later, :].shape)
    before = main.forecast_table.__wrapped__("CO")
    monkeypatch.setattr(main, "dataset_frame", lambda: noisy)
    after = main.forecast_table.__wrapped__("CO")
    earlier = [i for i, t in enumerate(before["times"]) if pd.Timestamp(t) + pd.Timedelta(hours=3) <= cut]
    assert len(earlier) > 500
    for k in ("f1", "f2", "f3"):
        assert [before[k][i] for i in earlier] == [after[k][i] for i in earlier]


def test_forecast_shares_hours_and_marks_missing_readings():
    tables = [client.get(f"/api/forecast/{p}").json() for p in ("CO", "NO2", "NOx", "C6H6")]
    assert all(t["times"] == tables[0]["times"] for t in tables)
    co = tables[0]
    missing = [i for i, v in enumerate(co["now"]) if v is None]
    assert missing and all(co["f1"][i] is None for i in missing)


def test_episode_csv_uses_plain_labels():
    lines = client.get("/api/episodes/CO").content.decode("utf-8-sig").splitlines()
    assert not any(raw in "\n".join(lines) for raw in (",Unusual pollution,", ",Data limitation,", ",Unclear,"))


def test_example_file_can_be_checked():
    example = client.get("/api/example-file")
    assert example.status_code == 200 and "attachment" in example.headers["content-disposition"]
    r = client.post("/api/check/CO", files={"file": ("readings.csv", example.content, "text/csv")})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["hours"] > 100 and len(out["predicted"]) == len(out["actual"]) == len(out["times"]) == out["hours"]
    assert out["typical_miss"] is not None and out["typical_miss"] < 2


def test_check_reads_the_original_uci_format():
    rows = ["Date;Time;CO(GT);T;RH;AH;;"]
    for h in range(30):
        rows.append(f"10/03/2004;{h % 24:02d}.00.00;{2 + (h % 5) * 0.3:.1f}".replace(".", ",", 1) + ";13,6;48,9;0,7578;;")
    rows[10] = "10/03/2004;09.00.00;-200;13,6;48,9;0,7578;;"   # -200 means missing in the UCI file
    text = "\n".join(rows).encode()
    r = client.post("/api/check/CO", files={"file": ("uci.csv", text, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["hours"] >= 20


def test_check_rejects_files_without_the_pollutant():
    text = b"timestamp,NO2(GT)\n2005-01-01 00:00,100\n2005-01-01 01:00,110\n"
    r = client.post("/api/check/CO", files={"file": ("x.csv", text, "text/csv")})
    assert r.status_code == 422 and "CO" in r.json()["detail"]
