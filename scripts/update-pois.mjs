// Shops, restaurants, cafés and other gathering places from Neshan's search, for the cities other than Tehran.
// OpenStreetMap is thin outside Tehran (a whole restaurant street can be missing), so hotspots there are built from
// OpenStreetMap + these places (scripts/hotspot-build.mjs).
//
//   node scripts/update-pois.mjs --city=gorgan
//
// Neshan service needed on the key (Neshan panel → the key → services): «جستجو» (Search, /v1/search).
// The city box is covered by a grid of search points, from the centre outwards, one search per point and term.
// A search that comes back full (30 answers) is split into four closer points, so dense streets are read in full.
// Each run spends at most NESHAN_POI_CALLS requests (default 400) and continues where the last run stopped;
// a complete pass is repeated every 60 days. Results: data/cities/<slug>/pois-neshan.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { CITIES, cityDir } from '../js/cities.js';
import { neshanClient, latin } from './neshan-api.mjs';
import { TERMS, termId } from './poi-terms.mjs';

const SLUG = (process.argv.find(a => a.startsWith('--city=')) || '').slice(7);
if (!CITIES[SLUG] || SLUG === 'tehran') { console.error('usage: update-pois.mjs --city=<slug> (not Tehran)'); process.exit(1); }
const CITY = CITIES[SLUG], DIR = cityDir(SLUG), FILE = `${DIR}/pois-neshan.json`;
const KEY = process.env.NESHAN_SEARCH_KEY || process.env.NESHAN_KEY;
const BUDGET = Math.max(0, +(process.env.NESHAN_POI_CALLS || 400));
const runLog = o => { try { mkdirSync('.cache', { recursive: true }); writeFileSync(`.cache/pois-run-${SLUG}.json`, JSON.stringify(o)); } catch { /* report only */ } };
if (!KEY) { console.log('NESHAN_KEY is not set; hotspots use OpenStreetMap only.'); runLog({ mode: 'nokey' }); process.exit(0); }
if (!BUDGET) { runLog({ mode: 'off' }); process.exit(0); }

const NOT_A_PLACE = /^(خیابان|بلوار|بولوار|کوچه|میدان|بزرگراه|اتوبان|جاده|محله|شهرک|ایستگاه|پل|تقاطع|چهارراه|سه ?راه|منطقه|ناحیه)(\s|$)/;
const ROAD_TYPES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'trunk', 'motorway', 'street', 'road', 'unclassified', 'service', 'neighbourhood', 'suburb', 'city', 'village', 'region']);

const KX = 111320 * Math.cos(CITY.center[0] * Math.PI / 180), KY = 110540;
const [S, W, N, E] = CITY.box;
const inBox = (la, ln) => la > S && la < N && ln > W && ln < E;
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const daysSince = ymd => (Date.now() - Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))) / 864e5;

// first-pass grid: 2 km apart, centre first, only where the city is built up (named streets nearby in the
// gazetteer); the main kinds of place first everywhere, then the rest
const CORE = 8; // the first TERMS: restaurants, cafés, fast food, clothes, malls, shoes, mobile, gold
function initialQueue() {
  const step = 2000, pts = [];
  for (let y = S + step / 2 / KY; y < N; y += step / KY) for (let x = W + step / 2 / KX; x < E; x += step / KX) pts.push([+y.toFixed(5), +x.toFixed(5)]);
  const gz = (() => { try { return JSON.parse(readFileSync(`${DIR}/gazetteer.json`, 'utf8')).places || []; } catch { return []; } })();
  const streets = gz.filter(p => p[1] === 'r').map(p => [p[2] / 1e5, p[3] / 1e5]);
  const built = p => !streets.length || streets.filter(q => Math.abs(q[0] - p[0]) * KY < 1100 && Math.abs(q[1] - p[1]) * KX < 1100).length >= 15;
  const [cy, cx] = CITY.center;
  const use = pts.filter(built).sort((a, b) => Math.hypot((a[0] - cy) * KY, (a[1] - cx) * KX) - Math.hypot((b[0] - cy) * KY, (b[1] - cx) * KX));
  const q = [];
  for (const p of use) TERMS.slice(0, CORE).forEach((_, k) => q.push([k, p[0], p[1], step]));
  for (const p of use) TERMS.slice(CORE).forEach((_, k) => q.push([k + CORE, p[0], p[1], step]));
  console.log(`${SLUG}: ${use.length} of ${pts.length} grid points are built up`);
  return q;
}

const norm = s => latin(s).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‍]/g, ' ').replace(/\s+/g, ' ').trim();
// the street from a Neshan address («گرگان، بلوار ناهارخوران، نبش عدالت 32» → «بلوار ناهارخوران»)
function streetOf(addr) {
  const parts = norm(addr).split(/[،,]/).map(s => s.trim()).filter(s => s && s !== CITY.fa);
  return parts.find(s => /^(خیابان|بلوار|بولوار|بزرگراه|جاده|میدان|خ\.?)\s/.test(s)) || '';
}

const prev = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const state = prev || { pass: 0, passAt: null, queue: [], items: [] };
if (!state.queue.length) {
  if (state.passAt && daysSince(state.passAt) < 60) { console.log(`${SLUG}: full pass done ${state.passAt}; next in ${Math.ceil(60 - daysSince(state.passAt))} days`); runLog({ mode: 'fresh', items: state.items.length }); process.exit(0); }
  state.queue = initialQueue(); state.pass++; state.passStart = today;
}

const byKey = new Map(state.items.map((it, i) => [`${it[1]}|${it[0]}|${Math.round(it[2] / 30)}|${Math.round(it[3] / 30)}`, i]));
const api = neshanClient(KEY, BUDGET);
let added = 0, seenAgain = 0, searches = 0;
const sample = new Map();
while (state.queue.length && !api.st.stop) {
  const [k, lat, lng, step] = state.queue[0];
  const T = TERMS[k];
  const j = await api.get(`/v1/search?term=${encodeURIComponent(T.q)}&lat=${lat}&lng=${lng}`);
  if (!j) break;
  state.queue.shift(); searches++;
  const items = Array.isArray(j.items) ? j.items : [];
  if (!sample.has(T.q)) sample.set(T.q, items.slice(0, 3).map(i => `${i.title} [${i.type || ''}/${i.category || ''}]`));
  let accepted = 0;
  for (const i of items) {
    const la = +i.location?.y, ln = +i.location?.x, title = norm(i.title);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || !title || !inBox(la, ln)) continue;
    const type = String(i.type || '').toLowerCase();
    if (NOT_A_PLACE.test(title) || ROAD_TYPES.has(type)) continue;
    if (!(T.types.includes(type) || T.ok.test(title))) continue;
    accepted++;
    const L5 = Math.round(la * 1e5), N5 = Math.round(ln * 1e5);
    const key = `${termId(T)}|${title}|${Math.round(L5 / 30)}|${Math.round(N5 / 30)}`;
    if (byKey.has(key)) { state.items[byKey.get(key)][5] = today; seenAgain++; continue; }
    byKey.set(key, state.items.length);
    state.items.push([title, termId(T), L5, N5, streetOf(i.address || ''), today]);
    added++;
  }
  // a full answer means there is more here: look again from four closer points (down to 500 m apart)
  if (items.length >= 30 && accepted >= 15 && step > 600) {
    const h = step / 2, dy = h / 2 / KY, dx = h / 2 / KX;
    state.queue.splice(0, 0, ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => [k, +(lat + a * dy).toFixed(5), +(lng + b * dx).toFixed(5), h]));
  }
}
if (!state.queue.length) {
  state.passAt = today;
  // places not seen in this whole pass (and not for 120 days) have probably closed
  state.items = state.items.filter(it => daysSince(it[5]) < 120 || it[5] >= (state.passStart || today));
}
state.updatedAt = new Date().toISOString();
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify(state));
const stop = api.st.stop && api.st.stop !== 'budget' ? api.st.stop : '';
console.log(`${SLUG}: ${searches} searches, +${added} new places, ${seenAgain} seen again, ${state.items.length} in total, ${state.queue.length} searches left in this pass${stop ? `; stopped: ${stop}` : ''}`);
for (const [q, s] of sample) console.log(`  ${q}: ${s.join(' · ')}`);
runLog({ mode: stop ? 'stopped' : 'ok', stop, searches, added, items: state.items.length, left: state.queue.length });
