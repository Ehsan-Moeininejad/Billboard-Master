// Live-data providers with automatic failover.
//
// Order of preference is set in Settings (default: Neshan → Map.ir). For every request the
// first usable provider is tried; when it is out of quota, rejects the key or cannot be
// reached, it is paused and the next one answers. If none can, the app falls back to the
// Tehran traffic model, so the tool never stops working.
import * as net from './net.js';

export const PROVIDERS = {
  neshan: {
    fa: 'نشان', en: 'Neshan', site: 'https://platform.neshan.org',
    caps: { profile: true, speed: true, search: true },
    note: 'الگوی ترافیک 24 ساعته + سرعت معمول مسیر + جستجو',
    keyHint: 'service.xxxxxxxxxxxxxxxx',
  },
  mapir: {
    fa: 'Map.ir (مپ)', en: 'Map.ir', site: 'https://corp.map.ir',
    caps: { profile: false, speed: true, search: true },
    note: 'سرعت مسیر + جستجو (الگوی ساعتی ندارد)',
    keyHint: 'eyJ0eXAiOiJKV1QiLCJhbGciOi...',
  },
};

export const CAP_FA = { profile: 'الگوی ترافیک ساعتی', speed: 'سرعت مسیر', search: 'جستجو' };

const UKEY = 'billboard-insight:usage:v1';
const month = () => new Date().toISOString().slice(0, 7);
let usage = {};
try { usage = JSON.parse(localStorage.getItem(UKEY) || '{}') || {}; } catch { usage = {}; }
const listeners = new Set();
export const onUsage = fn => listeners.add(fn);

function u(id) {
  const m = month();
  if (!usage[id] || usage[id].month !== m) usage[id] = { month: m, count: 0, pausedUntil: 0, reason: '', last: '' };
  return usage[id];
}
function persist() {
  try { localStorage.setItem(UKEY, JSON.stringify(usage)); } catch { /* memory only */ }
  listeners.forEach(fn => fn());
}

export function defaultProviderSettings() {
  return {
    order: ['neshan', 'mapir'],
    neshan: { key: '', proxy: '', cap: 0, enabled: true },
    mapir: { key: '', cap: 0, enabled: true },
  };
}

/** Old settings (single Neshan key) → provider settings. */
export function migrateSettings(st) {
  if (!st.providers) st.providers = defaultProviderSettings();
  const p = st.providers;
  for (const id of Object.keys(PROVIDERS)) p[id] = { ...defaultProviderSettings()[id], ...(p[id] || {}) };
  if (!Array.isArray(p.order)) p.order = ['neshan', 'mapir'];
  if (st.neshanKey && !p.neshan.key) { p.neshan.key = st.neshanKey; p.neshan.proxy = st.neshanProxy || ''; }
  delete st.neshanKey; delete st.neshanProxy;
  return st;
}

export function status(id, st) {
  const cfg = st.providers[id];
  const x = u(id);
  const now = Date.now();
  if (!cfg?.key) return { state: 'off', label: 'کلید ندارد', ...x };
  if (!cfg.enabled) return { state: 'off', label: 'غیرفعال', ...x };
  if (cfg.cap && x.count >= cfg.cap) return { state: 'paused', label: 'به سقف ماهانه رسید', ...x };
  if (x.pausedUntil > now) return { state: 'paused', label: x.reason || 'موقتاً متوقف', until: x.pausedUntil, ...x };
  return { state: 'ready', label: 'آماده', ...x };
}

export const anyConfigured = st => st.providers.order.some(id => st.providers[id]?.key && st.providers[id]?.enabled);

/** Which provider would answer a given capability right now (for the top-bar chip). */
export function activeFor(cap, st) {
  return st.providers.order.find(id => PROVIDERS[id].caps[cap] && status(id, st).state === 'ready') || null;
}

function pause(id, err) {
  const x = u(id);
  const s = err?.status;
  const hour = 3600e3;
  if (s === 401 || s === 403) { x.pausedUntil = Date.now() + 24 * hour; x.reason = 'کلید نامعتبر یا سرویس برای کلید فعال نیست'; }
  else if (s === 402 || s === 429 || s === 470) {
    const t = new Date(); t.setHours(24, 0, 0, 0);
    x.pausedUntil = t.getTime(); x.reason = 'سهمیه تمام شد';
  } else if (s === 204) { return; } // answered, but nothing usable for this point — not the provider's fault
  else { x.pausedUntil = Date.now() + 10 * 60e3; x.reason = 'در دسترس نیست (شبکه یا CORS)'; }
}

/** Manually clear pauses (Settings → «از سرگیری»). */
export function resume(id) { const x = u(id); x.pausedUntil = 0; x.reason = ''; persist(); }
export function resetUsage(id) { usage[id] = null; u(id); persist(); }
export function usageOf(id) { return u(id); }
/** demo helper */
export function setUsage(id, count) { u(id).count = count; persist(); }

/**
 * Run `cap` against providers in order until one answers.
 * @returns {Promise<{value:any, provider:string, tried:string[]}|null>}
 */
export async function call(cap, args, st) {
  const tried = [];
  for (const id of st.providers.order) {
    if (!PROVIDERS[id]?.caps[cap]) continue;
    if (status(id, st).state !== 'ready') continue;
    const cfg = st.providers[id];
    tried.push(id);
    const x = u(id);
    x.count++; x.last = new Date().toISOString();
    try {
      const value = await net[id][cap](...args, cfg);
      persist();
      return { value, provider: id, tried };
    } catch (err) {
      pause(id, err);
      persist();
      if (err?.status === 204) return { value: null, provider: id, tried, empty: true };
    }
  }
  return tried.length ? { value: null, provider: null, tried } : null;
}

/** Search with provider failover, ending at free OpenStreetMap search. */
export async function search(term, st) {
  const r = await call('search', [term], st);
  if (r?.value?.length) return { items: r.value, provider: r.provider };
  return { items: await net.osmSearch(term), provider: 'osm' };
}

/** Test one provider's key without counting it towards failover pauses. */
export async function test(id, cfg) {
  const lat = 35.7448, lng = 51.3753;
  if (id === 'neshan') return net.neshan.profile(lat, lng, cfg);
  return net.mapir.search('ونک', cfg);
}
