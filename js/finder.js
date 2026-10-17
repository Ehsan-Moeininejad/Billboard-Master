// Ranking existing structures and finding new sites — model only (no API quota used).
import { ROAD_CLASSES, VIS } from './config.js';
import { nearestOnLine, walk, dist, lineLength, pointAt } from './geo.js';
import { estimate, scoreFrom } from './model.js';

const TYPE_FORMAT = { bridge: 'bridge', ad: 'bulletin', bulletin: 'bulletin', poster: 'poster', digital: 'digital', rooftop: 'rooftop' };

/** A model-ready site at point p on way w. */
export function virtualSite(w, p, { format, facing = 'fwd', clutter = 0, twin = null } = {}) {
  const snap = nearestOnLine(p, w.line);
  const back = walk(w.line, snap, 700, -1).reverse(), fwd = walk(w.line, snap, 700, 1);
  return {
    lat: snap.point[0], lng: snap.point[1], format, facing, clutter, overrides: {}, loopShare: 1,
    road: {
      name: w.name, cls: w.cls, oneway: w.oneway, lanes: w.lanes, maxspeed: w.maxspeed, width: w.width,
      bearing: snap.bearing, line: back.concat(fwd.slice(1)), twinLine: twin, twinLanes: null, source: 'osm',
    },
  };
}

/** Weekday estimate condensed to what ranking needs. */
export function quick(site, settings) {
  const e = estimate(site, settings, 'weekday');
  return {
    imp: e.daily.impressions, veh: e.daily.vehicles, exp: e.daily.avgExposure, speed: e.daily.avgSpeed,
    score: scoreFrom(e.daily), sight: Math.min(...e.geo.map(g => g.sight)), window: e.geo[0]?.window,
    limited: e.geo.some(g => g.limitedBy === 'sight'),
  };
}

function bestFacing(w, p, opts, settings) {
  const options = opts.format === 'bridge' && !w.oneway ? ['both'] : w.oneway ? ['fwd'] : ['fwd', 'bwd'];
  let best = null;
  for (const facing of options) {
    const v = virtualSite(w, p, { ...opts, facing });
    const q = quick(v, settings);
    if (!best || q.imp > best.imp) best = { ...q, facing, site: v };
  }
  return best;
}

// spatial index: ways bucketed into ~550 m cells so thousands of structures rank quickly
const CELL = 0.005;
function indexWays(ways) {
  const grid = new Map();
  ways.forEach((w, i) => {
    const seen = new Set();
    for (const [la, lo] of w.line) {
      const k = `${Math.floor(la / CELL)}:${Math.floor(lo / CELL)}`;
      if (seen.has(k)) continue; seen.add(k);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  return grid;
}
function nearestWay(ways, p, maxD, grid) {
  let cand = ways;
  if (grid) {
    const ci = Math.floor(p[0] / CELL), cj = Math.floor(p[1] / CELL), ids = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) (grid.get(`${ci + a}:${cj + b}`) || []).forEach(i => ids.add(i));
    cand = [...ids].map(i => ways[i]);
  }
  let best = null;
  for (const w of cand) { const s = nearestOnLine(p, w.line); if (s.distance <= maxD && (!best || s.distance < best.d)) best = { w, d: s.distance }; }
  return best;
}

/** Rank structures by modelled weekday impressions. */
export function rankStructures(structs, ways, settings) {
  const grid = indexWays(ways);
  return structs.map(st => {
    let near = nearestWay(ways, [st.lat, st.lng], 140, grid);
    let guessed = false;
    if (!near) {
      // no mapped road nearby: assume the road named in the address, class guessed from its wording
      const txt = `${st.address || ''} ${st.name || ''}`;
      const cls = /بزرگراه|اتوبان|آزادراه/.test(txt) ? 'trunk' : /بلوار/.test(txt) ? 'primary' : 'secondary';
      const nm = (st.address || st.name || '').split(/[،,]/)[0].trim();
      near = { w: { name: nm, cls, oneway: false, lanes: {}, maxspeed: null, width: null, line: [[st.lat - 0.003, st.lng], [st.lat + 0.003, st.lng]] }, d: 0 };
      guessed = true;
    }
    const clutter = structs.filter(o => o !== st && dist([o.lat, o.lng], [st.lat, st.lng]) > 15 && dist([o.lat, o.lng], [st.lat, st.lng]) < VIS.clutterRadius).length;
    const format = TYPE_FORMAT[st.type] || (near.w.cls === 'motorway' || near.w.cls === 'trunk' ? 'bulletin' : 'poster');
    const q = bestFacing(near.w, [st.lat, st.lng], { format, clutter }, settings);
    return { ...st, ranked: true, roadGuessed: guessed, road: near.w.name || ROAD_CLASSES[near.w.cls]?.short, cls: near.w.cls, format, clutter, ...q, vsite: q.site, site: undefined };
  }).sort((a, b) => (b.ranked - a.ranked) || (Math.round(b.imp / 100) - Math.round(a.imp / 100)) || (b.exp - a.exp) || (b.sight - a.sight));
}

/**
 * Scan every road in view for the best empty spots.
 * @returns {{cands: Array, picks: Array}}
 */
export function findSites(ways, opts, settings, avoid, bbox) {
  const { format = 'bulletin', step = 120, spacing = 250, separation = 600, count = 8, perRoad = 2 } = opts;
  const [s, w, n, e] = bbox;
  const inside = p => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
  const cands = [];
  for (const way of ways) {
    const L = lineLength(way.line);
    for (let m = step / 2; m < L - 20; m += step) {
      const p = pointAt(way.line, m);
      if (!inside(p) || (opts.within && !opts.within(p))) continue;
      const blocked = avoid.some(a => dist(a, p) < spacing);
      const q = bestFacing(way, p, { format }, settings);
      cands.push({ way, p, m, blocked, ...q });
    }
  }
  const pool = cands.filter(c => !c.blocked).sort((a, b) => b.imp - a.imp);
  const picks = [];
  for (const c of pool) {
    if (picks.length >= count) break;
    if (picks.some(p => dist(p.p, c.p) < separation)) continue;
    const key = c.way.name || c.way.osmId;
    if (picks.filter(p => (p.way.name || p.way.osmId) === key).length >= perRoad) continue;   // spread picks across roads
    picks.push(c);
  }
  return { cands, picks };
}
