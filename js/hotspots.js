// Hotspots — places where people gather and spend time: malls and bazaars, shopping streets,
// specialist trade streets («بورس» موبایل، طلا، لوستر…), restaurant/café clusters, entertainment,
// metro/terminals and campuses. Built from OpenStreetMap points of interest:
//   1) every POI is classified into a hotspot type (and a sub-type for trade streets);
//   2) dense POI groups are found with a greedy density-peak search (mean-shift refined);
//   3) each hotspot gets a traced shape at four coverage levels (COVERAGE: share of its POIs the shape takes in),
//      so the map can show just the dense core or the wider area;
//   4) potential (0–100) mixes size, concentration and how much foot traffic the type usually brings.
// Used at deploy time (scripts/build-roads.mjs → data/hotspots.json) and as a live fallback in the browser.

export const HOTSPOT_TYPES = [
  { k: 'mall',    fa: 'مال، پاساژ و بازار', short: 'مال و بازار', color: '#FF5CA8', w: 1.00, desc: 'مراکز خرید، پاساژها، بازارها و میادین میوه و تره‌بار' },
  { k: 'retail',  fa: 'راسته خرید',          short: 'راسته خرید',  color: '#FFA53D', w: 0.95, desc: 'خیابان‌هایی که مغازه‌های پوشاک، آرایشی، هدیه و… پشت سر هم‌اند' },
  { k: 'food',    fa: 'قطب رستوران و کافه',  short: 'رستوران و کافه', color: '#FF7A59', w: 0.88, desc: 'تجمع رستوران، فست‌فود، کافه و بستنی‌فروشی' },
  { k: 'bourse',  fa: 'بورس کالا',           short: 'بورس کالا',   color: '#38C6F4', w: 0.82, desc: 'راسته‌های تخصصی یک دسته کالا؛ مخاطب هدفمند' },
  { k: 'fun',     fa: 'سرگرمی و فرهنگی',     short: 'سرگرمی',      color: '#B48CFF', w: 0.78, desc: 'سینما، تئاتر، فرهنگسرا و مراکز تفریحی' },
  { k: 'transit', fa: 'مترو و پایانه',       short: 'مترو و پایانه', color: '#3DDCC8', w: 0.90, desc: 'ایستگاه‌های مترو، راه‌آهن و پایانه‌های اتوبوس' },
  { k: 'campus',  fa: 'دانشگاه',             short: 'دانشگاه',     color: '#A8D86E', w: 0.62, desc: 'پردیس‌های دانشگاهی؛ مخاطب جوان' },
  { k: 'hyper',   fa: 'هایپرمارکت و فروشگاه زنجیره‌ای', short: 'هایپرمارکت', color: '#FFD24A', w: 0.85, desc: 'هایپراستار، رفاه، شهروند، افق کوروش و سوپرمارکت‌های بزرگ؛ خرید خانواده' },
  { k: 'office',  fa: 'مرکز اداری و تجاری',  short: 'اداری و تجاری', color: '#7C9CFF', w: 0.80, desc: 'تجمع شرکت‌ها، ادارات و بانک‌ها؛ شاغلان و تصمیم‌گیرندگان خرید سازمانی' },
  { k: 'health',  fa: 'مراکز درمانی',        short: 'درمانی',      color: '#C9D4E8', w: 0.70, desc: 'بیمارستان‌ها و تجمع درمانگاه و مطب؛ بیمار و همراه، رفت‌وآمد روزانه' },
  { k: 'park',    fa: 'پارک و تفریحگاه',     short: 'پارک',        color: '#4CC26B', w: 0.72, desc: 'پارک‌های بزرگ شهری؛ خانواده‌ها، عصرها و آخر هفته' },
  { k: 'sport',   fa: 'ورزشگاه و مجموعه ورزشی', short: 'ورزشی',   color: '#E36BFF', w: 0.70, desc: 'ورزشگاه‌ها و مجموعه‌های ورزشی بزرگ' },
];
export const TYPE_BY_KEY = Object.fromEntries(HOTSPOT_TYPES.map(t => [t.k, t]));

// specialist trade streets — shop=* values per sub-type
export const BOURSE = {
  elec:    { fa: 'موبایل و الکترونیک', shops: ['mobile_phone', 'computer', 'electronics', 'hifi', 'camera', 'video_games', 'telecommunication'], min: 6 },
  fashion: { fa: 'پوشاک و کفش',        shops: ['clothes', 'shoes', 'boutique', 'fashion_accessories', 'bag', 'fabric', 'tailor', 'leather', 'sewing'], min: 8 },
  gold:    { fa: 'طلا و جواهر',        shops: ['jewelry', 'watches', 'gold_buyer'], min: 6 },
  home:    { fa: 'خانه، مبلمان و روشنایی', shops: ['furniture', 'lighting', 'houseware', 'interior_decoration', 'carpet', 'kitchen', 'bed', 'curtain', 'bathroom_furnishing', 'tiles', 'flooring'], min: 7 },
  appliance: { fa: 'لوازم خانگی برقی',  shops: ['appliance', 'electrical', 'vacuum_cleaner'], min: 6 },
  beauty:  { fa: 'آرایشی و عطر',       shops: ['cosmetics', 'perfumery', 'hairdresser_supply'], min: 6 },
  sport:   { fa: 'ورزش و سفر',         shops: ['sports', 'outdoor', 'bicycle', 'fishing', 'hunting', 'scuba_diving', 'golf'], min: 6 },
  kids:    { fa: 'کودک و اسباب‌بازی',   shops: ['toys', 'baby_goods', 'games', 'model'], min: 5 },
  music:   { fa: 'ساز و موسیقی',       shops: ['musical_instrument', 'music', 'video'], min: 5 },
  pet:     { fa: 'حیوانات خانگی',      shops: ['pet', 'pet_grooming'], min: 5 },
  auto:    { fa: 'خودرو و قطعات',      shops: ['car_parts', 'car', 'tyres', 'motorcycle', 'car_repair', 'motorcycle_repair'], min: 12 },
  build:   { fa: 'ابزار و مصالح',      shops: ['hardware', 'doityourself', 'paint', 'trade', 'wholesale', 'glaziery'], min: 7 },
  books:   { fa: 'کتاب و لوازم‌التحریر', shops: ['books', 'stationery', 'copyshop', 'art'], min: 6 },
  medical: { fa: 'دارو و تجهیزات پزشکی', shops: ['chemist', 'medical_supply', 'optician', 'hearing_aids'], amenity: ['pharmacy'], min: 12 },
};
const SHOP_TO_SUB = {};
for (const [k, b] of Object.entries(BOURSE)) b.shops.forEach(s => { SHOP_TO_SUB[s] = k; });

// comparison shopping (what people travel for) — everyday neighbourhood shops are left out on purpose
const RETAIL = new Set(['clothes', 'shoes', 'boutique', 'fashion_accessories', 'bag', 'jewelry', 'watches', 'cosmetics', 'perfumery',
  'gift', 'toys', 'sports', 'outdoor', 'mobile_phone', 'electronics', 'computer', 'books', 'optician', 'variety_store',
  'department_store', 'confectionery', 'chocolate', 'nuts', 'coffee', 'tea', 'florist', 'music', 'baby_goods', 'leather', 'fabric', 'houseware', 'lighting']);
const FOOD = new Set(['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream', 'juice_bar']);
const FUN_AM = new Set(['cinema', 'theatre', 'arts_centre']);
const FUN_LE = new Set(['amusement_arcade', 'bowling_alley', 'water_park', 'escape_game', 'trampoline_park', 'miniature_golf']);

export const HOTSPOT_BBOX = [35.55, 51.10, 35.85, 51.65];
export const HOTSPOT_QUERY = (() => {
  const b = HOTSPOT_BBOX.join(',');
  return `[out:json][timeout:180];(nwr["shop"](${b});`
    + `nwr["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|juice_bar|marketplace|cinema|theatre|arts_centre|pharmacy|university|bus_station|hospital|clinic|doctors|dentist|bank)$"](${b});`
    + `nwr["office"](${b});nwr["railway"="station"](${b});`
    + `nwr["leisure"~"^(amusement_arcade|bowling_alley|water_park|escape_game|trampoline_park|miniature_golf|park|stadium|sports_centre)$"](${b}););out tags bb;`;
})();

// how much of each hotspot the shape takes in (share of its POIs for streets; halo size for single places)
export const COVERAGE = [50, 70, 85, 95];
export const COVERAGE_FA = { 50: 'هسته', 70: 'متعادل', 85: 'گسترده', 95: 'کامل' };
const BUF = { 50: 0.6, 70: 1, 85: 1.4, 95: 1.8 };
const CAPF = { 50: 0.8, 70: 1, 85: 1.25, 95: 1.5 };
const HYPER_RE = /هایپر|هایپراستار|رفاه|شهروند|کوروش|افق|جانبو|اتکا|سپه|یاس|hyper|refah|carrefour|kourosh/i;

// ── geometry helpers ─────────────────────────────────────────
const KX = 111320 * Math.cos(35.7 * Math.PI / 180), KY = 110540; // metres per degree around Tehran
const dm = (a, b) => Math.hypot((a.lat - b.lat) * KY, (a.lng - b.lng) * KX);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

function gridIndex(pts, cell) {
  const g = new Map(), key = (i, j) => i * 100003 + j;
  const cellOf = p => [Math.floor(p.lat * KY / cell), Math.floor(p.lng * KX / cell)];
  pts.forEach((p, idx) => { const [i, j] = cellOf(p); const k = key(i, j); (g.get(k) || g.set(k, []).get(k)).push(idx); });
  return {
    near(c, r) {
      const [i, j] = cellOf(c), n = Math.ceil(r / cell), out = [];
      for (let a = i - n; a <= i + n; a++) for (let b = j - n; b <= j + n; b++) {
        const l = g.get(key(a, b)); if (l) for (const idx of l) if (dm(pts[idx], c) <= r) out.push(idx);
      }
      return out;
    },
  };
}

// ── POI extraction ───────────────────────────────────────────
const fa = s => (s || '').trim();
function poiOf(e) {
  const t = e.tags || {};
  let lat = e.lat, lng = e.lon, ha = 0, B = null;
  if (lat == null && e.bounds) {
    B = e.bounds;
    lat = (B.minlat + B.maxlat) / 2; lng = (B.minlon + B.maxlon) / 2;
    ha = Math.max(0, (B.maxlat - B.minlat) * KY * (B.maxlon - B.minlon) * KX * 0.7) / 1e4; // bbox × 0.7 ≈ footprint
  }
  if (lat == null) return null;
  return { lat, lng, ha, B, name: fa(t['name:fa'] || t.name), street: fa(t['addr:street']), t, id: `${e.type[0]}${e.id}` };
}

// ── density-peak clustering ──────────────────────────────────
function peaks(pts, { r0, min, rMax, rMin, weight = () => 1, grow = 0 }) {
  if (!pts.length) return [];
  const idx = gridIndex(pts, r0);
  const dens = pts.map(p => idx.near(p, r0).reduce((s, j) => s + weight(pts[j]), 0));
  const order = pts.map((_, i) => i).sort((a, b) => dens[b] - dens[a]);
  const used = new Uint8Array(pts.length), out = [];
  for (const i of order) {
    if (used[i] || dens[i] < min) continue;
    let c = { lat: pts[i].lat, lng: pts[i].lng };
    for (let k = 0; k < 4; k++) { // mean shift towards the local centre of mass
      const nb = idx.near(c, r0 * 1.6).filter(j => !used[j]);
      if (!nb.length) break;
      const W = nb.reduce((s, j) => s + weight(pts[j]), 0);
      c = { lat: nb.reduce((s, j) => s + pts[j].lat * weight(pts[j]), 0) / W, lng: nb.reduce((s, j) => s + pts[j].lng * weight(pts[j]), 0) / W };
    }
    const mem = idx.near(c, rMax).filter(j => !used[j]);
    const r = clamp(pct(mem.map(j => dm(pts[j], c)), 0.75) + 40, rMin, rMax);
    const inside = mem.filter(j => dm(pts[j], c) <= r);
    const n = inside.reduce((s, j) => s + weight(pts[j]), 0);
    used[i] = 1;
    if (n < min) continue;
    inside.forEach(j => { used[j] = 1; });
    // follow the street: add free POIs chained to the cluster (≤ grow metres apart), so a long or bent
    // shopping street is covered by its shape instead of being cut at the circle
    if (grow) {
      const far = rMax;
      for (let q = [...inside]; q.length;) {
        const j = q.pop();
        idx.near(pts[j], grow).forEach(k => { if (!used[k] && dm(pts[k], c) <= far) { used[k] = 1; inside.push(k); q.push(k); } });
      }
    }
    out.push({ lat: c.lat, lng: c.lng, r, n: inside.reduce((s, j) => s + weight(pts[j]), 0), members: inside.map(j => pts[j]) });
  }
  return out;
}

const modeOf = arr => {
  const m = new Map(); arr.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
  let best = '', bn = 0; m.forEach((n, v) => { if (n > bn) { best = v; bn = n; } });
  return bn >= 2 ? best : '';
};
const streetLabel = s => s && !/^(خیابان|بلوار|بزرگراه|کوچه|میدان|بازار|پاساژ|کوی|جاده)/.test(s) ? `خیابان ${s}` : s;

// nearest named road (roads: [{name, line:[[lat,lng]…]}]) — used to label clusters without addr:street
export function roadNamer(roads) {
  const pts = [];
  (roads || []).forEach(w => { if (!w.name) return; const step = Math.max(1, Math.floor(w.line.length / 40)); for (let i = 0; i < w.line.length; i += step) pts.push({ lat: w.line[i][0], lng: w.line[i][1], name: w.name }); });
  const idx = gridIndex(pts, 300);
  return c => { let best = null, bd = 450; idx.near(c, 450).forEach(j => { const d = dm(pts[j], c); if (d < bd) { bd = d; best = pts[j].name; } }); return best || ''; };
}

// ── shapes ───────────────────────────────────────────────────
// Each POI is buffered by b metres on a fine grid, gaps narrower than `gap` are closed (so shops on both sides of a
// street or a few doors apart join up), and every connected patch is traced into a polygon. Patches holding less than
// minPart of the POIs are dropped as stragglers; the rest stay as separate parts (a MultiPolygon) when the cluster is patchy.
// Streets and food clusters keep only their dense core: a cell stays in the shape when at least `abs` POIs (and at least
// `frac` of the peak) lie within `h` metres of it. `cap` is the farthest a shape may reach from its densest point.
const SHAPE = {
  mall:   { b: 70, gap: 40, minPart: 0, cap: 350 },
  retail: { kde: { h: 60 }, b: 20, gap: 30, minPart: 0.08, cap: 380 },
  bourse: { kde: { h: 60 }, b: 20, gap: 30, minPart: 0.08, cap: 320 },
  food:   { kde: { h: 70 }, b: 20, gap: 30, minPart: 0.08, cap: 380 },
  office: { kde: { h: 70 }, b: 20, gap: 30, minPart: 0.08, cap: 380 },
  health: { kde: { h: 70 }, b: 25, gap: 30, minPart: 0.08, cap: 380 },
  fun:    { b: 70, gap: 60, minPart: 0, cap: 300 },
  campus: { b: 30, gap: 40, minPart: 0, cap: 650 },
  hyper:  { b: 80, gap: 40, minPart: 0, cap: 250 },
  park:   { b: 30, gap: 40, minPart: 0, cap: 900 },
  sport:  { b: 60, gap: 40, minPart: 0, cap: 500 },
};
const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // clockwise, y down

// a building or campus is sampled across its footprint (≤ step metres apart) so its whole area is covered
function samples(p, step) {
  if (!p.B) return [[p.lat, p.lng]];
  const { minlat: a, maxlat: b, minlon: c, maxlon: d } = p.B, out = [];
  const ni = clamp(Math.ceil((b - a) * KY / step), 1, 40), nj = clamp(Math.ceil((d - c) * KX / step), 1, 40);
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) out.push([a + (b - a) * i / ni, c + (d - c) * j / nj]);
  return out;
}
const diskOffsets = rc => { const o = []; for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) if (dx * dx + dy * dy <= rc * rc + rc * 0.6) o.push(dx, dy); return o; };

export function outline(members, { b: b0, gap, minPart, kde = null, cap: cap0 = Infinity }, cov = 70) {
  if (!members?.length) return null;
  const b = kde ? b0 : b0 * BUF[cov], cap = cap0 * CAPF[cov];
  const step = Math.max(20, Math.min(60, b * 0.8));
  const pts = members.flatMap((m, mi) => samples(m, step).map(([la, ln]) => ({ la, ln, mi })));
  // a huge footprint is sampled more coarsely than `step`; close those gaps too so a park stays one shape
  const spread = Math.max(0, ...members.filter(m => m.B).map(m => Math.max((m.B.maxlat - m.B.minlat) * KY, (m.B.maxlon - m.B.minlon) * KX) / 40));
  if (!kde && spread > gap / 1.3) gap = spread * 1.3;
  const lat0 = pts.reduce((s, p) => s + p.la, 0) / pts.length, lng0 = pts.reduce((s, p) => s + p.ln, 0) / pts.length;
  pts.forEach(p => { p.x = (p.ln - lng0) * KX; p.y = (lat0 - p.la) * KY; }); // y grows southwards (raster order)
  const pad = b + gap + (kde ? kde.h : 0) + 30;
  const minX = Math.min(...pts.map(p => p.x)) - pad, maxX = Math.max(...pts.map(p => p.x)) + pad;
  const minY = Math.min(...pts.map(p => p.y)) - pad, maxY = Math.max(...pts.map(p => p.y)) + pad;
  const cell = clamp(Math.max(maxX - minX, maxY - minY) / 110, 8, 40);
  const W = Math.ceil((maxX - minX) / cell) + 1, H = Math.ceil((maxY - minY) / cell) + 1;
  const at = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cx = p => Math.round((p.x - minX) / cell), cy = p => Math.round((p.y - minY) / cell);
  let g = new Uint8Array(W * H);
  const stamp = (src, dst, off, val) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (src[at(x, y)]) for (let k = 0; k < off.length; k += 2) { const X = x + off[k], Y = y + off[k + 1]; if (inb(X, Y)) dst[at(X, Y)] = val; } };
  const disk = diskOffsets(Math.max(1, Math.round(b / cell)));
  let peak = null;
  if (kde) {
    // density core: count POIs within h of every cell, keep the cells above the threshold, then pad them by b
    const cnt = new Uint16Array(W * H), kd = diskOffsets(Math.max(1, Math.round(kde.h / cell)));
    pts.forEach(p => { const x = cx(p), y = cy(p); for (let k = 0; k < kd.length; k += 2) { const X = x + kd[k], Y = y + kd[k + 1]; if (inb(X, Y)) cnt[at(X, Y)]++; } });
    let mx = 0, mi = 0; cnt.forEach((v, i) => { if (v > mx) { mx = v; mi = i; } });
    peak = [mi % W, Math.floor(mi / W)];
    // threshold chosen so the shape takes in `cov`% of the POIs (densest first); never below 2 neighbours except at 95%
    const mv = new Array(members.length).fill(0);
    pts.forEach(p => { mv[p.mi] = Math.max(mv[p.mi], cnt[at(cx(p), cy(p))]); });
    mv.sort((a, c) => c - a);
    const thr = Math.max(cov >= 95 ? 1 : 2, mv[clamp(Math.ceil(cov / 100 * mv.length) - 1, 0, mv.length - 1)]);
    const core = cnt.map(v => (v >= thr ? 1 : 0));
    stamp(core, g, disk, 1);
  } else {
    pts.forEach(p => { const x = cx(p), y = cy(p); for (let k = 0; k < disk.length; k += 2) { const X = x + disk[k], Y = y + disk[k + 1]; if (inb(X, Y)) g[at(X, Y)] = 1; } });
  }
  const gc = Math.round(gap / 2 / cell);
  if (gc > 0) { // morphological closing: dilate, then erode
    const off = diskOffsets(gc), dil = new Uint8Array(W * H);
    stamp(g, dil, off, 1);
    const inv = dil.map(v => 1 - v), ero = new Uint8Array(W * H).fill(1);
    stamp(inv, ero, off, 0);
    g = ero.map((v, i) => v | g[i]);
  }
  if (cap < Infinity) { // never reach farther than cap from the densest point (or the centre)
    const [px, py] = peak || [Math.round(-minX / cell), Math.round(-minY / cell)], rc = cap / cell;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[at(x, y)] && Math.hypot(x - px, y - py) > rc) g[at(x, y)] = 0;
  }
  // connected patches (8-neighbour)
  const lab = new Int32Array(W * H).fill(-1); const patches = [];
  for (let i = 0; i < W * H; i++) if (g[i] && lab[i] < 0) {
    const id = patches.length, q = [i]; lab[i] = id; let n = 0, sx = 0, sy = 0;
    while (q.length) { const c = q.pop(), x = c % W, y = (c - x) / W; n++; sx += x; sy += y;
      for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (inb(X, Y) && g[at(X, Y)] && lab[at(X, Y)] < 0) { lab[at(X, Y)] = id; q.push(at(X, Y)); } } }
    patches.push({ id, start: i, cells: n, sx, sy, members: new Set() });
  }
  pts.forEach(p => { const l = lab[at(cx(p), cy(p))]; if (l >= 0) patches[l].members.add(p.mi); });
  const need = Math.max(kde ? 3 : 1, Math.ceil(minPart * members.length));
  const biggest = patches.reduce((a, p) => (!a || p.members.size > a.members.size ? p : a), null);
  const keep = patches.filter(p => p.members.size >= need || p === biggest);
  if (!keep.length || !keep[0]) return null;
  const toLL = (x, y) => [+(lat0 - (y * cell + minY) / KY).toFixed(6), +(lng0 + (x * cell + minX) / KX).toFixed(6)];
  const parts = keep.map(p => {
    const sx = p.start % W, sy = (p.start - sx) / W, inP = (x, y) => inb(x, y) && lab[at(x, y)] === p.id;
    let x = sx, y = sy, bx = sx - 1, by = sy; const path = [[x, y]];
    for (let it = 0, max = p.cells * 4 + 8; it < max; it++) {
      const k = D8.findIndex(([dx, dy]) => dx === bx - x && dy === by - y);
      let moved = false;
      for (let t = 1; t <= 8; t++) {
        const d = (k + t) % 8, nx = x + D8[d][0], ny = y + D8[d][1];
        if (inP(nx, ny)) { const pd = (k + t + 7) % 8; bx = x + D8[pd][0]; by = y + D8[pd][1]; x = nx; y = ny; moved = true; break; }
      }
      if (!moved) break;
      if (x === sx && y === sy) break;
      path.push([x, y]);
    }
    let ring = path.length < 3 ? circleCells(sx, sy, Math.max(2, Math.round(b / cell))) : path;
    ring = simplify(ring, 0.9);
    ring = simplify(chaikin(ring), 0.8);
    const ll = ring.map(([a, c]) => toLL(a, c)); ll.push(ll[0]);
    return ll;
  });
  const cells = keep.reduce((s, p) => s + p.cells, 0);
  const cxm = keep.reduce((s, p) => s + p.sx, 0) / cells, cym = keep.reduce((s, p) => s + p.sy, 0) / cells;
  const [clat, clng] = toLL(cxm, cym), c = { lat: clat, lng: clng };
  const r = Math.max(...parts.flat().map(([la, ln]) => dm(c, { lat: la, lng: ln }))) + cell / 2;
  const inside = new Set(keep.flatMap(p => [...p.members])).size;
  return { parts, lat: clat, lng: clng, r, inside, area: +(cells * cell * cell / 1e4).toFixed(2) };
}
const circleCells = (x, y, rc) => Array.from({ length: 24 }, (_, i) => [x + rc * Math.cos(i * Math.PI / 12), y + rc * Math.sin(i * Math.PI / 12)]);
function chaikin(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) { const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length]; out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); }
  return out;
}
// Douglas–Peucker on a closed ring (tolerance in grid cells)
function simplify(ring, eps) {
  if (ring.length < 8) return ring;
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let iMax = 0, dMax = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > dMax) { dMax = d; iMax = i; } }
    return dMax <= eps ? [pts[0], pts[pts.length - 1]] : [...dp(pts.slice(0, iMax + 1)).slice(0, -1), ...dp(pts.slice(iMax))];
  };
  // split at the point farthest from the first so both halves are open polylines
  let far = 0, fd = -1; ring.forEach(([x, y], i) => { const d = Math.hypot(x - ring[0][0], y - ring[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = dp(ring.slice(0, far + 1)), b2 = dp([...ring.slice(far), ring[0]]);
  return [...a.slice(0, -1), ...b2.slice(0, -1)];
}
// rings are stored as delta-encoded 1e-5° integers (same as data/roads.json)
export function packRing(ring) { const o = []; let a = 0, b = 0; ring.forEach(([la, ln]) => { const A = Math.round(la * 1e5), B = Math.round(ln * 1e5); o.push(A - a, B - b); a = A; b = B; }); return o; }
export function unpackRing(p) { const o = []; let a = 0, b = 0; for (let i = 0; i < p.length; i += 2) { a += p[i]; b += p[i + 1]; o.push([a / 1e5, b / 1e5]); } return o; }

// geometry helpers for the app (rings: [[lat,lng]…])
const inRing = ([lat, lng], ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
// metres from a point to the hotspot's shape (0 when inside)
export function distToShape(rings, pt) {
  if (rings.some(r => inRing([pt.lat, pt.lng], r))) return 0;
  let best = Infinity;
  rings.forEach(r => { for (let i = 0; i < r.length - 1; i++) {
    const ax = (r[i][1] - pt.lng) * KX, ay = (r[i][0] - pt.lat) * KY, bx = (r[i + 1][1] - pt.lng) * KX, by = (r[i + 1][0] - pt.lat) * KY;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  } });
  return best;
}
export const ringAreaHa = ring => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += (ring[i][1] * KX) * (ring[i + 1][0] * KY) - (ring[i + 1][1] * KX) * (ring[i][0] * KY); return Math.abs(s) / 2 / 1e4; };

// ── build ────────────────────────────────────────────────────
// How tightly shops and restaurants cluster in Tehran: 90th percentile of neighbours within 120 m (shops) and 150 m
// (food). Other cities' OpenStreetMap data is sparser, so their thresholds are scaled by their own figure ÷ these.
const TEHRAN_P90 = { retail: 14, food: 9 };
function clusterP90(pts, r) {
  if (pts.length < 20) return 0;
  const idx = gridIndex(pts, r);
  const cnt = pts.map(p => idx.near(p, r).length).sort((a, b) => a - b);
  return cnt[Math.floor(0.9 * (cnt.length - 1))];
}

/**
 * @param osm      Overpass result (HOTSPOT_QUERY)
 * @param opts     roadName(c) → nearest road name; relative: true for cities other than Tehran, so that «dense» is
 *                 judged against the city's own clustering (Tehran is built without it, exactly as before)
 */
export function buildHotspots(osm, { roadName = () => '', relative = false } = {}) {
  const pois = (osm.elements || []).map(poiOf).filter(Boolean);
  // scale factors (1 in Tehran): sR for shops and trade streets, sF for food, sA for offices and clinics
  let sR = 1, sF = 1;
  if (relative) {
    const shopsR = pois.filter(p => p.t.shop && RETAIL.has(p.t.shop)), foodR = pois.filter(p => FOOD.has(p.t.amenity));
    sR = clamp(clusterP90(shopsR, 120) / TEHRAN_P90.retail, 0.3, 1) || 0.3;
    sF = clamp(clusterP90(foodR, 150) / TEHRAN_P90.food, 0.3, 1) || 0.3;
  }
  const sA = (sR + sF) / 2;
  const atLeast = (v, s, lo) => Math.max(lo, Math.round(v * s));
  const out = [];
  const push = (h) => out.push(h);

  // 1) malls, passages, department stores and bazaars — each is its own hotspot; neighbours within 140 m merge
  const isMall = p => p.t.shop === 'mall' || p.t.shop === 'department_store' || p.t.amenity === 'marketplace';
  const malls = pois.filter(isMall).filter(p => p.name || p.ha > 0.3);
  const shopIdx = gridIndex(pois.filter(p => p.t.shop && !isMall(p)), 150);
  const shopPts = pois.filter(p => p.t.shop && !isMall(p));
  const mallW = p => 1 + Math.min(12, p.ha * 2.5);
  peaks(malls, { r0: 120, min: 1, rMax: 200, rMin: 0, weight: mallW }).forEach(c => {
    const fame = p => (p.name ? 1 : 0) + (/مال|بازار|مرکز خرید|مجتمع/.test(p.name) ? 1 : 0);
    const big = [...c.members].sort((a, b) => b.ha - a.ha || fame(b) - fame(a));
    const ha = c.members.reduce((s, p) => s + p.ha, 0);
    const foot = Math.sqrt(Math.max(ha, 0.2) * 1e4 / Math.PI);
    const r = clamp(Math.max(c.r, foot) + 140, 160, 700);
    const inner = shopIdx.near(c, Math.max(80, foot)).length;
    const name = big[0].name || big.find(p => p.name)?.name || (big[0].t.amenity === 'marketplace' ? 'بازارچه' : 'مرکز خرید');
    const extra = c.members.length - 1;
    const size = c.members.length * 6 + inner + ha * 10;
    if (size < 9) return; // a lone, small passage is not a hotspot
    push({ _m: c.members, t: 'mall', name: extra ? `${name} و ${extra} مرکز دیگر` : name, lat: c.lat, lng: c.lng, r, n: c.members.length, shops: inner, ha: +ha.toFixed(1),
      size, top: big.slice(0, 4).map(p => p.name).filter(Boolean), kind: big[0].t.amenity === 'marketplace' ? 'bazaar' : 'mall' });
  });

  // 2) shopping streets — comparison retail
  const retail = shopPts.filter(p => RETAIL.has(p.t.shop));
  peaks(retail, { r0: 100, min: atLeast(12, sR, 4), rMax: 380, rMin: 100, grow: 70 }).forEach(c => {
    const st = modeOf(c.members.map(p => p.street));
    push({ _m: c.members, t: 'retail', place: streetLabel(st) || roadName(c), lat: c.lat, lng: c.lng, r: c.r, n: c.n, size: c.n,
      mix: topKinds(c.members, p => SHOP_FA[p.t.shop]) });
  });

  // 3) trade streets per category
  for (const [k, b] of Object.entries(BOURSE)) {
    const pts = pois.filter(p => (p.t.shop && SHOP_TO_SUB[p.t.shop] === k) || (b.amenity && b.amenity.includes(p.t.amenity)));
    peaks(pts, { r0: 100, min: atLeast(b.min, sR, 3), rMax: 320, rMin: 90, grow: 70 }).forEach(c => {
      const st = modeOf(c.members.map(p => p.street));
      push({ _m: c.members, t: 'bourse', sub: k, place: streetLabel(st) || roadName(c), lat: c.lat, lng: c.lng, r: c.r, n: c.n, size: c.n / (b.min / 6),
        mix: topKinds(c.members, p => SHOP_FA[p.t.shop] || (p.t.amenity === 'pharmacy' ? 'داروخانه' : '')) });
    });
  }

  // 4) food clusters
  const food = pois.filter(p => FOOD.has(p.t.amenity));
  peaks(food, { r0: 120, min: atLeast(8, sF, 4), rMax: 380, rMin: 100, grow: 80 }).forEach(c => {
    const st = modeOf(c.members.map(p => p.street));
    push({ _m: c.members, t: 'food', place: streetLabel(st) || roadName(c), lat: c.lat, lng: c.lng, r: c.r, n: c.n, size: c.n,
      mix: topKinds(c.members, p => ({ restaurant: 'رستوران', fast_food: 'فست‌فود', cafe: 'کافه', food_court: 'فودکورت', ice_cream: 'بستنی', juice_bar: 'آبمیوه' })[p.t.amenity]) });
  });

  // 5) entertainment & culture
  const fun = pois.filter(p => FUN_AM.has(p.t.amenity) || FUN_LE.has(p.t.leisure));
  peaks(fun, { r0: 250, min: 2, rMax: 300, rMin: 120 }).forEach(c => {
    const named = c.members.map(p => p.name).filter(Boolean);
    push({ _m: c.members, t: 'fun', name: named[0] ? (named.length > 1 ? `${named[0]} و ${named.length - 1} مرکز دیگر` : named[0]) : '', place: roadName(c), lat: c.lat, lng: c.lng, r: c.r, n: c.n, size: c.n,
      top: named.slice(0, 4), mix: topKinds(c.members, p => ({ cinema: 'سینما', theatre: 'تئاتر', arts_centre: 'فرهنگسرا' })[p.t.amenity] || 'تفریحی') });
  });

  // 6) metro, rail and bus terminals
  const isTerminal = p => p.t.amenity === 'bus_station' && /پایانه|ترمینال|terminal/i.test(p.name + ' ' + (p.t.name || ''));
  const isSubway = p => p.t.railway === 'station' && (p.t.station === 'subway' || p.t.subway === 'yes' || p.t.station === 'light_rail');
  const isRail = p => p.t.railway === 'station' && !isSubway(p) && (p.t.train === 'yes' || /راه.?آهن/.test(p.name));
  const transit = pois.filter(p => isSubway(p) || isRail(p) || isTerminal(p));
  peaks(transit, { r0: 220, min: 1, rMax: 260, rMin: 0 }).forEach(c => {
    const names = [...new Set(c.members.map(p => p.name.replace(/^ایستگاه\s*(مترو)?\s*/, '')).filter(Boolean))];
    const sub = c.members.some(isRail) ? 'rail' : c.members.some(isTerminal) ? 'terminal' : 'metro';
    const lines = new Set(c.members.flatMap(p => String(p.t.line || p.t['subway:line'] || p.t.ref || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)));
    const inter = sub === 'metro' && (lines.size > 1 || c.members.length > 1 && names.length === 1);
    const r = sub === 'metro' ? (inter ? 220 : 150) : 250;
    push({ _m: c.members, t: 'transit', sub, name: names[0] ? `${sub === 'metro' ? 'ایستگاه ' : ''}${names[0]}` : (sub === 'terminal' ? 'پایانه' : 'ایستگاه'), lat: c.lat, lng: c.lng, r, n: c.members.length,
      size: sub === 'metro' ? (inter ? 3 : 1.4) : sub === 'rail' ? 4 : 1.6, inter });
  });

  // 7) university campuses (≥ 2 ha, or explicitly «دانشگاه»)
  const campus = pois.filter(p => p.t.amenity === 'university' && (p.ha >= 2 || /^دانشگاه/.test(p.name)) && p.name);
  peaks(campus, { r0: 300, min: 1, rMax: 350, rMin: 0, weight: p => 1 + Math.min(6, p.ha / 4) }).forEach(c => {
    const big = [...c.members].sort((a, b) => b.ha - a.ha);
    const ha = c.members.reduce((s, p) => s + p.ha, 0);
    const r = clamp(Math.sqrt(Math.max(ha, 1) * 1e4 / Math.PI) + 120, 220, 800);
    push({ _m: c.members, t: 'campus', name: big[0].name, lat: c.lat, lng: c.lng, r, n: c.members.length, ha: +ha.toFixed(1), size: 1 + ha / 5 });
  });

  // 8) hypermarkets and big supermarkets (≥ 0.4 ha, or a chain store with its own building) — each is its own hotspot
  const hyper = pois.filter(p => p.t.shop === 'supermarket' && (p.ha >= 0.4 || (HYPER_RE.test(p.name) && p.ha >= 0.05) || /هایپر|hyper/i.test(p.name)));
  peaks(hyper, { r0: 150, min: 1, rMax: 150, rMin: 0, weight: p => 1 + Math.min(6, p.ha * 8) }).forEach(c => {
    const big = [...c.members].sort((a, b) => b.ha - a.ha || (HYPER_RE.test(b.name) ? 1 : 0) - (HYPER_RE.test(a.name) ? 1 : 0));
    const ha = c.members.reduce((s, p) => s + p.ha, 0), chain = c.members.some(p => HYPER_RE.test(p.name));
    push({ _m: c.members, t: 'hyper', name: big.find(p => p.name)?.name || 'فروشگاه بزرگ', lat: c.lat, lng: c.lng, r: 120, n: c.members.length, ha: +ha.toFixed(1), size: 3 + ha * 10 + (chain ? 3 : 0) });
  });

  // 9) office and business districts — companies, agencies and banks
  const office = pois.filter(p => p.t.office || p.t.amenity === 'bank');
  peaks(office, { r0: 120, min: atLeast(15, sA, 5), rMax: 380, rMin: 100, grow: 70 }).forEach(c => {
    const st = modeOf(c.members.map(p => p.street));
    push({ _m: c.members, t: 'office', place: streetLabel(st) || roadName(c), lat: c.lat, lng: c.lng, r: c.r, n: c.n, size: c.n,
      mix: topKinds(c.members, p => p.t.amenity === 'bank' ? 'بانک' : OFFICE_FA[p.t.office] || 'شرکت و اداره') });
  });

  // 10) hospitals and clinic clusters (a hospital counts as 8 clinics)
  const health = pois.filter(p => ['hospital', 'clinic', 'doctors', 'dentist'].includes(p.t.amenity));
  peaks(health, { r0: 150, min: atLeast(10, sA, 5), rMax: 380, rMin: 120, grow: 80, weight: p => (p.t.amenity === 'hospital' ? 8 : 1) }).forEach(c => {
    const hosp = c.members.filter(p => p.t.amenity === 'hospital' && p.name).sort((a, b) => b.ha - a.ha);
    const st = modeOf(c.members.map(p => p.street));
    push({ _m: c.members, t: 'health', name: hosp[0] ? (hosp.length > 1 ? `${hosp[0].name} و ${hosp.length - 1} بیمارستان دیگر` : hosp[0].name) : '', place: streetLabel(st) || roadName(c),
      lat: c.lat, lng: c.lng, r: c.r, n: c.members.length, size: c.n, top: hosp.slice(0, 4).map(p => p.name),
      mix: topKinds(c.members, p => ({ hospital: 'بیمارستان', clinic: 'درمانگاه', doctors: 'مطب', dentist: 'دندانپزشکی' })[p.t.amenity]) });
  });

  // 11) large parks (≥ 10 ha)
  const parks = pois.filter(p => p.t.leisure === 'park' && p.ha >= 10 && p.name);
  peaks(parks, { r0: 200, min: 1, rMax: 200, rMin: 0, weight: p => 1 + p.ha / 5 }).forEach(c => {
    const big = [...c.members].sort((a, b) => b.ha - a.ha), ha = c.members.reduce((s, p) => s + p.ha, 0);
    push({ _m: c.members, t: 'park', name: big[0].name, lat: c.lat, lng: c.lng, r: 300, n: c.members.length, ha: +ha.toFixed(1), size: ha });
  });

  // 12) stadiums and big sports complexes (≥ 1.5 ha)
  const sport = pois.filter(p => (p.t.leisure === 'stadium' || (p.t.leisure === 'sports_centre' && p.ha >= 1.5)) && (p.name || p.ha >= 3));
  peaks(sport, { r0: 250, min: 1, rMax: 250, rMin: 0, weight: p => 1 + p.ha / 3 }).forEach(c => {
    const big = [...c.members].sort((a, b) => (b.t.leisure === 'stadium') - (a.t.leisure === 'stadium') || b.ha - a.ha), ha = c.members.reduce((s, p) => s + p.ha, 0);
    push({ _m: c.members, t: 'sport', name: big.find(p => p.name)?.name || 'مجموعه ورزشی', lat: c.lat, lng: c.lng, r: 250, n: c.members.length, ha: +ha.toFixed(1), size: 1 + ha / 2 });
  });

  // shape of each hotspot at every coverage level: the area its POIs actually cover, split into parts when patchy.
  // The 70% level is the default view and also sets the centre, counts and density used for the potential score.
  out.forEach(h => {
    const S = h.t === 'transit' ? { b: h.r, gap: 0, minPart: 0 } : SHAPE[h.t];
    const lv = {};
    for (const c of COVERAGE) {
      const o = outline(h._m, S, c);
      if (o) lv[c] = { p: o.parts.map(packRing), a: o.area, r: Math.round(o.r), n: S.kde ? o.inside : null, lat: o.lat, lng: o.lng };
    }
    delete h._m;
    const o = lv[70];
    if (!o) { h.drop = true; return; }
    Object.assign(h, { lat: o.lat, lng: o.lng, r: o.r, area: o.a }); // shapes live in h.cov[level].p
    COVERAGE.forEach(c => { if (lv[c]) { delete lv[c].lat; delete lv[c].lng; if (lv[c].n == null) delete lv[c].n; } });
    h.cov = lv;
    if (S.kde) {
      const k = h.t === 'bourse' ? BOURSE[h.sub].min / 6 : 1;
      if (h.t !== 'health') { h.n = o.n; h.size = o.n / k; }
      if (o.n < atLeast(6, h.t === 'food' ? sF : h.t === 'office' || h.t === 'health' ? sA : sR, 3)) h.drop = true; // no real core
    }
  });
  for (let i = out.length - 1; i >= 0; i--) if (out[i].drop) out.splice(i, 1);

  // potential score: half "how big within its type" (percentile), half absolute size vs a typical strong hotspot,
  // scaled by how much foot traffic the type brings; a little bonus for overlapping other hotspot types
  // a «strong» hotspot of each type; outside Tehran measured against the city's own density
  const REF = { mall: 120 * Math.max(sR, 0.5), retail: 60 * sR, food: 45 * sF, bourse: 30 * sR, fun: 5, transit: 4, campus: 12, hyper: 12, office: 60 * sA, health: 40 * sA, park: 40, sport: 10 };
  const byType = {};
  out.forEach(h => (byType[h.t] ||= []).push(h.size));
  out.forEach(h => {
    const arr = byType[h.t], p = arr.filter(v => v < h.size).length / Math.max(1, arr.length - 1);
    const abs = clamp(Math.log1p(h.size) / Math.log1p(REF[h.t]), 0, 1);
    const overlap = new Set(out.filter(o => o !== h && o.t !== h.t && dm(o, h) < (o.r + h.r) * 0.7).map(o => o.t)).size;
    const dens = h.n / Math.max(0.05, h.area || Math.PI * h.r * h.r / 1e4); // POIs per hectare of the shape
    h.dens = +dens.toFixed(2);
    h.score = Math.round(clamp(100 * TYPE_BY_KEY[h.t].w * (0.45 * p + 0.55 * abs) + 4 * Math.min(3, overlap), 5, 99));
    h.lvl = h.score >= 75 ? 3 : h.score >= 55 ? 2 : 1;
    h.mixed = overlap;
  });

  for (let i = out.length - 1; i >= 0; i--) if (out[i].score < 25) out.splice(i, 1);
  out.forEach((h, i) => { h.lat = +h.lat.toFixed(5); h.lng = +h.lng.toFixed(5); h.r = Math.round(h.r); h.n = Math.round(h.n); delete h.size; h.id = `h${i}`; });
  out.sort((a, b) => b.score - a.score);
  if (relative) out.scale = { retail: +sR.toFixed(2), food: +sF.toFixed(2) };
  return out;
}

function topKinds(members, label) {
  const m = new Map(); members.forEach(p => { const l = label(p); if (l) m.set(l, (m.get(l) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, n]) => `${l} ${n}`);
}

const OFFICE_FA = { company: 'شرکت', government: 'دولتی', insurance: 'بیمه', it: 'فناوری', estate_agent: 'املاک', lawyer: 'وکالت', accountant: 'حسابداری', travel_agent: 'گردشگری', telecommunication: 'مخابرات', financial: 'مالی', ngo: 'سازمان' };
const SHOP_FA = {
  clothes: 'پوشاک', shoes: 'کفش', boutique: 'بوتیک', fashion_accessories: 'اکسسوری', bag: 'کیف', jewelry: 'طلا و جواهر', watches: 'ساعت',
  cosmetics: 'آرایشی', perfumery: 'عطر', beauty: 'زیبایی', gift: 'هدیه', toys: 'اسباب‌بازی', sports: 'ورزشی', outdoor: 'کوهنوردی',
  mobile_phone: 'موبایل', electronics: 'الکترونیک', computer: 'کامپیوتر', books: 'کتاب', optician: 'عینک', variety_store: 'خرازی',
  department_store: 'فروشگاه بزرگ', confectionery: 'شیرینی', chocolate: 'شکلات', nuts: 'آجیل', coffee: 'قهوه', tea: 'چای', florist: 'گل',
  music: 'موسیقی', baby_goods: 'کودک', leather: 'چرم', fabric: 'پارچه', houseware: 'لوازم خانه', lighting: 'لوستر و روشنایی',
  hifi: 'صوتی', camera: 'دوربین', video_games: 'بازی', telecommunication: 'مخابرات', tailor: 'خیاطی', sewing: 'خیاطی',
  furniture: 'مبلمان', interior_decoration: 'دکوراسیون', carpet: 'فرش', kitchen: 'آشپزخانه', bed: 'خواب', curtain: 'پرده', appliance: 'لوازم برقی',
  electrical: 'برق', bathroom_furnishing: 'شیرآلات', tiles: 'کاشی', flooring: 'کفپوش', car_parts: 'لوازم یدکی', car: 'نمایشگاه خودرو', tyres: 'لاستیک',
  motorcycle: 'موتورسیکلت', car_repair: 'تعمیرگاه', motorcycle_repair: 'تعمیر موتور', hardware: 'ابزار', doityourself: 'ابزار', paint: 'رنگ',
  trade: 'مصالح', wholesale: 'عمده‌فروشی', glaziery: 'شیشه', stationery: 'لوازم‌التحریر', copyshop: 'تکثیر', art: 'هنری', chemist: 'بهداشتی',
  medical_supply: 'تجهیزات پزشکی', hearing_aids: 'سمعک', gold_buyer: 'طلا', musical_instrument: 'ساز', bicycle: 'دوچرخه', fishing: 'ماهیگیری',
  hunting: 'شکار', scuba_diving: 'غواصی', golf: 'گلف', games: 'بازی', model: 'ماکت', pet: 'پت‌شاپ', pet_grooming: 'آرایش حیوانات',
  hairdresser_supply: 'لوازم آرایشگاهی', vacuum_cleaner: 'جاروبرقی', video: 'فیلم',
};

// display name of a hotspot
export function hotspotTitle(h) {
  const T = TYPE_BY_KEY[h.t];
  if (h.t === 'bourse') return `بورس ${BOURSE[h.sub]?.fa || ''}${h.place ? ' · ' + h.place : ''}`;
  if (h.t === 'retail') return `راسته خرید${h.place ? ' · ' + h.place : ''}`;
  if (h.t === 'food') return `رستوران و کافه${h.place ? ' · ' + h.place : ''}`;
  if (h.t === 'office') return `مرکز اداری و تجاری${h.place ? ' · ' + h.place : ''}`;
  if (h.t === 'health' && !h.name) return `مراکز درمانی${h.place ? ' · ' + h.place : ''}`;
  if (h.name) return h.name;
  return `${T?.short || ''}${h.place ? ' · ' + h.place : ''}`;
}
export const LEVEL_FA = { 3: 'خیلی زیاد', 2: 'زیاد', 1: 'متوسط' };
