// Calendar effects: which weekdays and which Persian months a campaign covers.
// Impressions follow the weekday pattern (WEEK) and the month traffic factor; cost follows the
// month price factor. Factors are relative, so a campaign over "average" days gets 1.0.
import { WEEK, WEEK_SUM, MONTHS } from './config.js';

const fmtMonth = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { month: 'numeric', timeZone: 'Asia/Tehran' });
const fmtYear = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', timeZone: 'Asia/Tehran' });
const fmtDay = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { day: 'numeric', timeZone: 'Asia/Tehran' });
const num = s => parseInt(String(s).replace(/\D/g, ''), 10);

export const persianMonth = d => num(fmtMonth.format(d));
export const persianYear = d => num(fmtYear.format(d));
export const persianDay = d => num(fmtDay.format(d));
/** index into WEEK (0 = Saturday) */
export const weekdayIdx = d => (d.getDay() + 1) % 7;

const DAY = 864e5;
const noon = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };

/** Month table with user overrides and observed traffic factors merged in. */
export function monthTable(overrides = {}, observed = {}) {
  return MONTHS.map(m => {
    const o = overrides[m.n] || {};
    const seen = observed[m.n];
    return {
      ...m,
      traffic: o.traffic ?? seen?.factor ?? m.traffic,
      price: o.price ?? m.price,
      trafficSource: o.traffic != null ? 'manual' : seen ? 'neshan' : 'default',
      priceSource: o.price != null ? 'manual' : 'default',
    };
  });
}

/** Start dates the planner offers: today and the first day of each of the next 12 Persian months. */
export function startOptions(from = new Date()) {
  const out = [{ key: 'now', date: noon(from), label: 'از امروز' }];
  let d = noon(from), m = persianMonth(d);
  for (let i = 0; i < 400 && out.length < 13; i++) {
    d = new Date(d.getTime() + DAY);
    const pm = persianMonth(d);
    if (pm !== m) { m = pm; out.push({ key: d.toISOString().slice(0, 10), date: d, label: `از اول ${MONTHS[pm - 1].fa} ${persianYear(d)}` }); }
  }
  return out;
}

/**
 * Factors for a campaign of `weeks` weeks starting at `start`.
 * impF multiplies the plain "weeks × weekly impressions" figure; priceF multiplies the plain cost.
 */
export function campaignFactors(start, weeks, months, { useTraffic = true, usePrice = true } = {}) {
  const days = Math.round(weeks * 7);
  let imp = 0, price = 0;
  const perMonth = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(noon(start).getTime() + i * DAY);
    const m = months[persianMonth(d) - 1];
    const wf = WEEK[weekdayIdx(d)].f / (WEEK_SUM / 7);
    const tf = useTraffic ? m.traffic : 1, pf = usePrice ? m.price : 1;
    imp += wf * tf; price += pf;
    perMonth.set(m.n, (perMonth.get(m.n) || 0) + 1);
  }
  const end = new Date(noon(start).getTime() + (days - 1) * DAY);
  return { impF: imp / days, priceF: price / days, days, perMonth: [...perMonth].map(([n, c]) => ({ n, fa: months[n - 1].fa, days: c })), start: noon(start), end };
}
