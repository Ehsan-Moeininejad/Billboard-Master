// Weekly email: what the data update did and what changed in the market.
// Inputs: data/market.json (new), .cache/prev-market.json (last week's, copied before the build),
// data/traffic.json, .cache/traffic-run.json (from update-traffic.mjs), data/districts.json (optional),
// and step outcomes in env (MARKET_OUTCOME, ROADS_OUTCOME, TRAFFIC_OUTCOME, PRICES_OUTCOME, COMMIT_OUTCOME).
// Output: .cache/report.html and .cache/report-subject.txt, sent by scripts/send-report.py.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { districtOf } from '../js/districts.js';

const read = (p, d = null) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const now = read('data/market.json', { items: [], stats: {} });
const prev = read('.cache/prev-market.json', null);
const traffic = read('data/traffic.json', null);
const run = read('.cache/traffic-run.json', null);
const districts = read('data/districts.json', null);
const env = process.env;
const SITE = env.PAGE_URL || `https://${(env.GITHUB_REPOSITORY_OWNER || 'ehsan-moeininejad').toLowerCase()}.github.io/${(env.GITHUB_REPOSITORY || '/Billboard-Master').split('/')[1]}/`;
const RUN = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;

const fa = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tehran' });
const num = n => Number(n || 0).toLocaleString('en-US');
const toman = n => {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} میلیارد`;
  return `${Math.round(n / 1e6).toLocaleString('en-US')} میلیون`;
};
const pct = v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.01 ? 1 : 0)}٪`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPE = { bulletin: 'بیلبورد', bridge: 'پل عابر', poster: 'استرابورد', digital: 'دیجیتال', rooftop: 'روی بام' };
const median = a => { const s = a.filter(Boolean).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const district = it => { if (!districts) return null; const n = districtOf(it.lat, it.lng, districts); return n ? `منطقه ${n}` : null; };

// ── changes ────────────────────────────────────────────────
const byId = m => new Map((m?.items || []).map(x => [x.id, x]));
const N = byId(now), P = byId(prev);
const added = prev ? now.items.filter(x => !P.has(x.id)) : [];
const removed = prev ? prev.items.filter(x => !N.has(x.id)) : [];
const moves = prev ? now.items.filter(x => P.has(x.id) && x.price && P.get(x.id).price && x.price !== P.get(x.id).price)
  .map(x => ({ x, from: P.get(x.id).price, d: x.price / P.get(x.id).price - 1 })).sort((a, b) => b.d - a.d) : [];
const medNow = median(now.items.map(x => x.price)), medPrev = prev ? median(prev.items.map(x => x.price)) : null;
const scraped = now.items.map(x => x.priceUpdated).filter(Boolean).sort().pop();
const scrapedAge = scraped ? Math.floor((Date.now() - new Date(scraped).getTime()) / 864e5) : null;
const covered = traffic?.items ? Object.keys(traffic.items).length : 0;

// ── step status ────────────────────────────────────────────
const okw = o => !o || o === 'success';
const cities = read('.cache/cities-run.json');
const TRAFFIC_TXT = {
  nokey: ['—', 'کلید نشان (NESHAN_KEY) هنوز در ریپو نیست؛ ترافیک با مدل برآورد می‌شود.'],
  noroads: ['!', 'معابر از OpenStreetMap نرسید؛ ترافیک این هفته به‌روز نشد و داده قبلی ماند.'],
};
let trafficRow;
if (!okw(env.TRAFFIC_OUTCOME)) trafficRow = ['✗', 'مرحله ترافیک نشان خطا داد؛ داده هفته قبل ماند.'];
else if (!run) trafficRow = ['—', 'اجرا نشد.'];
else if (TRAFFIC_TXT[run.mode]) trafficRow = TRAFFIC_TXT[run.mode];
else if (run.stop) trafficRow = ['!', `نشان اجرا را متوقف کرد (${run.stop}؛ سهمیه یا کلید). ${num(run.refreshed)} نقطه به‌روز شد، بقیه داده قبلی را دارند.`];
else trafficRow = [run.refreshed ? '✓' : '!', `${num(run.refreshed)} نقطه از ${num(run.points)} به‌روز شد با ${num(run.calls)} درخواست (${run.mode === 'historical' ? 'مسیریابی بر پایه الگوهای گذشته' : run.mode === 'analytics' ? 'تحلیل ترافیک' : 'مسیریابی الگوی ترافیکی'}). ${num(covered)} سازه داده نشان دارند.`];

const rows = [
  [okw(env.MARKET_OUTCOME) ? '✓' : '✗', 'فهرست و قیمت بازار', okw(env.MARKET_OUTCOME) ? `${num(now.items.length)} سازه در تهران؛ ${num(now.stats?.ok)} با مختصات منبع، ${num((now.stats?.moved || 0) + (now.stats?.onRoad || 0))} با مکان تقریبی.` : 'ساخت فهرست خطا داد؛ فهرست هفته قبل ماند.'],
  [okw(env.ROADS_OUTCOME) ? '✓' : '!', 'معابر و مناطق (OpenStreetMap)', okw(env.ROADS_OUTCOME) ? 'شبکه معابر و مرز 22 منطقه دوباره ساخته شد.' : 'OpenStreetMap در دسترس نبود؛ بررسی مکان با داده قبلی انجام شد.'],
  [trafficRow[0], 'ترافیک نشان', trafficRow[1]],
  ...(cities ? [[!okw(env.CITIES_OUTCOME) ? '✗' : Object.values(cities.cities).some(c => c.errors.length) ? '!' : '✓', 'شهرهای دیگر',
    !okw(env.CITIES_OUTCOME) ? 'به‌روزرسانی شهرها خطا داد؛ داده قبلی هر شهر ماند. تهران از این مرحله جداست.'
      : `${num(Object.values(cities.manifest?.cities || {}).filter(c => c.ready).length)} شهر آماده؛ معابر و هات‌اسپات این هفته: ${cities.heavy.map(s => cities.cities[s]?.fa).filter(Boolean).join('، ')}.`]] : []),
  [okw(env.PRICES_OUTCOME) ? '✓' : '!', 'فید قیمت تیم', okw(env.PRICES_OUTCOME) ? 'اجرا شد (اگر منبعی در data/price-sources.json فعال باشد).' : 'خطا داد؛ قیمت‌های تیم تغییر نکرد.'],
  [okw(env.COMMIT_OUTCOME) ? '✓' : '✗', 'ذخیره و انتشار سایت', okw(env.COMMIT_OUTCOME) ? 'داده ذخیره شد و انتشار دوباره سایت شروع شد.' : 'ذخیره یا انتشار خطا داد؛ سایت داده قبلی را نشان می‌دهد.'],
];
const failed = rows.some(r => r[0] === '✗');
const warn = rows.some(r => r[0] === '!');

const alerts = [];
if (scrapedAge != null && scrapedAge > 45) alerts.push(`قیمت‌ها ${num(scrapedAge)} روز است در منبع (Rasamap) تازه نشده‌اند. برای قیمت قطعی پیش از خرید استعلام بگیرید یا فید قیمت تیم را وصل کنید.`);
if (prev && !added.length && !removed.length && !moves.length) alerts.push('این هفته در فهرست و قیمت‌ها تغییری نبود (منبع داده‌اش را تازه نکرده است).');
if (!prev) alerts.push('اولین گزارش است؛ مقایسه با هفته قبل از گزارش بعدی شروع می‌شود.');

// ── html ───────────────────────────────────────────────────
// Same visual system as the research-digest email (Digikala red, white cards on light grey) and the same
// email-safe rules: tables only, and font + direction repeated on every cell, because Gmail drops styles
// that would otherwise be inherited from <body>.
const FONT = "Vazirmatn,Vazir,'Vazir Matn',Tahoma,'Segoe UI',Arial,sans-serif";
const C = { red: '#EF4056', redSoft: '#FFF2F4', ink: '#232933', soft: '#4F545C', mute: '#81858B', line: '#E4E4E7', bg: '#F0F0F1',
  good: '#00A049', goodSoft: '#E8F7EE', warn: '#C27C0E', warnSoft: '#FFF6E5', bad: '#D32F2F', badSoft: '#FDECEC' };
const td = (extra = '') => `dir="rtl" style="text-align:right;font-family:${FONT};${extra}"`;
const ltr = s => `<span dir="ltr" style="unicode-bidi:isolate">${s}</span>`;

const STATE = {
  '✓': { c: C.good, bg: C.goodSoft, t: 'انجام شد' },
  '!': { c: C.warn, bg: C.warnSoft, t: 'هشدار' },
  '✗': { c: C.bad, bg: C.badSoft, t: 'خطا' },
  '—': { c: C.mute, bg: C.bg, t: 'غیرفعال' },
};
const badge = s => { const x = STATE[s] || STATE['—']; return `<span style="display:inline-block;background:${x.bg};color:${x.c};font-family:${FONT};font-size:12px;font-weight:bold;padding:2px 10px;border-radius:12px;white-space:nowrap">${x.t}</span>`; };

const section = (title, sub = '') => `<tr><td ${td('padding:26px 0 8px')}>
  <div style="border-right:4px solid ${C.red};padding-right:10px">
    <div style="font-family:${FONT};font-size:17px;font-weight:bold;color:${C.ink};line-height:1.6">${title}</div>
    ${sub ? `<div style="font-family:${FONT};font-size:13px;color:${C.mute};line-height:1.6">${sub}</div>` : ''}
  </div></td></tr>`;
const card = inner => `<tr><td style="padding:4px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${C.line};border-radius:12px">${inner}</table></td></tr>`;
const item = (title, sub, value, last) => `<tr>
  <td ${td(`padding:12px 18px;${last ? '' : `border-bottom:1px solid ${C.line};`}`)}>
    <div style="font-family:${FONT};font-size:14.5px;font-weight:bold;color:${C.ink};line-height:1.7">${title}</div>
    ${sub ? `<div style="font-family:${FONT};font-size:12.5px;color:${C.mute};line-height:1.7">${sub}</div>` : ''}</td>
  <td dir="rtl" style="padding:12px 18px;${last ? '' : `border-bottom:1px solid ${C.line};`}text-align:left;white-space:nowrap;font-family:${FONT};font-size:13px;color:${C.soft}">${value}</td></tr>`;
const listCard = (rowsArr) => card(rowsArr.map((r, k) => item(r[0], r[1], r[2], k === rowsArr.length - 1)).join(''));
const meta = x => [TYPE[x.type] || 'سازه', district(x), x.owner].filter(Boolean).map(esc).join(' · ');
const price = n => n ? `${toman(n)} <span style="color:${C.mute};font-size:12px">تومان</span>` : `<span style="color:${C.mute}">بدون قیمت</span>`;

const today = fa.format(new Date());
const status = failed ? { t: 'بخشی از به‌روزرسانی خطا داد', c: C.bad, bg: C.badSoft } : warn ? { t: 'انجام شد، با هشدار', c: C.warn, bg: C.warnSoft } : { t: 'همه بخش‌ها انجام شد', c: C.good, bg: C.goodSoft };
const subject = `بیلبوردسنج | به‌روزرسانی هفتگی ${today}${failed ? ' | با خطا' : warn ? ' | با هشدار' : ''}`;
const deltaN = prev ? now.items.length - prev.items.length : null;
const kpi = (label, value, sub) => `<td width="33%" valign="top" style="padding:0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};border-radius:10px"><tr><td ${td('padding:12px 14px')}>
  <div style="font-family:${FONT};font-size:12px;color:${C.mute}">${label}</div>
  <div style="font-family:${FONT};font-size:20px;font-weight:800;color:${C.ink};line-height:1.6">${value}</div>
  ${sub ? `<div style="font-family:${FONT};font-size:12px;color:${C.mute}">${sub}</div>` : '<div style="font-size:12px">&nbsp;</div>'}</td></tr></table></td>`;

const topMoves = [...moves.slice(0, 5), ...moves.slice(-5)].filter((m, k, a) => a.indexOf(m) === k);
const rowsHTML = [
  section('وضعیت اجرا', 'هر بخش جدا اجرا می‌شود؛ اگر یکی خطا بدهد بقیه با داده هفته قبل ادامه می‌دهند'),
  card(rows.map(([st, title, desc], k) => `<tr>
    <td ${td(`padding:12px 18px;${k === rows.length - 1 ? '' : `border-bottom:1px solid ${C.line};`}`)}>
      <div style="font-family:${FONT};font-size:14.5px;font-weight:bold;color:${C.ink};line-height:1.7">${title}</div>
      <div style="font-family:${FONT};font-size:13px;color:${C.soft};line-height:1.8">${esc(desc)}</div></td>
    <td valign="top" style="padding:14px 18px;${k === rows.length - 1 ? '' : `border-bottom:1px solid ${C.line};`}text-align:left">${badge(st)}</td></tr>`).join('')),
  alerts.length ? `<tr><td style="padding:10px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.warnSoft};border-radius:10px"><tr><td ${td(`padding:12px 16px;border-right:3px solid ${C.warn};font-size:13.5px;line-height:1.9;color:${C.ink}`)}>${alerts.map(esc).join('<br>')}</td></tr></table></td></tr>` : '',
  added.length ? section(`سازه‌های جدید`, `${num(added.length)} سازه به فهرست بازار اضافه شد${added.length > 10 ? '؛ 10 مورد اول' : ''}`) + listCard(added.slice(0, 10).map(x => [esc(x.name), meta(x), price(x.price)])) : '',
  removed.length ? section(`حذف‌شده از بازار`, `${num(removed.length)} سازه دیگر در فهرست نیست${removed.length > 10 ? '؛ 10 مورد اول' : ''}`) + listCard(removed.slice(0, 10).map(x => [esc(x.name), meta(x), price(x.price)])) : '',
  moves.length ? section('تغییر قیمت', `قیمت ${num(moves.length)} سازه عوض شد؛ بیشترین افزایش و کاهش`) + listCard(topMoves.map(m => [esc(m.x.name), meta(m.x),
    `${toman(m.from)} ← ${toman(m.x.price)}<br><b style="color:${m.d > 0 ? C.bad : C.good};font-size:13.5px">${ltr(pct(m.d))}</b>`])) : '',
  cities ? section('شهرهای دیگر', 'سازه‌ها، قیمت‌ها، مکان‌های نشان و هات‌اسپات‌ها هر هفته؛ معابر و ترافیک نشان هر هفته برای دو شهر') + listCard(Object.entries(cities.cities).map(([slug, c]) => {
    const STEP = { ok: 'به‌روز شد', kept: 'داده قبلی ماند', waiting: 'منتظر ساخت معابر', none: 'ندارد', historical: 'به‌روز شد', typical: 'به‌روز شد', nokey: 'بدون کلید', fresh: 'تازه است', partial: 'در حال تکمیل', stopped: 'متوقف شد', off: 'خاموش' };
    const parts = [c.steps.market && `سازه‌ها: ${STEP[c.steps.market] || c.steps.market}`, c.steps.roads && `معابر: ${STEP[c.steps.roads] || c.steps.roads}`,
      c.steps.hotspots && `هات‌اسپات‌ها: ${STEP[c.steps.hotspots] || c.steps.hotspots}${c.hotspots ? ` (${num(c.hotspots)})` : ''}`, c.steps.traffic && `ترافیک: ${STEP[c.steps.traffic] || c.steps.traffic}`,
      c.steps.places && `مکان‌های نشان: ${STEP[c.steps.places] || c.steps.places}${c.places != null ? ` (${num(c.places)}${c.placesLeft ? `، ${num(c.placesLeft)} جستجوی مانده` : ''})` : ''}`,
      c.steps.zones && `مناطق از نشان: ${STEP[c.steps.zones] || c.steps.zones}`, c.byAddress ? `${num(c.byAddress)} سازه از روی نشانی` : '',
      c.errors.length && `خطا: ${c.errors.join('، ')}`].filter(Boolean).join(' · ');
    const d = c.count != null && c.prevCount != null ? c.count - c.prevCount : null;
    return [esc(c.fa), esc(parts), c.count != null ? `${num(c.count)} سازه${d ? ` <span style="color:${C.mute};font-size:12px">${ltr(`${d > 0 ? '+' : ''}${d}`)}</span>` : ''}` : '—'];
  })) : '',
].join('');

const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;800&display=swap" rel="stylesheet">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">

<tr><td style="background:#ffffff;border-radius:12px 12px 0 0;border-bottom:3px solid ${C.red}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td ${td(`padding:16px 22px;font-size:19px;font-weight:800;color:${C.red}`)}>بیلبوردسنج</td>
    <td dir="ltr" style="padding:16px 22px;text-align:left;font-family:${FONT};font-size:12.5px;color:${C.mute}">Billboard-Master · Weekly update</td>
  </tr></table>
</td></tr>

<tr><td ${td('background:#ffffff;padding:20px 22px 22px;border-radius:0 0 12px 12px')}>
  <div style="font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink};line-height:1.5">به‌روزرسانی هفتگی ${today}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>
    <td style="background:${status.bg};border-radius:8px;padding:7px 14px;font-family:${FONT};font-size:13px;font-weight:bold;color:${status.c}">${status.t}</td>
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>
    ${kpi('سازه‌های تهران', num(now.items.length), deltaN == null ? '' : deltaN === 0 ? 'بدون تغییر نسبت به هفته قبل' : `${ltr((deltaN > 0 ? '+' : '') + num(deltaN))} نسبت به هفته قبل`)}
    ${kpi('میانه اجاره ماهانه', `${toman(medNow)}`, medPrev && medNow ? `${ltr(pct(medNow / medPrev - 1))} نسبت به هفته قبل` : 'تومان')}
    ${kpi('داده ترافیک نشان', `${num(covered)} سازه`, run?.refreshed ? `${num(run.refreshed)} نقطه این هفته` : '')}
  </tr></table>
</td></tr>

<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHTML}</table></td></tr>

<tr><td align="center" style="padding:26px 0 8px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.red};border-radius:10px">
    <a href="${SITE}" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">باز کردن بیلبوردسنج</a>
  </td></tr></table>
  ${RUN ? `<div style="margin-top:12px;font-family:${FONT};font-size:12.5px"><a href="${RUN}" style="color:${C.mute}">جزئیات این اجرا در گیت‌هاب</a></div>` : ''}
</td></tr>
<tr><td ${td(`padding:14px 0 6px;text-align:center;font-size:11.5px;line-height:1.8;color:${C.mute}`)}>قیمت‌ها از آگهی‌های عمومی اجاره بیلبورد (مجموعه‌داده Rasamap) هستند${scraped ? `؛ آخرین برداشت منبع ${fa.format(new Date(scraped))}` : ''}. ترافیک از API نشان و مدل ترافیک تهران. این ایمیل هر هفته بعد از به‌روزرسانی خودکار فرستاده می‌شود.</td></tr>

</table></td></tr></table></body></html>`;

mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/report.html', html);
writeFileSync('.cache/report-subject.txt', subject);
console.log(subject);
console.log(`added ${added.length}, removed ${removed.length}, price changes ${moves.length}, neshan ${covered}`);
