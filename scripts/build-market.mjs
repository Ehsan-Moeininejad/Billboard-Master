// Builds data/market.json — the list of real Tehran billboard structures with prices.
//
// Source: the open-source Rasamap project (MIT, github.com/alireza-zareian/Rasamap-Repository),
// which collects public listings from billboardiha.com, irbillboard.com and aradholding.com.
// Run weekly by .github/workflows/data.yml; locally:  node scripts/build-market.mjs [path-or-url]
//
// What this script adds on top of the raw listings:
//   • Tehran only, normalised fields, price in toman, flag for prices the source estimated itself
//   • location check: listings whose coordinates sit far from the highway named in their address,
//     or share one fallback coordinate with many others, are moved onto the named highway
//     (at the named cross street / landmark when it can be found) and marked as approximate
//   • price history (data/price-history.csv) and change since the previous run
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { CITIES, cityDir, ELSEWHERE } from '../js/cities.js';

// --city=<slug> builds another city into data/cities/<slug>/; without it everything below is Tehran, unchanged
const SLUG = (process.argv.find(a => a.startsWith('--city=')) || '--city=tehran').slice(7);
if (!CITIES[SLUG]) { console.error(`unknown city ${SLUG}`); process.exit(1); }
const CITY = CITIES[SLUG], IS_TEHRAN = SLUG === 'tehran', DIR = cityDir(SLUG);
const SRC = process.argv.slice(2).find(a => !a.startsWith('--')) || 'https://raw.githubusercontent.com/alireza-zareian/Rasamap-Repository/main/scraper/data/billboards.json';
const BOX = IS_TEHRAN ? { s: 35.55, w: 51.10, n: 35.85, e: 51.65 } : { s: CITY.box[0], w: CITY.box[1], n: CITY.box[2], e: CITY.box[3] };

// ── geometry helpers (planar, metres) ──────────────────────
const R = 6371008.8, rad = d => d * Math.PI / 180;
const proj = (o, p) => [rad(p[1] - o[1]) * R * Math.cos(rad(o[0])), rad(p[0] - o[0]) * R];
const unproj = (o, xy) => [o[0] + xy[1] / R * 180 / Math.PI, o[1] + xy[0] / (R * Math.cos(rad(o[0]))) * 180 / Math.PI];
function nearestOn(p, line) {
  let best = { d: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = proj(p, line[i]), b = proj(p, line[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L));
    const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(x, y);
    if (d < best.d) best = { d, pt: unproj(p, [x, y]) };
  }
  return best;
}
const dist = (a, b) => Math.hypot(...proj(a, b));

// ── reference roads: real OSM geometry when the workflow downloaded it, else the bundled approximation
function loadRoads() {
  // prebuilt by scripts/build-roads.mjs (real OSM geometry)
  if (existsSync(`${DIR}/roads.json`)) {
    const d = JSON.parse(readFileSync(`${DIR}/roads.json`, 'utf8'));
    const byName = new Map();
    for (const w of d.ways) {
      if (!w.name || !['motorway', 'trunk', 'primary'].includes(w.cls)) continue;
      const line = []; let la = 0, lo = 0;
      for (let i = 0; i < w.line.length; i += 2) { la += w.line[i]; lo += w.line[i + 1]; line.push([la / 1e5, lo / 1e5]); }
      if (!byName.has(w.name)) byName.set(w.name, { lines: [], cls: w.cls });
      byName.get(w.name).lines.push(line);
    }
    return [...byName].map(([name, v]) => ({ name, lines: v.lines, cls: v.cls }));
  }
  if (!IS_TEHRAN) { console.log(`${DIR}/roads.json missing; ${SLUG} is skipped until its roads are built.`); process.exit(0); }
  if (existsSync('data/ref-roads.json')) {
    const osm = JSON.parse(readFileSync('data/ref-roads.json', 'utf8'));
    const byName = new Map();
    for (const el of osm.elements || []) {
      const name = el.tags?.['name:fa'] || el.tags?.name; if (!name || !el.geometry) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(el.geometry.map(g => [g.lat, g.lon]));
    }
    return [...byName].map(([name, lines]) => ({ name, lines, cls: 'osm' }));
  }
  const src = readFileSync('js/demo/tehran.js', 'utf8');
  const ROADS = Function(`${src.replace(/export const /g, 'const ')}; return ROADS;`)();
  return ROADS.map(r => ({ name: r.name, lines: [r.line], cls: r.cls }));
}
function loadPlaces() {
  if (!IS_TEHRAN) return []; // landmark list exists for Tehran only
  const src = readFileSync('js/demo/tehran.js', 'utf8');
  return Function(`${src.replace(/export const /g, 'const ')}; return PLACES;`)();
}
const norm = s => String(s || '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\-–—_]/g, ' ').replace(/\s+/g, ' ').trim();
const core = name => norm(name).replace(/^(بزرگراه|آزادراه|اتوبان|خیابان|بلوار)\s+/, '').replace(/^شهید\s+/, '');

// names too generic to identify a road from an address ("تهران" alone matches every listing)
const STOP = new Set(['تهران', 'آزادراه', 'بزرگراه', 'اتوبان', 'کرج', 'شمال', 'جنوب', 'شرق', 'غرب', 'میدان', 'پل', ...(IS_TEHRAN ? [] : [CITY.fa, 'خیابان', 'بلوار', 'کمربندی', 'جاده'])]);
const roads = loadRoads().map(r => ({ ...r, key: core(r.name) })).filter(r => r.key.length >= 3 && !STOP.has(r.key));
const places = loadPlaces();
// outside Tehran most listings name boulevards and streets, so every main road counts
const MAJOR = IS_TEHRAN ? roads.filter(r => /بزرگراه|آزادراه|اتوبان/.test(r.name) || r.cls === 'motorway' || r.cls === 'trunk') : roads;

function namedRoad(text) {
  const t = norm(text);
  // prefer the road mentioned first in the address
  let best = null;
  for (const r of MAJOR) {
    const i = t.indexOf(r.key);
    if (i >= 0 && (!best || i < best.i || (i === best.i && r.key.length > best.r.key.length))) best = { r, i };
  }
  return best?.r || null;
}
function crossPoint(text, main) {
  const t = norm(text).replace(main.key, ' ');
  const m = t.match(/(?:تقاطع|نرسیده به|بعد از|قبل از|خروجی|ورودی|ورود به|نبش|پل|روبروی|مقابل|لچکی)\s+([^،,()]+)/);
  const cand = m ? m[1] : t;
  for (const r of roads) {
    if (r === main || !cand.includes(r.key)) continue;
    // closest approach between the two roads
    let best = { d: Infinity };
    for (const l of r.lines) for (const p of l) for (const ml of main.lines) { const q = nearestOn(p, ml); if (q.d < best.d) best = q; }
    if (best.d < 800) return { pt: best.pt, via: r.name };
  }
  for (const p of places) {
    if (!cand.includes(core(p.name))) continue;
    let best = { d: Infinity };
    for (const ml of main.lines) { const q = nearestOn([p.lat, p.lng], ml); if (q.d < best.d) best = q; }
    if (best.d < 2500) return { pt: best.pt, via: p.name };
  }
  return null;
}

// ── load & normalise ───────────────────────────────────────
const raw = /^https?:/.test(SRC) ? await (await fetch(SRC)).json() : JSON.parse(readFileSync(SRC, 'utf8'));
const inBox = x => x.lat > BOX.s && x.lat < BOX.n && x.lng > BOX.w && x.lng < BOX.e;
// a geocoding slip inside Tehran is fixable; a point in another city is a listing from another city
const nearBox = x => x.lat > BOX.s - 0.08 && x.lat < BOX.n + 0.08 && x.lng > BOX.w - 0.1 && x.lng < BOX.e + 0.1;
// addresses that place the board outside the city even when the named freeway enters Tehran
const OUTSIDE = IS_TEHRAN ? /(چالوس|مرزن|تونل|سنگان|کرج|شهریار|اسلامشهر|لواسان|دماوند|رودهن|فشم|پرند|قزوین|اصفهان|شیراز|مشهد|تبریز|قم|کیش|رشت|ساری)/
  : new RegExp(`(${ELSEWHERE.filter(w => w !== CITY.fa && w !== 'تهران').join('|')})`);
const tehran = raw.filter(x => CITY.sources.includes(x.city) || (x.lat && inBox(x))); // (named for Tehran; holds this city's listings)

// listings that share one coordinate with many others got a city-level fallback from the geocoder
const counts = new Map();
tehran.forEach(x => { if (x.lat) { const k = `${x.lat.toFixed(4)},${x.lng.toFixed(4)}`; counts.set(k, (counts.get(k) || 0) + 1); } });

const TYPE = { billboard: 'bulletin', bridge: 'bridge', station: 'poster', digital: 'digital', led: 'digital', mall: 'poster', rooftop: 'rooftop' };
const prev = existsSync(`${DIR}/market.json`) ? JSON.parse(readFileSync(`${DIR}/market.json`, 'utf8')) : { items: [] };
const prevById = new Map((prev.items || []).map(x => [x.id, x]));
const stats = { total: 0, ok: 0, moved: 0, onRoad: 0, unknown: 0, noCoords: 0, outside: 0 };
const items = [];
for (const x of tehran) {
  const text = `${x.name} ${x.location}`;
  let lat = x.lat, lng = x.lng, loc = 'source', note = '';
  const fallback = lat && counts.get(`${lat.toFixed(4)},${lng.toFixed(4)}`) >= 3;
  if (lat && !fallback && !nearBox({ lat, lng })) { stats.outside++; continue; }
  if (OUTSIDE.test(text) && !(lat && !fallback && inBox({ lat, lng }))) { stats.outside++; continue; }
  const road = namedRoad(text);
  if (road) {
    const near = lat && !fallback ? Math.min(...road.lines.map(l => nearestOn([lat, lng], l).d)) : Infinity;
    if (near > 1200) {
      const c = crossPoint(text, road);
      if (c) { [lat, lng] = c.pt; loc = 'moved'; note = `${road.name} × ${c.via}`; }
      else if (lat && !fallback) {
        let best = { d: Infinity };
        for (const l of road.lines) { const q = nearestOn([lat, lng], l); if (q.d < best.d) best = q; }
        [lat, lng] = best.pt; loc = 'onroad'; note = `روی ${road.name}، جای دقیق نامعلوم`;
      } else { loc = 'unknown'; }
    }
  } else if (fallback || !lat) loc = 'unknown';
  if (!lat || loc === 'unknown') { stats[lat ? 'unknown' : 'noCoords']++; if (!lat || fallback) continue; }
  // listings tagged «تهران» that actually sit in Karaj, the Chalus road, Isfahan…
  if (!inBox({ lat, lng })) { stats.outside++; continue; }
  stats.total++; stats[loc === 'source' ? 'ok' : loc === 'moved' ? 'moved' : 'onRoad']++;
  const id = `rs-${x.id}`;
  const price = x.price ? Math.round(x.price * 1e6) : null;
  const p = prevById.get(id);
  items.push({
    id, name: x.name.replace(/^بیلبورد\s+/, ''), address: x.location, lat: +lat.toFixed(6), lng: +lng.toFixed(6),
    type: TYPE[x.type] || 'bulletin', w: x.width || null, h: x.height || null, faces: x.faces || 1,
    owner: x.agency || '', site: x.source || '', price, prevPrice: p && p.price !== price ? p.price : (p?.prevPrice ?? null),
    priceEstimated: !!x.priceEstimated, priceUpdated: x.scrapedAt || null, loc, locNote: note,
  });
}

const out = { updatedAt: new Date().toISOString(), source: { name: 'Rasamap (MIT)', url: 'https://github.com/alireza-zareian/Rasamap-Repository', sites: ['billboardiha.com', 'irbillboard.com', 'aradholding.com'] }, stats, items };
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/market.json`, JSON.stringify(out));
if (!existsSync(`${DIR}/price-history.csv`)) writeFileSync(`${DIR}/price-history.csv`, 'date,source,id,name,owner,price,negotiated\n');
const today = out.updatedAt.slice(0, 10);
appendFileSync(`${DIR}/price-history.csv`, items.filter(i => i.price).map(i => [today, 'market', i.id, `"${i.name.replace(/"/g, '""')}"`, i.owner, i.price, ''].join(',')).join('\n') + '\n');
console.log(JSON.stringify(stats));
