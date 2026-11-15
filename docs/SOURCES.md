# Source register

Checked with web search and primary pages on 15 November 2026. Search snippets were followed to primary documentation where accessible. “Current” means documentation/listing available, not an authenticated API call or installation test. External facts in RESEARCH/PRD link directly to these sources. Numerical dataset/model findings come from the supplied reproducible experiment, not external citations. Scores, personas, priorities and schedules are team planning judgments.

## Eight highest-value sources

1. [UCI Air Quality](https://archive.ics.uci.edu/dataset/360/air+quality): provenance, column meanings, units, sentinel, original paper and contradictory licensing/date metadata; file observations take priority for actual row/date counts.
2. [De Vito et al., 2008, original paper](https://doi.org/10.1016/j.snb.2007.09.060): *On field calibration of an electronic nose for benzene estimation in an urban pollution monitoring scenario*, Sensors and Actuators B: Chemical 129(2), 750–757. [Publisher abstract](https://www.sciencedirect.com/science/article/pii/S0925400507007691) verified title, venue and calibration context; full paper was not independently reviewed. No paper performance numbers are reused.
3. [WHO pollutant descriptions](https://www.who.int/teams/environment-climate-change-and-health/air-quality-and-health/health-impacts/types-of-pollutants): CO/NO2 health effects and guideline overview.
4. [WHO 2021 guideline publication](https://www.who.int/publications/i/item/9789240034228): health-based concentration guidance; [WHO Q&A](https://www.who.int/news-room/questions-and-answers/item/who-global-air-quality-guidelines) explains scope.
5. [US EPA AirNow AQI basics](https://www.airnow.gov/aqi/aqi-basics/): six US bands and health communication; [technical document](https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf) for pollutant averaging and conversion, which MVP does not implement.
6. [CPCB AQI portal](https://airquality.cpcb.gov.in/AQI/): six Indian bands; [government AQI explanation](https://ies.gov.in/arthapedia/concept/national-air-quality-index) describes eight pollutants and aggregation; [CPCB PDF](https://www.cpcb.gov.in/displaypdf.php?id=bmF0aW9uYWwtYWlyLXF1YWxpdHktaW5kZXgvQWJvdXRfQVFJLnBkZg%3D%3D) is indexed but some CPCB fetches returned 403/timeouts.
7. [scikit-learn TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html): future-period evaluation motivation. Our script implements explicit expanding chronological boundaries.
8. [Angelopoulos and Bates, conformal tutorial](https://arxiv.org/abs/2107.07511): residual calibration and exchangeability limitations; no coverage guarantee is claimed for this time series.

## Domain supplements

- [WHO benzene expert report](https://www.who.int/europe/publications/i/item/WHO-EURO-2023-8983-48755-72523): carcinogenicity and blood/immune effects.
- [EPA NO2 basics](https://www.epa.gov/no2-pollution/basic-information-about-no2): respiratory effects and NOx relationship.
- [EPA VOC technical overview](https://www.epa.gov/indoor-air-quality-iaq/technical-overview-volatile-organic-compounds): chemical mixture/smog context.
- [EPA VOC health effects](https://www.epa.gov/indoor-air-quality-iaq/volatile-organic-compounds-impact-indoor-air-quality): effects vary by compound; not a universal NMHC risk conversion.
- [WHO guideline table 3.26](https://www.ncbi.nlm.nih.gov/books/NBK574591/table/ch3.tab26/): indexed concentration values; direct browser fetch encountered CAPTCHA, so WHO publication remains primary.

## Product comparison

- [IQAir app](https://www.iqair.com/air-quality-monitors/air-quality-app), [forecast explanation](https://www.iqair.com/ae/support/knowledge-base/how-can-i-access-air-quality-forecasts-through-the-airvisual-app-and-website), [API documentation](https://api-docs.iqair.com/?version=latest): public app, seven-day forecast, API availability. No paid tier tested.
- [WAQI/AQICN API and terms](https://aqicn.org/api/): station provenance, forecasts, token/quota, free access with restrictions; caching/redistribution restrictions matter.
- [PurpleAir researcher guide](https://www.purpleair.com/research/quick-guide), [technology](https://community.purpleair.com/t/our-technology/804), [API](https://community.purpleair.com/t/about-the-purpleair-api/7145), [map graph](https://community.purpleair.com/t/how-to-use-the-map-graph/1122): particle sensors, public map and API, two sensor channels and conversions. Do not equate PM measurements with CO.
- [Google Air Quality overview](https://developers.google.com/maps/documentation/air-quality/overview): historical/current/96-hour forecast endpoints, health recommendations and Cloud setup; [usage and billing](https://developers.google.com/maps/documentation/air-quality/usage-and-billing) is the authoritative pricing entry, exact cost not verified.
- [OpenAQ measurements](https://docs.openaq.org/resources/measurements), [API keys](https://docs.openaq.org/using-the-api/api-key), [quick start](https://docs.openaq.org/using-the-api/quick-start): measured sensor data API v3 and key registration.
- [Government SAMEER description](https://www.data.gov.in/catalog/sameer-national-air-quality-index), [official-linked app listing](https://play.google.com/store/apps/details?id=com.cpcb), [CPCB notices](https://app.cpcbccr.com/cpcb_new_marquee): hourly AQI and pollution complaint context. App not installed/tested.

## Architecture, versions and deployment

**Used in the final build:** [FastAPI](https://fastapi.tiangolo.com/) with [Pydantic](https://docs.pydantic.dev/) and [Uvicorn](https://www.uvicorn.org/); [scikit-learn](https://scikit-learn.org/) (Linear Regression, Random Forest); [XGBoost](https://xgboost.readthedocs.io/); [joblib](https://joblib.readthedocs.io/) for saving models; [Apache ECharts](https://echarts.apache.org/) for the dashboard charts. Exact versions are in `requirements.txt`. The links below are the options considered during research.


- [React versions](https://react.dev/versions): direct page reports 19.3 and links 19.3.0; stale search snippets reported 19.2. Prefer fetched documentation.
- [Vite releases](https://vite.dev/releases): maintained line 8.3; exact current patch unverified. [Vite static deployment](https://vite.dev/guide/static-deploy.html): build directory, base path and GitHub Pages workflow.
- [Recharts latest stable release](https://github.com/recharts/recharts/releases/tag/v3.10.1): latest redirect resolved to 3.10.1. Main releases feed included 3.11 canaries; do not use those for deadline build.
- [FastAPI](https://fastapi.tiangolo.com/): Python API backend option; no performance or hosting claim inferred.
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html): browser inference option; our Ridge/XGBoost pipeline was not converted or benchmarked.
- [TensorFlow.js training](https://www.tensorflow.org/js/guide/train_models): JS training option; no TF.js model was evaluated.
- [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): static hosting in public repositories with GitHub Free; quota/policy details should be checked at deployment.
- [Ridge API](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html), [XGBoost API](https://xgboost.readthedocs.io/en/stable/python/python_api.html): model interfaces. Installed versions are recorded by pip, not assumed to equal newest docs.
- Installed package version provenance: [pandas](https://pypi.org/project/pandas/), [NumPy](https://pypi.org/project/numpy/), [scikit-learn](https://pypi.org/project/scikit-learn/), [XGBoost](https://pypi.org/project/xgboost/), [Matplotlib](https://pypi.org/project/matplotlib/). Exact installed pins are in research/requirements.txt and were exercised locally; platform availability elsewhere is [unverified].
