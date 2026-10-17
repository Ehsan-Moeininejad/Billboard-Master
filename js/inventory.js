// Inventory of existing billboard structures: imported lists, manual pins, OSM finds.
import { parseNum } from './fmt.js';

const KEY = 'billboard-insight:inventory:v2';
export const TYPE_FA = { bridge: 'پل عابر', bulletin: 'بیلبورد', poster: 'استرابورد', digital: 'دیجیتال', rooftop: 'پشت‌بامی', ad: 'تابلو OSM' };
export const SOURCE_FA = { import: 'واردشده', manual: 'ثبت دستی', osm: 'OpenStreetMap', demo: 'نمونه دمو', catalog: 'کاتالوگ', market: 'بازار' };

export function loadInventory() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; }
}
export function saveInventory(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.filter(x => x.source !== 'osm'))); } catch { /* memory only */ }
}

const HEAD = {
  name: ['name', 'title', 'نام', 'عنوان', 'سازه', 'نام سازه', 'محل'],
  lat: ['lat', 'latitude', 'عرض', 'عرض جغرافیایی', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'طول', 'طول جغرافیایی', 'x'],
  address: ['address', 'آدرس', 'نشانی', 'موقعیت'],
  type: ['type', 'نوع', 'نوع سازه', 'قالب'],
  owner: ['owner', 'مالک', 'مجری', 'شرکت'],
  price: ['price', 'قیمت', 'قیمت لیست', 'اجاره', 'اجاره ماهانه', 'تعرفه'],
  size: ['size', 'ابعاد', 'اندازه'],
  negotiated: ['negotiated', 'قیمت مذاکره', 'قیمت مذاکره‌شده', 'قیمت توافقی', 'قیمت نهایی'],
  id: ['id', 'کد', 'شناسه', 'کد سازه'],
};
const TYPE_WORDS = [
  ['bridge', ['پل', 'عرشه', 'bridge']],
  ['digital', ['دیجیتال', 'تلویزیون', 'led', 'digital']],
  ['rooftop', ['پشت بام', 'پشت‌بام', 'نما', 'rooftop']],
  ['poster', ['استرابورد', 'پوستر', 'poster', 'mupi']],
  ['bulletin', ['بیلبورد', 'billboard', 'بزرگراهی']],
];
export function guessType(text = '') {
  const t = String(text).toLowerCase();
  for (const [k, words] of TYPE_WORDS) if (words.some(w => t.includes(w))) return k;
  return 'bulletin';
}

/** Parse pasted Excel rows or a CSV/TSV file into rows. Header row optional. */
export function parseTable(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const split = l => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim()); return out;
  };
  const rows = lines.map(split);
  const norm = s => s.replace(/[‌\s_]+/g, ' ').trim().toLowerCase();
  const head = rows[0].map(norm);
  const idx = {};
  for (const [k, names] of Object.entries(HEAD)) {
    const i = head.findIndex(h => names.some(n => norm(n) === h));
    if (i >= 0) idx[k] = i;
  }
  const hasHeader = Object.keys(idx).length > 0;
  if (!hasHeader) { idx.name = 0; if (rows[0].length >= 3) { idx.lat = 1; idx.lng = 2; } }
  return rows.slice(hasHeader ? 1 : 0).map(r => {
    const get = k => idx[k] != null ? r[idx[k]] : '';
    const lat = parseNum(get('lat')), lng = parseNum(get('lng'));
    const name = get('name') || get('address');
    return {
      name, address: get('address'), owner: get('owner'), size: get('size'),
      type: guessType(`${get('type')} ${name}`), price: parseNum(get('price')), negotiated: parseNum(get('negotiated')), id: get('id') || undefined,
      lat: lat > 30 && lat < 40 ? lat : null, lng: lng > 45 && lng < 60 ? lng : null,
    };
  }).filter(r => r.name || (r.lat && r.lng));
}
