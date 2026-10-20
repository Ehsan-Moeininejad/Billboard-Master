// Known gathering streets (data/curated-hotspots.json) as hotspots for the cities other than Tehran.
// OpenStreetMap misses the shops and restaurants of some famous streets (بلوار ناهارخوران گرگان…); for those, the
// street itself is drawn as the hotspot: its line from roads.json / gazetteer.json, widened by `width` metres each side.
import { readFileSync } from 'node:fs';
import { packRing } from '../js/hotspots.js';

const readJSON = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const norm = s => String(s || '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌‍]/g, '');
const unpack = a => { const o = []; let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o.push([la / 1e5, lo / 1e5]); } return o; };
const COVERAGE = [50, 70, 85, 95], WF = { 50: 0.6, 70: 1, 85: 1.35, 95: 1.7 };

/** one street → its points (largest connected stretch) */
function streetPoints(spec, dir) {
  const names = new Set([spec.street, ...(spec.also || [])].map(norm));
  const pts = [];
  for (const w of readJSON(`${dir}/roads.json`)?.ways || []) {
    if (!names.has(norm(w.name))) continue;
    const line = unpack(w.line);
    for (let i = 0; i < line.length - 1; i++) { // every ~40 m along the road
      const [a, b] = [line[i], line[i + 1]], d = Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 90000), k = Math.max(1, Math.ceil(d / 40));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    pts.push(line[line.length - 1]);
  }
  for (const p of readJSON(`${dir}/gazetteer.json`)?.places || []) if ((p[1] === 'r' || p[1] === 's') && names.has(norm(p[0]))) pts.push([p[2] / 1e5, p[3] / 1e5]);
  if (!pts.length) return [];
  // connected stretches (points closer than 260 m); the longest one is the street meant
  const KX = 111320 * Math.cos(pts[0][0] * Math.PI / 180), KY = 110540, CELL = 260;
  const grid = new Map(), key = p => `${Math.floor(p[0] * KY / CELL)}:${Math.floor(p[1] * KX / CELL)}`;
  pts.forEach((p, i) => { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const comp = new Array(pts.length).fill(-1); let best = -1, bestN = 0, c = 0;
  for (let s = 0; s < pts.length; s++) {
    if (comp[s] >= 0) continue;
    const q = [s]; comp[s] = c; let n = 0;
    while (q.length) {
      const i = q.pop(); n++;
      const [gy, gx] = key(pts[i]).split(':').map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of grid.get(`${gy + dy}:${gx + dx}`) || []) {
        if (comp[j] < 0 && Math.hypot((pts[j][0] - pts[i][0]) * KY, (pts[j][1] - pts[i][1]) * KX) < CELL) { comp[j] = c; q.push(j); }
      }
    }
    if (n > bestN) { bestN = n; best = c; }
    c++;
  }
  return pts.filter((_, i) => comp[i] === best);
}

/** points widened by w metres → outline rings [[lat,lng]…] (raster 15 m, traced) */
function corridor(pts, w) {
  const lat0 = pts[0][0], KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110540, S = 15;
  const xy = pts.map(([a, b]) => [(b - pts[0][1]) * KX, (a - lat0) * KY]);
  const minX = Math.min(...xy.map(p => p[0])) - w - 2 * S, minY = Math.min(...xy.map(p => p[1])) - w - 2 * S;
  const maxX = Math.max(...xy.map(p => p[0])) + w + 2 * S, maxY = Math.max(...xy.map(p => p[1])) + w + 2 * S;
  const cols = Math.ceil((maxX - minX) / S), rows = Math.ceil((maxY - minY) / S);
  const on = new Uint8Array(cols * rows), r = Math.ceil(w / S);
  for (const [x, y] of xy) {
    const ci = Math.floor((x - minX) / S), ri = Math.floor((y - minY) / S);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if ((i * i + j * j) * S * S <= w * w) { const R = ri + i, C = ci + j; if (R >= 0 && C >= 0 && R < rows && C < cols) on[R * cols + C] = 1; }
  }
  const Z = (i, j) => i >= 0 && j >= 0 && i < rows && j < cols && on[i * cols + j] === 1;
  const edges = new Map(), add = (a, b) => { const k = a.join(':'); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (!Z(i, j)) continue;
    if (!Z(i - 1, j)) add([i, j], [i, j + 1]);
    if (!Z(i, j + 1)) add([i, j + 1], [i + 1, j + 1]);
    if (!Z(i + 1, j)) add([i + 1, j + 1], [i + 1, j]);
    if (!Z(i, j - 1)) add([i + 1, j], [i, j]);
  }
  const rings = [];
  while (edges.size) {
    const [k0] = edges.keys(), start = k0.split(':').map(Number), ring = [start]; let cur = start;
    for (let g = 0; g < 1e6; g++) {
      const k = cur.join(':'), nx = edges.get(k); if (!nx?.length) break;
      const next = nx.shift(); if (!nx.length) edges.delete(k);
      if (next[0] === start[0] && next[1] === start[1]) break;
      ring.push(next); cur = next;
    }
    let area = 0; for (let t = 0; t < ring.length; t++) { const p = ring[t], q = ring[(t + 1) % ring.length]; area += p[1] * q[0] - q[1] * p[0]; }
    if (area <= 0) continue; // holes
    // straight runs → corners, then Douglas–Peucker at 12 m
    let P = ring.map(([i, j]) => [minX + j * S, minY + i * S]);
    const dp = (a) => { if (a.length < 3) return a; const [x1, y1] = a[0], [x2, y2] = a[a.length - 1], L = Math.hypot(x2 - x1, y2 - y1) || 1e-9; let m = 0, k = 0; for (let t = 1; t < a.length - 1; t++) { const d = Math.abs((x2 - x1) * (y1 - a[t][1]) - (x1 - a[t][0]) * (y2 - y1)) / L; if (d > m) { m = d; k = t; } } return m <= 12 ? [a[0], a[a.length - 1]] : [...dp(a.slice(0, k + 1)).slice(0, -1), ...dp(a.slice(k))]; };
    let far = 0, fd = -1; P.forEach(([x, y], t) => { const d = Math.hypot(x - P[0][0], y - P[0][1]); if (d > fd) { fd = d; far = t; } });
    P = [...dp(P.slice(0, far + 1)).slice(0, -1), ...dp([...P.slice(far), P[0]]).slice(0, -1)];
    const ll = P.map(([x, y]) => [+(lat0 + y / KY).toFixed(6), +(pts[0][1] + x / KX).toFixed(6)]);
    ll.push(ll[0]);
    rings.push({ ring: ll, area: area * S * S / 2 });
  }
  return rings.sort((a, b) => b.area - a.area);
}

/** hotspot objects (same shape as js/hotspots.js output) for one city */
export function curatedHotspots(slug, dir, places = []) {
  const list = (readJSON('data/curated-hotspots.json')?.items || []).filter(x => x.city === slug);
  const out = [];
  for (const spec of list) {
    const pts = streetPoints(spec, dir);
    if (pts.length < 3) { console.warn(`curated: «${spec.street}» not found in ${slug}`); continue; }
    const w = spec.width || 120, cov = {};
    let main = null;
    for (const c of COVERAGE) {
      const rs = corridor(pts, w * WF[c]);
      if (!rs.length) continue;
      const big = rs.filter(r => r.area > 5000).slice(0, 4);
      const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length, lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const rad = Math.max(...pts.map(p => Math.hypot((p[0] - lat) * 110540, (p[1] - lng) * 111320 * Math.cos(lat * Math.PI / 180)))) + w * WF[c];
      cov[c] = { p: big.map(r => packRing(r.ring)), a: +(big.reduce((s, r) => s + r.area, 0) / 1e4).toFixed(1), r: Math.round(rad) };
      if (c === 70) main = { lat, lng, r: Math.round(rad), area: cov[c].a, rings: big.map(r => r.ring) };
    }
    if (!main) continue;
    // places already known inside (OpenStreetMap / Neshan), for the popup
    const inside = places.filter(p => main.rings.some(r => inRing(p, r))).length;
    out.push({ t: spec.type === 'food' ? 'food' : 'retail', place: spec.title || spec.street, name: spec.title || '', lat: +main.lat.toFixed(5), lng: +main.lng.toFixed(5), r: main.r, area: main.area,
      n: inside, cov, score: spec.score || 85, lvl: 3, curated: true, mix: ['راسته شناخته‌شده'] });
  }
  return out;
}
function inRing([lat, lng], ring) { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
