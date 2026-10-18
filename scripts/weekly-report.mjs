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
  [okw(env.PRICES_OUTCOME) ? '✓' : '!', 'فید قیمت تیم', okw(env.PRICES_OUTCOME) ? 'اجرا شد (اگر منبعی در data/price-sources.json فعال باشد).' : 'خطا داد؛ قیمت‌های تیم تغییر نکرد.'],
  [okw(env.COMMIT_OUTCOME) ? '✓' : '✗', 'ذخیره و انتشار سایت', okw(env.COMMIT_OUTCOME) ? 'داده ذخیره شد و انتشار دوباره سایت شروع شد.' : 'ذخیره یا انتشار خطا داد؛ سایت داده قبلی را نشان می‌دهد.'],
];
const failed = rows.some(r => r[0] === '✗');
const warn = rows.some(r => r[0] === '!');

const alerts = [];
if (scrapedAge != null && scrapedAge > 45) alerts.push(`قیمت‌ها ${num(scrapedAge)} روز است در منبع (Rasamap) تازه نشده‌اند. برای قیمت قطعی پیش از خرید استعلام بگیرید یا فید قیمت تیم را وصل کنید.`);
if (prev && !added.length && !removed.length && !moves.length) alerts.push('این هفته در فهرست و قیمت‌ها تغییری نبود (منبع داده‌اش را تازه نکرده است).');
if (!prev) alerts.push('اولین گزارش است؛ مقایسه با هفته قبل از گزارش بعدی شروع می‌شود.');

// ── html (email-safe: tables, inline styles, light only) ───
const C = { ink: '#1A2233', muted: '#6B7588', line: '#E4E8EF', soft: '#F5F7FB', accent: '#3D6FE8', good: '#12A37F', warn: '#C98A06', bad: '#D64545' };
const mark = s => `<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:11px;font-weight:700;color:#fff;background:${s === '✓' ? C.good : s === '✗' ? C.bad : s === '!' ? C.warn : C.muted}">${s === '—' ? '–' : s}</span>`;
const kpi = (label, value, sub) => `<td style="padding:12px;background:${C.soft};border-radius:10px;width:33%;vertical-align:top"><div style="font-size:12px;color:${C.muted}">${label}</div><div style="font-size:20px;font-weight:700;color:${C.ink};margin-top:2px">${value}</div>${sub ? `<div style="font-size:12px;color:${C.muted};margin-top:2px">${sub}</div>` : ''}</td>`;
const list = (title, items, fmt, more) => !items.length ? '' : `
  <h3 style="font-size:15px;margin:22px 0 8px;color:${C.ink}">${title}</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${items.map(fmt).join('')}</table>
  ${more > 0 ? `<div style="font-size:12px;color:${C.muted};margin-top:6px">و ${num(more)} مورد دیگر</div>` : ''}`;
const line = (a, b) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-size:13.5px;color:${C.ink}">${a}</td><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-size:13px;color:${C.muted};text-align:left;white-space:nowrap">${b}</td></tr>`;
const meta = x => [TYPE[x.type] || 'سازه', district(x), x.owner].filter(Boolean).map(esc).join(' · ');

const today = fa.format(new Date());
const subject = `بیلبوردسنج | به‌روزرسانی هفتگی ${today}${failed ? ' — با خطا' : warn ? ' — با هشدار' : ''}`;
const deltaN = prev ? now.items.length - prev.items.length : null;
const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.soft}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:14px;border:1px solid ${C.line};font-family:Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl;text-align:right">
<tr><td style="padding:22px 24px 6px">
  <div style="font-size:12px;color:${C.muted}">بیلبوردسنج · Billboard-Master</div>
  <h1 style="font-size:20px;margin:4px 0 2px;color:${C.ink}">به‌روزرسانی هفتگی ${today}</h1>
  <div style="font-size:13px;color:${failed ? C.bad : warn ? C.warn : C.good};font-weight:700">${failed ? 'بخشی از به‌روزرسانی خطا داد' : warn ? 'انجام شد، با هشدار' : 'همه بخش‌ها انجام شد'}</div>
</td></tr>
<tr><td style="padding:10px 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
    ${kpi('سازه‌ها', num(now.items.length), deltaN == null ? '' : deltaN === 0 ? 'بدون تغییر' : `${deltaN > 0 ? '+' : ''}${num(deltaN)} نسبت به هفته قبل`)}
    ${kpi('میانه اجاره ماهانه', toman(medNow) + ' تومان', medPrev && medNow ? `${pct(medNow / medPrev - 1)} نسبت به هفته قبل` : '')}
    ${kpi('داده ترافیک نشان', `${num(covered)} سازه`, run?.refreshed ? `${num(run.refreshed)} نقطه این هفته` : '')}
  </tr></table>
</td></tr>
<tr><td style="padding:4px 24px 8px">
  <h3 style="font-size:15px;margin:14px 0 8px;color:${C.ink}">وضعیت اجرا</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
  ${rows.map(([s, t, d]) => `<tr><td style="padding:8px 0 8px 10px;border-bottom:1px solid ${C.line};width:26px;vertical-align:top">${mark(s)}</td><td style="padding:8px 0;border-bottom:1px solid ${C.line}"><div style="font-size:13.5px;font-weight:700;color:${C.ink}">${t}</div><div style="font-size:12.5px;color:${C.muted};line-height:1.7">${esc(d)}</div></td></tr>`).join('')}
  </table>
  ${alerts.length ? `<div style="margin-top:14px;padding:10px 12px;border-radius:10px;background:#FFF8E6;border:1px solid #F3DFA8;font-size:13px;color:#6B4E00;line-height:1.8">${alerts.map(esc).join('<br>')}</div>` : ''}
  ${list(`سازه‌های جدید (${num(added.length)})`, added.slice(0, 10), x => line(`${esc(x.name)}<div style="font-size:12px;color:${C.muted}">${meta(x)}</div>`, x.price ? toman(x.price) + ' تومان' : 'بدون قیمت'), added.length - 10)}
  ${list(`حذف‌شده از بازار (${num(removed.length)})`, removed.slice(0, 10), x => line(`${esc(x.name)}<div style="font-size:12px;color:${C.muted}">${meta(x)}</div>`, x.price ? toman(x.price) + ' تومان' : ''), removed.length - 10)}
  ${list(`تغییر قیمت (${num(moves.length)} سازه)`, [...moves.slice(0, 5), ...moves.slice(-5).filter(m => !moves.slice(0, 5).includes(m))].filter((m, i, a) => a.indexOf(m) === i),
    m => line(`${esc(m.x.name)}<div style="font-size:12px;color:${C.muted}">${meta(m.x)}</div>`, `${toman(m.from)} ← ${toman(m.x.price)} <b style="color:${m.d > 0 ? C.bad : C.good}">${pct(m.d)}</b>`), 0)}
</td></tr>
<tr><td style="padding:16px 24px 24px">
  <a href="${SITE}" style="display:inline-block;background:${C.accent};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px">باز کردن بیلبوردسنج</a>
  ${RUN ? `<a href="${RUN}" style="display:inline-block;margin-right:10px;color:${C.accent};font-size:13px;text-decoration:none">جزئیات اجرا در گیت‌هاب</a>` : ''}
  <div style="font-size:11.5px;color:${C.muted};margin-top:14px;line-height:1.7">قیمت‌ها از آگهی‌های عمومی اجاره بیلبورد (مجموعه‌داده Rasamap) هستند${scraped ? `؛ آخرین برداشت منبع ${fa.format(new Date(scraped))}` : ''}. این ایمیل هر هفته بعد از به‌روزرسانی خودکار فرستاده می‌شود.</div>
</td></tr>
</table></td></tr></table></body></html>`;

mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/report.html', html);
writeFileSync('.cache/report-subject.txt', subject);
console.log(subject);
console.log(`added ${added.length}, removed ${removed.length}, price changes ${moves.length}, neshan ${covered}`);
