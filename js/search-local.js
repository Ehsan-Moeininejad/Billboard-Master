// Search inside the site's own data: structures, roads and districts, understood from a Persian sentence.
//   «بیلبوردهای همت شرق به غرب»  → road همت, traffic heading west
//   «پل عابرهای منطقه 3»          → type bridge, district 3
//   «ارزان‌ترین سازه‌های مدرس رسش» → road مدرس, owner رسش, sorted by cost per impression
// Pure functions; app.js applies the result to the map and the structure list.

export const normFa = s => String(s || '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه').replace(/[أإآ]/g, 'ا')
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[ً-ْـ]/g, '').toLowerCase();
const tight = s => normFa(s).replace(/[\s‌‍\-–_.,،()«»"']/g, '');

// traffic direction: the way the cars drive (the face looks at them)
const DIRS = [
  { re: /(شرق|خاور)\s*(به|تا|-|–|→|>)?\s*(سمت\s*)?(غرب|باختر)/, b: 270, fa: 'شرق به غرب' },
  { re: /(غرب|باختر)\s*(به|تا|-|–|→|>)?\s*(سمت\s*)?(شرق|خاور)/, b: 90, fa: 'غرب به شرق' },
  { re: /شمال\s*(به|تا|-|–|→|>)?\s*(سمت\s*)?جنوب/, b: 180, fa: 'شمال به جنوب' },
  { re: /جنوب\s*(به|تا|-|–|→|>)?\s*(سمت\s*)?شمال/, b: 0, fa: 'جنوب به شمال' },
  { re: /(به\s*سمت|رو\s*به|سمت|بطرف|به\s*طرف)\s*غرب/, b: 270, fa: 'به سمت غرب' },
  { re: /(به\s*سمت|رو\s*به|سمت|بطرف|به\s*طرف)\s*شرق/, b: 90, fa: 'به سمت شرق' },
  { re: /(به\s*سمت|رو\s*به|سمت|بطرف|به\s*طرف)\s*شمال/, b: 0, fa: 'به سمت شمال' },
  { re: /(به\s*سمت|رو\s*به|سمت|بطرف|به\s*طرف)\s*جنوب/, b: 180, fa: 'به سمت جنوب' },
];
const TYPES = [
  { re: /(پل\s*(های)?\s*عابر|عرشه|پل\s*(ها|های)?(?=\s|$))/, t: 'bridge', fa: 'پل عابر' },
  { re: /(استرابورد|استند|تابلو\s*متوسط)/, t: 'poster', fa: 'استرابورد' },
  { re: /(تلویزیون\s*شهری|دیجیتال|ال\s*ای\s*دی|led|نمایشگر)/, t: 'digital', fa: 'دیجیتال' },
];
const SORTS = [
  { re: /ارزان\s*(ترین|تر)?|کم\s*هزینه|هزینه\s*هر\s*ایمپرشن/, s: 'cpm', fa: 'ارزان‌ترین' },
  { re: /پر\s*بازدید|بیشترین\s*(ایمپرشن|بازدید)|پرترافیک|پر\s*تردد/, s: 'imp', fa: 'پربازدیدترین' },
  { re: /ارزش\s*خرید|به\s*صرفه/, s: 'value', fa: 'بهترین ارزش خرید' },
];
// words that carry no place: removed before matching the road name
const STOP = /(^|\s)(بیلبورد|بیلبوردهای|بیلبوردها|بیلبوردای|سازه|سازه‌ها|سازه‌های|سازه ها|سازه های|سازه‌ای|تابلو|تابلوها|تابلوهای|تبلیغاتی|تبلیغات|محیطی|های|ها|ی|را|رو|نشان|نشون|بده|بدید|بیار|لیست|فهرست|همه|همه‌ی|تمام|در|توی|تو|داخل|مسیر|بزرگراه|اتوبان|خیابان|خیابون|بلوار|آزادراه|جاده|شهید|کنار|روی|اطراف|حوالی|نزدیک|برای|من|که|با|و|یا|از|به|سمت|جهت|ترین|بهترین|برترین|کدام|کدوم|هست|هستند|موجود|چی|چه)(?=\s|$)/g;

export function parseQuery(raw, { owners = [] } = {}) {
  let s = ' ' + normFa(raw).replace(/[‌]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const q = { raw: String(raw || '').trim(), labels: [] };
  for (const d of DIRS) { const m = s.match(d.re); if (m) { q.dir = d.b; q.dirFa = d.fa; s = s.replace(m[0], ' '); break; } }
  for (const t of TYPES) { const m = s.match(t.re); if (m) { q.type = t.t; q.typeFa = t.fa; s = s.replace(m[0], ' '); break; } }
  for (const o of SORTS) { const m = s.match(o.re); if (m) { q.sort = o.s; q.sortFa = o.fa; s = s.replace(m[0], ' '); break; } }
  const dm = s.match(/منطقه\s*(\d{1,2})/);
  if (dm) { q.district = +dm[1]; s = s.replace(dm[0], ' '); }
  const ow = owners.find(o => o && tight(s).includes(tight(o)));
  if (ow) { q.owner = ow; s = s.replace(new RegExp(normFa(ow).split(/\s+/).join('\\s*')), ' '); }
  const road = s.replace(STOP, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  if (road.length >= 2) q.road = road;
  if (q.road) q.labels.push(q.road);
  if (q.dirFa) q.labels.push(q.dirFa);
  if (q.typeFa) q.labels.push(q.typeFa);
  if (q.district) q.labels.push(`منطقه ${q.district}`);
  if (q.owner) q.labels.push(q.owner);
  if (q.sortFa) q.labels.push(q.sortFa);
  q.label = q.labels.join(' · ');
  q.structural = !!(q.dir != null || q.type || q.district || q.owner || q.sort);
  return q;
}

const angle = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
/** traffic bearing of an agency direction text («غرب به شرق», «به سمت ونک» → null) */
export function dirOfText(t) { const s = normFa(t); for (const d of DIRS) if (d.re.test(s)) return d.b; return null; }

const roadHit = (e, road) => {
  const hay = tight(`${e.road || ''} ${e.name || ''} ${e.address || ''}`);
  const whole = tight(road);
  if (hay.includes(whole)) return true;
  const words = normFa(road).split(/\s+/).filter(w => w.length >= 2);
  return words.length > 1 && words.every(w => hay.includes(tight(w)));
};

/** does one structure (plan entry or inventory item) match the parsed query? */
export function matches(e, q) {
  if (q.road && !roadHit(e, q.road)) return false;
  if (q.type && !(e.type === q.type || (q.type === 'bulletin' && e.type === 'ad'))) return false;
  if (q.district && e.district !== q.district) return false;
  if (q.owner && tight(e.owner) !== tight(q.owner)) return false;
  if (q.dir != null) {
    const td = e.dir ? dirOfText(e.dir) : null;
    if (td != null) return angle(td, q.dir) < 30;
    if (!e.bearings?.length) return false;
    return e.bearings.some(b => angle(b, q.dir) <= 55);
  }
  return true;
}

/** single structures whose name, code or address contain the whole query */
export function nameHits(list, raw, n = 5) {
  const t = tight(raw);
  if (t.length < 2) return [];
  return list.filter(e => tight(`${e.name} ${e.code || ''} ${e.address || ''}`).includes(t)).slice(0, n);
}

/** distinct road names that contain the query (for «go to road») */
export function roadHits(ways, raw, n = 3) {
  const t = tight(raw);
  if (t.length < 2) return [];
  const seen = new Map();
  for (const w of ways) {
    if (!w.name || !tight(w.name).includes(t)) continue;
    const k = tight(w.name);
    const g = seen.get(k) || { name: w.name, cls: w.cls, pts: [] };
    if (w.line) g.pts.push(w.line[0], w.line[w.line.length - 1], w.line[w.line.length >> 1]);
    seen.set(k, g);
    if (seen.size > 40) break;
  }
  return [...seen.values()].filter(g => g.pts.length).sort((a, b) => b.pts.length - a.pts.length).slice(0, n);
}
