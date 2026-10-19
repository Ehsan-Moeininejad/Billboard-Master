// App state, persistence (localStorage) and share links (URL hash).
import { DEFAULTS, SITE_COLORS } from './config.js';
import { defaultProviderSettings, migrateSettings } from './providers.js';
import { cityKey } from './city.js';

const KEY = cityKey('billboard-insight:v1');
const SKEY = 'billboard-insight:settings:v1';

export const state = {
  sites: [],
  draft: null,
  selectedId: null,
  dayType: 'weekday',
  detailTab: 'summary',
  budget: null,
  listTab: 'inventory',
  inventory: [],
  ranking: null,
  invFilter: 'all',
  scope: { mode: 'city', districts: [], sort: 'score' },   // ranking scope of the structures tab
  rankDirty: true,
  mapMode: null,
  finder: { opts: { format: 'bulletin', classes: ['motorway', 'trunk'], spacing: 250, count: 8, step: 120, separation: 600, perRoad: 2 }, result: null, status: 'idle' },
  sheet: null,
  pricing: null,
  districts: null,
  districtsApprox: false,
  board: { sort: 'score', dir: -1, districts: [], types: [], owner: '', pricedOnly: false, q: '', sel: new Set() },
  plan: { districts: [], tab: 'plan', budget: 3e9, weeks: 4, start: 'now', cal: null, objective: 'impressions', perRoad: 2, minScore: 0, types: [], includeSites: true, locks: {}, excludes: {}, entries: null, evalKey: '', result: null, status: 'idle', editBundle: null, priceQuery: '' },
  settings: { providers: defaultProviderSettings(), occupancy: DEFAULTS.occupancy, campaignWeeks: DEFAULTS.campaignWeeks, basemap: 'dark' },
};

const listeners = new Set();
export const subscribe = fn => listeners.add(fn);
export function emit(reason) { listeners.forEach(fn => fn(reason)); save(); }

export function nextColor() {
  const used = new Set(state.sites.map(s => s.color));
  return SITE_COLORS.find(c => !used.has(c)) || SITE_COLORS[state.sites.length % SITE_COLORS.length];
}
export const uid = () => Math.random().toString(36).slice(2, 9);

// strip heavy / transient fields before saving or sharing
function slim(s, forShare = false) {
  const o = {
    id: s.id, name: s.name, color: s.color, lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6),
    format: s.format, facing: s.facing, price: s.price || null, loopShare: s.loopShare ?? 1,
    inCompare: s.inCompare !== false, overrides: s.overrides || {}, notes: s.notes || '', sample: !!s.sample,
    board: s.board || null, clutter: s.clutter || 0,
    road: {
      name: s.road.name, ref: s.road.ref, cls: s.road.cls, oneway: s.road.oneway, lanes: s.road.lanes,
      twinLanes: s.road.twinLanes ?? null, maxspeed: s.road.maxspeed, width: s.road.width ?? null, bridge: s.road.bridge, bearing: s.road.bearing,
      line: s.road.line?.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]),
      twinLine: s.road.twinLine?.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]) || null,
      source: s.road.source,
    },
    candidates: forShare ? undefined : s.candidates,
  };
  if (!forShare && s.live) o.live = s.live;
  return o;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sites: state.sites.map(s => slim(s)), dayType: state.dayType }));
    localStorage.setItem(SKEY, JSON.stringify(state.settings));
  } catch { /* storage unavailable — app still works in memory */ }
}

export function load() {
  try {
    const st = JSON.parse(localStorage.getItem(SKEY) || 'null');
    if (st) Object.assign(state.settings, st);
  } catch { /* ignore */ }
  migrateSettings(state.settings);
  const fromHash = readShare();
  if (fromHash) { state.sites = fromHash; return 'share'; }
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d?.sites) { state.sites = d.sites; state.dayType = d.dayType || 'weekday'; }
  } catch { /* ignore */ }
  return 'local';
}

// ── share links ────────────────────────────────────────────
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
export function shareUrl() {
  const payload = state.sites.map(s => slim(s, true));
  return `${location.origin}${location.pathname}${location.search}#s=${b64url(JSON.stringify(payload))}`; // ?city=… stays in the link
}
function readShare() {
  const m = location.hash.match(/#s=([\w-]+)/);
  if (!m) return null;
  try {
    const arr = JSON.parse(unb64url(m[1]));
    history.replaceState(null, '', location.pathname);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}
