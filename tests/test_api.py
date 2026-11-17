"""Tests for the UCI-only JSON API."""
import sys
from pathlib import Path

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
    assert client.get("/dashboard/").status_code == 200


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
