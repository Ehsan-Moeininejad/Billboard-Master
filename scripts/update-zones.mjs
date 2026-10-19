// Municipal districts (مناطق شهرداری) from Neshan, for cities whose districts OpenStreetMap does not have
// (or has only some of). The city box is sampled on a grid; Neshan's reverse geocoding says which municipal
// district each point is in («municipality_zone»), and the cells of each district are traced into its outline.
//
//   node scripts/update-zones.mjs --city=gorgan
//
// Neshan service needed on the key: «تبدیل مختصات به آدرس» (Reverse Geocoding, /v5/reverse).
// The grid is sampled once (NESHAN_ZONE_CALLS requests per run, default 400, continuing where it stopped) and
// sampled again every 180 days. The result replaces data/cities/<slug>/districts.json only when it has at least as
// many districts as what is there. Progress: data/cities/<slug>/zones-grid.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { CITIES, cityDir } from '../js/cities.js';
import { neshanClient, latin } from './neshan-api.mjs';

const SLUG = (process.argv.find(a => a.startsWith('--city=')) || '').slice(7);
if (!CITIES[SLUG] || SLUG === 'tehran') { console.error('usage: update-zones.mjs --city=<slug> (not Tehran)'); process.exit(1); }
const CITY = CITIES[SLUG], DIR = cityDir(SLUG), FILE = `${DIR}/zones-grid.json`;
const KEY = process.env.NESHAN_REVERSE_KEY || process.env.NESHAN_KEY;
const BUDGET = Math.max(0, +(process.env.NESHAN_ZONE_CALLS || 400));
const runLog = o => { try { mkdirSync('.cache', { recursive: true }); writeFileSync(`.cache/zones-run-${SLUG}.json`, JSON.stringify(o)); } catch { /* report only */ } };
if (!KEY || !BUDGET) { runLog({ mode: KEY ? 'off' : 'nokey' }); process.exit(0); }

const readJSON = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const STEP = 900; // metres between samples
const [S, W, N, E] = CITY.box;
const KX = 111320 * Math.cos(((S + N) / 2) * Math.PI / 180), KY = 110540;
const dLat = STEP / KY, dLng = STEP / KX;
const rows = Math.ceil((N - S) / dLat), cols = Math.ceil((E - W) / dLng);
const center = (i, j) => [+(S + (i + 0.5) * dLat).toFixed(5), +(W + (j + 0.5) * dLng).toFixed(5)];
const today = new Date().toISOString().slice(0, 10);

let st = readJSON(FILE);
if (!st || st.step !== STEP || st.rows !== rows || st.cols !== cols) st = { step: STEP, rows, cols, box: CITY.box, cells: {}, doneAt: null };
if (st.doneAt && (Date.now() - new Date(st.doneAt).getTime()) / 864e5 < 180) { console.log(`${SLUG}: districts sampled ${st.doneAt}; nothing to do`); runLog({ mode: 'fresh' }); process.exit(0); }
if (st.doneAt) { st.cells = {}; st.doneAt = null; }

// sample the cells not yet known, from the centre outwards
const todo = [];
for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (st.cells[`${i}:${j}`] == null) todo.push([i, j]);
const [cy, cx] = CITY.center;
todo.sort((a, b) => { const p = center(...a), q = center(...b); return Math.hypot((p[0] - cy) * KY, (p[1] - cx) * KX) - Math.hypot((q[0] - cy) * KY, (q[1] - cx) * KX); });
const api = neshanClient(KEY, BUDGET);
let asked = 0;
const zoneOf = j => {
  if (!j) return null;
  const city = latin(j.city || '').replace(/\s/g, '');
  if (city && !city.includes(CITY.fa.replace(/\s/g, ''))) return 0; // another town
  const m = latin(j.municipality_zone ?? '').match(/\d{1,2}/);
  return m ? +m[0] : 0;
};
for (const [i, j] of todo) {
  const [la, ln] = center(i, j);
  const r = await api.get(`/v5/reverse?lat=${la}&lng=${ln}`);
  if (!r) break;
  st.cells[`${i}:${j}`] = zoneOf(r); asked++;
}
const left = todo.length - asked;
const stop = api.st.stop && api.st.stop !== 'budget' ? api.st.stop : '';
if (!left) st.doneAt = today;
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, JSON.stringify(st));
console.log(`${SLUG}: ${asked} points asked, ${left} left${stop ? `; stopped: ${stop}` : ''}`);
if (left) { runLog({ mode: stop ? 'stopped' : 'partial', stop, asked, left }); process.exit(0); }

// ── trace the districts ───────────────────────────────────────
const Z = (i, j) => (i < 0 || j < 0 || i >= rows || j >= cols ? 0 : st.cells[`${i}:${j}`] || 0);
// one pass of tidying: a lone cell whose four neighbours agree takes their district
const fixed = {};
for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
  const nb = [Z(i - 1, j), Z(i + 1, j), Z(i, j - 1), Z(i, j + 1)];
  fixed[`${i}:${j}`] = nb.every(v => v === nb[0]) && nb[0] !== Z(i, j) ? nb[0] : Z(i, j);
}
const Zf = (i, j) => (i < 0 || j < 0 || i >= rows || j >= cols ? 0 : fixed[`${i}:${j}`] || 0);
const corner = (i, j) => [+(S + i * dLat).toFixed(6), +(W + j * dLng).toFixed(6)];
const zones = [...new Set(Object.values(fixed).filter(Boolean))].sort((a, b) => a - b);
const out = [];
for (const z of zones) {
  // boundary edges, counter-clockwise around each cell of the district
  const edges = new Map();
  const add = (a, b) => { const k = a.join(':'); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  let cells = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (Zf(i, j) !== z) continue;
    cells++;
    if (Zf(i - 1, j) !== z) add([i, j], [i, j + 1]);
    if (Zf(i, j + 1) !== z) add([i, j + 1], [i + 1, j + 1]);
    if (Zf(i + 1, j) !== z) add([i + 1, j + 1], [i + 1, j]);
    if (Zf(i, j - 1) !== z) add([i + 1, j], [i, j]);
  }
  if (cells < 3) continue;
  const rings = [];
  while (edges.size) {
    const [k0] = edges.keys(); const start = k0.split(':').map(Number);
    const ring = [start]; let cur = start;
    for (let guard = 0; guard < 100000; guard++) {
      const k = cur.join(':'), nx = edges.get(k);
      if (!nx?.length) break;
      const next = nx.shift(); if (!nx.length) edges.delete(k);
      if (next[0] === start[0] && next[1] === start[1]) break;
      ring.push(next); cur = next;
    }
    // drop the points in the middle of straight runs
    const simple = ring.filter((p, idx) => { const a = ring[(idx - 1 + ring.length) % ring.length], b = ring[(idx + 1) % ring.length]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
    let area = 0; for (let t = 0; t < simple.length; t++) { const p = simple[t], q = simple[(t + 1) % simple.length]; area += p[1] * q[0] - q[1] * p[0]; }
    if (area > 0 && Math.abs(area) / 2 >= 2) rings.push(simple.map(([i, j]) => corner(i, j))); // outer rings of 2+ cells
  }
  if (!rings.length) continue;
  rings.sort((a, b) => b.length - a.length);
  const r0 = rings[0], c = [r0.reduce((s, p) => s + p[0], 0) / r0.length, r0.reduce((s, p) => s + p[1], 0) / r0.length];
  out.push({ n: z, fa: '', poly: r0.concat([r0[0]]), rings: rings.map(r => r.concat([r[0]])), approx: false, center: [+c[0].toFixed(5), +c[1].toFixed(5)], src: 'neshan' });
}
const cur = readJSON(`${DIR}/districts.json`);
const have = Array.isArray(cur) ? cur.length : 0;
if (out.length >= 2 && out.length >= have) {
  writeFileSync(`${DIR}/districts.json`, JSON.stringify(out));
  console.log(`${SLUG}: districts from Neshan: ${out.map(d => d.n).join(', ')}`);
  runLog({ mode: 'ok', districts: out.length });
} else {
  console.log(`${SLUG}: Neshan gave ${out.length} districts; keeping the ${have} already there`);
  runLog({ mode: 'kept', districts: out.length, have });
}
