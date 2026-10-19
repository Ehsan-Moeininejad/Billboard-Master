// Real billboard listings (data/market.json, rebuilt daily) and the value index.

/** Merge the market snapshot into the inventory without losing what users changed. */
export function mergeMarket(inventory, market) {
  const byId = new Map(inventory.map(x => [x.id, x]));
  let added = 0, updated = 0;
  for (const m of market.items || []) {
    const it = byId.get(m.id);
    if (!it) {
      inventory.push({ ...m, source: 'market', priceSource: m.price ? 'market' : null });
      added++; continue;
    }
    // keep user edits: dragged position, manual price, negotiated price, value coefficient, owner override
    const keepPos = it.userMoved;
    const keepPrice = it.priceSource === 'manual';
    Object.assign(it, {
      name: m.name, address: m.address, type: m.type, w: m.w, h: m.h, faces: m.faces, site: m.site,
      owner: it.ownerEdited ? it.owner : m.owner, loc: keepPos ? 'user' : m.loc, locNote: keepPos ? '' : m.locNote,
      ...(keepPos ? {} : { lat: m.lat, lng: m.lng }),
      ...(keepPrice ? {} : { price: m.price, prevPrice: m.prevPrice ?? it.prevPrice, priceEstimated: m.priceEstimated, priceUpdated: m.priceUpdated, priceSource: m.price ? 'market' : it.priceSource }),
    });
    updated++;
  }
  // listings that left the market snapshot (sold out, moved to another city, failed the location check)
  // are dropped, unless the user has worked on them
  const live = new Set((market.items || []).map(m => m.id));
  let removed = 0;
  for (let i = inventory.length - 1; i >= 0; i--) {
    const it = inventory[i];
    if (it.source !== 'market' || live.has(it.id)) continue;
    if (it.userMoved || it.priceSource === 'manual' || it.negotiated || it.coef) { it.delisted = true; continue; }
    inventory.splice(i, 1); removed++;
  }
  return { added, updated, removed };
}


/**
 * Value index = fair price / asking price.
 *
 * Fair price comes from a simple hedonic fit over the market itself:
 *   log(price) = a[type] + b · log(monthly impressions)
 * fitted on priced structures (prices the source estimated itself are left out), then × the manual value coefficient.
 * A log-log fit is used instead of a flat CPM because rents grow slower than audience — a flat CPM would call every
 * cheap board on a busy road a «14× bargain». > 1 means the structure delivers more than the market charges for that audience.
 */
export function applyValue(entries, monthlyOf) {
  const pts = [];
  for (const e of entries) {
    const mp = monthlyOf(e), mi = e.ev.weeklyImp * 30 / 7;
    if (mp > 0 && mi > 0 && !e.priceEstimated) pts.push({ t: e.type, x: Math.log(mi), y: Math.log(mp) });
  }
  const fit = fitHedonic(pts);
  for (const e of entries) {
    const mi = e.ev.weeklyImp * 30 / 7, mp = monthlyOf(e);
    const a = fit ? (fit.a[e.type] ?? fit.a0) : null;
    e.fair = fit && mi > 0 ? Math.exp(a + fit.b * Math.log(mi)) * (e.coef || 1) : null;
    e.valueIdx = e.fair && mp ? e.fair / mp : null;
  }
  return fit;
}

function fitHedonic(pts) {
  if (pts.length < 8) return null;
  // pooled slope on type-demeaned data, type intercepts where a type has ≥ 5 points
  const groups = {};
  pts.forEach(p => (groups[p.t] ||= []).push(p));
  const mean = (a, k) => a.reduce((s, p) => s + p[k], 0) / a.length;
  const mx = mean(pts, 'x'), my = mean(pts, 'y');
  let sxy = 0, sxx = 0;
  for (const [, g] of Object.entries(groups)) {
    const gx = g.length >= 5 ? mean(g, 'x') : mx, gy = g.length >= 5 ? mean(g, 'y') : my;
    g.forEach(p => { sxy += (p.x - gx) * (p.y - gy); sxx += (p.x - gx) ** 2; });
  }
  const b = Math.min(1, Math.max(0.2, sxx ? sxy / sxx : 0.6));   // keep the elasticity in a sane band
  // intercepts from the median residual, so a typical structure sits at value ≈ 1
  const med = v => { const s = v.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const a0 = med(pts.map(p => p.y - b * p.x));
  const a = {};
  for (const [t, g] of Object.entries(groups)) if (g.length >= 5) a[t] = med(g.map(p => p.y - b * p.x));
  return { a, a0, b, n: pts.length };
}

export function valueLabel(v) {
  if (v == null) return { t: '—', c: '' };
  if (v >= 1.4) return { t: 'خرید عالی', c: 'good' };
  if (v >= 1.1) return { t: 'خرید خوب', c: 'good' };
  if (v >= 0.9) return { t: 'قیمت منصفانه', c: '' };
  if (v >= 0.7) return { t: 'کمی گران', c: 'warn' };
  return { t: 'گران', c: 'bad' };
}

export const LOC_FA = { source: 'مختصات منبع', moved: 'جابه‌جا شده به تقاطع ذکرشده', onroad: 'روی مسیر درست، جای دقیق تقریبی', user: 'اصلاح‌شده توسط شما', address: 'از روی نشانی، جای دقیق تقریبی' };
export const daysSince = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null;
