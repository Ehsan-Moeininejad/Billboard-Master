// Coordinates in the format location-based SMS panels take (operator geofencing):
//   [[lng,lat],[lng,lat],…,[first point again]]   — longitude first, one closed ring per area, 6 decimals.
// A shape in several parts gives one ring per line; a single point becomes a circle around it.

const KY = 110540;
const kx = lat => 111320 * Math.cos(lat * Math.PI / 180);

// panels are slow or refuse long lists: shapes are simplified to at most this many corners (the outline moves < ~40 m)
export const SMS_MAX_POINTS = 60;
function simplify(ring, max) {
  if (ring.length <= max) return ring;
  const lat0 = ring[0][0], X = p => [(p[1] - ring[0][1]) * kx(lat0), (p[0] - lat0) * KY];
  const xy = ring.map(X);
  const dp = (i0, i1, eps, keep) => {
    const [x1, y1] = xy[i0], [x2, y2] = xy[i1], L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let m = 0, k = -1;
    for (let t = i0 + 1; t < i1; t++) { const d = Math.abs((x2 - x1) * (y1 - xy[t][1]) - (x1 - xy[t][0]) * (y2 - y1)) / L; if (d > m) { m = d; k = t; } }
    if (k >= 0 && m > eps) { keep[k] = 1; dp(i0, k, eps, keep); dp(k, i1, eps, keep); }
  };
  // split at the corner farthest from the first, so both halves are open lines
  let far = 0, fd = -1; xy.forEach(([x, y], t) => { const d = Math.hypot(x - xy[0][0], y - xy[0][1]); if (d > fd) { fd = d; far = t; } });
  for (let eps = 5; eps < 2000; eps *= 1.4) {
    const keep = new Uint8Array(ring.length); keep[0] = keep[far] = keep[ring.length - 1] = 1;
    dp(0, far, eps, keep); dp(far, ring.length - 1, eps, keep);
    const out = ring.filter((_, t) => keep[t]);
    if (out.length <= max) return out;
  }
  return ring;
}

/** ring [[lat,lng]…] → «[[lng,lat],…]» closed, at most SMS_MAX_POINTS corners */
export function smsRing(ring, max = SMS_MAX_POINTS) {
  const pts = simplify(ring, max).map(([a, b]) => [+(+b).toFixed(6), +(+a).toFixed(6)]);
  const f = pts[0], l = pts[pts.length - 1];
  if (f && (f[0] !== l[0] || f[1] !== l[1])) pts.push(f);
  return `[${pts.map(([x, y]) => `[${x},${y}]`).join(',')}]`;
}
/** circle of r metres around a point, as a ring [[lat,lng]…] (closed) */
export function circleRing(lat, lng, r = 300, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; out.push([lat + (r * Math.cos(t)) / KY, lng + (r * Math.sin(t)) / kx(lat)]); }
  out.push(out[0]);
  return out;
}
/** several rings → one line each */
export const smsText = rings => rings.map(smsRing).join('\n');
/** radius used around a single billboard (metres) */
export const SMS_POINT_RADIUS = 300;
