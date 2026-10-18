// Category campaign engine: from what is being advertised (a Digikala category), find the hotspots where that audience
// gathers and rank billboard structures by how close they sit to those hotspots, combined with the structure's own score.
// Used by the campaign assistant (chat) and the hotspot panel. Pure functions; no network.
import { distToShape } from './hotspots.js';

const KX = 111320 * Math.cos(35.7 * Math.PI / 180), KY = 110540;
const dm = (a, b) => Math.hypot((a.lat - b.lat) * KY, (a.lng - b.lng) * KX);
const toLatin = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

// words that point to each preset (see PRESETS in hotlayer.js)
const WORDS = {
  digital: ['موبایل', 'گوشی', 'لپ‌تاپ', 'لپتاپ', 'لپ تاپ', 'دیجیتال', 'کامپیوتر', 'تبلت', 'هدفون', 'هندزفری', 'ساعت هوشمند', 'کنسول', 'آیفون', 'سامسونگ', 'شیائومی', 'گجت', 'الکترونیک'],
  appliance: ['لوازم خانگی', 'یخچال', 'لباسشویی', 'ظرفشویی', 'تلویزیون', 'جاروبرقی', 'کولر', 'اجاق', 'مایکروویو', 'برقی', 'اسپلیت', 'بخاری'],
  home: ['خانه', 'آشپزخانه', 'مبل', 'دکور', 'ظروف', 'فرش', 'روشنایی', 'لوستر', 'دکوراسیون', 'سرویس خواب', 'پرده'],
  fashion: ['پوشاک', 'لباس', 'کفش', 'کیف', 'طلا', 'جواهر', 'اکسسوری', 'مانتو', 'فشن', 'ساعت مچی'],
  beauty: ['آرایشی', 'بهداشتی', 'عطر', 'ادکلن', 'پوست', 'سلامت', 'دارو', 'مکمل', 'آرایش', 'شوینده', 'شامپو'],
  fmcg: ['سوپرمارکت', 'خوراکی', 'مواد غذایی', 'غذا', 'نوشیدنی', 'خواربار', 'دیجی‌کالا فرش', 'دیجیکالا فرش', 'fresh', 'میوه', 'لبنیات', 'تنقلات', 'کالای اساسی'],
  kids: ['کودک', 'بچه', 'نوزاد', 'اسباب‌بازی', 'اسباب بازی', 'مادر', 'سیسمونی', 'پوشک'],
  sport: ['ورزش', 'ورزشی', 'سفر', 'کمپینگ', 'دوچرخه', 'کوهنوردی', 'فیتنس', 'باشگاه', 'تناسب اندام'],
  books: ['کتاب', 'لوازم‌التحریر', 'لوازم التحریر', 'نوشت‌افزار', 'هنر', 'موسیقی', 'ساز موسیقی', 'بازگشایی مدارس', 'مدرسه'],
  tools: ['ابزار', 'صنعتی', 'تجهیزات', 'دریل', 'یراق'],
  auto: ['خودرو', 'ماشین', 'موتور', 'لاستیک', 'قطعات', 'لوازم یدکی', 'روغن موتور'],
  pet: ['حیوان', 'حیوانات', 'پت‌شاپ', 'پت شاپ', 'سگ', 'گربه'],
  youth: ['جوان', 'دانشجو', 'نوجوان', 'نسل z', 'gen z'],
  b2b: ['سازمانی', 'شرکتی', 'b2b', 'کارمند', 'شاغل', 'اداری', 'بیزینس', 'کسب‌وکار', 'کسب و کار'],
  reach: ['آگاهی', 'برندینگ', 'عمومی', 'حداکثر دیده', 'رفت‌وآمد', 'پربازدید'],
};

// read category, budget, months, districts and number of boards from free Persian text
export function parseBrief(text) {
  const t = toLatin(text || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  let preset = null, best = 0;
  for (const [k, ws] of Object.entries(WORDS)) {
    const hits = ws.filter(w => new RegExp(`(?:^|[\\s،,.!؟?:؛()«»"'\\-])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)).length;
    if (hits > best) { best = hits; preset = k; }
  }
  // budget: «2 میلیارد»، «800 میلیون»، «1.5 میلیارد تومان»
  let budget = null;
  const bm = t.match(/(\d+(?:[.,/٫]\d+)?)\s*(میلیارد|میلیون|هزار)/);
  if (bm) budget = parseFloat(bm[1].replace(/[,/٫]/, '.')) * ({ میلیارد: 1e9, میلیون: 1e6, هزار: 1e3 })[bm[2]];
  const mm = t.match(/(\d+)\s*ماه/), wm = t.match(/(\d+)\s*هفته/);
  const months = mm ? +mm[1] : wm ? Math.max(1, Math.round(+wm[1] / 4.3)) : null;
  // «منطقه 3»، «مناطق 2، 5 و 22» — a number followed by a unit (تا، بیلبورد، میلیون…) is not a district
  const districts = [], UNIT = /^\s*(?:تا|عدد|بیلبورد|سازه|تابلو|میلیون|میلیارد|هزار|ماه|هفته|روز|درصد|٪)/;
  for (const m of t.matchAll(/(?:منطقه|مناطق)\s*/g)) {
    let rest = t.slice(m.index + m[0].length);
    for (;;) {
      const n = rest.match(/^(\d{1,2})(?!\d)/); if (!n || UNIT.test(rest.slice(n[1].length))) break;
      districts.push(+n[1]); rest = rest.slice(n[1].length);
      const sep = rest.match(/^\s*(?:،|,|و)\s*/); if (!sep) break; rest = rest.slice(sep[0].length);
    }
  }
  const andMore = [];
  const cm = t.match(/(\d+)\s*(?:تا\s*)?(?:بیلبورد|سازه|تابلو)/);
  return { preset, budget, months, districts: [...new Set([...districts, ...andMore])].filter(n => n >= 1 && n <= 22), count: cm ? +cm[1] : null };
}

// proximity weight of a structure to a hotspot shape
const prox = d => (d <= 0 ? 1 : d <= 250 ? 0.85 : d <= 900 ? 0.15 + 0.55 * (1 - (d - 250) / 650) : 0);

/**
 * @param {object} o { preset, hotspots, structures, structInfo, rings, districtOf, districts, budget, months, count }
 * @returns {{ spots, boards, plan, total }}
 */
export function planCampaign(o) {
  const { preset, hotspots, structures, structInfo, rings, districtOf } = o;
  const inP = h => preset.types.includes(h.t) && (h.t !== 'bourse' || !preset.subs.length || preset.subs.includes(h.sub));
  const inD = (lat, lng) => !o.districts?.length || o.districts.includes(districtOf(lat, lng));
  const spots = hotspots.filter(h => inP(h) && inD(h.lat, h.lng)).sort((a, b) => b.score - a.score);
  const strong = spots.filter(h => h.lvl >= 2).length >= 6 ? spots.filter(h => h.lvl >= 2) : spots;

  const boards = [];
  structures.forEach(st => {
    if (!inD(st.lat, st.lng)) return;
    let fit = 0, why = null, whyW = 0;
    for (const h of strong) {
      if (dm(h, st) > h.r + 920) continue;
      const d = distToShape(rings(h), st), w = (h.score / 100) * prox(d);
      if (w > 0) { fit += w; if (w > whyW) { whyW = w; why = { h, d: Math.round(d) }; } }
    }
    if (!fit) return;
    const info = structInfo(st);
    boards.push({ st, fit, why, score: info.score, valueIdx: info.valueIdx, imp: info.imp, price: st.price || null });
  });
  const maxFit = Math.max(1e-9, ...boards.map(b => b.fit));
  boards.forEach(b => {
    b.fitPct = Math.round(100 * Math.min(1, b.fit / maxFit) ** 0.6);
    b.total = Math.round(b.score != null ? 0.6 * b.fitPct + 0.4 * b.score : b.fitPct);
  });
  boards.sort((a, b) => b.total - a.total || (a.price || Infinity) - (b.price || Infinity));

  // budget plan: best boards first, skipping ones that no longer fit the budget; no two boards within 300 m
  const months = o.months || 1, plan = [];
  let spent = 0;
  const cap = o.count || (o.budget ? 40 : 8);
  for (const b of boards) {
    if (plan.length >= cap) break;
    if (plan.some(p => dm(p.st, b.st) < 300)) continue;
    const cost = (b.price || 0) * months;
    if (o.budget && b.price && spent + cost > o.budget) continue;
    if (o.budget && !b.price) continue;
    plan.push(b); spent += cost;
  }
  return { spots, boards, plan, spent, months };
}

export const fmtToman = v => v == null ? '—' : v >= 1e9 ? `${+(v / 1e9).toFixed(2)} میلیارد` : `${Math.round(v / 1e6)} میلیون`;
