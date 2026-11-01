// Admin panel → «سازه‌ها و قیمت‌ها»: upload a billboard list (Excel / CSV), check it against the structures already on
// the map, and save it. Saved rows (table custom_structures) are applied on every page load on top of the monthly
// market list (js/uploads.js), so prices stay current and missing structures stay added.
import { sb, toman, num, faShort, esc, errFa, toast } from './auth.js';
import { ic } from './site-icons.js';
import { CITIES } from './cities.js';
import { normaliseRows, matchRow, meters, nameSim } from './uploads.js';
import { makeGeocoder } from '../scripts/geocode.mjs';

const TYPE_FA = { bulletin: 'بیلبورد', bridge: 'پل عابر', poster: 'استرابورد', digital: 'دیجیتال', rooftop: 'پشت‌بام / نما', ad: 'بیلبورد' };
const dataDir = slug => (slug === 'tehran' ? 'data' : `data/cities/${slug}`);
const X = { city: 'tehran', rows: null, file: '', saved: null, busy: false, progress: '' };

async function getJSON(path) { try { const r = await fetch(path, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch { return null; } }
let xlsxReady = null;
function loadXLSX() {
  xlsxReady ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('کتابخانه اکسل بارگذاری نشد')); document.head.append(s); });
  return xlsxReady;
}
const unpack = a => { const o = []; let la = 0, lo = 0; for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; o.push([la / 1e5, lo / 1e5]); } return o; };

/** geocoder for a city: its gazetteer, or (Tehran) named roads from roads.json as street points */
async function geocoderFor(slug) {
  const c = CITIES[slug];
  let places = (await getJSON(`${dataDir(slug)}/gazetteer.json`))?.places || [];
  if (!places.length) {
    const roads = await getJSON(`${dataDir(slug)}/roads.json`);
    for (const w of roads?.ways || []) {
      if (!w.name) continue;
      const line = unpack(w.line);
      let acc = 150;
      for (let i = 0; i < line.length; i++) {
        if (i) acc += meters(line[i - 1], line[i]);
        if (acc >= 150) { places.push([w.name, 'r', Math.round(line[i][0] * 1e5), Math.round(line[i][1] * 1e5)]); acc = 0; }
      }
    }
  }
  const [[s, w], [n, e]] = c.bounds;
  const inArea = p => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
  const g = places.length ? makeGeocoder(places, { cityName: c.fa, inArea }) : null;
  return { geocode: t => (g ? g(t) : null), inArea };
}
// OpenStreetMap search as the last try (one request a second, as its rules ask)
let lastNom = 0;
async function nominatim(q, slug) {
  const c = CITIES[slug], [[s, w], [n, e]] = c.bounds;
  const wait = 1100 - (Date.now() - lastNom); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNom = Date.now();
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fa&countrycodes=ir&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(`${q} ${c.fa}`)}`;
    const r = await fetch(u); const j = await r.json();
    return j?.[0] ? [+j[0].lat, +j[0].lon] : null;
  } catch { return null; }
}

async function readFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const text = await file.text();
    const XLSX = await loadXLSX();
    const wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  // the first sheet with a name column (the sample's guide sheet is skipped)
  for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); if (rows.length && normaliseRows(rows).fields.includes('name')) return rows; }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

async function loadSaved() {
  const { data, error } = await sb.from('custom_structures').select('*').eq('city', X.city).order('updated_at', { ascending: false }).limit(5000);
  if (error) throw error;
  X.saved = data || [];
}

/** read, place and match every row */
async function analyse(file) {
  X.busy = true; X.file = file.name; X.rows = null; X.progress = 'خواندن فایل…'; draw();
  try {
    const raw = await readFile(file);
    const { rows, fields } = normaliseRows(raw);
    if (!rows.length) throw new Error('ردیفی پیدا نشد. ستون «نام سازه» یا «نشانی» در فایل هست؟');
    if (!fields.includes('price')) toast('ستون قیمت پیدا نشد؛ فقط مکان و مشخصات ثبت می‌شود', '');
    X.progress = 'دریافت فهرست سازه‌های فعلی…'; draw();
    const [market] = await Promise.all([getJSON(`${dataDir(X.city)}/market.json`), loadSaved()]);
    const items = market?.items || [];
    const geo = await geocoderFor(X.city);
    let nomLeft = 60;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      X.progress = `پیدا کردن مکان و تطبیق… ${i + 1} از ${rows.length}`; if (i % 5 === 0) draw();
      r.loc = r.coords ? 'exact' : null;
      if (r.coords && !geo.inArea(r.coords)) { r.warn = 'مختصات بیرون از محدوده این شهر است'; }
      // a code match needs no location
      let m = matchRow(r, items);
      if (!r.coords && !m) {
        const g = geo.geocode(`${r.address || ''} ${r.name}`);
        if (g) { r.coords = [g.lat, g.lng]; r.loc = 'geocoded'; r.via = g.via; }
        else if (nomLeft-- > 0 && (r.address || r.name)) { const p = await nominatim(r.address || r.name, X.city); if (p) { r.coords = p; r.loc = 'geocoded'; r.via = 'جستجوی OpenStreetMap'; } }
        if (r.coords) m = matchRow(r, items, { exact: false });
      }
      if (m) { r.match = m.item; r.matchHow = m.how; if (!r.coords) { r.coords = [m.item.lat, m.item.lng]; r.loc = 'matched'; } }
      // already uploaded before → update that row instead of adding a twin
      r.prev = X.saved.find(s => (r.match && s.match_id === r.match.id) || (r.code && s.code === r.code && (!r.owner || s.owner === r.owner))
        || (!s.match_id && r.coords && s.lat != null && meters(r.coords, [s.lat, s.lng]) < 60 && nameSim(s.name, r.name) >= 0.5)) || null;
      r.status = !r.coords ? 'noloc' : r.match ? 'match' : 'new';
    }
    X.rows = rows; X.progress = '';
  } catch (e) { toast(errFa(e), 'bad'); X.progress = ''; }
  X.busy = false; draw();
}

async function save() {
  const rows = X.rows.filter(r => r.status !== 'noloc' && !r.skip);
  if (!rows.length) return toast('ردیفی برای ثبت نیست', 'bad');
  X.busy = true; X.progress = 'ثبت…'; draw();
  const batch = `${X.file} · ${faShort(new Date())}`, now = new Date().toISOString();
  const rec = r => ({ city: X.city, name: r.name, address: r.address || null, lat: r.coords?.[0] ?? null, lng: r.coords?.[1] ?? null, loc: r.loc, type: r.type,
    dir: r.dir || null, w: r.w || null, h: r.h || null, price: r.price || null, owner: r.owner || null, code: r.code || null, note: r.note || null,
    match_id: r.match?.id || null, active: true, batch, updated_at: now });
  const ins = rows.filter(r => !r.prev).map(rec);
  const upd = rows.filter(r => r.prev).map(r => ({ ...rec(r), id: r.prev.id }));
  try {
    if (ins.length) { const { error } = await sb.from('custom_structures').insert(ins); if (error) throw error; }
    if (upd.length) { const { error } = await sb.from('custom_structures').upsert(upd); if (error) throw error; }
    toast(`${ins.length} ردیف تازه و ${upd.length} به‌روزرسانی ثبت شد؛ با باز کردن دوباره نقشه دیده می‌شود`, 'good');
    X.rows = null; await loadSaved();
  } catch (e) { toast(errFa(e), 'bad'); }
  X.busy = false; X.progress = ''; draw();
}

function csvOf(rows, cols) {
  const text = '﻿' + [cols.map(c => c[0]).join(',')].concat(rows.map(r => cols.map(c => `"${String(c[1](r) ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); return a;
}

let root = null;
function draw() {
  if (!root) return;
  const R = X.rows;
  const cities = Object.entries(CITIES).map(([k, c]) => `<option value="${k}" ${k === X.city ? 'selected' : ''}>${c.fa}</option>`).join('');
  const cnt = R ? { all: R.length, match: R.filter(r => r.status === 'match').length, nw: R.filter(r => r.status === 'new').length, no: R.filter(r => r.status === 'noloc').length, again: R.filter(r => r.prev).length } : null;
  const ST = { match: ['موجود · به‌روزرسانی', 'acc'], new: ['سازه تازه', 'good'], noloc: ['مکان پیدا نشد', 'bad'] };
  const LOC = { exact: 'مختصات فایل', geocoded: 'از نشانی', matched: 'از سازه موجود' };
  const preview = R ? `<div class="card" style="margin-top:16px">
      <h3>پیش‌نمایش «${esc(X.file)}» <span class="chip">${CITIES[X.city].fa}</span></h3>
      <div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="kpi-l">ردیف‌ها</div><div class="kpi-v">${num(cnt.all)}</div></div>
        <div class="kpi"><div class="kpi-l">${ic('check')}سازه موجود</div><div class="kpi-v">${num(cnt.match)}</div><div class="kpi-s">قیمت و مشخصات به‌روز می‌شود</div></div>
        <div class="kpi"><div class="kpi-l">${ic('plus')}سازه تازه</div><div class="kpi-v">${num(cnt.nw)}</div><div class="kpi-s">به نقشه اضافه می‌شود</div></div>
        <div class="kpi"><div class="kpi-l">${ic('alert')}مکان پیدا نشد</div><div class="kpi-v">${num(cnt.no)}</div><div class="kpi-s">مختصات یا لینک نقشه بدهید</div></div>
      </div>
      ${cnt.again ? `<div class="alert" style="margin-bottom:10px">${ic('alert')}<span>${cnt.again} ردیف قبلاً هم بارگذاری شده؛ همان ردیف به‌روز می‌شود، تکراری ساخته نمی‌شود.</span></div>` : ''}
      <div class="tbl-wrap" style="max-height:460px;overflow:auto"><table class="tbl"><thead><tr><th></th><th>ردیف</th><th>نام</th><th>نوع</th><th>قیمت ماهانه</th><th>مکان</th><th>وضعیت</th></tr></thead><tbody>
      ${R.map((r, i) => `<tr style="${r.skip ? 'opacity:.45' : ''}"><td><input type="checkbox" data-skip="${i}" ${r.skip || r.status === 'noloc' ? '' : 'checked'} ${r.status === 'noloc' ? 'disabled' : ''} aria-label="ثبت این ردیف"></td>
        <td>${r.line}</td><td><b>${esc(r.name)}</b>${r.address && r.address !== r.name ? `<br><small style="color:var(--muted)">${esc(r.address)}</small>` : ''}${r.code ? `<br><small class="ltr" style="color:var(--muted)">کد ${esc(r.code)}</small>` : ''}</td>
        <td>${TYPE_FA[r.type] || '—'}${r.w ? `<br><small style="color:var(--muted)">${r.w}×${r.h}</small>` : ''}</td>
        <td>${r.price ? toman(r.price) : '—'}${r.match?.price && r.price && r.match.price !== r.price ? `<br><small style="color:var(--muted)">قبلی: ${toman(r.match.price)}</small>` : ''}</td>
        <td>${r.coords ? `${LOC[r.loc] || ''}${r.via ? `<br><small style="color:var(--muted)">${esc(r.via)}</small>` : ''}` : '—'}${r.warn ? `<br><small style="color:var(--warn)">${esc(r.warn)}</small>` : ''}</td>
        <td><span class="chip ${ST[r.status][1]}">${ST[r.status][0]}</span>${r.match ? `<br><small style="color:var(--muted)">${esc(r.match.name)} · با ${r.matchHow}</small>` : ''}${r.prev ? '<br><small style="color:var(--muted)">قبلاً بارگذاری شده</small>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="inline" style="justify-content:space-between;margin-top:14px">
        <div class="inline">${cnt.no ? `<button class="btn btn-ghost btn-sm" data-x="noloc">${ic('copy')} ردیف‌های بدون مکان (CSV)</button>` : ''}</div>
        <div class="inline"><button class="btn btn-ghost btn-sm" data-x="cancel">انصراف</button><button class="btn btn-primary btn-sm" data-x="save" ${X.busy ? 'disabled' : ''}>${ic('check')} ثبت ${num(R.filter(r => r.status !== 'noloc' && !r.skip).length)} ردیف</button></div>
      </div></div>` : '';
  const saved = X.saved || [];
  const savedHTML = `<div class="card" style="margin-top:16px"><h3>فهرست ثبت‌شده ${CITIES[X.city].fa} <span class="chip">${num(saved.filter(s => s.active).length)} فعال</span></h3>
    ${saved.length ? `<div class="tbl-wrap" style="max-height:460px;overflow:auto"><table class="tbl"><thead><tr><th>نام</th><th>نوع</th><th>قیمت</th><th>روی نقشه</th><th>فایل</th><th>تاریخ</th><th></th></tr></thead><tbody>
      ${saved.map(s => `<tr style="${s.active ? '' : 'opacity:.5'}"><td><b>${esc(s.name)}</b>${s.owner ? `<br><small style="color:var(--muted)">${esc(s.owner)}</small>` : ''}</td><td>${TYPE_FA[s.type] || '—'}</td><td>${s.price ? toman(s.price) : '—'}</td>
        <td>${s.match_id ? '<span class="chip acc">جایگزین سازه موجود</span>' : '<span class="chip good">سازه تازه</span>'}${s.loc === 'geocoded' ? ' <span class="chip warn">مکان تقریبی</span>' : ''}</td>
        <td><small>${esc(s.batch || '')}</small></td><td>${faShort(s.updated_at)}</td>
        <td><div class="inline" style="flex-wrap:nowrap"><button class="btn btn-ghost btn-xs" data-tog="${s.id}">${s.active ? 'خاموش' : 'روشن'}</button><button class="btn btn-danger btn-xs" data-del="${s.id}">${ic('trash')}</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">هنوز فهرستی برای این شهر بارگذاری نشده</div>'}</div>`;
  root.innerHTML = `<div class="page-h"><div><h1>سازه‌ها و قیمت‌ها</h1><p>فهرست بیلبوردها را با اکسل یا CSV بارگذاری کنید: سازه‌های موجود قیمت تازه می‌گیرند و سازه‌های تازه به نقشه اضافه می‌شوند. فهرست بازار ماهانه به‌روز می‌شود و فهرست شما همیشه رویش اعمال می‌شود.</p></div>
      <div class="inline"><a class="btn btn-ghost btn-sm" href="samples/billboards-sample.xlsx" download>${ic('copy')} فایل نمونه اکسل</a><a class="btn btn-ghost btn-sm" href="samples/billboards-sample.csv" download>CSV نمونه</a></div></div>
    <div class="card"><h3>بارگذاری فهرست</h3>
      <div class="grid-form">
        <div class="field"><label for="sc_city">شهر</label><select class="sel inp-sm" id="sc_city">${cities}</select></div>
        <div class="field" style="grid-column:span 2"><label for="sc_file">فایل (xlsx، xls یا csv)</label><input class="inp inp-sm" id="sc_file" type="file" accept=".xlsx,.xls,.csv,text/csv" ${X.busy ? 'disabled' : ''}></div>
      </div>
      <ul style="margin:12px 0 0;padding-inline-start:18px;color:var(--text-2);font-size:12.5px;line-height:2">
        <li>ستون‌های لازم: <b>نام سازه</b> و یکی از <b>نشانی</b>، <b>مختصات</b> (عرض و طول جغرافیایی) یا <b>لینک نقشه</b> (گوگل‌مپ، نشان یا بلد). <b>قیمت ماهانه (تومان)</b> برای به‌روز کردن قیمت.</li>
        <li>مکان حدودی کافی است؛ سازه با کد، یا با نزدیکی و شباهت نام به سازه‌های موجود تطبیق داده می‌شود. ستون «ریال» خودکار به تومان تبدیل می‌شود؛ «4.5 میلیارد» و «450 میلیون» هم خوانده می‌شود.</li>
        <li>بارگذاری دوباره همان فهرست، ردیف‌های قبلی را به‌روز می‌کند و تکراری نمی‌سازد.</li>
      </ul>
      ${X.progress ? `<div class="alert" style="margin-top:12px"><span class="spin" style="border-color:rgba(255,255,255,.2);border-top-color:var(--accent)"></span><span>${esc(X.progress)}</span></div>` : ''}
    </div>${preview}${savedHTML}`;
  root.querySelector('#sc_city').onchange = async e => { X.city = e.target.value; X.rows = null; X.saved = null; draw(); try { await loadSaved(); } catch (er) { toast(errFa(er), 'bad'); } draw(); };
  root.querySelector('#sc_file').onchange = e => { const f = e.target.files?.[0]; if (f) analyse(f); };
  root.querySelectorAll('[data-skip]').forEach(c => { c.onchange = () => { X.rows[+c.dataset.skip].skip = !c.checked; draw(); }; });
  root.querySelector('[data-x="save"]')?.addEventListener('click', save);
  root.querySelector('[data-x="cancel"]')?.addEventListener('click', () => { X.rows = null; draw(); });
  root.querySelector('[data-x="noloc"]')?.addEventListener('click', () => {
    const a = csvOf(X.rows.filter(r => r.status === 'noloc'), [['ردیف', r => r.line], ['نام سازه', r => r.name], ['نشانی', r => r.address], ['عرض جغرافیایی', () => ''], ['طول جغرافیایی', () => ''], ['قیمت ماهانه (تومان)', r => r.price], ['مجری', r => r.owner], ['کد', r => r.code]]);
    a.download = 'بدون-مکان.csv'; a.click();
  });
  root.querySelectorAll('[data-tog]').forEach(b => { b.onclick = async () => { const s = X.saved.find(x => x.id === b.dataset.tog); const { error } = await sb.from('custom_structures').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id); if (error) return toast(errFa(error), 'bad'); await loadSaved(); draw(); }; });
  root.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => { if (!confirm('این ردیف حذف شود؟ اگر جایگزین یک سازه موجود بوده، قیمت بازار برمی‌گردد.')) return; const { error } = await sb.from('custom_structures').delete().eq('id', b.dataset.del); if (error) return toast(errFa(error), 'bad'); await loadSaved(); draw(); }; });
}

export async function structsPage(el) {
  root = el;
  draw();
  if (!X.saved) { try { await loadSaved(); } catch (e) { toast(/custom_structures/.test(e.message || '') ? 'جدول سازه‌ها در Supabase نیست؛ فایل schema.sql را دوباره اجرا کنید' : errFa(e), 'bad'); X.saved = []; } draw(); }
}
