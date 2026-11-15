import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactECharts from 'echarts-for-react';
import './styles.css';

const api = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
type Prediction = { timestamp: string; actual: number | null; predicted: number; flagged: boolean; imputed_feature_count: number };
type Episode = { id: string; start: string; end: string; hours: number; severity: string; classification: string; reason: string };

function LineChart({ rows }: { rows: Prediction[] }) {
  const values = rows.flatMap(r => [r.actual ?? r.predicted, r.predicted]); const max = Math.max(...values, 1); const min = Math.min(...values, 0);
  const points = (key: 'actual'|'predicted') => rows.map((r, i) => `${(i / Math.max(rows.length - 1, 1)) * 100},${100 - (((r[key] ?? r.predicted) - min) / (max - min)) * 100}`).join(' ');
  return <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points('actual')} fill="none" stroke="var(--observed)" strokeWidth="1"/><polyline points={points('predicted')} fill="none" stroke="var(--estimate)" strokeWidth="1"/></svg>;
}

function App() {
  const [page, setPage] = useState('Overview'); const [pred, setPred] = useState<Prediction[]>([]); const [eps, setEps] = useState<Episode[]>([]); const [metrics, setMetrics] = useState<any>(); const [error, setError] = useState('');
  useEffect(() => { Promise.all([api<{data: Prediction[]}>('/api/predictions?max_points=600'), api<{data: Episode[]}>('/api/episodes'), api<any>('/api/metrics')]).then(([p,e,m]) => {setPred(p.data);setEps(e.data);setMetrics(m)}).catch(e => setError(e.message)); }, []);
  const observed = pred.filter(p => p.actual !== null).map(p => p.actual as number); const latest = observed.at(-1); const average = observed.reduce((a,b)=>a+b,0)/Math.max(observed.length,1); const selected = metrics?.rows?.find((r:any)=>r.framing==='nowcast' && r.split==='test' && r.model==='Ridge');
  const option = useMemo(() => ({darkMode: 'dark', tooltip: {trigger:'axis'}, xAxis:{type:'category',data:pred.map(p=>p.timestamp.slice(0,10))}, yAxis:{type:'value',name:'CO mg/m³'}, series:[{name:'Observed',type:'line',data:pred.map(p=>p.actual),lineStyle:{color:'#52d6b3'}},{name:'Estimated',type:'line',data:pred.map(p=>p.predicted),lineStyle:{color:'#ffb86b'}}]}), [pred]);
  return <div className="app"><aside><div className="brand">AQ<span>•</span>LAB</div><p className="eyebrow">AIR QUALITY / ML</p>{['Overview','Data explorer','Model performance','Episodes','Virtual sensor','Methodology','About'].map(item => <button className={page===item?'active':''} onClick={()=>setPage(item)} key={item}>{item}</button>)}</aside><main><header><div><p className="eyebrow">AIR QUALITY PREDICTION</p><h1>{page}</h1></div><div className="status">● LIVE MODEL</div></header>{error && <div className="error">{error}</div>}{page==='Overview' && <><section className="grid"><Card label="Latest observed CO" value={latest?.toFixed(2) ?? '—'} unit="mg/m³"/><Card label="Observed average" value={average.toFixed(2)} unit="mg/m³"/><Card label="Test MAE" value={selected?.MAE?.toFixed(3) ?? '—'} unit="mg/m³"/><Card label="Candidate episodes" value={eps.length} unit="26 data-limitation · 3 unusual"/></section><section className="panel hero"><div className="panel-head"><div><h2>Estimated vs observed CO</h2><p>Ridge virtual-sensor nowcast · test period · observed targets only</p></div><div className="legend"><span className="observed">● Observed</span><span className="estimate">● Estimated</span></div></div><ReactECharts option={option} style={{height:340}}/></section><section className="split"><div className="panel"><h2>Model signal</h2><p>Validation R² <b>{metrics?.summary?.test_metrics_all_observed?.R2?.toFixed(3) ?? '—'}</b></p><p className="muted">The test period was examined during earlier research and is not fully independent.</p></div><div className="panel"><h2>Recent estimate trace</h2><LineChart rows={pred.slice(-100)}/></div></section></>}{page==='Episodes' && <section className="panel"><h2>Pollution episode candidates</h2><p className="muted">Candidates are not diagnoses. Every row includes its evidence reason.</p><table><thead><tr><th>ID</th><th>Start</th><th>Hours</th><th>Class</th><th>Reason</th></tr></thead><tbody>{eps.map(e=><tr key={e.id}><td>{e.id}</td><td>{e.start.slice(0,16).replace('T',' ')}</td><td>{e.hours}</td><td><span className={e.classification.includes('unusual')?'tag amber':'tag violet'}>{e.classification.replaceAll('_',' ')}</span></td><td>{e.reason}</td></tr>)}</tbody></table></section>}{page==='Data explorer' && <section className="panel"><h2>Data explorer</h2><p>Real source data and exported model outputs are available through the explorer API.</p><ReactECharts option={{...option, title:{text:'CO test series'}, toolbox:{feature:{saveAsImage:{}}}}} style={{height:420}}/></section>}{page!=='Overview'&&page!=='Episodes'&&page!=='Data explorer'&&<section className="panel"><h2>{page}</h2><p className="muted">This section is wired to the research contract and will expose only values returned by the API.</p></section>}</main></div>
}
function Card({label,value,unit}:{label:string,value:string|number,unit:string}) { return <div className="card"><p className="eyebrow">{label}</p><strong>{value}</strong><span>{unit}</span></div> }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
