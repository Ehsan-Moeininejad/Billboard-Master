// Network layer: raw calls to OpenStreetMap, Neshan and Map.ir.
// Failover between providers lives in providers.js; the demo build swaps this file for demo/net.js.
import { OVERPASS_ENDPOINTS, ROAD_CLASSES, ROAD_QUERY, TEHRAN, NESHAN_COLOR_RATIO } from './config.js';
import { nearestOnLine, walk, bearing } from './geo.js';
import { OSM_DISTRICT_QUERY, parseOsmDistricts } from './districts.js';

async function fetchJSON(url, opts = {}, timeout = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

// ── Overpass ───────────────────────────────────────────────
let preferred = 0;
async function overpass(q, timeout = 25000) {
  let lastErr;
  for (let k = 0; k < OVERPASS_ENDPOINTS.length; k++) {
    const i = (preferred + k) % OVERPASS_ENDPOINTS.length;
    try {
      const res = await fetchJSON(OVERPASS_ENDPOINTS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      }, timeout);
      preferred = i;
      return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('overpass unavailable');
}

function parseLanes(tags) {
  const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : null; };
  return { total: n(tags.lanes), fwd: n(tags['lanes:forward']), bwd: n(tags['lanes:backward']) };
}
function parseSpeed(v) {
  if (!v) return null;
  const x = parseInt(v, 10);
  return Number.isFinite(x) && x > 10 ? x : null;
}

export function shapeWay(e) {
  const line = e.geometry.map(g => [g.lat, g.lon]);
  const tags = e.tags || {};
  const cls = ROAD_CLASSES[tags.highway] ? tags.highway : 'secondary';
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' ||
    ((cls === 'motorway' || cls.endsWith('_link')) && tags.oneway !== 'no');
  const w = parseFloat(tags.width);
  return {
    osmId: e.id,
    name: tags['name:fa'] || tags.name || tags['name:en'] || '',
    nameEn: tags['name:en'] || '',
    ref: tags.ref || '',
    cls,
    oneway,
    reversed: tags.oneway === '-1',
    lanes: parseLanes(tags),
    width: Number.isFinite(w) && w > 3 ? w : null,
    maxspeed: parseSpeed(tags.maxspeed),
    bridge: tags.bridge === 'yes' || tags.bridge === 'viaduct',
    tunnel: tags.tunnel === 'yes',
    line: tags.oneway === '-1' ? line.slice().reverse() : line,
    snap: null,
  };
}

/**
 * Tehran's major roads, prebuilt at deploy time (data/roads.json) so the app does not have to
 * pull thousands of ways from Overpass on first load. Returns { bbox, classes, ways } or null.
 */
export async function staticRoads() {
  try {
    const d = await fetchJSON('data/roads.json', {}, 30000);
    if (!d?.ways?.length) return null;
    const ways = d.ways.map(w => ({ ...w, nameEn: '', ref: '', snap: null, line: unpack(w.line) }));
    return { bbox: d.bbox, classes: d.classes, ways, updatedAt: d.updatedAt };
  } catch { return null; }
}
// line stored as a flat delta-encoded list of 1e-5 degree integers
function unpack(a) {
  const out = []; let la = 0, lo = 0;
  for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; out.push([la / 1e5, lo / 1e5]); }
  return out;
}

/** Every major road inside a bbox [s,w,n,e] (for ranking and site finding). */
export async function roadsInBbox(b, classes = ['motorway', 'trunk', 'primary']) {
  const bb = b.map(v => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:40];way["highway"~"^(${classes.join('|')})$"](${bb});out tags geom;`;
  const res = await overpass(q, 45000);
  return (res.elements || []).filter(e => e.type === 'way' && e.geometry?.length > 1).map(shapeWay);
}

/** Major roads within `radius` metres of a point, each snapped. Sorted nearest first. */
export async function roadsNear(lat, lng, radius = 90) {
  const q = `[out:json][timeout:20];way(around:${radius},${lat},${lng})["highway"~"^(${ROAD_QUERY})$"];out tags geom;`;
  const res = await overpass(q);
  const p = [lat, lng];
  const ways = (res.elements || []).filter(e => e.type === 'way' && e.geometry?.length > 1).map(shapeWay);
  ways.forEach(w => { w.snap = nearestOnLine(p, w.line); });

  // pair split carriageways: same name & class, oneway, opposite bearing
  ways.forEach(w => {
    if (!w.oneway) return;
    const twin = ways.find(o => o !== w && o.oneway && o.cls === w.cls && o.name === w.name &&
      Math.abs(((o.snap.bearing - w.snap.bearing + 540) % 360) - 180) < 40);
    if (twin) w.twin = { lanes: twin.lanes, line: twin.line, snap: twin.snap, maxspeed: twin.maxspeed };
  });

  // score: distance with a mild preference for bigger roads; de-duplicate same road
  const scored = ways
    .map(w => ({ w, s: w.snap.distance - ROAD_CLASSES[w.cls].rank * 6 }))
    .sort((a, b) => a.s - b.s)
    .map(x => x.w);
  const seen = new Set();
  return scored.filter(w => {
    const k = `${w.name}|${w.cls}|${w.oneway ? Math.round(w.snap.bearing / 90) : 'x'}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 6);
}

/** Pedestrian bridges and OSM-mapped ad structures inside a bbox [s,w,n,e]. */
export async function structuresIn(b) {
  const bb = b.map(v => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:25];(
    way["highway"~"^(footway|pedestrian|steps|path)$"]["bridge"="yes"](${bb});
    node["advertising"](${bb});
    way["advertising"](${bb});
  );out tags center;`;
  const res = await overpass(q, 30000);
  return (res.elements || []).map(e => {
    const c = e.type === 'node' ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null;
    if (!c) return null;
    const t = e.tags || {};
    const isAd = !!t.advertising;
    return {
      id: `${e.type}/${e.id}`, lat: c[0], lng: c[1],
      kind: isAd ? 'ad' : 'bridge',
      name: t['name:fa'] || t.name || (isAd ? 'سازه تبلیغاتی ثبت‌شده' : 'پل عابر پیاده'),
      adType: t.advertising || '',
    };
  }).filter(Boolean);
}

/** Motorway / trunk network of Tehran for the overlay. */
export async function highwayNetwork() {
  const [[s, w], [n, e]] = TEHRAN.bounds;
  const q = `[out:json][timeout:60];way["highway"~"^(motorway|trunk)$"](${s},${w},${n},${e});out tags geom;`;
  const res = await overpass(q, 65000);
  return (res.elements || []).filter(e => e.geometry).map(e => ({
    cls: e.tags.highway,
    name: e.tags['name:fa'] || e.tags.name || '',
    line: e.geometry.map(g => [g.lat, g.lon]),
  }));
}

// ── Search (OSM, free) ─────────────────────────────────────
export async function osmSearch(term) {
  const [[s, w], [n, e]] = TEHRAN.bounds;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=fa&limit=8&countrycodes=ir&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(term)}`;
  const r = await fetchJSON(url, {}, 10000);
  return r.map(i => {
    const parts = (i.display_name || '').split('،').map(s => s.trim());
    return { title: i.name || parts[0], sub: parts.slice(1, 4).join('، '), lat: +i.lat, lng: +i.lon };
  });
}

// helpers: a short stretch of road around the snapped point, in the travel direction
function segmentAround(line, snap, m = 400) {
  const back = walk(line, snap, m, -1), fwd = walk(line, snap, m, 1);
  return { o: back[back.length - 1], d: fwd[fwd.length - 1] };
}

// ── Neshan ─────────────────────────────────────────────────
const neshanBase = cfg => (cfg.proxy || 'https://api.neshan.org').replace(/\/$/, '');
const neshanGet = (cfg, path, timeout = 12000) => fetchJSON(neshanBase(cfg) + path, { headers: { 'Api-Key': cfg.key } }, timeout);

export const neshan = {
  async search(term, cfg) {
    const [c0, c1] = TEHRAN.center;
    const r = await neshanGet(cfg, `/v1/search?term=${encodeURIComponent(term)}&lat=${c0}&lng=${c1}`, 8000);
    return (r.items || []).map(i => ({ title: i.title, sub: i.address || i.region || '', lat: i.location?.y, lng: i.location?.x }))
      .filter(i => Number.isFinite(i.lat));
  },
  /** hourly congestion pattern around a point → {kpi, ratio[24], congestion[24]} */
  async profile(lat, lng, cfg) {
    const r = await neshanGet(cfg, `/navigation/traffic/analytics/v0.1?latitude=${lat}&longitude=${lng}`);
    const p = parseAnalytics(r);
    if (!p) { const e = new Error('empty profile'); e.status = 204; throw e; }
    return p;
  },
  /** pattern-based typical speed over ~800 m of road → {kmh, meters} */
  async speed(line, snap, cfg) {
    const { o, d } = segmentAround(line, snap);
    const brg = Math.round(bearing(o, d));
    const r = await neshanGet(cfg, `/v1/direction/typical?type=car&origin=${o[0]},${o[1]}&destination=${d[0]},${d[1]}&bearing=${brg}`);
    const leg = r?.routes?.[0]?.legs?.[0];
    return checkedSpeed(leg?.distance?.value, leg?.duration?.value, true);
  },
};

// ── Map.ir ─────────────────────────────────────────────────
const mapirHeaders = cfg => ({ 'x-api-key': cfg.key, 'Content-Type': 'application/json' });

export const mapir = {
  async search(term, cfg) {
    const [c0, c1] = TEHRAN.center;
    const r = await fetchJSON('https://map.ir/search/v2', {
      method: 'POST', headers: mapirHeaders(cfg), body: JSON.stringify({ text: term, lat: c0, lon: c1 }),
    }, 8000);
    return (r.value || r.data || []).map(i => {
      const c = i.geom?.coordinates || [];
      return { title: i.title || i.name, sub: i.address || i.city || '', lat: +c[1], lng: +c[0] };
    }).filter(i => Number.isFinite(i.lat));
  },
  /** route duration over ~800 m (OSRM-style response) → {kmh, meters} */
  async speed(line, snap, cfg) {
    const { o, d } = segmentAround(line, snap);
    const r = await fetchJSON(`https://map.ir/routes/route/v1/driving/${o[1]},${o[0]};${d[1]},${d[0]}?alternatives=false&steps=false&overview=false`,
      { headers: mapirHeaders(cfg) }, 12000);
    const rt = r?.routes?.[0];
    return checkedSpeed(rt?.distance, rt?.duration, false);
  },
};

function checkedSpeed(m, s, trafficAware) {
  if (!m || !s) { const e = new Error('no route'); e.status = 204; throw e; }
  if (m > 2000) { const e = new Error('route detoured'); e.status = 204; throw e; } // snapped to the wrong carriageway
  return { kmh: (m / s) * 3.6, meters: m, trafficAware };
}

export function parseAnalytics(r) {
  // The response format is not publicly documented: find the first ~24-long array anywhere.
  let arr = null;
  const visit = (o, depth = 0) => {
    if (arr || !o || depth > 5) return;
    if (Array.isArray(o) && o.length >= 20 && o.length <= 48) { arr = o; return; }
    if (typeof o === 'object') Object.values(o).forEach(v => visit(v, depth + 1));
  };
  visit(r?.chart ?? r);
  if (!arr) return null;
  const hours = new Array(24).fill(null);
  arr.forEach((it, idx) => {
    let h = idx, score = null, color = null;
    if (typeof it === 'number') score = it;
    else if (it && typeof it === 'object') {
      const hv = it.hour ?? it.h ?? it.time ?? it.label ?? it.x;
      if (hv != null) { const m = String(hv).match(/\d+/); if (m) h = parseInt(m[0], 10); }
      score = Number(it.score ?? it.value ?? it.traffic ?? it.level ?? it.y ?? it.congestion);
      color = (it.color ?? it.colour ?? it.key ?? '').toString().toLowerCase() || null;
    }
    if (arr.length > 24) h = Math.floor(idx * 24 / arr.length);
    if (h >= 0 && h < 24 && hours[h] == null) hours[h] = { score: Number.isFinite(score) ? score : null, color };
  });
  const scores = hours.map(x => x?.score).filter(Number.isFinite);
  const max = Math.max(...scores, 0);
  const scale = max <= 1 ? 1 : max <= 5 ? 5 : max <= 10 ? 10 : 100;
  const congestion = hours.map(x => {
    if (!x) return null;
    if (x.color && NESHAN_COLOR_RATIO[x.color] != null) return 1 - NESHAN_COLOR_RATIO[x.color];
    return Number.isFinite(x.score) ? Math.min(1, x.score / scale) : null;
  });
  if (congestion.filter(v => v != null).length < 12) return null;
  // fill gaps by neighbours
  for (let i = 0; i < 24; i++) if (congestion[i] == null) {
    const a = congestion[(i + 23) % 24] ?? 0, b = congestion[(i + 1) % 24] ?? a;
    congestion[i] = (a + b) / 2;
  }
  const ratio = congestion.map(c => Math.max(0.15, Math.min(1, 1 - 0.85 * c)));
  return { kpi: r?.kpi ?? null, congestion, ratio };
}


/** Tehran's municipal districts from OSM (null if fewer than 15 come back). */
export async function districts() {
  // prebuilt at deploy time by scripts/build-roads.mjs; live Overpass only as a fallback
  try { const d = await fetchJSON('data/districts.json', {}, 15000); if (Array.isArray(d) && d.length >= 15) return d; } catch { /* fall back */ }
  const res = await overpass(OSM_DISTRICT_QUERY, 65000);
  const d = parseOsmDistricts(res);
  return d.length >= 15 ? d : null;
}
