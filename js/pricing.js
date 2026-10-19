// Prices, agency (owner) rules and bundles.
//
// Price of a structure for a campaign:
//   base      = negotiated price (if set and the scenario uses it) else list price
//   scenario  = base × (1 + global adjustment)            e.g. "list price −10%"
//   owner     = scenario × (1 − owner discount)
//   campaign  = owner × billable weeks × 7/30            billable = max(campaign weeks, owner/bundle minimum)
import { parseNum } from './fmt.js';
import { cityKey } from './city.js';

const KEY = cityKey('billboard-insight:pricing:v2');

export function defaultPricing() {
  return {
    scenario: { adj: 0, useNegotiated: true, allowLonger: true, seasonTraffic: true, seasonPrice: true },
    months: {},         // Persian month n → { traffic?, price? } manual overrides of the seasonal factors
    rules: {},          // owner → { bundleOnly, minWeeks, discount }
    bundles: [],        // { id, name, owner, ids[], price (monthly, whole package), minWeeks, only }
    feed: { url: '', updatedAt: null, count: 0, status: '' },
  };
}
export function loadPricing() {
  try {
    const d = defaultPricing(), s = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    return { ...d, ...s, scenario: { ...d.scenario, ...(s.scenario || {}) }, months: s.months || {} };
  } catch { return defaultPricing(); }
}
export function savePricing(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* memory only */ } }

export const ruleFor = (pricing, owner) => ({ bundleOnly: false, minWeeks: 0, discount: 0, ...(pricing.rules[owner] || {}) });

/** Monthly price after scenario and owner discount (null if unpriced). */
export function monthlyPrice(item, pricing) {
  const base = (pricing.scenario.useNegotiated && item.negotiated) || item.price;
  if (!base) return null;
  const r = ruleFor(pricing, item.owner || '');
  return base * (1 + (pricing.scenario.adj || 0)) * (1 - (r.discount || 0));
}

export function billableWeeks(weeks, minWeeks) { return Math.max(weeks, minWeeks || 0); }
export const costFor = (monthly, weeks) => monthly * weeks * 7 / 30;

// ── price feed ─────────────────────────────────────────────
/**
 * Merge a price feed into the inventory. Feed rows: { id?, name, owner?, lat?, lng?, price, negotiated?, updatedAt? }
 * Matching: same id → same coordinates (≤ 40 m) → same name. Unmatched rows with coordinates are added.
 */
export function mergeFeed(inventory, rows, distFn, stamp = new Date().toISOString()) {
  let matched = 0, added = 0;
  const norm = s => String(s || '').replace(/[‌\s]+/g, ' ').trim();
  for (const r of rows) {
    const price = parseNum(r.price);
    if (!price) continue;
    let it = (r.id && inventory.find(x => x.id === r.id)) ||
      (r.lat && r.lng && inventory.find(x => distFn([x.lat, x.lng], [+r.lat, +r.lng]) < 40)) ||
      inventory.find(x => norm(x.name) === norm(r.name));
    if (!it && r.lat && r.lng) {
      it = { id: r.id || `feed-${Math.random().toString(36).slice(2, 8)}`, name: r.name, lat: +r.lat, lng: +r.lng, type: r.type || 'bulletin', owner: r.owner || '', source: 'import' };
      inventory.push(it); added++;
    }
    if (!it) continue;
    if (it.price && it.price !== price) it.prevPrice = it.price;
    it.price = price;
    if (r.negotiated) it.negotiated = parseNum(r.negotiated);
    if (r.owner && !it.owner) it.owner = r.owner;
    it.priceSource = 'feed';
    it.priceUpdated = r.updatedAt || stamp;
    matched++;
  }
  return { matched, added };
}

/** Fetch a CSV (e.g. a published Google Sheet) or JSON price feed. */
export async function fetchFeed(url, parseTable) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    return { rows: Array.isArray(j) ? j : j.items || [], updatedAt: j.updatedAt || null };
  } catch {
    return { rows: parseTable(text), updatedAt: null };
  }
}
