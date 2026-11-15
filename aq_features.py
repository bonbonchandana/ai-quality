"""Shared feature engineering for training (train_model.py) and serving (main.py).

The saved pipeline references these functions, so this module must sit next to
main.py when the model is loaded.
"""
import numpy as np
import pandas as pd

# Raw inputs the API accepts (POST /predict) and the pipeline is trained on.
INPUT_COLUMNS = [
    "hour",               # 0-23
    "weekday",            # 0 = Monday ... 6 = Sunday
    "pt08_s1_co",         # low-cost tin-oxide sensor (CO targeted)
    "pt08_s2_nmhc",       # titania sensor (NMHC targeted)
    "pt08_s3_nox",        # tungsten-oxide sensor (NOx targeted)
    "pt08_s4_no2",        # tungsten-oxide sensor (NO2 targeted)
    "pt08_s5_o3",         # indium-oxide sensor (O3 targeted)
    "temperature",        # degrees C
    "relative_humidity",  # %
    "absolute_humidity",
    "co_lag_1",           # reference CO 1 hour earlier (mg/m3)
    "co_lag_2",
    "co_lag_3",
    "co_lag_24",          # same hour yesterday
    "pt08_s1_co_prev",    # each sensor's reading 1 hour earlier (optional)
    "pt08_s2_nmhc_prev",
    "pt08_s3_nox_prev",
    "pt08_s4_no2_prev",
    "pt08_s5_o3_prev",
]

SENSOR_INPUTS = ["pt08_s1_co", "pt08_s2_nmhc", "pt08_s3_nox", "pt08_s4_no2", "pt08_s5_o3"]

# Mapping from the UCI column names to the API field names.
SOURCE_TO_INPUT = {
    "PT08.S1(CO)": "pt08_s1_co",
    "PT08.S2(NMHC)": "pt08_s2_nmhc",
    "PT08.S3(NOx)": "pt08_s3_nox",
    "PT08.S4(NO2)": "pt08_s4_no2",
    "PT08.S5(O3)": "pt08_s5_o3",
    "T": "temperature",
    "RH": "relative_humidity",
    "AH": "absolute_humidity",
}

ENGINEERED_COLUMNS = [
    "hour_sin", "hour_cos", "weekday_sin", "weekday_cos",
    "pt08_s1_co", "pt08_s2_nmhc", "pt08_s3_nox", "pt08_s4_no2", "pt08_s5_o3",
    "temperature", "relative_humidity", "absolute_humidity",
    "co_lag_1", "co_lag_2", "co_lag_3", "co_lag_24",
    "co_lag_mean_3", "co_diff_1_2",
    "pt08_s1_co_prev", "pt08_s2_nmhc_prev", "pt08_s3_nox_prev", "pt08_s4_no2_prev", "pt08_s5_o3_prev",
    "pt08_s1_co_delta", "pt08_s2_nmhc_delta", "pt08_s3_nox_delta", "pt08_s4_no2_delta", "pt08_s5_o3_delta",
]


def add_engineered_features(X):
    """Turn raw API inputs into model features (cyclical time, lag summaries)."""
    X = pd.DataFrame(X, columns=INPUT_COLUMNS).astype(float)
    out = pd.DataFrame(index=X.index)
    out["hour_sin"] = np.sin(2 * np.pi * X["hour"] / 24)
    out["hour_cos"] = np.cos(2 * np.pi * X["hour"] / 24)
    out["weekday_sin"] = np.sin(2 * np.pi * X["weekday"] / 7)
    out["weekday_cos"] = np.cos(2 * np.pi * X["weekday"] / 7)
    for col in INPUT_COLUMNS[2:]:
        out[col] = X[col]
    for col in SENSOR_INPUTS:
        # Hour-to-hour sensor change tracks the change in CO (NaN if previous hour unknown).
        out[col + "_delta"] = X[col] - X[col + "_prev"]
    lags = X[["co_lag_1", "co_lag_2", "co_lag_3"]]
    # Mean of whichever recent lags exist; stays NaN (imputed later) if none exist.
    out["co_lag_mean_3"] = lags.mean(axis=1, skipna=True)
    out["co_diff_1_2"] = X["co_lag_1"] - X["co_lag_2"]
    return out[ENGINEERED_COLUMNS]


def engineered_feature_names(transformer, input_features=None):
    """feature_names_out hook for the FunctionTransformer (must be picklable)."""
    return np.array(ENGINEERED_COLUMNS, dtype=object)


def build_inputs(hourly, shift_sensors=0):
    """Build the INPUT_COLUMNS frame from the hourly UCI dataframe.

    shift_sensors=0 -> nowcast (sensors at hour t); 1 -> forecast (sensors at t-1).
    """
    co = hourly["CO(GT)"]
    X = pd.DataFrame(index=hourly.index)
    X["hour"] = hourly.index.hour
    X["weekday"] = hourly.index.day_of_week
    for src, dst in SOURCE_TO_INPUT.items():
        X[dst] = hourly[src].shift(shift_sensors)
    for lag in (1, 2, 3, 24):
        X[f"co_lag_{lag}"] = co.shift(lag)
    for src, dst in SOURCE_TO_INPUT.items():
        if dst in SENSOR_INPUTS:
            X[dst + "_prev"] = hourly[src].shift(shift_sensors + 1)
    return X[INPUT_COLUMNS]
