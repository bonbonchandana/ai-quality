"""API tests. Run from the project folder:  .venv\\Scripts\\python -m pytest -q"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402

client = TestClient(main.app)
EXAMPLE = {"pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7,
           "lag_24": 2.9, "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}


def test_root_and_health():
    assert client.get("/").json()["message"] == "Air Quality Prediction API is running"
    assert client.get("/health").json()["status"] == "ok"


@pytest.mark.parametrize("pollutant", ["CO", "NO2", "NOx", "C6H6"])
def test_predict_each_pollutant(pollutant):
    sample = client.get(f"/api/sample/{pollutant}").json()["input"]
    r = client.post("/predict", json=sample)
    assert r.status_code == 200
    body = r.json()
    assert body["pollutant"] == pollutant and body["prediction"] >= 0
    assert "flagged" in body["episode_check"]


def test_predict_matches_saved_test_predictions():
    """The API must give the same numbers as the training script."""
    preds = {p["t"]: p["predicted"] for p in main.results["CO"]["test_predictions"]}
    for _ in range(5):
        sample = client.get("/api/sample/CO").json()
        out = client.post("/predict", json=sample["input"]).json()["prediction"]
        assert abs(out - max(0.0, preds[sample["time"]])) < 1e-3


def test_optional_lags_can_be_left_out():
    body = {k: v for k, v in EXAMPLE.items() if k not in ("lag_2", "lag_3", "lag_24")}
    assert client.post("/predict", json=body).status_code == 200


@pytest.mark.parametrize("change", [{"hour": 25}, {"pollutant": "O3"}, {"relative_humidity": 150}, {"lag_1": "high"}])
def test_invalid_input_returns_422(change):
    assert client.post("/predict", json={**EXAMPLE, **change}).status_code == 422


def test_missing_required_field_returns_422():
    body = dict(EXAMPLE)
    body.pop("lag_1")
    assert client.post("/predict", json=body).status_code == 422


def test_unknown_paths_return_404():
    assert client.get("/predictions").status_code == 404
    assert client.get("/api/results/O3").status_code == 404


def test_dashboard_data():
    assert len(client.get("/api/pollutants").json()) == 4
    res = client.get("/api/results/NO2").json()
    assert res["test_predictions"] and res["models"] and "episodes" in res
    assert client.get("/dashboard/").status_code == 200
