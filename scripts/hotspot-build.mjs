// Hotspots of a city other than Tehran from everything known about its places:
//   data/cities/<slug>/osm-pois.json     shops, restaurants, malls… from OpenStreetMap (saved by build-roads.mjs)
//   data/cities/<slug>/pois-neshan.json  the same kinds of places from Neshan's search (update-pois.mjs)
//   data/cities/<slug>/roads.json        street names for the hotspot labels
// Runs every week for every city, so new Neshan places show up without waiting for the city's OpenStreetMap turn.
//
//   node scripts/hotspot-build.mjs --city=gorgan
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CITIES, cityDir } from '../js/cities.js';
import { buildHotspots, roadNamer } from '../js/hotspots.js';
import { TAGS_BY_ID } from './poi-terms.mjs';

const KEEP = ['name', 'name:fa', 'shop', 'amenity', 'leisure', 'office', 'railway', 'station', 'subway', 'train', 'light_rail', 'line', 'subway:line', 'ref', 'public_transport', 'addr:street'];
const r6 = v => Math.round(v * 1e6) / 1e6;
/** OpenStreetMap hotspot answer → the small form saved in osm-pois.json */
export function compactOsm(osm) {
  return (osm.elements || []).map(e => {
    const t = {}; for (const k of KEEP) if (e.tags?.[k] != null) t[k] = e.tags[k];
    const o = { type: e.type, id: e.id, tags: t };
    if (e.lat != null) { o.lat = r6(e.lat); o.lon = r6(e.lon); }
    if (e.bounds) o.bounds = { minlat: r6(e.bounds.minlat), minlon: r6(e.bounds.minlon), maxlat: r6(e.bounds.maxlat), maxlon: r6(e.bounds.maxlon) };
    return o;
  }).filter(o => o.lat != null || o.bounds);
}

const unpack = a => { const o = []; let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o.push([la / 1e5, lo / 1e5]); } return o; };
const readJSON = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** Neshan places that OpenStreetMap does not already have, as OpenStreetMap-style elements */
export function neshanElements(osmEls, items) {
  const KX = 111320 * 0.8, KY = 110540, CELL = 0.001;
  const grid = new Map(), cell = (la, ln) => `${Math.floor(la / CELL)}:${Math.floor(ln / CELL)}`;
  for (const e of osmEls) {
    const la = e.lat ?? (e.bounds && (e.bounds.minlat + e.bounds.maxlat) / 2), ln = e.lon ?? (e.bounds && (e.bounds.minlon + e.bounds.maxlon) / 2);
    if (la == null) continue;
    const k = cell(la, ln); if (!grid.has(k)) grid.set(k, []); grid.get(k).push({ la, ln, t: e.tags || {} });
  }
  const near = (la, ln) => { const out = [], a = Math.floor(la / CELL), b = Math.floor(ln / CELL); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${a + i}:${b + j}`) || [])); return out; };
  const els = [];
  items.forEach(([title, id, L5, N5, street], i) => {
    const tags = TAGS_BY_ID[id]; if (!tags) return;
    const la = L5 / 1e5, ln = N5 / 1e5;
    const [[k, v]] = Object.entries(tags);
    const dup = near(la, ln).some(o => {
      const d = Math.hypot((o.la - la) * KY, (o.ln - ln) * KX);
      return (d < 40 && o.t[k] === v) || (d < 60 && (o.t.name || '').replace(/\s/g, '') === title.replace(/\s/g, ''));
    });
    if (dup) return;
    els.push({ type: 'node', id: `ns${i}`, lat: la, lon: ln, tags: { ...tags, name: title, ...(street ? { 'addr:street': street } : {}), source: 'neshan' } });
  });
  return els;
}

/** build and save data/cities/<slug>/hotspots.json; returns {items, osm, neshan} or throws */
export function buildCityHotspots(slug, { osm = null, roads = null } = {}) {
  const DIR = cityDir(slug);
  const osmEls = osm ? osm.elements : (readJSON(`${DIR}/osm-pois.json`)?.elements || []);
  if (!osmEls.length) throw new Error('no OpenStreetMap places saved yet');
  const ns = readJSON(`${DIR}/pois-neshan.json`)?.items || [];
  const extra = neshanElements(osmEls, ns);
  const plainRoads = roads || (readJSON(`${DIR}/roads.json`)?.ways || []).filter(w => w.name).map(w => ({ name: w.name, line: unpack(w.line) }));
  const items = buildHotspots({ elements: [...osmEls, ...extra] }, { roadName: roadNamer(plainRoads), relative: true });
  if (items.scale) console.log('density scale vs Tehran:', JSON.stringify(items.scale));
  if (items.length < 15) throw new Error(`only ${items.length} hotspots`);
  const file = `${DIR}/hotspots.json`, old = readJSON(file);
  if (JSON.stringify(old?.items) !== JSON.stringify(items)) writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), source: extra.length ? 'OpenStreetMap + Neshan' : 'OpenStreetMap', items }));
  console.log(`hotspots: ${items.length} (OpenStreetMap places ${osmEls.length}, Neshan places added ${extra.length})`);
  return { items: items.length, osm: osmEls.length, neshan: extra.length };
}

// command line
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = (process.argv.find(a => a.startsWith('--city=')) || '').slice(7);
  if (!CITIES[slug] || slug === 'tehran') { console.error('usage: hotspot-build.mjs --city=<slug> (not Tehran)'); process.exit(1); }
  try { const r = buildCityHotspots(slug); mkdirSync('.cache', { recursive: true }); writeFileSync(`.cache/hotspots-run-${slug}.json`, JSON.stringify(r)); }
  catch (e) { console.warn(`${slug}: hotspots not rebuilt: ${e.message}`); process.exitCode = 0; }
}
