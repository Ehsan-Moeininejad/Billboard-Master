// Tehran's 22 municipal districts (مناطق شهرداری).
// Real boundaries are read from OpenStreetMap when reachable; otherwise each point is assigned
// to the nearest approximate district centre (shown as «تقریبی»).
import { TEHRAN } from './config.js';

// Approximate centres — used only for the fallback and for labels.
export const DISTRICT_CENTERS = [
  [1, 35.800, 51.470, 'تجریش، نیاوران'], [2, 35.765, 51.360, 'سعادت‌آباد، شهرک غرب'], [3, 35.765, 51.420, 'ونک، جردن'],
  [4, 35.755, 51.520, 'تهرانپارس، لویزان'], [5, 35.760, 51.300, 'پونک، جنت‌آباد'], [6, 35.720, 51.400, 'یوسف‌آباد، ولیعصر'],
  [7, 35.725, 51.440, 'هفت تیر، سیدخندان'], [8, 35.732, 51.492, 'نارمک'], [9, 35.685, 51.320, 'مهرآباد'],
  [10, 35.685, 51.360, 'سلسبیل'], [11, 35.680, 51.390, 'راه‌آهن، جمهوری'], [12, 35.675, 51.425, 'بازار، بهارستان'],
  [13, 35.703, 51.482, 'پیروزی'], [14, 35.668, 51.470, 'خاوران'], [15, 35.632, 51.482, 'افسریه، مسعودیه'],
  [16, 35.642, 51.410, 'جوادیه'], [17, 35.655, 51.360, 'ابوذر'], [18, 35.645, 51.300, 'یافت‌آباد'],
  [19, 35.620, 51.360, 'نعمت‌آباد'], [20, 35.592, 51.440, 'شهرری'], [21, 35.700, 51.225, 'تهرانسر'], [22, 35.752, 51.190, 'چیتگر'],
].map(([n, lat, lng, fa]) => ({ n, lat, lng, fa }));

// rough convex outline of the 22 districts (fallback only)
const OUTLINE = [[35.815, 51.24], [35.832, 51.33], [35.828, 51.44], [35.805, 51.54], [35.765, 51.575], [35.69, 51.575], [35.62, 51.53],
  [35.565, 51.46], [35.57, 51.34], [35.615, 51.24], [35.69, 51.15], [35.765, 51.14]];

const toLatin = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

export function pointInPoly([lat, lng], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Voronoi cells of the centres clipped to the Tehran bbox (fallback polygons). */
export function approximateDistricts() {
  const [[s, w], [n, e]] = [[35.55, 51.10], [35.84, 51.62]];
  const k = Math.cos(35.7 * Math.PI / 180);
  const P = p => [p[1] * k, p[0]], U = q => [q[1], q[0] / k];   // lng scaled ↔ planar
  const box = [[s, w], [s, e], [n, e], [n, w]].map(P);
  return DISTRICT_CENTERS.map(c => {
    let poly = box;
    const a = P([c.lat, c.lng]);
    for (const o of DISTRICT_CENTERS) {
      if (o === c) continue;
      const b = P([o.lat, o.lng]);
      const nx = b[0] - a[0], ny = b[1] - a[1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const side = p => (p[0] - mx) * nx + (p[1] - my) * ny;   // ≤ 0 keeps the half-plane of a
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
        if (sp <= 0) out.push(p);
        if ((sp <= 0) !== (sq <= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
    }
    // clip to an approximate (convex) city outline
    const hull = OUTLINE.map(P);
    const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length, cy = hull.reduce((a, p) => a + p[1], 0) / hull.length;
    for (let i = 0; i < hull.length; i++) {
      const p1 = hull[i], p2 = hull[(i + 1) % hull.length];
      const cross = q => (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]);
      const inSign = Math.sign(cross([cx, cy]));
      const side = q => -cross(q) * inSign;   // ≤ 0 = inside
      const out = [];
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length], sp = side(p), sq = side(q);
        if (sp <= 0) out.push(p);
        if ((sp <= 0) !== (sq <= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
    }
    return { n: c.n, fa: c.fa, poly: poly.map(U), approx: true, center: [c.lat, c.lng] };
  });
}

/** Parse OSM relations (out geom) into district polygons. */
export function parseOsmDistricts(res) {
  const out = [];
  for (const el of res.elements || []) {
    const name = el.tags?.name || '', en = el.tags?.['name:en'] || '';
    const m = toLatin(name).match(/منطقه\s*(\d{1,2})/) || en.match(/District\s*(\d{1,2})/i);
    if (!m) continue;
    const n = +m[1];
    if (n < 1 || n > 22) continue;
    // stitch outer ways into rings
    const segs = (el.members || []).filter(x => x.type === 'way' && x.role !== 'inner' && x.geometry).map(x => x.geometry.map(g => [g.lat, g.lon]));
    const rings = [];
    while (segs.length) {
      let ring = segs.shift();
      let grew = true;
      while (grew && segs.length) {
        grew = false;
        const end = ring[ring.length - 1];
        for (let i = 0; i < segs.length; i++) {
          const sg = segs[i], same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
          if (same(sg[0], end)) { ring = ring.concat(sg.slice(1)); segs.splice(i, 1); grew = true; break; }
          if (same(sg[sg.length - 1], end)) { ring = ring.concat(sg.slice(0, -1).reverse()); segs.splice(i, 1); grew = true; break; }
        }
      }
      if (ring.length > 3) rings.push(ring);
    }
    if (!rings.length) continue;
    const c = DISTRICT_CENTERS.find(x => x.n === n);
    rings.sort((a, b) => b.length - a.length);
    out.push({ n, fa: c?.fa || '', poly: rings[0], rings, approx: false, center: [c.lat, c.lng] });
  }
  // keep one entry per district number
  const seen = new Set();
  return out.filter(d => !seen.has(d.n) && seen.add(d.n));
}

export function districtOf(lat, lng, districts) {
  if (!districts) return null;
  for (const d of districts) if ((d.rings || [d.poly]).some(r => pointInPoly([lat, lng], r))) return d.n;
  if (!districts[0]?.approx) return null;
  return null;
}

export const OSM_DISTRICT_QUERY = (() => {
  const [[s, w], [n, e]] = TEHRAN.bounds;
  return `[out:json][timeout:60];rel["boundary"="administrative"]["name"~"منطقه|District"](${s},${w},${n},${e});out geom;`;
})();
