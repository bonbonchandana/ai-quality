"""Independent artifact and consistency checks; no training."""
from pathlib import Path
import json,hashlib
import pandas as pd
import numpy as np
R=Path('research');O=R/'output'
s=json.loads((O/'summary.json').read_text());p=json.loads((O/'predictions.json').read_text());e=json.loads((O/'episodes.json').read_text())
df=pd.read_csv(R/'data/clean.csv',index_col=0,parse_dates=True)
assert len(df)==9357 and df.index.is_unique and df.index.is_monotonic_increasing
assert (df.index.to_series().diff().dropna()==pd.Timedelta(hours=1)).all()
assert not (df==-200).any().any()
assert hashlib.sha256((R/'data/air-quality.zip').read_bytes()).hexdigest()==s['source_sha256']
times=[x['timestamp'] for x in p];assert times==sorted(set(times))
flags={x['timestamp'] for x in p if x['flagged']};covered=set()
for x in p:
 assert np.isfinite(x['predicted'])
 assert x['interval']['lower']<=x['interval']['upper']
 assert x['actual'] is not None or not x['flagged']
 assert x['actual']==(None if pd.isna(df.loc[pd.Timestamp(x['timestamp']),'CO(GT)']) else float(df.loc[pd.Timestamp(x['timestamp']),'CO(GT)']))
for ep in e:
 assert ep['classification'] in ['data_limitation_candidate','unusual_pollution_candidate'] and ep['reason']
 pts={x for x in flags if ep['start']<=x<=ep['end']}
 assert len(pts)==ep['hours'] and not covered.intersection(pts)
 assert ep['hours']==int((pd.Timestamp(ep['end'])-pd.Timestamp(ep['start'])).total_seconds()/3600)+1
 covered.update(pts)
assert covered==flags and len(e)==s['episodes'] and len(flags)==s['flagged_hours']
a=np.array([x['actual'] for x in p if x['actual'] is not None]);pr=np.array([x['predicted'] for x in p if x['actual'] is not None])
assert abs(np.mean(np.abs(a-pr))-s['test_metrics_all_observed']['MAE'])<1e-12
assert len(list((R/'figures').glob('*.png')))==7
for split in s['splits'].values():assert split[0]<split[1]
sp=list(s['splits'].values());assert all(sp[i][1]<sp[i+1][0] for i in range(3))
report={'status':'passed','clean_rows':len(df),'prediction_rows':len(p),'observed_test_targets':len(a),'flagged_hours':len(flags),'episodes':len(e),'figures':7,'checks':['hourly unique sorted grid','sentinel removed','archive hash','prediction finite and interval ordered','actuals equal cleaned source','nulls never flagged','episodes exactly cover flags without overlap','every episode classified with reason','export MAE recomputed','chronological split separation']}
(O/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
