// Small planar geometry helpers (accurate enough at city scale).
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

export function project(ref, p) {
  const k = Math.cos(rad(ref[0]));
  return [rad(p[1] - ref[1]) * R * k, rad(p[0] - ref[0]) * R];
}
export function unproject(ref, xy) {
  const k = Math.cos(rad(ref[0]));
  return [ref[0] + deg(xy[1] / R), ref[1] + deg(xy[0] / (R * k))];
}
export function dist(a, b) {
  const [x, y] = project(a, b);
  return Math.hypot(x, y);
}
export function bearing(a, b) {
  const [x, y] = project(a, b);
  return (deg(Math.atan2(x, y)) + 360) % 360;
}

/** Nearest point on polyline. Returns {point, index, t, distance, bearing}. */
export function nearestOnLine(p, line) {
  let best = { distance: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = project(p, line[i]), b = project(p, line[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-9;
    let t = -(a[0] * dx + a[1] * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, y = a[1] + t * dy;
    const d = Math.hypot(x, y);
    if (d < best.distance) {
      best = { distance: d, index: i, t, point: unproject(p, [x, y]), bearing: bearing(line[i], line[i + 1]) };
    }
  }
  return best;
}

/** Walk `meters` along the polyline from a snapped position, backwards (dir=-1) or forwards (dir=1). */
export function walk(line, snap, meters, dir = -1) {
  const out = [snap.point];
  let left = meters;
  let cur = snap.point;
  let i = dir < 0 ? snap.index : snap.index + 1;
  while (left > 0 && i >= 0 && i < line.length) {
    const nxt = line[i];
    const d = dist(cur, nxt);
    if (d >= left) {
      const f = left / d;
      out.push([cur[0] + (nxt[0] - cur[0]) * f, cur[1] + (nxt[1] - cur[1]) * f]);
      return out;
    }
    out.push(nxt);
    left -= d;
    cur = nxt;
    i += dir;
  }
  return out;
}

export function offsetLine(line, meters) {
  // shift a polyline sideways (right of travel direction for +meters)
  if (line.length < 2) return line;
  const ref = line[0];
  const pts = line.map(p => project(ref, p));
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return unproject(ref, [p[0] + (dy / L) * meters, p[1] - (dx / L) * meters]);
  });
}

export function lineLength(line) {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) s += dist(line[i], line[i + 1]);
  return s;
}

const COMPASS = ['شمال', 'شمال‌شرق', 'شرق', 'جنوب‌شرق', 'جنوب', 'جنوب‌غرب', 'غرب', 'شمال‌غرب'];
export function compassFa(b) {
  return COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
}
export const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
export function arrow(b) {
  return ARROWS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
}

/**
 * Straight-line visibility on the approach to a point.
 * Walks back along the (travel-oriented) line from the snapped point and stops where the road
 * bends out of a corridor `halfWidth` wide around the line of sight. Returns metres.
 */
export function sightline(line, snap, maxM = 650, halfWidth = 15) {
  if (!line || line.length < 2) return maxM;
  const pts = walk(line, snap, maxM, -1);          // [board, ..., farthest upstream]
  const ref = pts[0];
  const brg = (snap.bearing ?? bearing(line[snap.index], line[snap.index + 1])) * Math.PI / 180;
  const ax = -Math.sin(brg), ay = -Math.cos(brg);  // unit vector looking back up-stream
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    // densify each segment to ~20 m steps
    const a = pts[i - 1], b = pts[i], seg = dist(a, b), n = Math.max(1, Math.ceil(seg / 20));
    for (let k = 1; k <= n; k++) {
      const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
      const [x, y] = project(ref, p);
      const along = x * ax + y * ay;
      const lateral = Math.abs(x * ay - y * ax);
      if (along < 0 || lateral > halfWidth) return Math.max(40, Math.round(s));
      s += seg / n;
    }
  }
  return Math.round(Math.min(maxM, s));
}

/** Point `m` metres along a polyline from its start. */
export function pointAt(line, m) {
  const pts = walk(line, { point: line[0], index: 0 }, m, 1);
  return pts[pts.length - 1];
}
