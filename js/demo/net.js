// Demo network layer — same exports as ../net.js, but everything is simulated in the browser:
// a simplified Tehran road network, pedestrian bridges, and fake Neshan / Map.ir answers
// (with latency) so the failover between providers can be seen working.
import { ROADS, PLACES, AREAS } from './tehran.js';
import { SPEED_RATIO } from '../config.js';
import { nearestOnLine, dist } from '../geo.js';
import MARKET from '../../data/market.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lag = () => sleep(250 + Math.random() * 450);
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }

function asWay(r, p) {
  const snap = nearestOnLine(p, r.line);
  return {
    osmId: r.id, name: r.name, nameEn: '', ref: '', cls: r.cls, oneway: false, reversed: false,
    lanes: { total: r.lanes * 2, fwd: r.lanes, bwd: r.lanes }, maxspeed: r.max, bridge: false, tunnel: false,
    line: r.line, snap,
  };
}
function nearestRoad(p) {
  let best = null;
  for (const r of ROADS) { const s = nearestOnLine(p, r.line); if (!best || s.distance < best.d) best = { r, d: s.distance }; }
  return best;
}

// ── OSM equivalents ────────────────────────────────────────
export async function roadsInBbox([s, w, n, e], classes = ['motorway', 'trunk', 'primary']) {
  await sleep(250);
  return ROADS.filter(r => classes.includes(r.cls) && r.line.some(([la, lo]) => la >= s && la <= n && lo >= w && lo <= e))
    .map(r => ({ ...asWay(r, r.line[0]), snap: null }));
}

export async function roadsNear(lat, lng, radius = 90) {
  await sleep(180 + Math.random() * 220);
  const p = [lat, lng];
  return ROADS.map(r => asWay(r, p)).filter(w => w.snap.distance <= radius * 1.6).sort((a, b) => a.snap.distance - b.snap.distance).slice(0, 4);
}

let STRUCTS = null;
function structures() {
  if (STRUCTS) return STRUCTS;
  STRUCTS = [];
  ROADS.filter(r => r.cls === 'motorway' || r.cls === 'trunk').forEach(r => {
    let acc = 0, next = 600 + hash(r.id) * 700;
    for (let i = 0; i < r.line.length - 1; i++) {
      const a = r.line[i], b = r.line[i + 1], d = dist(a, b);
      while (acc + d >= next) {
        const f = (next - acc) / d;
        const lat = a[0] + (b[0] - a[0]) * f, lng = a[1] + (b[1] - a[1]) * f;
        const place = PLACES.reduce((best, pl) => { const d = dist([lat, lng], [pl.lat, pl.lng]); return !best || d < best.d ? { pl, d } : best; }, null);
        let nm = `پل عابر ${r.name.replace('بزرگراه ', '').replace('شهید ', '')} — حوالی ${place.pl.name}`;
        const dup = STRUCTS.filter(x => x.name.startsWith(nm)).length;
        if (dup) nm += ` (${dup + 1})`;
        STRUCTS.push({ id: `${r.id}-${STRUCTS.length}`, lat, lng, kind: 'bridge', name: nm, adType: '', source: 'demo' });
        next += 1100 + hash(r.id + next) * 900;
      }
      acc += d;
    }
  });
  [['valiasr', 0.35], ['valiasr', 0.62], ['shariati', 0.5], ['enghelab', 0.4], ['mirdamad', 0.5]].forEach(([id, t], k) => {
    const r = ROADS.find(x => x.id === id); const i = Math.floor(t * (r.line.length - 1));
    const a = r.line[i], b = r.line[i + 1];
    STRUCTS.push({ id: `ad-${k}`, lat: (a[0] + b[0]) / 2 + 0.0003, lng: (a[1] + b[1]) / 2 + 0.0003, kind: 'ad', name: `تابلو ثبت‌شده — ${r.name.replace('خیابان ', '')}`, adType: 'billboard', source: 'demo' });
  });
  return STRUCTS;
}
export async function structuresIn([s, w, n, e]) {
  // the demo now uses the real market snapshot instead of simulated bridges
  await sleep(100);
  return [];
}

export async function highwayNetwork() {
  await sleep(300);
  return ROADS.filter(r => r.cls === 'motorway' || r.cls === 'trunk').map(r => ({ cls: r.cls, name: r.name, line: r.line }));
}

function searchLocal(term) {
  const t = term.replace(/\s+/g, ' ').trim();
  const places = PLACES.filter(p => p.name.includes(t)).map(p => ({ title: p.name, sub: 'تهران', lat: p.lat, lng: p.lng }));
  const roads = ROADS.filter(r => r.name.includes(t)).map(r => { const m = r.line[Math.floor(r.line.length / 2)]; return { title: r.name, sub: 'تهران', lat: m[0], lng: m[1] }; });
  return [...places, ...roads].slice(0, 8);
}
export async function osmSearch(term) { await lag(); return searchLocal(term); }

// ── simulated live traffic ─────────────────────────────────
function profileFor(r) {
  const sev = 0.8 + hash(r.id) * 0.45, shift = Math.round(hash(r.id + 'x') * 2) - 1;
  const minor = r.cls === 'primary' ? 0.8 : 1;
  const ratio = SPEED_RATIO.map((_, h) => {
    const base = SPEED_RATIO[(h - shift + 24) % 24];
    return Math.max(0.18, Math.min(1, 1 - (1 - base) * sev * minor));
  });
  return { kpi: Math.round((1 - ratio.reduce((a, b) => a + b, 0) / 24) * 100), ratio, congestion: ratio.map(x => (1 - x) / 0.85) };
}
const nowHour = () => { try { return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date()), 10); } catch { return new Date().getHours(); } };

export const neshan = {
  async search(term) { await lag(); return searchLocal(term); },
  async profile(lat, lng) {
    await lag();
    const n = nearestRoad([lat, lng]);
    if (!n || n.d > 400) { const e = new Error('no data'); e.status = 204; throw e; }
    return profileFor(n.r);
  },
  async speed(line, snap) {
    await lag();
    const n = nearestRoad(snap.point);
    const p = profileFor(n.r);
    return { kmh: n.r.max * p.ratio[nowHour()] * (0.94 + Math.random() * 0.12), meters: 800, trafficAware: true };
  },
};

export const mapir = {
  async search(term) { await lag(); return searchLocal(term); },
  async speed(line, snap) {
    await lag();
    const n = nearestRoad(snap.point);
    return { kmh: n.r.max * (0.82 + Math.random() * 0.08), meters: 800, trafficAware: false };
  },
};

export function parseAnalytics(r) { return r; }

// ── vector basemap (replaces map tiles in the demo) ────────
export function drawBase(map) {
  const L = window.L;
  map.createPane('demoBase'); map.getPane('demoBase').style.zIndex = 250;
  map.createPane('demoLabels'); map.getPane('demoLabels').style.zIndex = 420; map.getPane('demoLabels').style.pointerEvents = 'none';
  const pane = 'demoBase';
  const style = {
    mountain: { color: '#1a2130', fillColor: '#161c27', fillOpacity: 1, weight: 0 },
    city: { color: '#232c3d', fillColor: '#121823', fillOpacity: 1, weight: 1.2 },
    park: { color: '#1d3a33', fillColor: '#15302a', fillOpacity: 1, weight: 1 },
    airport: { color: '#262f40', fillColor: '#1a2130', fillOpacity: 1, weight: 1, dashArray: '4 4' },
  };
  ['mountain', 'city', 'park', 'airport'].forEach(k => AREAS.filter(a => a.kind === k).forEach(a => L.polygon(a.poly, { ...style[k], pane, interactive: false }).addTo(map)));
  // light street grid for texture
  const grid = [];
  for (let la = 35.62; la <= 35.81; la += 0.012) grid.push([[la, 51.22 + hash('g' + la) * 0.05], [la + 0.002, 51.54 - hash('h' + la) * 0.05]]);
  for (let lo = 51.24; lo <= 51.54; lo += 0.014) grid.push([[35.62 + hash('i' + lo) * 0.03, lo], [35.80 - hash('j' + lo) * 0.02, lo + 0.003]]);
  grid.forEach(l => L.polyline(l, { color: '#1b2333', weight: 1, pane, interactive: false }).addTo(map));
  const w = { motorway: [7, 4], trunk: [6, 3.4], primary: [4, 2.2] };
  const col = { motorway: '#3b4a66', trunk: '#36435c', primary: '#2a3446' };
  ROADS.slice().sort((a, b) => (a.cls === 'primary') - (b.cls === 'primary')).reverse().forEach(r => {
    L.polyline(r.line, { color: '#0d121b', weight: w[r.cls][0], pane, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    L.polyline(r.line, { color: col[r.cls], weight: w[r.cls][1], pane, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  });
  const roadLabels = L.layerGroup();
  ROADS.forEach(r => {
    const m = r.line[Math.floor((r.line.length - 1) / 2)], m2 = r.line[Math.floor((r.line.length - 1) / 2) + 1] || m;
    const pt = [(m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2];
    L.marker(pt, { pane: 'demoLabels', interactive: false, icon: L.divIcon({ className: '', iconSize: null, html: `<div class="demo-road">${r.name.replace('بزرگراه ', '').replace('شهید ', '')}</div>` }) }).addTo(roadLabels);
  });
  const placeLabels = L.layerGroup();
  PLACES.forEach(p => L.marker([p.lat, p.lng], { pane: 'demoLabels', interactive: false, icon: L.divIcon({ className: '', iconSize: null, html: `<div class="demo-place ${p.landmark ? 'lm' : ''} s${p.size}">${p.name}</div>` }) }).addTo(placeLabels));
  AREAS.filter(a => a.name).forEach(a => {
    const c = a.poly.reduce((s, q) => [s[0] + q[0] / a.poly.length, s[1] + q[1] / a.poly.length], [0, 0]);
    L.marker(c, { pane: 'demoLabels', interactive: false, icon: L.divIcon({ className: '', iconSize: null, html: `<div class="demo-area">${a.name}</div>` }) }).addTo(placeLabels);
  });
  const sync = () => {
    const z = map.getZoom();
    if (z >= 13) roadLabels.addTo(map); else roadLabels.remove();
    placeLabels.addTo(map);
    map.getContainer().classList.toggle('z-low', z < 13);
  };
  map.on('zoomend', sync); sync();
  map.attributionControl.addAttribution('نقشه ساده‌شده دمو');
}

// ── real market snapshot (data/market.json) for the offline demo ──
export function demoMarket() {
  const items = MARKET.items.map(m => ({ ...m, source: 'market', priceSource: m.price ? 'market' : null }));
  // one illustrative bundle so the bundle logic can be seen — not a real offer
  const pick = items.filter(x => /همت/.test(x.name + x.address) && x.price).slice(0, 3).map(x => x.id);
  const bundles = pick.length === 3 ? [{ id: 'sample', name: 'باندل نمونه (فرضی) — سه سازه همت', owner: '', ids: pick, price: Math.round(items.filter(x => pick.includes(x.id)).reduce((a, x) => a + x.price, 0) * 0.85 / 1e6) * 1e6, minWeeks: 4, only: false }] : [];
  return { items, bundles, rules: {}, updatedAt: MARKET.updatedAt, stats: MARKET.stats, source: MARKET.source };
}

/** Demo: no real boundaries — the app falls back to approximate districts. */
export async function districts() { await sleep(100); return null; }

/** Demo: roads come from the bundled approximation, no prebuilt file. */
export async function staticRoads() { return null; }
