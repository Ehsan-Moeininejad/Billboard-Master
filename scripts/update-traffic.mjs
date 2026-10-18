// Weekly traffic refresh from the Neshan API (needs the NESHAN_KEY repository secret).
//
// For every market structure (grouped by road and ~250 m, so neighbours share one lookup) it asks Neshan
// how long an ~800 m stretch of that road takes at 03, 08, 11, 14, 18 and 21 o'clock on a working day
// («مسیریابی پیش‌بینی بر پایه الگوهای ترافیکی گذشته», /v1/direction/historical). Those speeds give the
// 24-hour traffic pattern and the free-flow speed of the point. Without that service it falls back to
// «مسیریابی برمبنای الگوی ترافیکی» (/v1/direction/typical) for one speed; if the key also has traffic
// analytics, that 24-hour chart is used directly. The site uses data/traffic.json instead of its model profile.
// Each run refreshes the oldest points first, up to NESHAN_MAX_CALLS requests, so a free quota is respected.
// Every snapshot is appended to data/traffic-history.csv; once a Persian month has been observed in at
// least two weekly runs, its measured traffic level replaces the default month factor (seasonality).
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
// one-line summary for the weekly email (scripts/weekly-report.mjs)
const runLog = o => { try { mkdirSync('.cache', { recursive: true }); writeFileSync('.cache/traffic-run.json', JSON.stringify(o)); } catch { /* report only */ } };
import { neshan } from '../js/net.js';
import { nearestOnLine } from '../js/geo.js';
import { persianMonth } from '../js/calendar.js';
import { tehranHour } from '../js/model.js';

const KEY = process.env.NESHAN_KEY;
const MAX_CALLS = +(process.env.NESHAN_MAX_CALLS || 800);
if (!KEY) { console.log('NESHAN_KEY is not set; traffic stays on the model profile.'); runLog({ mode: 'nokey' }); process.exit(0); }
const cfg = { key: KEY };

const market = JSON.parse(readFileSync('data/market.json', 'utf8'));
if (!existsSync('data/roads.json')) { console.log('data/roads.json missing (Overpass down?); skipping this week.'); runLog({ mode: 'noroads' }); process.exit(0); }
const roadsFile = JSON.parse(readFileSync('data/roads.json', 'utf8'));
const unpack = a => { const o = []; let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o.push([la / 1e5, lo / 1e5]); } return o; };
const ways = roadsFile.ways.filter(w => !w.cls.endsWith('_link')).map(w => ({ ...w, line: unpack(w.line) }));

// coarse grid so each structure only checks nearby roads
const G = 0.01, grid = new Map();
ways.forEach((w, i) => {
  const cells = new Set(w.line.map(([a, b]) => `${Math.floor(a / G)}:${Math.floor(b / G)}`));
  cells.forEach(c => { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(i); });
});
function nearestWay(lat, lng) {
  const ca = Math.floor(lat / G), cb = Math.floor(lng / G), seen = new Set();
  let best = null;
  for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const i of grid.get(`${ca + da}:${cb + db}`) || []) {
    if (seen.has(i)) continue; seen.add(i);
    const s = nearestOnLine([lat, lng], ways[i].line);
    if (!best || s.distance < best.snap.distance) best = { way: ways[i], snap: s };
  }
  return best && best.snap.distance <= 150 ? best : null;
}

const prev = existsSync('data/traffic.json') ? JSON.parse(readFileSync('data/traffic.json', 'utf8')) : { items: {}, groups: {} };
const groups = new Map();
for (const it of market.items) {
  const nw = nearestWay(it.lat, it.lng);
  if (!nw) continue;
  const p = nw.snap.point;
  const key = `${nw.way.osmId}:${Math.round(p[0] / 0.0025)}:${Math.round(p[1] / 0.0025)}`;
  if (!groups.has(key)) groups.set(key, { key, way: nw.way, snap: nw.snap, ids: [] });
  groups.get(key).ids.push(it.id);
}
const order = [...groups.values()].sort((a, b) => (prev.groups?.[a.key]?.at || 0) - (prev.groups?.[b.key]?.at || 0));
console.log(`${market.items.length} structures → ${groups.size} road points; up to ${MAX_CALLS} Neshan requests this run (about 7 per point)`);

const out = { items: { ...(prev.items || {}) }, groups: { ...(prev.groups || {}) } };
const today = new Date().toISOString().slice(0, 10), month = persianMonth(new Date());
const history = [];
let calls = 0, ok = 0, failed = 0, stop = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the same set of current ids, so dropped structures do not linger
const liveIds = new Set(market.items.map(i => i.id));
Object.keys(out.items).forEach(id => { if (!liveIds.has(id)) delete out.items[id]; });

// ── Neshan services used (enable them on the key in the Neshan panel) ──
//   «مسیریابی پیش‌بینی بر پایه الگوهای ترافیکی گذشته»  /v1/direction/historical  → speed at chosen hours
//   «مسیریابی برمبنای الگوی ترافیکی»                     /v1/direction/typical     → fallback speed
//   traffic analytics (/navigation/traffic/analytics) is used only if the key happens to have it.
const QUOTA = [401, 402, 403, 429, 470];
async function neshanJSON(path) {
  calls++;
  const r = await fetch('https://api.neshan.org' + path, { headers: { 'Api-Key': KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status} ${path.split('?')[0]}`); e.status = r.status; throw e; }
  return r.json();
}
// duration (s) and distance (m) from a direction-style answer, wherever they sit
function legOf(j) {
  const leg = j?.routes?.[0]?.legs?.[0] || j?.routes?.[0] || j?.route || j;
  const dur = leg?.duration?.value ?? leg?.duration ?? j?.duration?.value ?? j?.duration;
  const dist = leg?.distance?.value ?? leg?.distance ?? j?.distance?.value ?? j?.distance;
  return Number.isFinite(+dur) && Number.isFinite(+dist) && +dur > 0 && +dist > 0 ? { s: +dur, m: +dist } : null;
}
// ~800 m stretch of the road around the structure (same as the in-app live check)
function stretch(g) {
  const line = g.way.line, i = g.snap.index ?? 0;
  const pick = k => line[Math.max(0, Math.min(line.length - 1, k))];
  let a = i, b = i + 1, len = 0;
  const d = (p, q) => Math.hypot((p[0] - q[0]) * 111320, (p[1] - q[1]) * 111320 * Math.cos(p[0] * Math.PI / 180));
  while (len < 800 && (a > 0 || b < line.length - 1)) {
    if (a > 0) { len += d(pick(a), pick(a - 1)); a--; }
    if (b < line.length - 1) { len += d(pick(b), pick(b + 1)); b++; }
  }
  return { o: pick(a), dst: pick(b) };
}
// Tehran-time hours sampled on the coming Sunday (a normal working day); Neshan wants UTC "YYYY-MM-DDThh:mm"
const SLOTS = [3, 8, 11, 14, 18, 21];
function utcFor(hourTehran) {
  const now = new Date(), day = new Date(now);
  const toSun = ((0 - now.getUTCDay()) + 7) % 7 || 7;            // next Sunday, never today
  day.setUTCDate(now.getUTCDate() + toSun);
  const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hourTehran, 0) - 3.5 * 3600e3;
  return new Date(t).toISOString().slice(0, 16);
}
// 24-hour speed ratio from a few sampled hours (linear, wrapping round midnight)
function profileFrom(samples) {
  const pts = Object.entries(samples).map(([h, v]) => [+h, v]).sort((a, b) => a[0] - b[0]);
  const free = Math.max(...pts.map(p => p[1]));
  const at = h => {
    for (let k = 0; k < pts.length; k++) {
      const [h1, v1] = pts[k], [h2, v2] = pts[(k + 1) % pts.length];
      const span = ((h2 - h1) + 24) % 24 || 24, off = ((h - h1) + 24) % 24;
      if (off <= span) return v1 + (v2 - v1) * off / span;
    }
    return pts[0][1];
  };
  const ratio = Array.from({ length: 24 }, (_, h) => Math.max(0.15, Math.min(1, at(h) / free)));
  return { kpi: null, ratio, congestion: ratio.map(r => Math.min(1, (1 - r) / 0.85)), source: 'historical', freeKmh: +free.toFixed(1) };
}

let analyticsOK = true, historicalOK = true;
for (const g of order) {
  if (stop || calls + SLOTS.length + 1 > MAX_CALLS) break;
  const p = g.snap.point, { o, dst } = stretch(g);
  const od = `origin=${o[0]},${o[1]}&destination=${dst[0]},${dst[1]}`;
  let traffic = null, speed = null;

  if (analyticsOK) {
    try { traffic = await neshan.profile(p[0], p[1], cfg); calls++; }
    catch (e) { calls++; if (QUOTA.includes(e.status) || e.status === 404) { analyticsOK = false; console.log(`traffic analytics not available on this key (${e.status}); using historical routing`); } }
  }
  if (!traffic && historicalOK) {
    const samples = {};
    for (const h of SLOTS) {
      try {
        const leg = legOf(await neshanJSON(`/v1/direction/historical?${od}&routingType=DepartAt&dateTime=${utcFor(h)}`));
        if (leg && leg.m < 2500) samples[h] = leg.m / leg.s * 3.6;
      } catch (e) {
        if (e.status === 429 || e.status === 402 || e.status === 470) { stop = e; break; }
        if (e.status === 401 || e.status === 403 || e.status === 404) { historicalOK = false; console.log(`historical routing not available on this key (${e.status}); using typical routing only`); break; }
      }
      await sleep(150);
    }
    if (Object.keys(samples).length >= 4) {
      traffic = profileFrom(samples);
      speed = { kmh: samples[11] ?? Object.values(samples)[0], meters: null, hour: samples[11] != null ? 11 : +Object.keys(samples)[0], trafficAware: true };
    }
  }
  if (!speed && !stop) {
    try {
      const leg = legOf(await neshanJSON(`/v1/direction/typical?type=car&${od}`));
      if (leg && leg.m < 2500) speed = { kmh: leg.m / leg.s * 3.6, meters: leg.m, hour: tehranHour(), trafficAware: true };
    } catch (e) { if (QUOTA.includes(e.status)) stop = e; }
  }
  if (!traffic && !speed) { failed++; await sleep(150); continue; }
  ok++;
  const rec = { traffic, speed: speed ? { ...speed, provider: 'neshan' } : null, at: Date.now() };
  out.groups[g.key] = { at: rec.at };
  g.ids.forEach(id => { out.items[id] = rec; });
  if (traffic) {
    const day = traffic.congestion.slice(7, 22), mean = day.reduce((a, b) => a + b, 0) / day.length;
    history.push([today, month, g.key, mean.toFixed(4), speed ? speed.kmh.toFixed(1) : ''].join(','));
  }
  await sleep(150);
}
if (stop) console.warn(`Neshan stopped the run: HTTP ${stop.status} (${stop.message}) — quota or key problem; previous values kept.`);
console.log(`calls ${calls}, refreshed ${ok}, empty ${failed}`);
runLog({ mode: analyticsOK ? 'analytics' : historicalOK ? 'historical' : 'typical', calls, refreshed: ok, empty: failed, points: groups.size,
  stop: stop ? `HTTP ${stop.status}` : null });

// seasonality from the history: mean daytime congestion per Persian month, relative to the observed average
if (!existsSync('data/traffic-history.csv')) writeFileSync('data/traffic-history.csv', 'date,persian_month,point,day_congestion,speed_kmh\n');
if (history.length) appendFileSync('data/traffic-history.csv', history.join('\n') + '\n');
const rows = readFileSync('data/traffic-history.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const byMonth = new Map();
for (const [date, m, , c] of rows) {
  if (!byMonth.has(+m)) byMonth.set(+m, { sum: 0, n: 0, dates: new Set() });
  const b = byMonth.get(+m); b.sum += +c; b.n++; b.dates.add(date);
}
const seasonality = {};
const observed = [...byMonth].filter(([, b]) => b.dates.size >= 2);
if (observed.length >= 2) {
  const avg = observed.reduce((a, [, b]) => a + b.sum / b.n, 0) / observed.length;
  // congestion moves faster than volume near capacity; damp it before using it as a volume factor
  for (const [m, b] of observed) seasonality[m] = { factor: +Math.min(1.3, Math.max(0.7, 1 + 0.6 * ((b.sum / b.n) / avg - 1))).toFixed(3), weeks: b.dates.size };
}

writeFileSync('data/traffic.json', JSON.stringify({
  updatedAt: new Date().toISOString(), provider: 'neshan',
  coverage: { structures: Object.keys(out.items).length, points: groups.size },
  seasonality, groups: out.groups, items: out.items,
}));
console.log(`traffic.json: ${Object.keys(out.items).length} structures with Neshan data; seasonality months: ${Object.keys(seasonality).join(',') || 'none yet'}`);
