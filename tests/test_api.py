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
    sample = client.get("/api/sample/CO").json()["input"]
    response = client.post("/predict", json=sample)
    assert response.status_code == 200
    assert response.json()["dataset"] == "uci-italy"
    assert response.json()["prediction"] >= 0


def test_only_uci_routes_are_exposed():
    assert client.get("/api/results/beijing-aotizhongxin/CO").status_code == 404
    assert client.get("/api/live").status_code == 404
    assert client.post("/api/upload").status_code == 404


def test_invalid_prediction_is_rejected():
    sample = client.get("/api/sample/CO").json()["input"]
    sample["hour"] = 25
    assert client.post("/predict", json=sample).status_code == 422


def test_episode_csv_is_available():
    response = client.get("/api/episodes/CO")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.decode("utf-8-sig").startswith("start,end,hours_flagged")


def test_dashboard_is_served():
    assert client.get("/dashboard/").status_code == 200
