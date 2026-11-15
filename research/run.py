"""Run from repository root: research/.venv/bin/python research/run.py."""
from pathlib import Path
import os
os.environ["MPLCONFIGDIR"]="research/.mplconfig"
os.environ["XDG_CACHE_HOME"]="research/.cache"
import io,json,zipfile,hashlib,urllib.request
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error,mean_squared_error,r2_score
from sklearn.inspection import permutation_importance
from xgboost import XGBRegressor
import joblib
R=Path('research'); O=R/'output'; F=R/'figures'; D=R/'data'
for p in [O,F,D]:p.mkdir(parents=True,exist_ok=True)
z=D/'air-quality.zip'
if not z.exists():urllib.request.urlretrieve('https://archive.ics.uci.edu/static/public/360/air+quality.zip',z)
assert hashlib.sha256(z.read_bytes()).hexdigest()=='d4a64013fb385288a8a48d9d193ca7079b2e1bbddf6f8d458feb8c08ab2b8a2a', 'Source archive changed; review provenance before comparing metrics'
raw=pd.read_csv(io.BytesIO(zipfile.ZipFile(z).read('AirQualityUCI.csv')),sep=';',decimal=',')
df=raw.dropna(subset=['Date','Time']).copy()
ts=pd.to_datetime(df.Date+' '+df.Time,format='%d/%m/%Y %H.%M.%S')
df=df.drop(columns=['Date','Time']).dropna(axis=1,how='all').replace(-200,np.nan)
df.index=pd.DatetimeIndex(ts,name='timestamp');df=df.sort_index()
assert not df.index.duplicated().any()
original_n=len(df);df=df.reindex(pd.date_range(df.index.min(),df.index.max(),freq='h',name='timestamp'))
df.to_csv(D/'clean.csv')
def runs(mask):
 ix=np.flatnonzero(np.diff(np.r_[False,np.asarray(mask),False].astype(int)))
 return [(int(a),int(b)) for a,b in ix.reshape(-1,2)]
gaps={c:[{'start':str(df.index[a]),'end':str(df.index[b-1]),'hours':b-a} for a,b in runs(df[c].isna()) if b-a>=24] for c in df}
missing=pd.DataFrame({'missing':df.isna().sum(),'percent':df.isna().mean()*100,'longest_gap_hours':{c:max([b-a for a,b in runs(df[c].isna())] or [0]) for c in df}})
missing.to_csv(O/'missingness.csv');(O/'gaps.json').write_text(json.dumps(gaps,indent=2))
target='CO(GT)';y=df[target]
n=len(df);a=int(n*.6);b=int(n*.8);calstart=int(n*.7)
folds=[(int(n*.3),int(n*.4)),(int(n*.4),int(n*.5)),(int(n*.5),a)]
sensors=[c for c in df if c.startswith('PT08.')]; weather=['T','RH','AH']
def features(framing):
 X=pd.DataFrame(index=df.index)
 for lag in [1,2,3,24,168]:X[f'co_lag_{lag}']=y.shift(lag)
 for w in [3,24,168]:
  X[f'co_mean_{w}']=y.shift(1).rolling(w,min_periods=1).mean();X[f'co_std_{w}']=y.shift(1).rolling(w,min_periods=2).std()
 X['co_diff_1_2']=y.shift(1)-y.shift(2)
 offset=1 if framing=='forecast' else 0
 for c in sensors+weather:
  for lag in [offset,offset+1,offset+2,offset+24]:X[f'{c}_lag_{lag}']=df[c].shift(lag)
  X[c+'_diff']=df[c].shift(offset+1)-df[c].shift(offset+2)
  for w in [3,24]:
   X[f'{c}_mean_{w}']=df[c].shift(offset).rolling(w,min_periods=1).mean()
   X[f'{c}_std_{w}']=df[c].shift(offset).rolling(w,min_periods=2).std()
 for name,v,period in [('hour',df.index.hour,24),('weekday',df.index.day_of_week,7)]:
  X[name+'_sin']=np.sin(2*np.pi*v/period);X[name+'_cos']=np.cos(2*np.pi*v/period)
 X['lag_missing_count']=X.isna().sum(axis=1)
 return X
Xs={f:features(f) for f in ['forecast','nowcast']}
assert all(Xs[f]['co_lag_1'].equals(y.shift(1)) for f in Xs)
assert Xs['nowcast']['PT08.S1(CO)_lag_0'].equals(df['PT08.S1(CO)'])
assert Xs['forecast']['PT08.S1(CO)_lag_1'].equals(df['PT08.S1(CO)'].shift(1))
def valid(lo,hi):return np.arange(lo,hi)[y.iloc[lo:hi].notna().to_numpy() & y.shift(1).iloc[lo:hi].notna().to_numpy() & y.shift(24).iloc[lo:hi].notna().to_numpy()]
def trainids(end):return np.arange(168,end)[y.iloc[168:end].notna().to_numpy()]
def metrics(yi,p):return {'n':len(yi),'MAE':float(mean_absolute_error(yi,p)),'RMSE':float(np.sqrt(mean_squared_error(yi,p))),'R2':float(r2_score(yi,p))}
def fitmodel(name,X,end,rounds=None):
 tr=trainids(end)
 if name=='Ridge':
  m=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),Ridge(alpha=10));m.fit(X.iloc[tr],y.iloc[tr]);return m,None
 # Early stopping uses a chronological tail WITHIN the training period; the outer fold remains untouched.
 if rounds is None:
  cut=int(end*.85); inner=trainids(cut); val=trainids(end);val=val[val>=cut]
  imp=SimpleImputer(strategy='median',add_indicator=True);xt=imp.fit_transform(X.iloc[inner]);xv=imp.transform(X.iloc[val])
  early=XGBRegressor(n_estimators=1000,max_depth=3,learning_rate=.04,objective='reg:squarederror',random_state=42,n_jobs=2,tree_method='hist',early_stopping_rounds=40)
  early.fit(xt,y.iloc[inner],eval_set=[(xv,y.iloc[val])],verbose=False);rounds=early.best_iteration+1
 m=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),XGBRegressor(n_estimators=int(rounds),max_depth=3,learning_rate=.04,objective='reg:squarederror',random_state=42,n_jobs=2,tree_method='hist'))
 m.fit(X.iloc[tr],y.iloc[tr]);return m,int(rounds)
rows=[]; rounds_by={f:[] for f in Xs}
for f,X in Xs.items():
 for k,(lo,hi) in enumerate(folds,1):
  ev=valid(lo,hi)
  for name in ['Persistence','Seasonal naive','Ridge','XGBoost']:
   if name in ['Persistence','Seasonal naive']:preds=X.iloc[ev]['co_lag_1' if name=='Persistence' else 'co_lag_24'].to_numpy();rounds=None
   else:
    mod,rounds=fitmodel(name,X,lo);preds=mod.predict(X.iloc[ev])
    if rounds:rounds_by[f].append(rounds)
   rows.append({'framing':f,'split':f'rolling_{k}','model':name,'train_end':str(df.index[lo-1]),'eval_start':str(df.index[lo]),'eval_end':str(df.index[hi-1]),'rounds':rounds,**metrics(y.iloc[ev],preds)})
# Freeze model, framing and XGBoost tree counts before any test evaluation.
foldmet=pd.DataFrame(rows);avg=foldmet.groupby(['framing','model'])[['MAE','RMSE','R2']].mean().reset_index()
selection=avg[avg.model.isin(['Ridge','XGBoost'])].sort_values('MAE').iloc[0]
framing=selection.framing;choice=selection.model;X=Xs[framing]
fixed_rounds={f:int(np.median(rounds_by[f])) for f in Xs}
(O/'selection.json').write_text(json.dumps({'selected_framing':framing,'selected_model':choice,'criterion':'unweighted mean rolling-fold MAE','selected_before_test':True,'fold_early_stopping_rounds':rounds_by,'final_xgboost_trees':fixed_rounds},indent=2))
trained={}
# One final pass over the holdout: all methods and both framings, fixed training ends and tree counts.
for f,xf in Xs.items():
 ev=valid(b,n)
 for name in ['Persistence','Seasonal naive','Ridge','XGBoost']:
  if name in ['Persistence','Seasonal naive']:preds=xf.iloc[ev]['co_lag_1' if name=='Persistence' else 'co_lag_24'].to_numpy();rounds=None
  else:
   mod,rounds=fitmodel(name,xf,a,fixed_rounds[f] if name=='XGBoost' else None);preds=mod.predict(xf.iloc[ev]);trained[(f,name)]=mod
  rows.append({'framing':f,'split':'test','model':name,'train_end':str(df.index[a-1]),'eval_start':str(df.index[b]),'eval_end':str(df.index[-1]),'rounds':rounds,**metrics(y.iloc[ev],preds)})
met=pd.DataFrame(rows);met.to_csv(O/'metrics.csv',index=False);avg.to_csv(O/'validation_mean.csv',index=False)
m=trained[(framing,choice)]
cal=valid(calstart,b);res=np.abs(y.iloc[cal].to_numpy()-m.predict(X.iloc[cal]));q=float(np.quantile(res,min(1,np.ceil((len(res)+1)*.90)/len(res)),method='higher'))
threshold=float(np.quantile(res,.95,method='higher'))
# Predictions on ALL test hours; no evaluation or residual flag if target unavailable.
te=np.arange(b,n);p=m.predict(X.iloc[te]);actual=y.iloc[te].to_numpy();err=actual-p
lo=p-q;hi=p+q
flag=np.isfinite(actual)&(np.abs(err)>max(q,threshold))
# Auxiliary sensor/reference consistency model trained ONLY on train complete pairs.
s='PT08.S1(CO)';pair=df.iloc[:a][[s,target]].dropna();coef=np.polyfit(pair[s],pair[target],1)
sres=np.abs(pair[target]-np.polyval(coef,pair[s]));sq=float(sres.quantile(.99));sensor_est=np.polyval(coef,df[s].iloc[te]);disagreement=np.abs(actual-sensor_est)>sq
sensor_min=float(pair[s].min());sensor_max=float(pair[s].max())
quality=X.iloc[te].isna().sum(axis=1).to_numpy()>0
missing_streak=np.zeros(n,dtype=int)
for j in range(1,n):missing_streak[j]=missing_streak[j-1]+1 if pd.isna(y.iloc[j-1]) else 0
# Drift proxy is past-only 7-day disagreement fraction, not a verified sensor diagnosis.
dr=pd.Series(disagreement,index=df.index[te]).shift(1).rolling(168,min_periods=24).mean().fillna(0).to_numpy()>.25
saturation=(df[s].iloc[te].to_numpy()<=sensor_min)|(df[s].iloc[te].to_numpy()>=sensor_max)
episodes=[]
for i,(start,end) in enumerate(runs(flag),1):
 sl=slice(start,end); reasons=[]
 if quality[sl].any():reasons.append('At least one predictor missing; training-median imputation used; includes missing lag or sensor/environment history.')
 if missing_streak[te[sl]].max()>0:reasons.append(f'Prior CO missing streak reaches {missing_streak[te[sl]].max()} hours.')
 if saturation[sl].any():reasons.append('Sensor response reaches/exceeds training observed range; saturation is only a candidate, not confirmed.')
 if dr[sl].any():reasons.append('Past 7-day sensor/reference disagreement fraction exceeds 25%; drift/confounding candidate.')
 if disagreement[sl].any():reasons.append('CO reference differs from training linear sensor expectation beyond training 99th-percentile residual; fault or cross-sensitivity possible.')
 classification='data_limitation_candidate' if reasons else 'unusual_pollution_candidate'
 if not reasons:reasons=['Observed CO departs from model expectation with complete inputs and no triggered sensor-quality rule; cause unverified.']
 severity='high' if np.max(np.abs(err[sl]))>2*threshold else 'moderate'
 episodes.append({'id':f'EP{i:03d}','start':df.index[te[start]].isoformat(),'end':df.index[te[end-1]].isoformat(),'hours':end-start,'severity':severity,'classification':classification,'reason':' '.join(reasons),'peak_abs_residual':float(np.max(np.abs(err[sl])))})
records=[]
for j,ix in enumerate(te):
 records.append({'timestamp':df.index[ix].isoformat(),'actual':None if not np.isfinite(actual[j]) else float(actual[j]),'predicted':float(p[j]),'interval':{'lower':float(lo[j]),'upper':float(hi[j]),'nominal_coverage':.9},'flagged':bool(flag[j]),'imputed_feature_count':int(X.iloc[ix].isna().sum()),'prior_co_missing_hours':int(missing_streak[ix])})
(O/'predictions.json').write_text(json.dumps(records,indent=2,allow_nan=False));(O/'episodes.json').write_text(json.dumps(episodes,indent=2,allow_nan=False))
# Permutation on validation (model fitted before validation), not test.
vm=m;vi=valid(a,calstart)
imp=permutation_importance(vm,X.iloc[vi],y.iloc[vi],scoring='neg_mean_absolute_error',n_repeats=3,random_state=42,n_jobs=1)
pd.Series(imp.importances_mean,index=X.columns).sort_values(ascending=False).to_csv(O/'feature_importance.csv',header=['MAE_increase'])
plt.rcParams.update({'figure.figsize':(11,4),'figure.dpi':140})
def save(name):plt.tight_layout();plt.savefig(F/name);plt.close()
missing.percent.plot.bar();plt.ylabel('Missing %');save('01_missingness.png')
y.resample('D').mean().plot();plt.ylabel('CO mg/m³');save('02_daily.png')
fig,ax=plt.subplots(1,3,figsize=(12,4))
for aa,g,title in zip(ax,[df.index.hour,df.index.day_of_week,df.index.month],['Hour','Weekday (Monday=0)','Month']):y.groupby(g).mean().plot(ax=aa,title=title);aa.set_ylabel('CO mg/m³')
save('03_calendar.png')
corr=df.corr();plt.imshow(corr,vmin=-1,vmax=1,cmap='coolwarm');plt.xticks(range(len(df.columns)),df.columns,rotation=90,fontsize=7);plt.yticks(range(len(df.columns)),df.columns,fontsize=7);plt.colorbar();save('04_correlations.png');corr.to_csv(O/'correlations.csv')
monthly=[]
for month,group in df.groupby(df.index.to_period('M')):
 gg=group[[s,target]].dropna();monthly.append({'month':str(month),'n':len(gg),'correlation':gg[s].corr(gg[target]),'slope':np.polyfit(gg[s],gg[target],1)[0] if len(gg)>2 else None})
pd.DataFrame(monthly).to_csv(O/'drift_proxy.csv',index=False);pd.DataFrame(monthly).set_index('month')['slope'].plot(marker='o');plt.ylabel('Monthly CO vs S1 slope (confounded drift proxy)');save('05_drift_proxy.png')
plt.plot(df.index[te],actual,label='actual',lw=.6);plt.plot(df.index[te],p,label='prediction',lw=.6);plt.fill_between(df.index[te],lo,hi,alpha=.2,label='90% nominal interval');plt.scatter(df.index[te][flag],actual[flag],c='red',s=7,label='flag');plt.legend();plt.ylabel('CO mg/m³');save('06_episodes.png')
pd.Series(imp.importances_mean,index=X.columns).nlargest(10).sort_values().plot.barh();plt.xlabel('Validation MAE increase under permutation');save('07_importance.png')
validactual=np.isfinite(actual)
summary={'source_sha256':hashlib.sha256(z.read_bytes()).hexdigest(),'raw_rows':len(raw),'valid_source_rows':original_n,'hourly_grid_rows':n,'start':str(df.index.min()),'end':str(df.index.max()),'inserted_hours':n-original_n,'selected_model':choice,'selected_framing':framing,'q90':q,'threshold95':threshold,'calibration_n':len(cal),'test_interval_coverage_all_observed':float(np.mean((actual[validactual]>=lo[validactual])&(actual[validactual]<=hi[validactual]))),'test_metrics_all_observed':metrics(actual[validactual],p[validactual]),'flagged_hours':int(flag.sum()),'episodes':len(episodes),'classifications':pd.Series([e['classification'] for e in episodes]).value_counts().to_dict(),'splits':{'train':[str(df.index[168]),str(df.index[a-1])],'validation':[str(df.index[a]),str(df.index[calstart-1])],'calibration':[str(df.index[calstart]),str(df.index[b-1])],'test':[str(df.index[b]),str(df.index[-1])]},'hour_means':y.groupby(df.index.hour).mean().to_dict(),'weekday_means':y.groupby(df.index.day_of_week).mean().to_dict(),'month_means':y.groupby(df.index.month).mean().to_dict()}
(O/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2));print(met.to_string(index=False))
joblib.dump(m,O/'selected_model.joblib')
(O/'model_metadata.json').write_text(json.dumps({'model':choice,'target':target,'units':'mg/m3','framing':framing,'horizon_hours':1 if framing=='forecast' else 0,'timestamp_basis':'source local wall time; timezone and DST unverified; no UTC conversion','features':list(X.columns),'calibration_radius':q,'episode_threshold':threshold,'sensor_reference_coefficients':coef.tolist(),'sensor_disagreement_threshold':sq,'sensor_training_range':[sensor_min,sensor_max]},indent=2))
assert all(e['reason'] for e in episodes)
assert len(records)==n-b
assert not np.isinf(X.select_dtypes('number').to_numpy()).any()
