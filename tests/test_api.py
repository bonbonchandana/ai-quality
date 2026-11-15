"""API tests. Run them from the project folder:  .venv\\Scripts\\python -m pytest -q"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402

client = TestClient(main.app)
EXAMPLE = {"pollutant": "CO", "hour": 18, "weekday": 2, "lag_1": 2.4, "lag_2": 2.0, "lag_3": 1.7,
           "lag_24": 2.9, "temperature": 12.5, "relative_humidity": 55.0, "absolute_humidity": 0.8}
CASES = [(d["id"], p["key"]) for d in main.datasets() for p in d["pollutants"]]


def test_root_and_health():
    assert client.get("/").json()["message"] == "Air Quality Prediction API is running"
    assert client.get("/health").json()["status"] == "ok"


def test_postman_example_works():
    r = client.post("/predict", json=EXAMPLE)
    assert r.status_code == 200 and r.json()["prediction"] >= 0


@pytest.mark.parametrize("dataset,pollutant", CASES)
def test_every_model_reproduces_its_test_predictions(dataset, pollutant):
    """The API should give the same number the training script saved."""
    sample = client.get(f"/api/sample/{dataset}/{pollutant}").json()
    saved = {p["t"]: p["predicted"] for p in main.load_results(dataset, pollutant)["test_predictions"]}
    out = client.post("/predict", json=sample["input"]).json()
    assert abs(out["prediction"] - max(0.0, saved[sample["time"]])) < 1e-3
    assert "flagged" in out["episode_check"]


def test_optional_inputs_can_be_left_out():
    body = {k: v for k, v in EXAMPLE.items() if k not in ("lag_2", "lag_3", "lag_24", "absolute_humidity")}
    assert client.post("/predict", json=body).status_code == 200


@pytest.mark.parametrize("change", [{"hour": 25}, {"relative_humidity": 150}, {"lag_1": "high"}])
def test_invalid_input_returns_422(change):
    assert client.post("/predict", json={**EXAMPLE, **change}).status_code == 422


def test_missing_required_field_returns_422():
    body = dict(EXAMPLE)
    body.pop("lag_1")
    assert client.post("/predict", json=body).status_code == 422


def test_unknown_things_return_404():
    assert client.get("/predictions").status_code == 404
    assert client.post("/predict", json={**EXAMPLE, "pollutant": "XYZ"}).status_code == 404
    assert client.post("/predict", json={**EXAMPLE, "dataset": "nope"}).status_code == 404


def test_upload_rejects_a_file_without_pollutants():
    r = client.post("/api/upload", files={"file": ("bad.csv", b"a,b,c,d\n1,2,3,4\n", "text/csv")})
    assert r.status_code == 422


def test_dashboard_is_served():
    assert len(client.get("/api/datasets").json()) >= 2
    assert client.get("/dashboard/").status_code == 200
