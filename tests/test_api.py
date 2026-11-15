"""API tests: run with  .venv\\Scripts\\python -m pytest -q"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main  # noqa: E402

client = TestClient(main.app)


VALID = main.INPUTS.dropna().index.intersection(main.PRED[main.PRED["period"] == "test"].index)


def real_sample():
    return client.get("/api/samples", params={"t": VALID[100].isoformat()}).json()


def test_root_and_health():
    r = client.get("/")
    assert r.status_code == 200 and "running" in r.json()["message"]
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["model_loaded"] is True


def test_predict_valid_with_anomaly_check():
    s = real_sample()
    body = {**s["input"], "observed_co": s["observed"]}
    r = client.post("/predict", json=body)
    assert r.status_code == 200
    out = r.json()
    assert out["estimated_co_mg_m3"] >= 0
    assert out["interval"]["lower"] <= out["estimated_co_mg_m3"] <= out["interval"]["upper"]
    assert out["anomaly"]["classification_hint"] in {"normal", "unusual_pollution_candidate", "data_limitation_candidate"}
    assert out["contributions"] and out["contributions"][0]["feature"].startswith("baseline")


def test_predict_matches_training_predictions():
    """The API must reproduce the saved model's out-of-sample estimates exactly."""
    test = main.PRED[(main.PRED["period"] == "test")].dropna(subset=["estimated"]).iloc[::80][:20]
    for ts, row in test.iterrows():
        inp = main.INPUTS.loc[ts]
        body = {c: (None if pd.isna(inp[c]) else float(inp[c])) for c in main.INPUT_COLUMNS}
        est = client.post("/predict", json=body).json()["estimated_co_mg_m3"]
        assert abs(est - max(0.0, row["estimated"])) < 1e-3, ts


def test_predict_optional_fields_are_imputed():
    s = real_sample()
    body = {k: v for k, v in s["input"].items() if not k.startswith(("co_lag", "pt08_s1_co_prev"))}
    r = client.post("/predict", json=body)
    assert r.status_code == 200
    assert "co_lag_1" in r.json()["imputed_fields"]


@pytest.mark.parametrize("change", [{"hour": 25}, {"relative_humidity": 140}, {"pt08_s1_co": "high"}])
def test_predict_invalid_inputs_return_422(change):
    body = {**real_sample()["input"], **change}
    assert client.post("/predict", json=body).status_code == 422


def test_predict_missing_required_field_returns_422():
    body = real_sample()["input"]
    body.pop("temperature")
    assert client.post("/predict", json=body).status_code == 422


def test_unknown_routes_and_ids_return_404():
    assert client.get("/predictions").status_code == 404
    assert client.get("/api/episodes/EP999").status_code == 404


def test_dashboard_endpoints():
    assert client.get("/api/summary").json()["model"]["name"]
    m = client.get("/api/metrics").json()
    assert any(x["family"] == "baseline" for x in m["models"])
    p = client.get("/api/predictions", params={"max_points": 300}).json()
    assert p["points"] and all(np.isfinite(pt["estimated"]) for pt in p["points"])
    eps = client.get("/api/episodes").json()["episodes"]
    assert eps
    detail = client.get(f"/api/episodes/{eps[0]['id']}").json()
    assert detail["window"] and "evidence" in detail["episode"]
    for path in ["variables", "correlation", "missing", "sensor_vs_reference"]:
        assert client.get(f"/api/explorer/{path}").status_code == 200
    for path in ["distribution", "heatmap", "calendar", "profiles"]:
        assert client.get(f"/api/explorer/{path}", params={"var": "CO(GT)"}).status_code == 200
    assert client.get("/api/explorer/series", params={"vars": "CO(GT),T"}).status_code == 200
    assert client.get("/api/explorer/heatmap", params={"var": "bogus"}).status_code == 422
    assert client.get("/api/samples/random").status_code == 200
