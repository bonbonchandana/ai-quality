// App shell: hash router, sidebar, theme toggle, page transitions.
import * as charts from './charts.js';
import { $, debounce, errorState, esc, pageSkeleton, storage } from './ui.js';
import * as overview from './pages/overview.js';
import * as explorer from './pages/explorer.js';
import * as model from './pages/model.js';
import * as episodes from './pages/episodes.js';
import * as episode from './pages/episode.js';
import * as simulator from './pages/simulator.js';
import * as methodology from './pages/methodology.js';
import * as about from './pages/about.js';

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ROUTES = [
  { key: 'overview', label: 'Overview', page: overview, icon: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>') },
  { key: 'explorer', label: 'Data explorer', page: explorer, icon: I('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>') },
  { key: 'model', label: 'Model performance', page: model, icon: I('<path d="M12 20V10M18 20V4M6 20v-6"/>') },
  { key: 'episodes', label: 'Episodes', page: episodes, icon: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>') },
  { key: 'simulator', label: 'Virtual sensor', page: simulator, icon: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>') },
  { key: 'methodology', label: 'Methodology', page: methodology, icon: I('<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8.5M18 8l-5 8.5"/>') },
  { key: 'about', label: 'About', page: about, icon: I('<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>') },
];

const view = $('#view');
const mq = window.matchMedia('(max-width: 960px)');
let token = 0;

/* ---------- Navigation ---------- */
$('#nav').innerHTML = ROUTES.map((r) => `<a href="#/${r.key}" data-key="${r.key}" title="${esc(r.label)}">${r.icon}<span class="nav-label">${esc(r.label)}</span></a>`).join('');

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const key = parts[0] || 'overview';
  if (key === 'episodes' && parts[1]) return { key: 'episodes', page: episode, params: { id: parts[1] } };
  const route = ROUTES.find((r) => r.key === key);
  return route ? { key, page: route.page, params: {} } : null;
}

async function navigate() {
  const match = parseHash();
  if (!match) { location.replace('#/overview'); return; }
  const my = ++token;
  const ctx = { alive: () => my === token, setTitle };

  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.key === match.key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (mq.matches) setDrawer(false);

  charts.disposeAll();
  const meta = match.page.meta || {};
  setTitle(meta.title || 'AirSense', meta.subtitle || '');
  view.classList.remove('is-entering');
  view.innerHTML = pageSkeleton();
  void view.offsetWidth; // restart the fade animation
  view.classList.add('is-entering');
  window.scrollTo({ top: 0 });

  try {
    await match.page.render(view, match.params, ctx);
  } catch (err) {
    if (!ctx.alive()) return;
    console.error(err);
    charts.disposeAll();
    view.innerHTML = errorState(err, { title: 'This page could not be loaded' });
    view.querySelector('[data-retry]')?.addEventListener('click', navigate);
  }
}

function setTitle(title, subtitle = '') {
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  document.title = `${title} · AirSense CO nowcast`;
}

/* ---------- Sidebar (collapsible on desktop, drawer on mobile) ---------- */
const root = document.documentElement;
const backdrop = $('#backdrop');
const toggleBtn = $('#navToggle');

function setDrawer(open) {
  root.classList.toggle('nav-open', open);
  backdrop.hidden = !open;
  toggleBtn.setAttribute('aria-expanded', String(open));
}

toggleBtn.addEventListener('click', () => {
  if (mq.matches) {
    setDrawer(!root.classList.contains('nav-open'));
  } else {
    const collapsed = root.classList.toggle('sidebar-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    storage('aq-sidebar', collapsed ? 'collapsed' : 'open');
    // Resize charts once the grid transition settles (and once mid-way for smoothness).
    setTimeout(charts.resizeAll, 120);
    setTimeout(charts.resizeAll, 260);
  }
});
backdrop.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('nav-open')) setDrawer(false); });
mq.addEventListener('change', () => { setDrawer(false); setTimeout(charts.resizeAll, 60); });
toggleBtn.setAttribute('aria-expanded', String(mq.matches ? false : !root.classList.contains('sidebar-collapsed')));

/* ---------- Theme ---------- */
const themeBtn = $('#themeToggle');
function syncThemeButton() {
  const light = root.getAttribute('data-theme') === 'light';
  themeBtn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  themeBtn.title = themeBtn.getAttribute('aria-label');
}
themeBtn.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  storage('aq-theme', next);
  syncThemeButton();
  charts.rethemeAll();
  window.dispatchEvent(new CustomEvent('themechange'));
});
syncThemeButton();

/* ---------- Global listeners ---------- */
window.addEventListener('resize', debounce(charts.resizeAll, 150));
window.addEventListener('hashchange', navigate);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => charts.rethemeAll());

if (!location.hash) history.replaceState(null, '', '#/overview');
navigate();
