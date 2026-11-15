# Reproduce the research

Research only: no web application was scaffolded. Run commands from the repository root. All created files live under docs/ and research/. Python 3.12 was used locally.

```bash
python -m venv research/.venv
research/.venv/bin/python -m pip install --no-cache-dir -r research/requirements.txt
research/.venv/bin/python research/run.py
research/.venv/bin/python research/verify.py
```

If creating a second environment, change the local environment path under research/. No global install is necessary. Internet access is needed for installation and the first data download. The script downloads UCI's archive if research/data/air-quality.zip does not exist. It retains the archive and regenerates clean data, metrics, model, JSON and seven charts deterministically. Expected archive SHA256: d4a64013fb385288a8a48d9d193ca7079b2e1bbddf6f8d458feb8c08ab2b8a2a. If UCI changes the file, do not silently compare the new results with this report.

The environment and Matplotlib caches are not deliverables. requirements.txt is the tested full environment freeze, including Linux transitive dependencies; the XGBoost wheel may install a large NCCL dependency although training uses CPU. GPU is not needed. Do not upload the virtual environment to hosting or source control.

Inputs/outputs:

- data/air-quality.zip: original UCI archive, retained for provenance.
- data/clean.csv: sorted hourly source measurements; sentinel and empty values are blank. No targets are imputed.
- output/metrics.csv: all four methods on three rolling folds and common-row holdout, for both framings.
- output/summary.json: split dates, all-observed export metrics, coverage and counts.
- output/predictions.json, episodes.json: directly parseable JSON arrays for frontend consumption; no NaN.
- output/model_metadata.json, selected_model.joblib: feature contract and trained pipeline. Load joblib only from this trusted research run, with the pinned environment.
- output/missingness.csv, gaps.json, correlations.csv, drift_proxy.csv, feature_importance.csv: analysis evidence.
- figures/: seven PNGs referenced by docs/RESEARCH.md.

The selected artifact is a same-hour virtual-sensor nowcast; the comparison also evaluates one-hour rolling forecasts. Prior test observations are available sequentially at each origin. This is not a forecast of the entire test period from its first timestamp. Timestamp strings preserve source wall time, with no claimed timezone or DST correction. The frontend must retain their displayed wall-clock hour instead of converting to the viewer's timezone.
