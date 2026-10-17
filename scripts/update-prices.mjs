// Nightly price snapshot: reads data/price-sources.json, writes data/prices.json and appends
// data/price-history.csv. Run weekly by .github/workflows/data.yml (or `node scripts/update-prices.mjs`).
//
// Supported source types:
//   csv  — any CSV URL (e.g. Google Sheets → File → Share → Publish to web → CSV)
//   json — an array of rows, or { items: [...] }
// Agency websites can be added as new types, but only where the site's terms allow automated reading.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('data/price-sources.json', 'utf8'));
const HEAD = {
  id: ['id', 'کد', 'شناسه', 'کد سازه'], name: ['name', 'نام', 'نام سازه', 'عنوان'],
  lat: ['lat', 'latitude', 'عرض', 'عرض جغرافیایی'], lng: ['lng', 'lon', 'longitude', 'طول', 'طول جغرافیایی'],
  owner: ['owner', 'مالک', 'مجری', 'شرکت'], type: ['type', 'نوع', 'نوع سازه'],
  price: ['price', 'قیمت', 'قیمت لیست', 'اجاره ماهانه', 'تعرفه'], negotiated: ['negotiated', 'قیمت مذاکره', 'قیمت مذاکره‌شده', 'قیمت توافقی'],
};
const norm = s => String(s || '').replace(/[‌\s_]+/g, ' ').trim().toLowerCase();
const digits = s => String(s ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[,،٬\s]/g, '');

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  const split = l => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c.trim()); c = ''; } else c += ch; } o.push(c.trim()); return o; };
  const rows = lines.map(split); const head = rows[0].map(norm); const idx = {};
  for (const [k, names] of Object.entries(HEAD)) { const i = head.findIndex(h => names.some(n => norm(n) === h)); if (i >= 0) idx[k] = i; }
  return rows.slice(1).map(r => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i]])));
}

const items = [], report = [];
for (const s of cfg.sources.filter(s => s.enabled && s.url)) {
  try {
    const res = await fetch(s.url, { headers: { 'User-Agent': 'billboard-insight-price-job' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let rows = s.type === 'json' ? (j => Array.isArray(j) ? j : j.items || [])(JSON.parse(text)) : parseCSV(text);
    rows = rows.map(r => ({ ...r, price: Number(digits(r.price)) || null, negotiated: Number(digits(r.negotiated)) || null, source: s.name }))
      .filter(r => r.price && (r.name || r.id));
    items.push(...rows); report.push({ name: s.name, ok: true, count: rows.length });
  } catch (e) { report.push({ name: s.name, ok: false, error: String(e.message || e) }); }
}

const updatedAt = new Date().toISOString();
const prev = existsSync('data/prices.json') ? JSON.parse(readFileSync('data/prices.json', 'utf8')) : { items: [] };
// keep yesterday's rows for sources that failed today
const failed = new Set(report.filter(r => !r.ok).map(r => r.name));
const kept = (prev.items || []).filter(r => failed.has(r.source));
const out = { updatedAt, sources: report, items: [...items, ...kept] };
writeFileSync('data/prices.json', JSON.stringify(out, null, 1));
if (!existsSync('data/price-history.csv')) writeFileSync('data/price-history.csv', 'date,source,id,name,owner,price,negotiated\n');
appendFileSync('data/price-history.csv', items.map(r => [updatedAt.slice(0, 10), r.source, r.id || '', `"${String(r.name || '').replace(/"/g, '""')}"`, r.owner || '', r.price, r.negotiated || ''].join(',')).join('\n') + (items.length ? '\n' : ''));
console.log(JSON.stringify(report));
