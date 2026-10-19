// The city this page shows: ?city=<slug> (no parameter = Tehran, exactly as before).
// Switching city reloads the page, so every module sees one fixed city for its whole life.
import { CITIES, cityDir } from './cities.js';

const want = (() => { try { return new URLSearchParams(location.search).get('city') || 'tehran'; } catch { return 'tehran'; } })();
export const CITY_SLUG = CITIES[want] ? want : 'tehran';
export const CITY = { slug: CITY_SLUG, ...CITIES[CITY_SLUG] };
export const IS_TEHRAN = CITY_SLUG === 'tehran';

/** path of a data file for this city: data/x.json for Tehran, data/cities/<slug>/x.json for the rest */
export const dataPath = f => `${cityDir(CITY_SLUG)}/${f}`;
/** browser-storage key for this city (Tehran keeps its original keys) */
export const cityKey = k => (IS_TEHRAN ? k : `${k}:${CITY_SLUG}`);
/** link to another city (Tehran = the plain address) */
export const cityUrl = slug => `${location.pathname}${slug === 'tehran' ? '' : `?city=${slug}`}`;
