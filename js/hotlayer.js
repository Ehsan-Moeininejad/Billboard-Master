// Hotspot layer: shapes (one or several polygons) for places where people gather (malls, shopping streets, trade streets,
// restaurant clusters, entertainment, metro/terminals, campuses), a filter panel and popups that
// list the billboard structures inside or next to each hotspot.
import { HOTSPOT_TYPES, TYPE_BY_KEY, BOURSE, HOTSPOT_QUERY, LEVEL_FA, COVERAGE, COVERAGE_FA, buildHotspots, hotspotTitle, unpackRing, distToShape } from './hotspots.js';
import { OVERPASS_ENDPOINTS } from './config.js';
import { CITY, IS_TEHRAN, dataPath, cityKey } from './city.js';
import { smsText } from './geofence.js';
import { HOTSPOT_BBOX } from './hotspots.js';

const PREF_KEY = 'billboard-insight:hotspots:v1';
const CACHE_KEY = cityKey('billboard-insight:hotspots-cache:v4');
// the live fallback query for this city's area
const CITY_QUERY = IS_TEHRAN ? HOTSPOT_QUERY : HOTSPOT_QUERY.replaceAll(HOTSPOT_BBOX.join(','), CITY.box.join(','));
const CACHE_DAYS = 8;
const KX = 111320 * Math.cos(35.7 * Math.PI / 180), KY = 110540;
const dm = (a, b) => Math.hypot((a.lat - b.lat) * KY, (a.lng - b.lng) * KX);
// when people are usually there (typical Tehran pattern per place type) — for timing digital boards and flights
const PEAK_FA = {
  mall: 'عصر تا شب؛ اوج پنجشنبه و جمعه',
  retail: 'عصرها؛ اوج آخر هفته و شب‌های عید',
  food: 'ظهر و شب؛ اوج پنجشنبه و جمعه شب',
  bourse: 'روزهای کاری، صبح تا عصر؛ خریدار هدفمند',
  fun: 'عصر و شب؛ اوج آخر هفته',
  transit: 'روزهای کاری؛ اوج 7 تا 9 صبح و 16 تا 19',
  campus: 'روزهای کاری در ترم؛ کم‌رونق در تابستان',
  hyper: 'عصرها و آخر هفته؛ خرید هفتگی خانواده',
  office: 'روزهای کاری 8 تا 17؛ خلوت در آخر هفته',
  health: 'روزهای کاری، صبح تا عصر',
  park: 'عصرها و کل روز آخر هفته؛ اوج بهار و تابستان',
  sport: 'عصر و شب؛ اوج روزهای مسابقه',
};
// quick starting points by what is being advertised (category → hotspot types)
// (Digikala's main categories plus two audience-based sets)
export const PRESETS = [
  { k: 'digital', fa: 'موبایل و دیجیتال', types: ['mall', 'bourse', 'retail', 'office', 'campus'], subs: ['elec'] },
  { k: 'appliance', fa: 'لوازم خانگی برقی', types: ['mall', 'bourse', 'hyper'], subs: ['appliance', 'home'] },
  { k: 'home', fa: 'خانه و آشپزخانه', types: ['mall', 'bourse', 'hyper'], subs: ['home', 'build'] },
  { k: 'fashion', fa: 'مد و پوشاک', types: ['mall', 'retail', 'bourse'], subs: ['fashion', 'gold'] },
  { k: 'beauty', fa: 'آرایشی، بهداشتی و سلامت', types: ['mall', 'retail', 'bourse', 'hyper', 'health'], subs: ['beauty', 'medical'] },
  { k: 'fmcg', fa: 'سوپرمارکت و خوراکی', types: ['hyper', 'food', 'mall'], subs: [] },
  { k: 'kids', fa: 'مادر و کودک', types: ['mall', 'park', 'bourse'], subs: ['kids'] },
  { k: 'sport', fa: 'ورزش و سفر', types: ['sport', 'park', 'bourse'], subs: ['sport'] },
  { k: 'books', fa: 'کتاب، لوازم‌التحریر و هنر', types: ['campus', 'bourse', 'fun'], subs: ['books', 'music'] },
  { k: 'tools', fa: 'ابزار و تجهیزات صنعتی', types: ['bourse'], subs: ['build', 'auto'] },
  { k: 'auto', fa: 'خودرو و موتورسیکلت', types: ['bourse'], subs: ['auto'] },
  { k: 'pet', fa: 'حیوانات خانگی', types: ['bourse', 'park'], subs: ['pet'] },
  { k: 'youth', fa: 'جوانان و دانشجوها', types: ['campus', 'fun', 'food', 'transit'], subs: [] },
  { k: 'b2b', fa: 'شاغلان و خرید سازمانی', types: ['office', 'transit', 'food'], subs: [] },
  { k: 'reach', fa: 'بیشترین رفت‌وآمد', types: ['transit', 'mall', 'retail', 'hyper'], subs: [] },
];
const inPreset = (p, h) => p.types.includes(h.t) && (h.t !== 'bourse' || !p.subs.length || p.subs.includes(h.sub));
const SUB_FA = { metro: 'ایستگاه مترو', rail: 'راه‌آهن', terminal: 'پایانه اتوبوس', mall: 'مرکز خرید', bazaar: 'بازار' };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

// ── geometry export ───────────────────────────────────────────
// circle → closed polygon of n points (lat, lng); used only when a hotspot has no traced shape
export function hotspotRing(h, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([+(h.lat + (h.r * Math.cos(a)) / KY).toFixed(6), +(h.lng + (h.r * Math.sin(a)) / KX).toFixed(6)]);
  }
  pts.push(pts[0]);
  return pts;
}
// shapes are stored per coverage level (h.cov[50|70|85|95].p); COV is the level being shown
let COV = 70;
const ringsOf = h => {
  const cache = (h._rings ||= {});
  if (!cache[COV]) { const p = h.cov?.[COV]?.p || h.cov?.[70]?.p || h.poly; cache[COV] = p?.length ? p.map(unpackRing) : [hotspotRing(h)]; }
  return cache[COV];
};
const wktRing = r => `(${r.map(([a, b]) => `${b} ${a}`).join(', ')})`;
const wkt = h => { const R = ringsOf(h); return R.length === 1 ? `POLYGON(${wktRing(R[0])})` : `MULTIPOLYGON(${R.map(r => `(${wktRing(r)})`).join(', ')})`; };
const lngLat = r => r.map(([a, b]) => [b, a]);
const feature = h => ({
  type: 'Feature',
  properties: { id: h.id, name: h.title, type: TYPE_BY_KEY[h.t].fa, subtype: h.t === 'bourse' ? BOURSE[h.sub]?.fa : SUB_FA[h.sub || h.kind] || '', district: h.dist, center_lat: h.lat, center_lng: h.lng, cover_radius_m: h.r, area_ha: h.area ?? null, parts: ringsOf(h).length, score: h.score, level: LEVEL_FA[h.lvl] },
  geometry: ringsOf(h).length === 1 ? { type: 'Polygon', coordinates: [lngLat(ringsOf(h)[0])] } : { type: 'MultiPolygon', coordinates: ringsOf(h).map(r => [lngLat(r)]) },
});
const xml = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
function kml(list) {
  const hex = c => { const m = c.replace('#', ''); return `66${m.slice(4, 6)}${m.slice(2, 4)}${m.slice(0, 2)}`; }; // aabbggrr
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>بیلبوردسنج — هات‌اسپات‌ها</name>
${HOTSPOT_TYPES.map(t => `<Style id="${t.k}"><LineStyle><color>ff${hex(t.color).slice(2)}</color><width>2</width></LineStyle><PolyStyle><color>${hex(t.color)}</color></PolyStyle></Style>`).join('\n')}
${list.map(h => `<Placemark><name>${xml(h.title)}</name><description>${xml(`${TYPE_BY_KEY[h.t].fa} · پتانسیل ${h.score} ${h.area ? ` · ${h.area} هکتار` : ''}${h.dist ? ` · منطقه ${h.dist}` : ''}`)}</description><styleUrl>#${h.t}</styleUrl><MultiGeometry>${ringsOf(h).map(r => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${r.map(([a, b]) => `${b},${a},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join('')}</MultiGeometry></Placemark>`).join('\n')}
</Document></kml>`;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function createHotspots(ctx) {
  // ctx: { map, $, icon, esc, toast, structures(), structInfo(st), focusStructure(id), districts(), districtOf(lat,lng) }
  const { map, $, icon, esc } = ctx;
  const pref = Object.assign({ on: false, types: HOTSPOT_TYPES.map(t => t.k), subs: Object.keys(BOURSE), min: 2, sel: [], only: false, cov: 70 }, store.get(PREF_KEY) || {});
  // types and trade-street groups added after a viewer saved their filters start switched on
  const knownT = pref.knownT || ['mall', 'retail', 'food', 'bourse', 'fun', 'transit', 'campus'];
  const knownS = pref.knownS || ['elec', 'fashion', 'gold', 'home', 'auto', 'build', 'books', 'medical'];
  HOTSPOT_TYPES.forEach(t => { if (!knownT.includes(t.k) && !pref.types.includes(t.k)) pref.types.push(t.k); });
  Object.keys(BOURSE).forEach(k => { if (!knownS.includes(k) && !pref.subs.includes(k)) pref.subs.push(k); });
  pref.knownT = HOTSPOT_TYPES.map(t => t.k); pref.knownS = Object.keys(BOURSE);
  if (!COVERAGE.includes(pref.cov)) pref.cov = 70;
  COV = pref.cov;
  let query = '';
  const H = { items: null, status: 'idle', source: '', updatedAt: '', layer: null, renderer: null, byId: new Map() };
  const savePref = () => store.set(PREF_KEY, pref);

  map.createPane('hot');
  map.getPane('hot').style.zIndex = 410; // above tiles, highways and districts; below structures and popups
  H.renderer = L.svg({ pane: 'hot', padding: 0.4 });
  H.layer = L.layerGroup();

  // ── data ────────────────────────────────────────────────────
  async function load() {
    if (H.items || H.status === 'loading') return H.items;
    H.status = 'loading'; renderPop();
    try {
      const r = await fetch(dataPath('hotspots.json'), { cache: 'no-cache' });
      if (r.ok) { const d = await r.json(); if (d.items?.length) { H.dataSource = d.source || ''; set(d.items, 'build', d.updatedAt); return H.items; } }
    } catch { /* no prebuilt file — fall back below */ }
    const c = store.get(CACHE_KEY);
    if (c?.items?.length && Date.now() - c.at < CACHE_DAYS * 864e5) { set(c.items, 'cache', new Date(c.at).toISOString()); return H.items; }
    try {
      H.status = 'building'; renderPop();
      const osm = await overpass(CITY_QUERY);
      const items = buildHotspots(osm, { relative: !IS_TEHRAN });
      store.set(CACHE_KEY, { at: Date.now(), items });
      set(items, 'live', new Date().toISOString());
    } catch (e) {
      console.warn('hotspots', e); H.status = 'error'; renderPop();
      ctx.toast('هات‌اسپات‌ها از OpenStreetMap دریافت نشد؛ کمی بعد دوباره امتحان کنید', '');
    }
    return H.items;
  }
  function set(items, source, updatedAt) {
    H.items = items; H.source = source; H.updatedAt = updatedAt || ''; H.status = 'ready';
    H.byId = new Map(items.map(h => [h.id, h]));
    items.forEach(h => { h.title = hotspotTitle(h); h.dist = ctx.districtOf?.(h.lat, h.lng) ?? null; h.base = { r: h.r, area: h.area, n: h.n }; });
    applyCov();
    // district numbers for the labels; districts load only once hotspots are actually used
    ctx.ensureDistricts?.().then(() => { items.forEach(h => { h.dist = ctx.districtOf?.(h.lat, h.lng) ?? h.dist; }); renderPop(); }).catch(() => {});
    draw(); renderPop();
  }
  // switch every hotspot's shape, area, cover radius and count to the chosen coverage level
  function applyCov() {
    COV = pref.cov;
    (H.items || []).forEach(h => {
      const lv = h.cov?.[COV] || h.cov?.[70];
      h.r = lv?.r ?? h.base.r; h.area = lv?.a ?? h.base.area; h.n = lv?.n ?? h.base.n;
      h.dens = h.area ? +(h.n / Math.max(0.05, h.area)).toFixed(2) : h.dens;
      ringsOf(h);
    });
  }
  async function overpass(q) {
    let last;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(150000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { last = e; }
    }
    throw last;
  }

  // ── filters ─────────────────────────────────────────────────
  const visible = h => pref.types.includes(h.t) && (h.t !== 'bourse' || pref.subs.includes(h.sub)) && h.lvl >= pref.min;
  // selection: a stable key survives the weekly rebuild (ids are renumbered, places barely move)
  const skey = h => `${h.t}:${h.sub || ''}:${h.lat.toFixed(3)},${h.lng.toFixed(3)}`;
  const isSel = h => pref.sel.includes(skey(h));
  const selected = () => (H.items || []).filter(isSel);
  const onMap = h => isSel(h) || (!pref.only && visible(h));
  function toggleSel(h) {
    const k = skey(h);
    pref.sel = pref.sel.includes(k) ? pref.sel.filter(x => x !== k) : [...pref.sel, k];
    savePref(); draw(); renderPop();
  }
  const typeColor = h => TYPE_BY_KEY[h.t]?.color || '#999';

  // ── map ─────────────────────────────────────────────────────
  function draw() {
    H.layer.clearLayers();
    if (!pref.on || !H.items) return;
    const z = map.getZoom();
    const list = H.items.filter(onMap).sort((a, b) => (b.area || b.r) - (a.area || a.r)); // big shapes first, small ones stay clickable on top
    list.forEach(h => {
      const col = typeColor(h);
      const c = L.polygon(ringsOf(h).map(r => [r]), {
        renderer: H.renderer, smoothFactor: 0.5, className: isSel(h) ? 'hs-sel-shape' : '', pane: 'hot', color: col, weight: isSel(h) ? 3.2 : h.lvl === 3 ? 2 : 1.4, opacity: isSel(h) ? 1 : 0.9,
        dashArray: h.lvl === 1 ? '4 5' : null, fillColor: col, fillOpacity: h.lvl === 3 ? 0.24 : h.lvl === 2 ? 0.15 : 0.08, bubblingMouseEvents: false,
      });
      c.bindTooltip(`<b>${esc(h.title)}</b><br><span class="hs-tt">${esc(TYPE_BY_KEY[h.t].short)} · پتانسیل ${LEVEL_FA[h.lvl]}</span>`, { direction: 'top', sticky: true, className: 'hs-tip' });
      c.on('click', ev => { L.DomEvent.stopPropagation(ev); openPopup(h); });
      c.addTo(H.layer);
    });
    // names of the strongest hotspots once the map is close enough to read them
    if (z >= 14) list.filter(h => h.lvl >= 2 && map.getBounds().pad(0.2).contains([h.lat, h.lng])).slice(0, 60).forEach(h => {
      L.marker([h.lat, h.lng], { pane: 'hot', interactive: false, icon: L.divIcon({ className: '', iconSize: null, html: `<div class="hs-lbl" style="--c:${typeColor(h)}">${esc(shortTitle(h))}</div>` }) }).addTo(H.layer);
    });
    if (!map.hasLayer(H.layer)) H.layer.addTo(map);
  }
  const shortTitle = h => h.title.length > 34 ? h.title.slice(0, 32) + '…' : h.title;
  let lastZ = null;
  map.on('zoomend', () => { const z = map.getZoom(); if (pref.on && (lastZ == null || (lastZ >= 14) !== (z >= 14))) draw(); lastZ = z; });
  map.on('moveend', () => { if (pref.on && map.getZoom() >= 14) draw(); if (!$('#hotPop').hidden) renderList(); });

  // structures inside the shape (or within 250 m of its edge), best first
  // structures inside or at the edge of the shape (≤ 250 m) and on the way in (≤ 900 m), best first
  function nearby(h, reach = 900) {
    return ctx.structures().filter(st => dm(h, st) <= h.r + reach + 10).map(st => ({ st, d: distToShape(ringsOf(h), st) })).filter(x => x.d <= reach)
      .map(x => ({ ...x, inside: x.d === 0, edge: x.d <= 250, ...ctx.structInfo(x.st) }))
      .sort((a, b) => (b.inside - a.inside) || ((b.score ?? -1) - (a.score ?? -1)) || a.d - b.d);
  }

  function popupHTML(h) {
    const T = TYPE_BY_KEY[h.t];
    const kind = h.t === 'bourse' ? `بورس ${BOURSE[h.sub]?.fa}` : h.t === 'transit' ? SUB_FA[h.sub] : h.t === 'mall' ? SUB_FA[h.kind] || T.short : T.short;
    const what = h.t === 'mall' ? `${h.n} مرکز${h.shops ? ` · ${h.shops} مغازه ثبت‌شده` : ''}${h.ha >= 0.5 ? ` · ${h.ha} هکتار` : ''}`
      : h.t === 'transit' ? (h.inter ? 'ایستگاه تقاطعی' : '') : h.t === 'campus' ? (h.ha >= 1 ? `${h.ha} هکتار` : '')
      : `${h.n} ${h.t === 'food' ? 'رستوران و کافه' : h.t === 'fun' ? 'مرکز' : 'مغازه'}`;
    const all = nearby(h), close = all.filter(x => x.edge), way = all.filter(x => !x.edge).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.d - b.d);
    const nRows = matchMedia('(max-width: 860px)').matches ? 2 : 3;
    const row = x => `<button class="hs-st" data-act="hs-struct" data-id="${esc(x.st.id)}"><span>${esc(x.st.name)}</span><small>${x.inside ? 'داخل محدوده' : `${Math.round(x.d)} م تا محدوده`}${x.score != null ? ` · امتیاز ${x.score}` : ''}${x.st.price ? ` · ${Math.round(x.st.price / 1e6)} میلیون` : ''}</small></button>`;
    const structs = (close.length
      ? `<div class="hs-sec">سازه‌های داخل یا لبه محدوده <b>${close.length}</b></div><div class="hs-sts">${close.slice(0, nRows).map(row).join('')}</div>`
      : `<div class="hs-sec">سازه بیلبوردی داخل یا لبه این محدوده ثبت نشده؛ فرصت سازه جدید یا تبلیغات محیطی (استرابورد، تلویزیون شهری، داخل مجتمع)</div>`)
      + (way.length ? `<div class="hs-sec">در مسیر رسیدن (تا 900 متر) <b>${way.length}</b> · بهترین‌ها</div><div class="hs-sts">${way.slice(0, nRows).map(row).join('')}</div>` : '');
    return `<div class="hs-pop" style="--c:${T.color}">
      <div class="hs-kind"><i></i>${esc(kind)}${h.dist ? ` · منطقه ${h.dist}` : ''}</div>
      <b class="hs-title">${esc(h.title)}</b>
      <div class="hs-meter"><span>پتانسیل تبلیغاتی</span><b>${LEVEL_FA[h.lvl]}</b><em>${h.score}/100</em><div class="hs-bar"><i style="width:${h.score}%"></i></div></div>
      <div class="pop-stats">${h.area ? `<span>مساحت <b>${h.area}</b> هکتار</span>` : ''}${ringsOf(h).length > 1 ? `<span><b>${ringsOf(h).length}</b> بخش جدا</span>` : ''}<span>دایره پوشش <b>${h.r}</b> م</span>${what ? `<span>${esc(what)}</span>` : ''}${h.dens && h.t !== 'transit' && h.t !== 'campus' ? `<span>تمرکز <b>${h.dens}</b> در هکتار</span>` : ''}</div>
      ${h.mix?.length ? `<div class="hs-mix">${h.mix.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      ${h.top?.length > 1 ? `<div class="hs-top">${h.top.slice(0, 4).map(esc).join('، ')}</div>` : ''}
      ${PEAK_FA[h.t] ? `<div class="hs-peak">${icon('clock')} <span>اوج حضور معمول: ${PEAK_FA[h.t]}</span></div>` : ''}
      ${h.mixed ? `<div class="hs-note">${icon('spark')} با ${h.mixed} نوع هات‌اسپات دیگر هم‌پوشانی دارد</div>` : ''}
      ${structs}
      <button class="hs-selbtn ${isSel(h) ? 'on' : ''}" data-act="hs-sel" data-id="${h.id}">${icon(isSel(h) ? 'check' : 'plus')} ${isSel(h) ? 'انتخاب شده؛ برای حذف از انتخاب بزنید' : 'افزودن به هات‌اسپات‌های انتخاب‌شده'}</button>
      <div class="hs-geo"><span>مختصات</span>
        <button data-act="hs-copy" data-id="${h.id}" data-f="center" title="lat, lng, شعاع دایره‌ای که کل محدوده را می‌پوشاند (متر)">${icon('copy')} مرکز و شعاع</button>
        <button data-act="hs-copy" data-id="${h.id}" data-f="poly" title="رئوس چندضلعی، lat,lng در هر خط؛ بخش‌ها با خط خالی جدا می‌شوند">${icon('copy')} چندضلعی${ringsOf(h).length > 1 ? `‌ها (${ringsOf(h).length})` : ''}</button>
        <button data-act="hs-copy" data-id="${h.id}" data-f="geojson" title="GeoJSON Feature">GeoJSON</button>
        <button data-act="hs-copy" data-id="${h.id}" data-f="wkt" title="WKT (lng lat)">WKT</button>
        <button data-act="hs-copy" data-id="${h.id}" data-f="sms" title="قالب پنل پیامک لوکیشن: [[lng,lat],…]؛ هر بخش در یک خط">${icon('copy')} پیامک لوکیشن</button>
      </div>
      <button class="btn btn-primary btn-block" data-act="analyze-struct" data-lat="${h.lat}" data-lng="${h.lng}" data-kind="" data-name="${esc(h.title)}">${icon('target')} تحلیل بیلبورد در همین محدوده</button>
    </div>`;
  }
  function openPopup(h) {
    L.popup({ maxWidth: 320, autoPanPaddingTopLeft: [60, 80], autoPanPaddingBottomRight: matchMedia('(max-width: 860px)').matches ? [10, Math.round(innerHeight * 0.5)] : [440, 20] }).setLatLng([h.lat, h.lng]).setContent(popupHTML(h)).openOn(map);
  }
  function focus(h) {
    if (matchMedia('(max-width: 860px)').matches) { $('#hotPop').hidden = true; $('#btnHot')?.classList.remove('on'); }
    const b = L.latLngBounds(ringsOf(h).flat()).pad(0.35);
    map.flyToBounds(b, { maxZoom: 16, duration: 0.5 });
    setTimeout(() => openPopup(h), 600);
  }

  // ── panel ───────────────────────────────────────────────────
  function counts() {
    const c = {}; (H.items || []).filter(h => h.lvl >= pref.min).forEach(h => { c[h.t] = (c[h.t] || 0) + 1; if (h.t === 'bourse') c['b:' + h.sub] = (c['b:' + h.sub] || 0) + 1; });
    // all levels, so a chip can say how many more the «minimum potential» filter is hiding
    const all = {}; (H.items || []).forEach(h => { all[h.t] = (all[h.t] || 0) + 1; if (h.t === 'bourse') all['b:' + h.sub] = (all['b:' + h.sub] || 0) + 1; });
    c.all = all;
    return c;
  }
  const hidden = (c, k) => { const n = (c.all[k] || 0) - (c[k] || 0); return n > 0 ? `<small class="hs-hid" dir="ltr" title="${n} مورد دیگر با پتانسیل کمتر؛ «حداقل پتانسیل» را روی «همه» بگذارید">+${n}</small>` : ''; };
  function renderPop() {
    const el = $('#hotPop'); if (!el) return;
    const c = counts();
    const status = H.status === 'loading' ? '<div class="hs-status">در حال بارگذاری…</div>'
      : H.status === 'building' ? '<div class="hs-status">در حال ساخت هات‌اسپات‌ها از OpenStreetMap (یک بار، حدود 1 دقیقه)…</div>'
      : H.status === 'error' ? '<div class="hs-status bad">داده دریافت نشد. <button class="linkish" data-hs="retry">دوباره</button></div>' : '';
    el.innerHTML = `
      <label class="switch-row hs-main"><input type="checkbox" data-hs="on" ${pref.on ? 'checked' : ''}><span class="switch"></span><span><b>هات‌اسپات‌های تجمع مردم</b><small>جاهایی که مردم جمع می‌شوند و پتانسیل تبلیغات دارند</small></span></label>
      ${status}
      <div class="pop-title">برای تبلیغ چه چیزی؟</div>
      <select class="inp hs-preset-sel" data-hs="preset-sel"><option value="">همه دسته‌ها (انتخاب دستی نوع‌ها)</option>${PRESETS.map(p => `<option value="${p.k}" ${presetOn(p) ? 'selected' : ''}>${p.fa}</option>`).join('')}</select>
      ${(() => { const p = PRESETS.find(presetOn); return p && ctx.openAssistant ? `<button class="hs-camp" data-hs="camp" data-k="${p.k}">${icon('spark')} پیشنهاد بیلبورد و محل برای کمپین «${p.fa}»</button>` : ''; })()}
      <div class="pop-title">نوع هات‌اسپات</div>
      <div class="hs-types">${HOTSPOT_TYPES.map(t => `<button class="hs-type ${pref.types.includes(t.k) ? 'on' : ''}" data-hs="type" data-k="${t.k}" style="--c:${t.color}" title="${esc(t.desc)}"><i></i>${t.short}${H.items ? `<small>${c[t.k] || 0}</small>${hidden(c, t.k)}` : ''}</button>`).join('')}</div>
      ${pref.types.includes('bourse') ? `<div class="hs-subs">${Object.entries(BOURSE).map(([k, b]) => `<button class="${pref.subs.includes(k) ? 'on' : ''}" data-hs="sub" data-k="${k}">${b.fa}${H.items ? ` <small>${c['b:' + k] || 0}</small>${hidden(c, 'b:' + k)}` : ''}</button>`).join('')}</div>` : ''}
      <div class="pop-title">حداقل پتانسیل</div>
      <div class="seg hs-seg">${[[1, 'همه'], [2, 'زیاد به بالا'], [3, 'فقط خیلی زیاد']].map(([v, l]) => `<button class="${pref.min === v ? 'on' : ''}" data-hs="min" data-v="${v}">${l}${H.items ? ` <small>${H.items.filter(h => h.lvl >= v).length}</small>` : ''}</button>`).join('')}</div>
      <div class="pop-title">اندازه هات‌اسپات‌ها</div>
      <div class="seg hs-seg hs-cov">${COVERAGE.map(c => `<button class="${pref.cov === c ? 'on' : ''}" data-hs="cov" data-v="${c}" title="${c === 50 ? 'فقط شلوغ‌ترین هسته' : c === 95 ? 'تقریباً همه مغازه‌ها و مراکز آن تجمع' : ''}">${COVERAGE_FA[c]} <small>${c}٪</small></button>`).join('')}</div>
      <div class="hs-cov-note">درصد = سهم مغازه‌ها و مراکز هر تجمع که داخل شکل قرار می‌گیرد؛ برای مال، مترو، پارک و… حریم اطراف را کوچک و بزرگ می‌کند.</div>
      <div class="pop-title hs-list-title">بیشترین پتانسیل در محدوده نقشه</div>
      <input class="inp hs-q" data-hs="q" type="search" placeholder="جستجوی هات‌اسپات (مثلاً جمهوری، تیراژه)" value="${esc(query)}" autocomplete="off">
      <div class="hs-list" id="hsList"></div>
      <div class="hs-selbar" id="hsSel"></div>
      <div class="hs-export"><span>خروجی همه هات‌اسپات‌های فیلترشده (نه فقط انتخاب‌شده‌ها)</span><div>
        <button data-hs="exp" data-f="csv">${icon('download')} CSV</button><button data-hs="exp" data-f="geojson">${icon('download')} GeoJSON</button><button data-hs="exp" data-f="kml">${icon('download')} KML</button></div></div>
      <div class="hs-foot">از نقاط ثبت‌شده در OpenStreetMap${/Neshan/.test(H.dataSource || '') ? ' و جستجوی نشان' : ''}؛ شکل هر هات‌اسپات همان محدوده‌ای است که مراکزش پوشش می‌دهند (اگر تجمع تکه‌تکه باشد، چند بخش جدا) و پتانسیل، اندازه، تمرکز و نوع مکان را با هم می‌سنجد.${H.updatedAt ? ` به‌روزرسانی: ${new Date(H.updatedAt).toLocaleDateString('fa-IR-u-nu-latn')}` : ''}</div>`;
    renderList(); renderSel();
  }
  function presetOn(p) {
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    return same(pref.types, p.types) && (!p.types.includes('bourse') || same(pref.subs, p.subs));
  }
  function shareSelUrl() {
    return `${location.origin}${location.pathname}#hs=${encodeURIComponent(pref.sel.join(';'))}`;
  }
  function renderSel() {
    const el = $('#hsSel'); if (!el) return;
    const sel = selected();
    el.innerHTML = !sel.length ? '<div class="hs-hint">برای انتخاب، تیک کنار هر هات‌اسپات (یا دکمه انتخاب در پاپ‌آپ آن روی نقشه) را بزنید؛ بعد مختصات همه را یک‌جا کپی کنید.</div>' : `
      <div class="hs-sel-head"><b>${sel.length} هات‌اسپات انتخاب شده</b><button class="linkish" data-hs="sel-clear">پاک کردن</button></div>
      <div class="hs-sel-chips">${sel.map(h => `<button data-hs="focus" data-id="${h.id}" style="--c:${typeColor(h)}"><i></i>${esc(shortTitle(h))}</button>`).join('')}</div>
      <div class="seg hs-seg">${[[false, 'نقشه: همه فیلترشده‌ها'], [true, 'نقشه: فقط انتخاب‌شده‌ها']].map(([v, l]) => `<button class="${pref.only === v ? 'on' : ''}" data-hs="only" data-v="${v ? 1 : 0}">${l}</button>`).join('')}</div>
      <div class="hs-sel-act">
        <button class="btn btn-primary" data-hs="sel-copy" data-f="poly">${icon('copy')} کپی مختصات چندضلعی‌ها</button>
        <div><button data-hs="sel-copy" data-f="geojson">${icon('copy')} GeoJSON</button><button data-hs="sel-copy" data-f="wkt">${icon('copy')} WKT</button><button data-hs="sel-copy" data-f="center">${icon('copy')} مرکز و شعاع</button><button data-hs="sel-copy" data-f="sms" title="[[lng,lat],…]؛ هر محدوده در یک خط">${icon('copy')} پیامک لوکیشن</button></div>
        <button class="hs-share" data-hs="sel-share">${icon('share')} لینک اشتراک همین انتخاب‌ها برای همکاران</button>
        <div><button data-hs="sel-exp" data-f="csv">${icon('download')} CSV</button><button data-hs="sel-exp" data-f="geojson">${icon('download')} GeoJSON</button><button data-hs="sel-exp" data-f="kml">${icon('download')} KML</button></div>
      </div>`;
  }
  function renderList() {
    const el = $('#hsList'); if (!el) return;
    if (!H.items) { el.innerHTML = `<div class="hs-empty">${pref.on ? '' : 'برای دیدن فهرست، نمایش را روشن کنید'}</div>`; return; }
    const bounds = map.getBounds(), q = query.trim();
    let list, title;
    if (q) { list = H.items.filter(h => h.title.includes(q) || (h.dist && `منطقه ${h.dist}` === q)); title = `نتیجه جستجو در ${CITY.fa} (${list.length})`; }
    else {
      list = H.items.filter(visible).filter(h => bounds.contains([h.lat, h.lng]));
      title = 'بیشترین پتانسیل در محدوده نقشه';
      if (!list.length) { list = H.items.filter(visible); title = `بیشترین پتانسیل در ${CITY.fa}`; }
    }
    $('#hotPop .hs-list-title').textContent = title;
    el.innerHTML = list.slice(0, 40).map(h => `<div class="hs-row ${isSel(h) ? 'sel' : ''}" style="--c:${typeColor(h)}"><button class="hs-check" data-hs="sel" data-id="${h.id}" aria-label="انتخاب" title="انتخاب برای کپی و خروجی">${isSel(h) ? icon('check') : ''}</button><button class="hs-row-main" data-hs="focus" data-id="${h.id}"><i></i><span><b>${esc(h.title)}</b><small>${TYPE_BY_KEY[h.t].short}${h.dist ? ` · منطقه ${h.dist}` : ''}${h.area ? ` · ${h.area} هکتار` : ''}${ringsOf(h).length > 1 ? ` · ${ringsOf(h).length} بخش` : ''}</small></span><em class="lv${h.lvl}">${h.score}</em></button></div>`).join('')
      || `<div class="hs-empty">${q ? 'چیزی پیدا نشد' : 'با این فیلترها هات‌اسپاتی نیست'}</div>`;
  }

  async function setOn(on) {
    pref.on = on; savePref();
    const sw = $('#lyrHot'); if (sw) sw.checked = on;
    $('#btnHot')?.classList.toggle('lit', on);
    if (on) { await load(); draw(); } else { H.layer.clearLayers(); }
    renderPop();
  }

  function onPopClick(e) {
    const b = e.target.closest('[data-hs]'); if (!b) return;
    const a = b.dataset.hs;
    if (a === 'type') { const k = b.dataset.k; pref.types = pref.types.includes(k) ? pref.types.filter(x => x !== k) : [...pref.types, k]; }
    else if (a === 'sub') { const k = b.dataset.k; pref.subs = pref.subs.includes(k) ? pref.subs.filter(x => x !== k) : [...pref.subs, k]; }
    else if (a === 'min') pref.min = +b.dataset.v;
    else if (a === 'focus') { const h = H.byId.get(b.dataset.id); if (h) focus(h); return; }
    else if (a === 'retry') { H.status = 'idle'; setOn(true); return; }
    else if (a === 'exp') { exportAll(b.dataset.f); return; }
    else if (a === 'cov') { pref.cov = +b.dataset.v; savePref(); applyCov(); draw(); renderPop(); return; }
    else if (a === 'camp') { ctx.openAssistant?.({ preset: b.dataset.k }); return; }
    else if (a === 'preset') {
      const p = PRESETS.find(x => x.k === b.dataset.k); if (!p) return;
      pref.types = [...p.types]; if (p.subs.length) pref.subs = [...p.subs]; else pref.subs = Object.keys(BOURSE);
    }
    else if (a === 'sel-share') { ctx.copyText(shareSelUrl(), 'لینک کپی شد؛ گیرنده همین هات‌اسپات‌ها را روی نقشه می‌بیند'); return; }
    else if (a === 'sel') { const h = H.byId.get(b.dataset.id); if (h) toggleSel(h); return; }
    else if (a === 'sel-clear') { pref.sel = []; pref.only = false; savePref(); draw(); renderPop(); return; }
    else if (a === 'only') { pref.only = b.dataset.v === '1'; savePref(); draw(); renderPop(); return; }
    else if (a === 'sel-copy') { copyMany(selected(), b.dataset.f); return; }
    else if (a === 'sel-exp') { exportAll(b.dataset.f, selected()); return; }
    else return;
    savePref();
    if (!pref.on) { setOn(true); return; }
    draw(); renderPop();
  }

  function copyOne(h, f) {
    const text = f === 'center' ? `${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}, ${h.r}`
      : f === 'poly' ? ringsOf(h).map((r, i, all) => `${all.length > 1 ? `# بخش ${i + 1}\n` : ''}${r.map(([a, b]) => `${a},${b}`).join('\n')}`).join('\n\n')
      : f === 'sms' ? smsText(ringsOf(h))
      : f === 'geojson' ? JSON.stringify(feature(h)) : wkt(h);
    const what = { center: 'مرکز و شعاع (lat, lng, متر)', poly: ringsOf(h).length > 1 ? `${ringsOf(h).length} چندضلعی (lat,lng در هر خط)` : 'چندضلعی (lat,lng در هر خط)', geojson: 'GeoJSON', wkt: 'WKT',
      sms: ringsOf(h).length > 1 ? `مختصات پیامک لوکیشن کپی شد؛ ${ringsOf(h).length} بخش، هر خط یک محدوده` : 'مختصات پیامک لوکیشن' }[f];
    if (f === 'sms' && ringsOf(h).length > 1) { ctx.copyText(text, what); return; }
    ctx.copyText(text, `${what} کپی شد`);
  }
  function copyMany(list, f) {
    if (!list.length) return;
    if (list.length === 1) { copyOne(list[0], f); return; }
    if (f === 'sms') { const rings = list.flatMap(ringsOf); ctx.copyText(smsText(rings), `مختصات پیامک لوکیشن کپی شد؛ ${rings.length} محدوده، هر خط یکی`); return; }
    const text = f === 'geojson' ? JSON.stringify({ type: 'FeatureCollection', features: list.map(feature) })
      : list.map(h => `# ${h.title} (${TYPE_BY_KEY[h.t].short})\n` + (f === 'center' ? `${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}, ${h.r}`
        : f === 'wkt' ? wkt(h)
        : ringsOf(h).map((r, i, all) => `${all.length > 1 ? `# بخش ${i + 1}\n` : ''}${r.map(([a, c]) => `${a},${c}`).join('\n')}`).join('\n\n'))).join('\n\n');
    ctx.copyText(text, `مختصات ${list.length} هات‌اسپات کپی شد`);
  }
  function exportAll(f, only = null) {
    const list = only || (H.items || []).filter(visible);
    if (!list.length) { ctx.toast('با این فیلترها هات‌اسپاتی برای خروجی نیست'); return; }
    const day = new Date().toISOString().slice(0, 10), base = `hotspots-${CITY.slug}-${only ? 'selected-' : ''}${day}`;
    if (f === 'geojson') download(`${base}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: list.map(feature) }), 'application/geo+json');
    else if (f === 'kml') download(`${base}.kml`, kml(list), 'application/vnd.google-earth.kml+xml');
    else {
      const head = ['id', 'name', 'type', 'subtype', 'district', 'center_lat', 'center_lng', 'cover_radius_m', 'area_ha', 'parts', 'score', 'level', 'polygon_wkt', 'polygon_sms_lnglat'];
      const rows = list.map(h => { const p = feature(h).properties; return [h.id, h.title, p.type, p.subtype, h.dist ?? '', h.lat, h.lng, h.r, h.area ?? '', p.parts, h.score, p.level, wkt(h), smsText(ringsOf(h)).split('\n').join(' | ')]; });
      download(`${base}.csv`, '\ufeff' + [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    }
    ctx.toast(`${list.length} هات‌اسپات در فایل ${f.toUpperCase()} ذخیره شد`, 'ok');
  }

  // wiring
  $('#hotPop').addEventListener('click', e => { e.stopPropagation(); onPopClick(e); });
  $('#hotPop').addEventListener('input', e => { if (e.target.matches('[data-hs="q"]')) { query = e.target.value; renderList(); } });
  $('#hotPop').addEventListener('change', e => {
    if (e.target.matches('[data-hs="preset-sel"]')) {
      const p = PRESETS.find(x => x.k === e.target.value);
      if (p) { pref.types = [...p.types]; pref.subs = p.subs.length ? [...p.subs] : Object.keys(BOURSE); }
      else { pref.types = HOTSPOT_TYPES.map(t => t.k); pref.subs = Object.keys(BOURSE); }
      savePref(); if (!pref.on) setOn(true); else { draw(); renderPop(); }
      return;
    } if (e.target.matches('[data-hs="on"]')) setOn(e.target.checked); });
  $('#lyrHot')?.addEventListener('change', e => setOn(e.target.checked));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="hs-struct"]'); if (!b) return;
    map.closePopup(); ctx.focusStructure(b.dataset.id);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="hs-copy"]'); if (!b) return;
    const h = H.byId.get(b.dataset.id); if (h) copyOne(h, b.dataset.f);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="hs-sel"]'); if (!b) return;
    const h = H.byId.get(b.dataset.id); if (!h) return;
    toggleSel(h); openPopup(h);
  });
  // a shared link (#hs=…) opens with exactly those hotspots selected and shown
  const shared = location.hash.match(/#hs=([^&]+)/);
  if (shared) {
    pref.sel = decodeURIComponent(shared[1]).split(';').filter(Boolean); pref.only = true; savePref();
    setOn(true).then(() => {
      const sel = selected(); if (!sel.length) return;
      map.fitBounds(L.latLngBounds(sel.flatMap(ringsOf).flat()).pad(0.3), { maxZoom: 16 });
      ctx.toast(`${sel.length} هات‌اسپات از لینک اشتراکی نمایش داده شد`, 'ok');
    });
  } else if (pref.on) setOn(true); else renderPop();

  return {
    toggle() { const p = $('#hotPop'); p.hidden = !p.hidden; if (!p.hidden) { renderPop(); if (!H.items && pref.on) load(); } return !p.hidden; },
    redraw: draw,
    // the strongest hotspot that contains a point (for structure popups)
    at(lat, lng) {
      if (!H.items) return null;
      let best = null;
      H.items.forEach(h => { if ((!best || h.score > best.score) && dm(h, { lat, lng }) <= h.r && distToShape(ringsOf(h), { lat, lng }) === 0) best = h; });
      return best;
    },
    open(id) { const h = H.byId.get(id); if (h) focus(h); },
    // for the campaign assistant
    async ready() { if (!H.items) await load(); return H.items || []; },
    rings: ringsOf,
    peak: t => PEAK_FA[t] || '',
    showOnly(list) {
      pref.sel = list.map(skey); pref.only = true; savePref();
      return setOn(true).then(() => { if (list.length) map.fitBounds(L.latLngBounds(list.flatMap(ringsOf).flat()).pad(0.25), { maxZoom: 16, paddingBottomRight: matchMedia('(max-width: 860px)').matches ? [10, Math.round(innerHeight * 0.45)] : [420, 20] }); });
    },
    focus(h) { focus(h); },
    refreshDistricts() { (H.items || []).forEach(h => { h.dist = ctx.districtOf?.(h.lat, h.lng) ?? h.dist; }); },
    get on() { return pref.on; },
  };
}
