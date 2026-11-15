from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)

def test_core_endpoints():
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/metadata').status_code == 200
    assert client.get('/api/metrics').status_code == 200
    assert client.get('/api/predictions?max_points=20').json()['total'] == 1872
    assert client.get('/api/episodes').status_code == 200
    assert client.get('/api/explorer/correlation').status_code == 200

def test_predict_validation():
    response = client.post('/api/predict', json={'timestamp':'2005-01-16T15:00:00','co_lag_1':-1,'co_lag_2':1,'co_lag_3':1,'co_lag_24':1,'co_lag_168':1})
    assert response.status_code == 422
