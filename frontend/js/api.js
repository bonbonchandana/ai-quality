// Thin same-origin API client with an in-memory promise cache.

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, url = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.url = url;
  }
}

const cache = new Map();

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...(init.headers || {}) }, ...init });
  } catch (err) {
    throw new ApiError('Could not reach the API server. Is the backend running?', { url });
  }
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const detail = body && typeof body === 'object' ? body.detail : body;
    const msg = typeof detail === 'string' ? detail : `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(msg, { status: res.status, detail, url });
  }
  return body;
}

/** GET with promise caching; failed requests are evicted so Retry refetches. */
export function getJSON(path, params, { fresh = false } = {}) {
  const url = path + qs(params);
  if (!fresh && cache.has(url)) return cache.get(url);
  const p = request(url).catch((err) => { cache.delete(url); throw err; });
  if (!fresh) cache.set(url, p);
  return p;
}

export const api = {
  summary: () => getJSON('/api/summary'),
  metrics: () => getJSON('/api/metrics'),
  predictions: (params = {}) => getJSON('/api/predictions', { max_points: 1500, ...params }),
  episodes: () => getJSON('/api/episodes'),
  episode: (id) => getJSON(`/api/episodes/${encodeURIComponent(id)}`),
  variables: () => getJSON('/api/explorer/variables'),
  series: (vars, { start, end, max_points = 2000 } = {}) =>
    getJSON('/api/explorer/series', { vars: vars.join(','), start, end, max_points }),
  correlation: () => getJSON('/api/explorer/correlation'),
  distribution: (v) => getJSON('/api/explorer/distribution', { var: v }),
  heatmap: (v) => getJSON('/api/explorer/heatmap', { var: v }),
  calendar: (v) => getJSON('/api/explorer/calendar', { var: v }),
  missing: () => getJSON('/api/explorer/missing'),
  profiles: (v) => getJSON('/api/explorer/profiles', { var: v }),
  sensorVsReference: () => getJSON('/api/explorer/sensor_vs_reference'),
  sample: (t) => getJSON('/api/samples', { t }, { fresh: true }),
  randomSample: () => getJSON('/api/samples/random', undefined, { fresh: true }),
  predict: (body) => request('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
};
