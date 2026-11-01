// Billboard lists the admin uploads (Excel / CSV): reading the rows, and merging them into the map's structures.
// The rows live in Supabase (table custom_structures, supabase/schema.sql); every page load applies them on top of
// the monthly market list, so an uploaded price or a structure the market lacks stays until the admin changes it.

const FA_DIG = '۰۱۲۳۴۵۶۷۸۹', AR_DIG = '٠١٢٣٤٥٦٧٨٩';
export const latinNum = s => String(s ?? '').replace(/[۰-۹]/g, d => FA_DIG.indexOf(d)).replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).replace(/٫/g, '.').replace(/٬/g, ',');
const nfa = s => latinNum(s).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// column headers people write, in Persian or English → field
export const COLUMNS = {
  name: ['نام', 'نام سازه', 'عنوان', 'سازه', 'name', 'title'],
  city: ['شهر', 'city'],
  address: ['نشانی', 'آدرس', 'محل', 'مکان', 'موقعیت', 'لوکیشن', 'address', 'location'],
  lat: ['عرض جغرافیایی', 'عرض', 'lat', 'latitude', 'y'],
  lng: ['طول جغرافیایی', 'طول', 'lng', 'lon', 'long', 'longitude', 'x'],
  link: ['لینک نقشه', 'لینک', 'نقشه', 'map', 'link', 'url'],
  type: ['نوع', 'نوع سازه', 'type', 'format'],
  dir: ['جهت', 'جهت دید', 'direction', 'dir'],
  w: ['طول تابلو', 'عرض تابلو (متر)', 'عرض تابلو', 'width', 'w'],
  h: ['ارتفاع', 'ارتفاع تابلو', 'height', 'h'],
  size: ['ابعاد', 'اندازه', 'size', 'dimensions'],
  price: ['قیمت', 'قیمت ماهانه', 'اجاره', 'اجاره ماهانه', 'قیمت ماهانه (تومان)', 'price', 'monthly price'],
  owner: ['مجری', 'آژانس', 'مالک', 'owner', 'agency'],
  code: ['کد', 'کد سازه', 'code', 'id'],
  note: ['توضیح', 'توضیحات', 'یادداشت', 'note', 'notes'],
};
const HEAD_ALIASES = Object.entries(COLUMNS).flatMap(([k, ws]) => ws.map(w => [nfa(w), k]));
/** header text → field name (or null) */
export function fieldOf(header) {
  const h = nfa(header).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = HEAD_ALIASES.find(([w]) => w === h);
  if (exact) return exact[1];
  // «قیمت ماهانه به ریال» / «lat (y)»
  const part = HEAD_ALIASES.filter(([w]) => w.length >= 2 && h.includes(w)).sort((a, b) => b[0].length - a[0].length)[0];
  return part ? part[1] : null;
}

/** «4.5 میلیارد»، «450,000,000»، «۴۵۰ میلیون تومان» → toman; rial when the header or the text says so */
export function parsePrice(v, { rial = false } = {}) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(rial ? v / 10 : v) || null;
  let s = nfa(v);
  const isRial = rial || /ریال|rial|irr/.test(s);
  let mul = 1;
  if (/میلیارد|billion|\bb\b/.test(s)) mul = 1e9; else if (/میلیون|million|\bm\b/.test(s)) mul = 1e6; else if (/هزار|thousand|\bk\b/.test(s)) mul = 1e3;
  s = s.replace(/,/g, '');
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]) * mul;
  return Math.round(isRial ? n / 10 : n) || null;
}

/** coordinates in text: «35.75, 51.41»، Google Maps / Neshan / Balad links */
export function parseCoords(v) {
  const s = latinNum(v);
  const pats = [/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /[?&](?:q|ll|query|center|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /(?:^|[^\d.])(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})(?![\d.])/];
  for (const p of pats) { const m = s.match(p); if (m) { const a = +m[1], b = +m[2]; if (a > 24 && a < 40 && b > 43 && b < 64) return [a, b]; if (b > 24 && b < 40 && a > 43 && a < 64) return [b, a]; } }
  return null;
}

export function parseType(v, name = '') {
  const s = nfa(`${v || ''} ${v ? '' : name}`);
  if (/پل|عرشه|bridge/.test(s)) return 'bridge';
  if (/دیجیتال|تلویزیون|led|ال ای دی|digital/.test(s)) return 'digital';
  if (/استرابورد|استند|پوستر|poster|تابلو متوسط/.test(s)) return 'poster';
  if (/بام|روف|نما|rooftop|wall/.test(s)) return 'rooftop';
  return 'bulletin';
}
export function parseSize(row) {
  let w = +latinNum(row.w) || null, h = +latinNum(row.h) || null;
  if ((!w || !h) && row.size) { const m = latinNum(row.size).match(/(\d+(?:\.\d+)?)\s*[x×*\/]\s*(\d+(?:\.\d+)?)/i); if (m) { w = +m[1]; h = +m[2]; } }
  if (w && h && h > w) [w, h] = [h, w];
  return { w, h };
}

/**
 * Rows from a sheet (array of objects keyed by the sheet's headers) → normalised rows.
 * Unknown columns are ignored; returns { rows, fields } where fields lists the columns understood.
 */
export function normaliseRows(raw) {
  if (!raw.length) return { rows: [], fields: [] };
  const map = {}, rialCols = new Set();
  for (const h of Object.keys(raw[0])) { const f = fieldOf(h); if (f && !Object.values(map).includes(f)) map[h] = f; if (/ریال|rial/i.test(h)) rialCols.add(h); }
  const rows = raw.map((r, i) => {
    const o = { line: i + 2 };
    let rial = false;
    for (const [h, f] of Object.entries(map)) { o[f] = typeof r[h] === 'string' ? r[h].trim() : r[h]; if (f === 'price' && rialCols.has(h)) rial = true; }
    o.price = parsePrice(o.price, { rial });
    const lat = +latinNum(o.lat), lng = +latinNum(o.lng);
    // Iran: latitude 24–40, longitude 43–64 (columns swapped by mistake are put right)
    o.coords = lat && lng ? (lat >= 24 && lat <= 40 ? [lat, lng] : [lng, lat]) : parseCoords(o.link) || parseCoords(o.address);
    o.type = parseType(o.type, o.name);
    Object.assign(o, parseSize(o));
    o.name = String(o.name || o.address || '').trim();
    o.code = o.code != null && o.code !== '' ? String(o.code).trim() : null;
    return o;
  }).filter(o => o.name || o.coords);
  return { rows, fields: [...new Set(Object.values(map))] };
}

// ── matching an uploaded row to a structure already on the map ──
const KY = 110540, KX = lat => 111320 * Math.cos(lat * Math.PI / 180);
export const meters = (a, b) => Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX(a[0]));
const STOPW = new Set(['بزرگراه', 'خیابان', 'بلوار', 'پل', 'عابر', 'تقاطع', 'به', 'سمت', 'از', 'شهید', 'روبروی', 'مسیر', 'بیلبورد', 'تابلو', 'و', 'در', 'قبل', 'بعد', 'نرسیده', 'عرشه']);
const words = s => new Set(nfa(s).split(/[\s،,\-–()]+/).filter(w => w.length > 1 && !STOPW.has(w)));
export function nameSim(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => { if (B.has(w)) n++; }); return n / Math.min(A.size, B.size); }

/** best existing structure for a row: same code, or close by with the same kind and a similar name */
export function matchRow(row, items, { exact = true } = {}) {
  const tc = row.code && row.code.replace(/\s/g, '');
  if (tc) { const hit = items.find(x => x.code && String(x.code).replace(/\s/g, '') === tc && (!row.owner || !x.owner || nfa(x.owner) === nfa(row.owner))); if (hit) return { item: hit, how: 'کد', d: row.coords ? meters(row.coords, [hit.lat, hit.lng]) : null }; }
  if (!row.coords) return null;
  const isBridge = row.type === 'bridge';
  let best = null;
  for (const x of items) {
    if (x.lat == null) continue;
    const d = meters(row.coords, [x.lat, x.lng]);
    if (d > (exact ? 250 : 600)) continue;
    if ((x.type === 'bridge') !== isBridge) continue;
    const sim = nameSim(row.name + ' ' + (row.address || ''), (x.name || '') + ' ' + (x.address || ''));
    const ok = exact ? (d <= 60 || (d <= 250 && sim >= 0.5)) : sim >= 0.6;
    if (!ok) continue;
    const score = d - sim * 150;
    if (!best || score < best.score) best = { item: x, how: d <= 60 ? 'مکان' : 'مکان و نام', d, score };
  }
  return best;
}

// ── on the map: uploaded rows on top of the market list ──
/**
 * @param inventory  state.inventory (mutated)
 * @param rows       custom_structures rows of this city
 */
export function applyUploads(inventory, rows) {
  const byId = new Map(inventory.map(x => [x.id, x]));
  const live = new Set();
  let priced = 0, added = 0;
  for (const r of rows) {
    const upd = { uploaded: true, uploadNote: r.batch || '', priceUpdated: r.updated_at };
    if (r.dir) upd.dir = r.dir;
    if (r.w && r.h) { upd.w = r.w; upd.h = r.h; }
    if (r.code) upd.code = r.code;
    if (r.owner) upd.owner = r.owner;
    const it = r.match_id && byId.get(r.match_id);
    if (it) {
      if (r.price && it.priceSource !== 'manual') { Object.assign(upd, { price: r.price, priceSource: 'upload', priceEstimated: false }); priced++; }
      if (r.loc === 'exact' && r.lat != null && !it.userMoved) Object.assign(upd, { lat: r.lat, lng: r.lng, loc: 'upload', approx: false, locNote: '' });
      Object.assign(it, upd);
      continue;
    }
    if (r.lat == null) continue;
    const id = `up:${r.id}`;
    live.add(id);
    const base = { id, name: r.name, address: r.address || '', lat: r.lat, lng: r.lng, type: r.type || 'bulletin', price: r.price || null,
      priceSource: r.price ? 'upload' : null, priceEstimated: false, source: 'upload', loc: r.loc === 'exact' ? 'upload' : 'address',
      approx: r.loc !== 'exact', locNote: r.loc !== 'exact' ? 'مکان از روی نشانی فهرست بارگذاری‌شده' : '', ...upd };
    const old = byId.get(id);
    if (old) { const keep = old.userMoved ? { lat: old.lat, lng: old.lng, loc: 'user', approx: false } : {}; Object.assign(old, base, keep, old.priceSource === 'manual' ? { price: old.price, priceSource: 'manual' } : {}); }
    else { inventory.push(base); added++; }
  }
  // uploaded structures the admin removed
  for (let i = inventory.length - 1; i >= 0; i--) if (inventory[i].source === 'upload' && !live.has(inventory[i].id)) inventory.splice(i, 1);
  return { priced, added };
}
