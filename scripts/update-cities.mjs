// Weekly update for the cities other than Tehran (Tehran's own steps run before this and are not touched).
//
//   every week, every city      structures and prices (scripts/build-market.mjs --city=…) — one shared download, fast
//   every week, two cities      roads, municipal districts, hotspots and the place-name list used to place listings
//                               that came without coordinates, from OpenStreetMap (build-roads.mjs --city=…)
//                               and Neshan traffic for those two (update-traffic.mjs --city=…, NESHAN_CITY_CALLS each)
//                               → each city's heavy data is refreshed about once a month; cities never built go first
//   every week, every city      places from Neshan's search (update-pois.mjs, NESHAN_POI_CALLS per city), hotspots
//                               rebuilt from OpenStreetMap + those places (hotspot-build.mjs), and for cities marked
//                               «zones» the municipal districts from Neshan (update-zones.mjs, NESHAN_ZONE_CALLS)
//   CITIES_ALL=1                build everything for every city now (first setup, or after a long outage)
//
// Each city runs on its own; a failure in one city is reported and the others carry on.
// Writes data/cities.json (what the city menu shows), data/cities-state.json (rotation) and .cache/cities-run.json (email).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CITIES, OTHER_CITIES, cityDir } from '../js/cities.js';

const LISTINGS = process.argv[2] || (existsSync('.cache/rs/flagged.json') ? '.cache/rs/flagged.json' : '');
const PER_WEEK = Math.max(1, +(process.env.CITIES_PER_WEEK || 2));
const ALL = process.env.CITIES_ALL === '1' || process.env.CITIES_ALL === 'true';
const readJSON = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (args, timeoutMin) => execFileSync('node', args, { stdio: 'inherit', timeout: timeoutMin * 60e3, env: process.env });

const state = readJSON('data/cities-state.json', {});
const prevManifest = readJSON('data/cities.json', { cities: {} });
const report = { at: new Date().toISOString(), all: ALL, cities: {} };

// cities whose heavy data is missing or oldest come first
const heavy = ALL ? [...OTHER_CITIES] : [...OTHER_CITIES]
  .sort((a, b) => (state[a]?.roadsAt || '').localeCompare(state[b]?.roadsAt || ''))
  .slice(0, PER_WEEK);

// roads, districts, hotspots for one city; true when the roads came through
async function buildHeavy(slug, r, st) {
  try {
    run(['scripts/build-roads.mjs', `--city=${slug}`], 30);
    const b = readJSON(`.cache/build-${slug}.json`, {});
    r.steps.roads = b.roads ? 'ok' : 'kept'; r.steps.districts = b.districts ? 'ok' : (CITIES[slug].districts ? 'kept' : 'none'); r.steps.hotspots = b.hotspots ? 'ok' : 'kept'; r.steps.gazetteer = b.gazetteer ? 'ok' : 'kept';
    r.hotspots = b.hotspots ?? r.hotspots ?? null;
    if (b.roads) st.roadsAt = new Date().toISOString();
    if (b.hotspots) st.hotspotsAt = new Date().toISOString();
    await sleep(15000); // be gentle with the public Overpass servers
    if (b.roads && b.hotspots) r.errors = r.errors.filter(x => x !== 'معابر و هات‌اسپات‌ها');
    return !!(b.roads && b.hotspots);
  } catch (e) { r.errors.push('معابر و هات‌اسپات‌ها'); console.warn(slug, 'build-roads', e.message); await sleep(15000); return false; }
}

const retry = [];
for (const slug of OTHER_CITIES) {
  const dir = cityDir(slug), r = (report.cities[slug] = { fa: CITIES[slug].fa, steps: {}, errors: [] });
  const st = (state[slug] ||= {});
  mkdirSync(dir, { recursive: true });
  // 1) roads, districts, hotspots (rotating)
  if (heavy.includes(slug) && !(await buildHeavy(slug, r, st))) retry.push(slug);
}
// a busy Overpass server often answers a few minutes later: one more try for cities that did not come through
if (retry.length) {
  await sleep(60000);
  for (const slug of retry) if (!(await buildHeavy(slug, report.cities[slug], state[slug])) && !report.cities[slug].errors.length) report.cities[slug].errors.push('OpenStreetMap جواب نداد؛ داده قبلی ماند');
}

// 2) every city, every week: places from Neshan's search (a share of the city per run), hotspots rebuilt from
//    OpenStreetMap + Neshan places, and municipal districts from Neshan where OpenStreetMap lacks them
for (const slug of OTHER_CITIES) {
  const r = report.cities[slug], st = state[slug];
  if (process.env.NESHAN_KEY) {
    try {
      run(['scripts/update-pois.mjs', `--city=${slug}`], 25);
      const p = readJSON(`.cache/pois-run-${slug}.json`, {});
      r.steps.places = p.mode || 'ok'; r.places = p.items ?? null; r.placesLeft = p.left ?? null;
      if (p.stop) r.errors.push(`جستجوی نشان: ${p.stop}`);
    } catch (e) { r.errors.push('مکان‌های نشان'); console.warn(slug, 'update-pois', e.message); }
    if (CITIES[slug].zones) try {
      run(['scripts/update-zones.mjs', `--city=${slug}`], 20);
      const z = readJSON(`.cache/zones-run-${slug}.json`, {});
      r.steps.zones = z.mode || 'ok';
      if (z.stop) r.errors.push(`مناطق از نشان: ${z.stop}`);
    } catch (e) { r.errors.push('مناطق از نشان'); console.warn(slug, 'update-zones', e.message); }
  }
  try {
    run(['scripts/hotspot-build.mjs', `--city=${slug}`], 5);
    const h = readJSON(`.cache/hotspots-run-${slug}.json`, null);
    if (h) { r.hotspots = h.items; r.neshanPlaces = h.neshan; st.hotspotsAt = new Date().toISOString(); }
  } catch (e) { console.warn(slug, 'hotspot-build', e.message); }
}

for (const slug of OTHER_CITIES) {
  const dir = cityDir(slug), r = report.cities[slug], st = state[slug];
  // 3) structures and prices (every week; without a road file listings are placed by their own coordinates)
  try {
    run(['scripts/build-market.mjs', ...(LISTINGS ? [LISTINGS] : []), `--city=${slug}`], 10);
    r.steps.market = 'ok'; st.marketAt = new Date().toISOString();
    r.byAddress = readJSON(`${dir}/market.json`)?.stats?.byAddress ?? null; // listings placed from their address
  } catch (e) { r.errors.push('فهرست سازه‌ها'); console.warn(slug, 'build-market', e.message); }
  // 4) Neshan traffic for the cities in this week's rotation (not again within 6 days, so a re-run costs no quota)
  const fresh = st.trafficAt && Date.now() - new Date(st.trafficAt).getTime() < 6 * 864e5;
  if (heavy.includes(slug) && !fresh && process.env.NESHAN_KEY && existsSync(`${dir}/market.json`) && existsSync(`${dir}/roads.json`)) {
    try {
      run(['scripts/update-traffic.mjs', `--city=${slug}`], 30);
      const t = readJSON(`.cache/traffic-run-${slug}.json`, {});
      r.steps.traffic = t.mode || 'ok'; r.trafficPoints = t.refreshed ?? null;
      if (t.refreshed) st.trafficAt = new Date().toISOString();
      if (t.stop) r.errors.push(`نشان: ${t.stop}`);
    } catch (e) { r.errors.push('ترافیک نشان'); console.warn(slug, 'update-traffic', e.message); }
  }
  const m = readJSON(`${dir}/market.json`);
  r.count = m?.items?.length ?? null;
  r.prevCount = prevManifest.cities?.[slug]?.count ?? null;
}

// what the city menu shows: a city is ready once it has roads and a structure list
const manifest = { updatedAt: new Date().toISOString(), cities: {} };
for (const slug of OTHER_CITIES) {
  const dir = cityDir(slug), m = readJSON(`${dir}/market.json`), h = readJSON(`${dir}/hotspots.json`), d = readJSON(`${dir}/districts.json`);
  manifest.cities[slug] = {
    fa: CITIES[slug].fa, ready: !!m?.items?.length, count: m?.items?.length || 0,
    hotspots: h?.items?.length || 0, districts: Array.isArray(d) ? d.length : 0, limited: !!CITIES[slug].limited,
    roadsAt: state[slug]?.roadsAt || null, marketAt: state[slug]?.marketAt || null, trafficAt: state[slug]?.trafficAt || null,
  };
}
writeFileSync('data/cities.json', JSON.stringify(manifest, null, 1));
writeFileSync('data/cities-state.json', JSON.stringify(state, null, 1));
mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/cities-run.json', JSON.stringify({ ...report, heavy, manifest }));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.cities).map(([k, v]) => [k, { count: v.count, steps: v.steps, errors: v.errors }]))));
