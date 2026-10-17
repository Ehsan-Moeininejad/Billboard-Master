// Prebuilds Tehran's major roads and municipal districts from OpenStreetMap so the site loads fast:
//   data/roads.json      — motorways … secondary roads, in the same shape the app uses (js/net.js shapeWay)
//   data/districts.json  — the 22 municipal districts (only written when OSM returns at least 15)
// Run at deploy time by .github/workflows/pages.yml and before the weekly market build.
// If Overpass is down the previous files (if any) are kept and the app falls back to live queries.
import { writeFileSync } from 'node:fs';
import { OVERPASS_ENDPOINTS } from '../js/config.js';
import { shapeWay } from '../js/net.js';
import { OSM_DISTRICT_QUERY, parseOsmDistricts } from '../js/districts.js';

const BBOX = [35.55, 51.10, 35.85, 51.65];
const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link'];

async function overpass(q, tries = 2) {
  let last;
  for (let t = 0; t < tries; t++) for (const url of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'billboard-insight (GitHub Actions)' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(200000),
      });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; console.warn('overpass failed:', e.message); }
  }
  throw last;
}

// flat, delta-encoded 1e-5 degree integers — about a third of the size of plain coordinate arrays
function pack(line) {
  const out = []; let la = 0, lo = 0;
  for (const [a, b] of line) { const A = Math.round(a * 1e5), B = Math.round(b * 1e5); out.push(A - la, B - lo); la = A; lo = B; }
  return out;
}

let ok = true;
try {
  const q = `[out:json][timeout:180];way["highway"~"^(${CLASSES.join('|')})$"](${BBOX.join(',')});out tags geom;`;
  const res = await overpass(q);
  const ways = (res.elements || []).filter(e => e.type === 'way' && e.geometry?.length > 1).map(shapeWay)
    .map(({ nameEn, ref, snap, ...w }) => ({ ...w, line: pack(w.line) }));
  if (ways.length < 500) throw new Error(`only ${ways.length} roads returned`);
  writeFileSync('data/roads.json', JSON.stringify({ updatedAt: new Date().toISOString(), bbox: BBOX, classes: CLASSES, ways }));
  console.log(`roads: ${ways.length}`);
} catch (e) { ok = false; console.warn('roads not rebuilt:', e.message); }

try {
  const d = parseOsmDistricts(await overpass(OSM_DISTRICT_QUERY));
  if (d.length >= 15) { writeFileSync('data/districts.json', JSON.stringify(d)); console.log(`districts: ${d.length}`); }
  else console.warn(`districts: only ${d.length}, keeping fallback`);
} catch (e) { console.warn('districts not rebuilt:', e.message); }

if (!ok) process.exitCode = 0; // never fail the deploy because of Overpass
