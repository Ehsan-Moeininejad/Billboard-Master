// Places a billboard listing from its address when the source gave no coordinates (or a city-level fallback).
// Used for the cities other than Tehran (Tehran keeps its own landmark logic in build-market.mjs).
//
// The gazetteer (data/cities/<slug>/gazetteer.json, built by build-roads.mjs from OpenStreetMap) holds named
// streets, squares, neighbourhoods and landmarks as points:  [[name, kind, lat×1e5, lng×1e5], …]
//   kind  r street (one point per ~150 m of it)   s square / roundabout   n neighbourhood   l landmark   a airport   t station
//
// An address is read as a set of place names. A square, a neighbourhood or a landmark fixes the point on its own;
// two streets fix it at their crossing; a single long street is not enough and the listing stays unplaced.

const ZW = /[‌‍‎‏]/g;
const DIAC = /[ً-ٰٟـ]/g;
const FA_DIG = '۰۱۲۳۴۵۶۷۸۹', AR_DIG = '٠١٢٣٤٥٦٧٨٩';
export function norm(s) {
  return String(s || '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/[أإ]/g, 'ا').replace(/ؤ/g, 'و')
    .replace(/[۰-۹]/g, d => FA_DIG.indexOf(d)).replace(/[٠-٩]/g, d => AR_DIG.indexOf(d))
    .replace(DIAC, '').replace(ZW, ' ')
    .replace(/[_\-–—،,؛;:.()\[\]«»"'/\\|*+]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// words that describe a place without naming it
const GENERIC = new Set(['خیابان', 'خ', 'بلوار', 'بولوار', 'میدان', 'م', 'فلکه', 'چهارراه', 'چهار', 'راه', 'سه', 'کوچه', 'بزرگراه', 'اتوبان',
  'آزادراه', 'جاده', 'کمربندی', 'پل', 'تقاطع', 'شهرک', 'محله', 'کوی', 'ابتدای', 'ابتدا', 'انتهای', 'انتها', 'ورودی', 'خروجی', 'روبروی', 'روبرو',
  'مقابل', 'جنب', 'نبش', 'بعد', 'قبل', 'از', 'به', 'دید', 'سمت', 'راست', 'چپ', 'وسط', 'اریب', 'شهید', 'دکتر', 'حاج', 'و', 'در', 'تا', 'بین',
  'حدفاصل', 'حد', 'فاصل', 'مسیر', 'رفت', 'برگشت', 'لاین', 'عرشه', 'پیشانی', 'عابر', 'پیاده', 'بیلبورد', 'استرابورد', 'تابلو', 'عدد', 'وجه',
  'شمالی', 'جنوبی', 'شرقی', 'غربی', 'ضلع', 'شمال', 'جنوب', 'شرق', 'غرب', 'سر', 'نرسیده', 'بالای', 'پایین', 'نزدیک', 'مجاور', 'مجاورت',
  'دوطرفه', 'یکطرفه', 'گردان', 'چهاروجهی', 'سه', 'وجهی', 'بلوارهای', 'خیابانهای', 'پمپ', 'بنزین', 'ایستگاه', 'اتوبوس', 'تاکسی', 'کیلومتری',
  'بین', 'المللی', 'الله', 'آیت', 'امامزاده', 'ع', 'ره', 'س', 'ص', 'نو', 'جدید', 'قدیم', 'اصلی', 'فرعی', 'مرکز', 'شهر']);
// words that every second landmark has: a key made only of these names nothing in particular
const WEAK = new Set(['مجموعه', 'ورزشی', 'بازار', 'پارک', 'بوستان', 'دانشگاه', 'دانشکده', 'بیمارستان', 'مسجد', 'مدرسه', 'دبیرستان', 'هنرستان', 'خرید',
  'تجاری', 'فروشگاه', 'پایانه', 'ترمینال', 'مجتمع', 'پاساژ', 'مال', 'هایپر', 'استار', 'رفاه', 'افق', 'کوروش', 'بانک', 'ملت', 'صادرات',
  'سپه', 'تجارت', 'مسکن', 'کشاورزی', 'رفاه', 'آزاد', 'اسلامی', 'پیام', 'نور', 'فنی', 'حرفه', 'ای', 'درمانگاه', 'کلینیک', 'داروخانه', 'سینما',
  'هتل', 'رستوران', 'کافه', 'تالار', 'باغ', 'محله', 'روز', 'میوه', 'تره', 'بار', 'جایگاه', 'سوخت', 'کلانتری', 'پلیس', 'اداره', 'شرکت', 'سازمان',
  'شهرداری', 'منطقه', 'ناحیه', 'حسینیه', 'امامزاده', 'گلزار', 'شهدا', 'بهشت', 'زهرا', 'آرامستان', 'ورزشگاه', 'استخر', 'باشگاه', 'سالن']);
// «دید به X»، «به سمت X»: X is where the board looks, not where it stands
const TOWARD = /(دید|سمت|طرف|جهت)( به| از)?\s*$/;
const CUE = { s: /(میدان|فلکه|م)\s*$/, n: /(شهرک|کوی|محله|شهرکهای)\s*$/, r: /(خیابان|بلوار|بولوار|خ|بزرگراه|اتوبان|جاده|کمربندی)\s*$/ };

// the part of a name that identifies it («بلوار شهید جمهوری اسلامی» → «جمهوری اسلامی»)
export function core(s) {
  return norm(s).split(' ').filter(w => w && !GENERIC.has(w) && !/^\d+$/.test(w)).join(' ');
}

const KX = lat => 111320 * Math.cos(lat * Math.PI / 180), KY = 110540;
const dm = (a, b) => Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX(a[0]));
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * @param gz        gazetteer rows [name, kind, lat×1e5, lng×1e5]
 * @param cityName  the city's own name (never used as a place)
 * @param extra     roads with full geometry (data/cities/<slug>/roads.json ways, unpacked) to refine crossings
 */
export function makeGeocoder(gz, { cityName = '', inArea = () => true } = {}) {
  const city = core(cityName);
  const byKey = new Map();
  const add = (key, kind, pt, name) => {
    if (!key || key.length < 3 || key === city || GENERIC.has(key)) return;
    if (kind !== 'a' && kind !== 't' && kind !== 'r' && key.split(' ').every(w => WEAK.has(w) || w === city)) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ kind, pt, name });
  };
  for (const [name, kind, la, ln] of gz) {
    const pt = [la / 1e5, ln / 1e5];
    if (!inArea(pt)) continue;
    const k = core(name);
    if (kind !== 't') add(k, kind, pt, name);
    // the same place without the city's name («دانشگاه شهید باهنر کرمان» → «دانشگاه باهنر»)
    if (city) { const k2 = k.split(' ').filter(w => w !== city).join(' '); if (k2 !== k) add(k2, kind, pt, name); }
    if (kind === 'a') add(core('فرودگاه'), 'a', pt, name);
    if (kind === 't' && /راه ?آهن/.test(norm(name))) add(core('راه آهن'), 't', pt, name);
  }
  const maxWords = Math.max(1, ...[...byKey.keys()].map(k => k.split(' ').length));

  // every place name that appears in the address, longest first, without overlaps
  function mentions(text) {
    const words = norm(text).split(' ');
    // name words with their position in the address (generic words such as «خیابان» or «شهید» are skipped)
    const tok = []; words.forEach((w, i) => { if (w && !GENERIC.has(w) && !/^\d+$/.test(w)) tok.push({ w, i }); });
    const out = [], used = new Array(tok.length).fill(false);
    for (let n = Math.min(maxWords, 5); n >= 1; n--) {
      for (let i = 0; i + n <= tok.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const phrase = tok.slice(i, i + n).map(t => t.w).join(' ');
        const hits = byKey.get(phrase);
        if (!hits) continue;
        const at = tok[i].i, before = words.slice(Math.max(0, at - 2), at).join(' ');
        const want = Object.keys(CUE).find(k => CUE[k].test(before));
        let pick = hits;
        if (want) {
          const f = hits.filter(h => h.kind === want);
          if (f.length) pick = f;
          // «میدان X» with no square called X: a street called X is somewhere else; landmarks still count
          else if (want !== 'r') { pick = hits.filter(h => h.kind !== 'r'); if (!pick.length) { for (let j = i; j < i + n; j++) used[j] = true; continue; } }
        }
        out.push({ key: phrase, at, hits: pick, cue: want, toward: TOWARD.test(words.slice(Math.max(0, at - 3), at).join(' ')) });
        for (let j = i; j < i + n; j++) used[j] = true;
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // groups of points of one mention that lie together (a name used in two corners of the city gives two groups)
  function groups(hits, r = 700) {
    const gs = [];
    for (const h of hits) { const g = gs.find(g => dm(g.c, h.pt) < r); if (g) { g.pts.push(h); g.c = mid(g.c, h.pt); } else gs.push({ c: h.pt, pts: [h], kind: h.kind }); }
    gs.forEach(g => { g.span = Math.max(0, ...g.pts.map(p => dm(p.pt, g.c))) * 2; g.kind = g.pts.some(p => p.kind !== 'r') ? g.pts.find(p => p.kind !== 'r').kind : 'r'; });
    return gs;
  }

  /** {lat, lng, via, how} or null */
  const geocode = function (text) {
    const ms = mentions(text).filter(m => !m.toward);
    if (!ms.length) return null;
    // a landmark named after a street («پایانه وکیل آباد», a metro station) is not proof of a spot on that street:
    // a name that is also a street counts as a street unless the address calls it a square or a neighbourhood
    const point = ms.filter(m => m.hits.some(h => h.kind !== 'r') && (m.cue === 's' || m.cue === 'n' || !m.hits.some(h => h.kind === 'r')));
    const roads = ms.filter(m => !point.includes(m) && m.hits.some(h => h.kind === 'r')).map(m => ({ ...m, hits: m.hits.filter(h => h.kind === 'r') }));
    // 1) a square, neighbourhood or landmark — near a mentioned street when there is one
    for (const m of point) {
      const gs = groups(m.hits.filter(h => h.kind !== 'r'), 400);
      let best = null;
      if (gs.length === 1) best = gs[0];
      else if (roads.length) {
        // the group closest to one of the mentioned streets
        let bd = Infinity;
        for (const g of gs) for (const r of roads) for (const h of r.hits) { const d = dm(g.c, h.pt); if (d < bd) { bd = d; best = g; } }
        if (bd > 1500) best = null;
      }
      if (best && best.span < 1500) return { lat: best.c[0], lng: best.c[1], via: best.pts[0].name, how: 'place' };
    }
    // 2) two streets: where they meet
    if (roads.length >= 2) {
      let bd = Infinity, at = null, names = null;
      for (let a = 0; a < roads.length; a++) for (let b = a + 1; b < roads.length; b++) {
        if (roads[a].key === roads[b].key) continue;
        for (const p of roads[a].hits) for (const q of roads[b].hits) { if (p.name === q.name) continue; const d = dm(p.pt, q.pt); if (d < bd) { bd = d; at = mid(p.pt, q.pt); names = [p.name, q.name]; } }
      }
      if (at && bd < 350) return { lat: at[0], lng: at[1], via: names.join(' × '), how: 'cross' };
    }
    return null;
  };
  geocode.mentions = mentions;
  return geocode;
}

// ── gazetteer from an Overpass result (build-roads.mjs) ──────────────
export const gazetteerQuery = b => {
  const bb = b.join(',');
  return `[out:json][timeout:180];(`
    + `way["highway"]["name"]["highway"!~"^(footway|path|service|track|cycleway|steps|bridleway|construction|proposed|platform|corridor)$"](${bb});`
    + `nwr["junction"~"^(roundabout|circular)$"]["name"](${bb});nwr["place"~"^(square|neighbourhood|suburb|quarter|city_block|borough)$"]["name"](${bb});`
    + `nwr["landuse"="residential"]["name"](${bb});`
    + `nwr["name"]["amenity"~"^(university|college|school|hospital|clinic|marketplace|bus_station|place_of_worship|townhall|police|fuel|cinema|theatre|library|bank|courthouse|post_office|fire_station|restaurant|community_centre)$"](${bb});`
    + `nwr["name"]["leisure"~"^(park|stadium|sports_centre|water_park|garden|amusement_arcade)$"](${bb});nwr["name"]["shop"~"^(mall|department_store|supermarket|car)$"](${bb});`
    + `nwr["name"]["aeroway"="aerodrome"](${bb});nwr["name"]["railway"="station"](${bb});nwr["name"]["tourism"](${bb});nwr["name"]["historic"](${bb});`
    + `nwr["name"]["office"="government"](${bb});nwr["name"]["building"~"^(commercial|retail|hospital|university|government|public)$"](${bb});`
    + `);out tags center;`;
};

export function buildGazetteer(osm) {
  const rows = [], seen = new Map();
  for (const e of osm.elements || []) {
    const t = e.tags || {}, name = t.name || t['name:fa'];
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!name || lat == null) continue;
    let kind = 'l';
    if (t.aeroway === 'aerodrome') kind = 'a';
    else if (t.railway === 'station') kind = 't';
    else if (t.junction || t.place === 'square') kind = 's';
    else if (t.place || t.landuse === 'residential') kind = 'n';
    else if (t.highway) kind = 'r';
    const pt = [Math.round(lat * 1e5), Math.round(lng * 1e5)];
    // streets: one point per ~150 m of each name is plenty
    const k = `${kind}|${name}`;
    const prev = seen.get(k) || [];
    if (kind === 'r' && prev.some(p => Math.abs(p[0] - pt[0]) < 135 && Math.abs(p[1] - pt[1]) < 165)) continue;
    prev.push(pt); seen.set(k, prev);
    rows.push([name, kind, pt[0], pt[1]]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2] || a[3] - b[3]));
  return rows;
}
