// Coordinates in the format location-based SMS panels take (operator geofencing):
//   [[lng,lat],[lng,lat],…,[first point again]]   — longitude first, one closed ring per area, 6 decimals.
// A shape in several parts gives one ring per line; a single point becomes a circle around it.

const KY = 110540;
const kx = lat => 111320 * Math.cos(lat * Math.PI / 180);

/** ring [[lat,lng]…] → «[[lng,lat],…]» closed */
export function smsRing(ring) {
  const pts = ring.map(([a, b]) => [+(+b).toFixed(6), +(+a).toFixed(6)]);
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
