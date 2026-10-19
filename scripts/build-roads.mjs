// Prebuilds Tehran's major roads and municipal districts from OpenStreetMap so the site loads fast:
//   data/roads.json      — motorways … secondary roads, in the same shape the app uses (js/net.js shapeWay)
//   data/districts.json  — the 22 municipal districts (only written when OSM returns at least 15)
//   data/hotspots.json   — places where people gather (malls, shopping/trade streets, food, metro…), see js/hotspots.js
// Run at deploy time by .github/workflows/pages.yml and before the weekly market build.
// If Overpass is down the previous files (if any) are kept and the app falls back to live queries.
// With --city=<slug> the same files are built for another city into data/cities/<slug>/ (see js/cities.js).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { CITIES, cityDir } from '../js/cities.js';
import { OVERPASS_ENDPOINTS } from '../js/config.js';
import { shapeWay } from '../js/net.js';
import { OSM_DISTRICT_QUERY, parseOsmDistricts, districtQuery } from '../js/districts.js';
import { HOTSPOT_QUERY, HOTSPOT_BBOX, buildHotspots, roadNamer } from '../js/hotspots.js';

const SLUG = (process.argv.find(a => a.startsWith('--city=')) || '--city=tehran').slice(7);
if (!CITIES[SLUG]) { console.error(`unknown city ${SLUG}`); process.exit(1); }
const CITY = CITIES[SLUG], IS_TEHRAN = SLUG === 'tehran', DIR = cityDir(SLUG);
mkdirSync(DIR, { recursive: true });
const BBOX = IS_TEHRAN ? [35.55, 51.10, 35.85, 51.65] : CITY.box;
const result = { city: SLUG, roads: null, districts: null, hotspots: null };
// other cities' files are committed to the repo: skip the write when only the timestamp would change
const same = (file, key, value) => { if (IS_TEHRAN || !existsSync(file)) return false; try { return JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))[key]) === JSON.stringify(value); } catch { return false; } };
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

// a big query that times out is retried as four quadrants and the results merged
async function overpassTiled(makeQuery, bbox) {
  try { return await overpass(makeQuery(bbox)); } catch (e) { console.warn('whole-city query failed, trying quadrants:', e.message); }
  const [s, w, n, e] = bbox, mLat = (s + n) / 2, mLng = (w + e) / 2;
  const seen = new Set(), elements = [];
  for (const b of [[s, w, mLat, mLng], [s, mLng, mLat, e], [mLat, w, n, mLng], [mLat, mLng, n, e]]) {
    const r = await overpass(makeQuery(b));
    (r.elements || []).forEach(x => { const k = x.type + x.id; if (!seen.has(k)) { seen.add(k); elements.push(x); } });
  }
  return { elements };
}

// flat, delta-encoded 1e-5 degree integers — about a third of the size of plain coordinate arrays
function pack(line) {
  const out = []; let la = 0, lo = 0;
  for (const [a, b] of line) { const A = Math.round(a * 1e5), B = Math.round(b * 1e5); out.push(A - la, B - lo); la = A; lo = B; }
  return out;
}

let ok = true, plainRoads = [];
try {
  const q = b => `[out:json][timeout:180];way["highway"~"^(${CLASSES.join('|')})$"](${b.join(',')});out tags geom;`;
  const res = await overpassTiled(q, BBOX);
  const shaped = (res.elements || []).filter(e => e.type === 'way' && e.geometry?.length > 1).map(shapeWay);
  plainRoads = shaped.map(w => ({ name: w.name, line: w.line }));
  const ways = shaped.map(({ nameEn, ref, snap, ...w }) => ({ ...w, line: pack(w.line) }));
  if (ways.length < (IS_TEHRAN ? 500 : 60)) throw new Error(`only ${ways.length} roads returned`);
  if (!same(`${DIR}/roads.json`, 'ways', ways)) writeFileSync(`${DIR}/roads.json`, JSON.stringify({ updatedAt: new Date().toISOString(), bbox: BBOX, classes: CLASSES, ways }));
  console.log(`roads: ${ways.length}`); result.roads = ways.length;
} catch (e) { ok = false; console.warn('roads not rebuilt:', e.message); }

if (CITY.districts) try {
  const d = IS_TEHRAN ? parseOsmDistricts(await overpass(OSM_DISTRICT_QUERY)) : parseOsmDistricts(await overpass(districtQuery(CITY.box)), { city: CITY.fa, box: CITY.box });
  if (d.length >= (CITY.minDistricts || 15)) { writeFileSync(`${DIR}/districts.json`, JSON.stringify(d)); console.log(`districts: ${d.length}`); result.districts = d.length; }
  else console.warn(`districts: only ${d.length}, keeping fallback`);
} catch (e) { console.warn('districts not rebuilt:', e.message); }

try {
  const osm = await overpassTiled(b => HOTSPOT_QUERY.replaceAll(HOTSPOT_BBOX.join(','), b.join(',')), IS_TEHRAN ? HOTSPOT_BBOX : CITY.box);
  const items = buildHotspots(osm, { roadName: roadNamer(plainRoads) });
  if (items.length < (IS_TEHRAN ? 100 : 15)) throw new Error(`only ${items.length} hotspots`);
  if (!same(`${DIR}/hotspots.json`, 'items', items)) writeFileSync(`${DIR}/hotspots.json`, JSON.stringify({ updatedAt: new Date().toISOString(), source: 'OpenStreetMap', items }));
  console.log(`hotspots: ${items.length}`); result.hotspots = items.length;
} catch (e) { console.warn('hotspots not rebuilt:', e.message); }

try { mkdirSync('.cache', { recursive: true }); writeFileSync(`.cache/build-${SLUG}.json`, JSON.stringify(result)); } catch { /* report only */ }
if (!ok) process.exitCode = 0; // never fail the deploy because of Overpass
