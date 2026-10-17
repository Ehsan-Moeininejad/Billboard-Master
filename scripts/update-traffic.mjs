// Weekly traffic refresh from the Neshan API (needs the NESHAN_KEY repository secret).
//
// For every market structure (grouped by road and ~250 m, so neighbours share one lookup) it asks Neshan for
//   • the 24-hour traffic pattern at the point   (/navigation/traffic/analytics)
//   • the typical speed over ~800 m of that road  (/v1/direction/typical)
// and writes data/traffic.json, which the site uses instead of the built-in Tehran profile.
// Each run refreshes the oldest groups first, up to NESHAN_MAX_CALLS requests, so a free quota is respected.
// Every snapshot is appended to data/traffic-history.csv; once a Persian month has been observed in at
// least two weekly runs, its measured traffic level replaces the default month factor (seasonality).
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { neshan } from '../js/net.js';
import { nearestOnLine } from '../js/geo.js';
import { persianMonth } from '../js/calendar.js';
import { tehranHour } from '../js/model.js';

const KEY = process.env.NESHAN_KEY;
const MAX_CALLS = +(process.env.NESHAN_MAX_CALLS || 800);
if (!KEY) { console.log('NESHAN_KEY is not set; traffic stays on the model profile.'); process.exit(0); }
const cfg = { key: KEY };

const market = JSON.parse(readFileSync('data/market.json', 'utf8'));
if (!existsSync('data/roads.json')) { console.log('data/roads.json missing (Overpass down?); skipping this week.'); process.exit(0); }
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
console.log(`${market.items.length} structures → ${groups.size} road points; refreshing up to ${Math.floor(MAX_CALLS / 2)} this run`);

const out = { items: { ...(prev.items || {}) }, groups: { ...(prev.groups || {}) } };
const today = new Date().toISOString().slice(0, 10), month = persianMonth(new Date());
const history = [];
let calls = 0, ok = 0, failed = 0, stop = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the same set of current ids, so dropped structures do not linger
const liveIds = new Set(market.items.map(i => i.id));
Object.keys(out.items).forEach(id => { if (!liveIds.has(id)) delete out.items[id]; });

for (const g of order) {
  if (calls + 2 > MAX_CALLS || stop) break;
  const p = g.snap.point;
  let traffic = null, speed = null;
  try { traffic = await neshan.profile(p[0], p[1], cfg); } catch (e) { if ([401, 402, 403, 429, 470].includes(e.status)) stop = e; }
  calls++;
  try { speed = await neshan.speed(g.way.line, g.snap, cfg); } catch (e) { if ([401, 402, 403, 429, 470].includes(e.status)) stop = e; }
  calls++;
  if (!traffic && !speed) { failed++; await sleep(250); continue; }
  ok++;
  const rec = { traffic, speed: speed ? { ...speed, provider: 'neshan', hour: tehranHour() } : null, at: Date.now() };
  out.groups[g.key] = { at: rec.at };
  g.ids.forEach(id => { out.items[id] = rec; });
  if (traffic) {
    const day = traffic.congestion.slice(7, 22), mean = day.reduce((a, b) => a + b, 0) / day.length;
    history.push([today, month, g.key, mean.toFixed(4), speed ? speed.kmh.toFixed(1) : ''].join(','));
  }
  await sleep(250);
}
if (stop) console.warn(`Neshan stopped the run: HTTP ${stop.status} (${stop.message}) — quota or key problem; previous values kept.`);
console.log(`calls ${calls}, refreshed ${ok}, empty ${failed}`);

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
