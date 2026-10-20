// بیلبوردسنج — main UI controller
import { TEHRAN, ROAD_CLASSES, FORMATS, BASEMAPS, WEEK, SAMPLES, VIS, CATALOG_SAMPLE } from './config.js';
import { rankStructures, findSites } from './finder.js';
import { loadPricing, savePricing, ruleFor, mergeFeed, fetchFeed, monthlyPrice } from './pricing.js';
import { approximateDistricts, districtOf, DISTRICT_CENTERS, pointInPoly } from './districts.js';
import { evalSite, buildOptions, optimize, budgetCurve, OBJECTIVES } from './planner.js';
import { loadInventory, saveInventory, parseTable, TYPE_FA, SOURCE_FA } from './inventory.js';
import { smsText, circleRing, SMS_POINT_RADIUS } from './geofence.js';
import { mergeMarket, applyValue, valueLabel, LOC_FA, daysSince } from './market.js';
import { monthTable, startOptions, campaignFactors, persianMonth } from './calendar.js';
import { state, load, save, emit, subscribe, nextColor, uid, shareUrl } from './store.js';
import { createHotspots } from './hotlayer.js';
import { createAssistant } from './assistant.js';
import { CITY, IS_TEHRAN, dataPath, cityUrl } from './city.js';
import { CITIES, CITY_SLUGS } from './cities.js';
import * as net from './net.js';
const { roadsNear, structuresIn, highwayNetwork } = net;
import * as providers from './providers.js';
import { PROVIDERS, anyConfigured } from './providers.js';
import { summarize, directionsFor, tehranHour, CONFIDENCE_FA, visibility, legibleFor } from './model.js';
import { nearestOnLine, walk, offsetLine, dist } from './geo.js';
import { hourlyChart, multiLine, ring, heatmap, valueMap } from './charts.js';
import { num, num1, compact, compactParts, toman, hourRange, hourLabel, esc, parseNum, scoreLabel } from './fmt.js';

// The demo build (build/demo.mjs) defines __DEMO__ = true and swaps net.js for a simulated network.
const DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;

const $ = s => document.querySelector(s);
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const isMobile = () => matchMedia('(max-width: 860px)').matches;

let map, baseLayer, hwLayer = null, searchMarker = null, hot = null, assistant = null;
const siteLayers = new Map();
const structCache = { tiles: new Set(), items: new Map() };

// ════════════════════════════════════════════════════════════
//  boot
// ════════════════════════════════════════════════════════════
async function init() {
  const origin = load();
  state.inventory = loadInventory();
  state.pricing = loadPricing();
  state.sites.forEach(s => { s.status = 'ready'; });

  map = L.map('map', {
    center: CITY.center, zoom: CITY.zoom, zoomControl: false, attributionControl: true,
    maxBounds: L.latLngBounds(CITY.bounds).pad(0.6), minZoom: 10, worldCopyJump: false,
  });
  $('#map').setAttribute('dir', 'ltr');
  window.__bbMap = map; // handy for debugging from the console
  window.__bbState = state;
  L.control.zoom({ position: 'bottomleft', zoomInTitle: 'بزرگ‌نمایی', zoomOutTitle: 'کوچک‌نمایی' }).addTo(map);
  map.attributionControl.setPrefix(false);
  if (net.drawBase) {
    net.drawBase(map);
    $('#basemaps').previousElementSibling.hidden = true; $('#basemaps').hidden = true;
  } else setBasemap(state.settings.basemap || 'dark');
  if (DEMO) setupDemo();

  map.on('click', e => {
    closePops();
    if (state.mapMode === 'addStructure') {
      const near = [...roadCache.ways.values()].find(w => nearestOnLine([e.latlng.lat, e.latlng.lng], w.line).distance < 60);
      const [it] = addInventory([{ name: `سازه ثبت‌شده ${state.inventory.filter(x => x.source === 'manual').length + 1}`, lat: e.latlng.lat, lng: e.latlng.lng, type: near && (near.cls === 'motorway' || near.cls === 'trunk') ? 'bridge' : 'bulletin' }], 'manual');
      state.mapMode = null; document.body.classList.remove('picking');
      setModeHint(null);
      setStructuresLayer(true); scheduleRefresh(50);
      toast(`«${it.name}» ثبت شد؛ برای جابه‌جایی، «جابه‌جا کردن» را در پاپ‌آپ سازه بزنید`, 'ok');
      return;
    }
    if (state.listTab === 'sites' || state.selectedId) { analyzeAt(e.latlng.lat, e.latlng.lng); return; }
    // elsewhere a stray click should not open a new analysis; offer it instead
    L.popup({ className: 'ask-pop' }).setLatLng(e.latlng).setContent(`<b>تحلیل این نقطه؟</b><div class="pop-sub">تردد، سرعت، زمان مواجهه و ایمپرشن یک بیلبورد فرضی در همین نقطه</div><button class="btn btn-primary btn-block" data-act="analyze-struct" data-lat="${e.latlng.lat}" data-lng="${e.latlng.lng}" data-kind="" data-name="">${icon('target')} تحلیل این نقطه</button>`).openOn(map);
  });
  map.on('moveend', () => { scheduleRefresh(); if (state.listTab === 'finder' && !state.selectedId) renderPanel(); });

  bindChrome();
  if (!DEMO) {
    hot = createHotspots({
      map, $, icon, esc, toast, copyText,
      structures: () => allStructures().filter(st => st.source !== 'osm'),
      structInfo: st => { const r = rankById.get(st.id), pe = state.plan.entries?.find(x => x.id === st.id); return { score: r?.score ?? pe?.score ?? null, valueIdx: pe?.valueIdx ?? null }; },
      focusStructure,
      districtOf: (lat, lng) => state.districts && !state.districtsApprox ? districtOf(lat, lng, state.districts) : null,
      ensureDistricts: () => loadDistricts(),
      openAssistant: o => { closePops(); assistant?.open(o); },
    });
    assistant = createAssistant({
      $, icon, toast, copyText, hot, focusStructure,
      structures: () => allStructures().filter(st => st.source !== 'osm'),
      structInfo: st => { const r = rankById.get(st.id), pe = state.plan.entries?.find(x => x.id === st.id); return { score: pe?.score ?? r?.score ?? null, valueIdx: pe?.valueIdx ?? null, imp: pe?.ev?.dailyImp ?? r?.imp ?? null }; },
      districtOf: (lat, lng) => state.districts ? districtOf(lat, lng, state.districts) : null,
      ensureScores: () => evaluateMarket(),
    });
    $('#btnAssist').addEventListener('click', () => { closePops(); assistant.toggle(); });
    $('#btnAssist2').addEventListener('click', e => { e.stopPropagation(); closePops(); assistant.toggle(); });
  } else { $('#btnHot').hidden = true; $('#btnAssist').hidden = true; $('#btnAssist2').hidden = true; }
  subscribe(() => { drawAllSites(); renderPanel(); updateDataChip(); });
  drawAllSites();
  renderPanel();
  updateDataChip();

  if (origin === 'share' && state.sites.length) {
    toast(`${state.sites.length} نقطه از لینک اشتراکی بارگذاری شد`, 'ok');
    state.listTab = 'sites'; renderPanel();
    fitSites();
    save();
  } else if (state.sites.length && state.listTab === 'sites') {
    fitSites();
  }
  if (DEMO && !state.sites.length) loadSamples();
  if (DEMO) {
    const m = net.demoMarket();
    state.market = { updatedAt: m.updatedAt, stats: m.stats, source: m.source, count: m.items.length };
    if (!state.inventory.some(x => x.source === 'market')) { if (!state.pricing.bundles.length) state.pricing.bundles = m.bundles; persistPricing(); }
    mergeMarket(state.inventory, m); persistInventory();
  } else {
    await Promise.all([loadMarket(), preloadRoads(), loadTraffic()]);
    refreshFeed();
  }
  updateDataChip();
  if (state.inventory.length) setStructuresLayer(true);
  setTimeout(() => $('#modeHint').classList.toggle('hide', state.sites.length > 0 || state.listTab !== 'sites'), 50);
  if (!welcomed()) setTimeout(openWelcome, 300);
}

function setupDemo() {
  // The artifact cannot reach the traffic APIs, so it runs on the traffic model only (no simulated "live" data).
  const p = state.settings.providers;
  ['neshan', 'mapir'].forEach(id => { if (/^demo-/.test(p[id]?.key || '')) p[id].key = ''; });
  $('#btnSettings').hidden = true;
  document.querySelector('.brand').insertAdjacentHTML('beforeend', '<span class="demo-badge" title="سازه‌ها و قیمت‌ها واقعی‌اند؛ ترافیک با مدل برآورد می‌شود">نسخه نمایشی</span>');
}

function fitSites() {
  if (!state.sites.length) return;
  const b = L.latLngBounds(state.sites.map(s => [s.lat, s.lng]));
  map.fitBounds(b.pad(0.3), { maxZoom: 15, paddingTopLeft: [60, 80], paddingBottomRight: isMobile() ? [20, innerHeight * 0.45] : [440, 40] });
}

function setBasemap(key) {
  const bm = BASEMAPS[key] || BASEMAPS.dark;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(bm.url, { attribution: bm.attr, subdomains: bm.sub || 'abc', maxZoom: 19, detectRetina: false });
  baseLayer.addTo(map);
  $('#map').classList.toggle('bm-filter-dark', bm.filter === 'dark');
  state.settings.basemap = key;
  document.querySelectorAll('.bm').forEach(b => b.classList.toggle('on', b.dataset.bm === key));
}

// ════════════════════════════════════════════════════════════
//  analysis
// ════════════════════════════════════════════════════════════
function trimmed(line, snap, m = 700) {
  const back = walk(line, snap, m, -1).reverse();
  const fwd = walk(line, snap, m, 1);
  return back.concat(fwd.slice(1));
}

function candidateFromWay(w) {
  const line = trimmed(w.line, w.snap);
  const c = {
    name: w.name, ref: w.ref, cls: w.cls, oneway: w.oneway, lanes: w.lanes, maxspeed: w.maxspeed, width: w.width ?? null,
    bridge: w.bridge, bearing: w.snap.bearing, distance: Math.round(w.snap.distance), line, source: 'osm',
    twinLine: null, twinLanes: null,
  };
  if (w.twin) {
    c.twinLine = trimmed(w.twin.line, w.twin.snap);
    c.twinLanes = w.twin.lanes?.total ?? null;
  }
  return c;
}

function manualRoad(cls = 'primary') {
  return { name: '', ref: '', cls, oneway: false, lanes: {}, maxspeed: null, bridge: false, bearing: 90, line: null, source: 'manual', twinLine: null, twinLanes: null };
}

function guessFormat(cls) {
  return (cls === 'motorway' || cls === 'trunk') ? 'bridge' : cls === 'primary' ? 'bulletin' : 'poster';
}

async function analyzeAt(lat, lng, opts = {}) {
  const existing = opts.siteId ? findSite(opts.siteId) : null;
  const site = existing || {
    id: uid(), draft: !opts.save, name: opts.name || 'نقطه جدید', autoName: !opts.name, color: nextColor(),
    format: opts.format || null, facing: opts.facing || 'fwd', price: opts.price || null, loopShare: opts.loopShare ?? 1,
    overrides: {}, inCompare: true, sample: !!opts.sample,
  };
  site.lat = lat; site.lng = lng; site.status = 'loading'; site.live = null;
  if (opts.save && !existing) { delete site.draft; state.sites.push(site); }
  else if (!existing) { state.draft = site; }
  if (!opts.save) state.selectedId = site.id;
  $('#modeHint').classList.add('hide');
  if (isMobile()) setPanelSize('');
  renderPanel(); drawAllSites();

  let roads = [];
  let err = null;
  try {
    roads = await roadsNear(lat, lng, 90);
    if (!roads.length) roads = await roadsNear(lat, lng, 220);
  } catch (e) { err = e; }
  if (!opts.save && state.selectedId !== site.id && !existing && state.draft !== site) return; // user moved on

  if (roads.length) {
    site.candidates = roads.map(candidateFromWay);
    site.road = site.candidates[0];
    site.roadWarn = site.road.distance > 120 ? 'far' : null;
  } else {
    site.candidates = [];
    site.road = manualRoad();
    site.roadWarn = err ? 'offline' : 'none';
    if (err && !opts.save) toast('دریافت اطلاعات معبر از OpenStreetMap ممکن نشد. مشخصات معبر را دستی تنظیم کنید.', 'err');
  }
  if (!site.format) site.format = guessFormat(site.road.cls);
  site.clutter = clutterAt(lat, lng);
  if (site.autoName) site.name = autoName(site);
  site.status = 'ready';
  renderPanel(); drawAllSites();
  if (!site.draft) emit('analyze');
  fetchLive(site);
}

function autoName(site) {
  const r = site.road;
  const base = r.name || (r.source === 'manual' ? 'نقطه دستی' : ROAD_CLASSES[r.cls]?.short || 'معبر بی‌نام');
  const fm = site.format === 'bridge' ? 'پل عابر' : '';
  return fm ? `${base} — ${fm}` : base;
}

function liveLineFor(site) {
  const r = site.road;
  if (!r.line) return null;
  const p = [site.lat, site.lng];
  const dir = site.facing === 'bwd' ? 'bwd' : 'fwd';
  if (dir === 'fwd') return { line: r.line, snap: nearestOnLine(p, r.line) };
  if (r.oneway && r.twinLine) return { line: r.twinLine, snap: nearestOnLine(p, r.twinLine) };
  const rev = r.line.slice().reverse();
  return { line: rev, snap: nearestOnLine(p, rev) };
}

async function fetchLive(site) {
  const st = state.settings;
  if (!site.road) return;
  if (!anyConfigured(st)) {
    const sh = nearbyShared(site);
    if (sh) { site.live = sh; if (!site.draft) emit('live'); else rerenderIfSelected(site); }
    return;
  }
  site.live = { status: { traffic: 'wait', speed: 'wait' } };
  rerenderIfSelected(site);
  const ll = liveLineFor(site);
  const pt = ll ? ll.snap.point : [site.lat, site.lng];
  const [t, s] = await Promise.all([
    providers.call('profile', [pt[0], pt[1]], st),
    ll ? providers.call('speed', [ll.line, ll.snap], st) : Promise.resolve(null),
  ]);
  const stat = x => !x ? 'none' : x.value ? 'ok' : x.empty ? 'empty' : 'err';
  site.live = {
    traffic: t?.value ? { ...t.value, provider: t.provider } : null,
    speed: s?.value ? { ...s.value, provider: s.provider, hour: tehranHour() } : null,
    status: { traffic: stat(t), speed: stat(s) },
    via: { traffic: t?.provider || null, speed: s?.provider || null },
    tried: { traffic: t?.tried || [], speed: s?.tried || [] },
    at: Date.now(),
  };
  const fell = [t, s].find(x => x?.provider && x.tried.length > 1 && x.tried[0] !== x.provider);
  if (fell) toast(`${PROVIDERS[fell.tried[0]].fa} پاسخ نداد (${providers.status(fell.tried[0], st).label})؛ داده از ${PROVIDERS[fell.provider].fa} گرفته شد`);
  if (!site.draft) emit('live'); else rerenderIfSelected(site);
  updateDataChip();
}

function rerenderIfSelected(site) {
  if (state.selectedId === site.id) renderPanel();
}

const TYPE_TO_FORMAT = { bridge: 'bridge', ad: 'bulletin', bulletin: 'bulletin', poster: 'poster', digital: 'digital', rooftop: 'rooftop' };
const isReady = s => !!s.road && s.status !== 'loading';
const findSite = id => state.sites.find(s => s.id === id) || (state.draft?.id === id ? state.draft : null);
const selected = () => state.selectedId ? findSite(state.selectedId) : null;

// ════════════════════════════════════════════════════════════
//  map drawing
// ════════════════════════════════════════════════════════════
function pinIcon(site, idx, sel) {
  const label = site.draft ? '+' : String(idx + 1);
  return L.divIcon({
    className: '', iconSize: [34, 44], iconAnchor: [17, 42],
    html: `<div class="pin ${sel ? 'is-sel' : ''} ${site.draft ? 'draft' : ''}"><svg viewBox="0 0 34 44"><path d="M17 42s14-13.4 14-24.5C31 9.4 24.7 3 17 3S3 9.4 3 17.5C3 28.6 17 42 17 42z" fill="${site.color}" stroke="#fff" stroke-width="2.5"/></svg><span>${label}</span></div>`,
  });
}

function zonesFor(site, est) {
  const r = site.road;
  if (!r?.line) return [];
  const p = [site.lat, site.lng];
  const { facing } = directionsFor(site);
  const geo = visibility(site, facing);
  return facing.map((d, k) => {
    const g = geo[k];
    const vis = g.window + g.lanes.reduce((a, l) => a + l.cutoff, 0) / g.lanes.length;
    let seg;
    if (d.key === 'fwd') {
      seg = walk(r.line, nearestOnLine(p, r.line), vis, -1);
    } else if (r.oneway && r.twinLine) {
      seg = walk(r.twinLine, nearestOnLine(p, r.twinLine), vis, -1);
    } else {
      seg = walk(r.line, nearestOnLine(p, r.line), vis, 1);
    }
    if (!r.oneway) seg = offsetLine(seg, d.key === 'fwd' ? -7 : 7);
    return { dir: d, seg };
  });
}

function drawSite(site, idx) {
  const old = siteLayers.get(site.id);
  if (old) map.removeLayer(old);
  const sel = state.selectedId === site.id;
  const g = L.layerGroup();
  if (site.status === 'loading') {
    L.marker([site.lat, site.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse"></div>', iconSize: [16, 16] }), interactive: false }).addTo(g);
  } else {
    zonesFor(site).forEach(z => {
      if (z.seg.length < 2) return;
      L.polyline(z.seg, { color: site.color, weight: sel ? 16 : 11, opacity: sel ? 0.28 : 0.16, lineCap: 'round', interactive: false }).addTo(g);
      L.polyline(z.seg, { color: site.color, weight: sel ? 4 : 3, opacity: sel ? 0.95 : 0.6, lineCap: 'round', dashArray: sel ? null : '6 6', interactive: false }).addTo(g);
      const start = z.seg[z.seg.length - 1];
      L.marker(start, { icon: L.divIcon({ className: '', html: `<div class="dir-arrow" style="color:${site.color}">${z.dir.arrow}</div>`, iconSize: [24, 24] }), interactive: false }).addTo(g);
    });
    const m = L.marker([site.lat, site.lng], { icon: pinIcon(site, idx, sel), draggable: true, zIndexOffset: sel ? 1000 : 0, keyboard: true, title: site.name });
    m.on('click', ev => { L.DomEvent.stopPropagation(ev); selectSite(site.id); });
    m.on('dragend', ev => { const ll = ev.target.getLatLng(); analyzeAt(ll.lat, ll.lng, { siteId: site.id }); });
    m.bindTooltip(esc(site.name), { direction: 'top', offset: [0, -40], className: 'road-tip' });
    m.addTo(g);
  }
  g.addTo(map);
  siteLayers.set(site.id, g);
}

function drawAllSites() {
  const ids = new Set([...state.sites.map(s => s.id), state.draft?.id].filter(Boolean));
  for (const [id, layer] of siteLayers) if (!ids.has(id)) { map.removeLayer(layer); siteLayers.delete(id); }
  state.sites.forEach((s, i) => drawSite(s, i));
  if (state.draft) drawSite(state.draft, state.sites.length);
  syncSiteVisibility();
}

/** Comparison points only show where they matter, so the structure map stays readable. */
function syncSiteVisibility() {
  const show = state.listTab === 'sites' || !!state.selectedId || state.sheet === 'compare';
  for (const layer of siteLayers.values()) {
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function selectSite(id) {
  state.selectedId = id;
  if (isMobile()) setPanelSize('');
  drawAllSites(); renderPanel();
}

// ════════════════════════════════════════════════════════════
//  panel
// ════════════════════════════════════════════════════════════
function renderPanel() {
  const s = selected();
  const body = $('#panelBody');
  const scroll = body.scrollTop;
  const view = s ? s.id : `list:${state.listTab}`;
  const sameSite = body.dataset.view === view;
  body.innerHTML = s ? detailHTML(s) : panelTabs() + (state.listTab === 'inventory' ? inventoryHTML() : state.listTab === 'finder' ? finderHTML() : listHTML());
  body.dataset.view = view;
  syncSiteVisibility();
  if (s && s.status === 'ready') mountDetailCharts(s);
  if (sameSite) body.scrollTop = scroll;
}

function panelTabs() {
  const t = state.listTab;
  const n = state.sites.length, m = state.inventory.length + structCache.items.size;
  return `<div class="list-tabs" role="tablist">
    <button role="tab" aria-selected="${t === 'inventory'}" class="${t === 'inventory' ? 'on' : ''}" data-act="ltab" data-v="inventory">${icon('board')}بهترین سازه‌ها</button>
    <button role="tab" aria-selected="false" data-act="open-plan">${icon('money')}کمپین با بودجه</button>
    <button role="tab" aria-selected="${t === 'sites'}" class="${t === 'sites' ? 'on' : ''}" data-act="ltab" data-v="sites">${icon('compare')}مقایسه نقاط${n ? `<i>${n}</i>` : ''}</button>
    <button role="tab" aria-selected="${t === 'finder'}" class="${t === 'finder' ? 'on' : ''}" data-act="ltab" data-v="finder">${icon('spark')}جای بیلبورد جدید</button>
  </div>`;
}

function setModeHint(text) {
  const h = $('#modeHint');
  if (!text) { h.classList.add('hide'); return; }
  h.querySelector('span').textContent = text; h.classList.remove('hide');
}

function listHTML() {
  if (!state.sites.length) return emptyHTML();
  const rows = state.sites.map((s, i) => {
    if (!isReady(s)) return `<div class="card"><div class="badge-num" style="background:${s.color}">${i + 1}</div><div class="card-main"><div class="card-name">${esc(s.name)}</div><div class="skel" style="height:12px;width:70%;margin-top:8px"></div></div><div></div></div>`;
    const sum = summarize(s, state.settings);
    const sc = sum.score;
    const col = sc >= 65 ? 'var(--good)' : sc >= 45 ? 'var(--warn)' : 'var(--bad)';
    return `<div class="card ${state.selectedId === s.id ? 'is-sel' : ''}" data-act="open" data-id="${s.id}" role="button" tabindex="0">
      <div class="badge-num" style="background:${s.color}">${i + 1}</div>
      <div class="card-main">
        <div class="card-name">${esc(s.name)}${s.sample ? ' <span class="chip chip-xs">نمونه</span>' : ''}</div>
        <div class="card-meta">${esc(ROAD_CLASSES[s.road.cls]?.short || '')} · ${esc(FORMATS[s.format]?.fa || '')}</div>
        <div class="card-stats">
          <span>${icon('eye')} <b>${compact(sum.wk.daily.impressions)}</b>/روز</span>
          <span><b>${num1(sum.wk.daily.avgExposure)}</b> ثانیه</span>
          ${sum.cpm ? `<span>CPM <b>${compact(sum.cpm)}</b></span>` : ''}
        </div>
      </div>
      <div class="card-side">
        <span class="mini-score" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)">${sc}</span>
        <button class="chk ${s.inCompare !== false ? 'on' : ''}" data-act="toggle-cmp" data-id="${s.id}" aria-label="در مقایسه" title="در مقایسه">${icon('check')}</button>
      </div>
    </div>`;
  }).join('');
  const nCmp = state.sites.filter(s => s.inCompare !== false && isReady(s)).length;
  return `${guideHTML('compare')}<div class="p-head flat">
      <div class="p-head-row"><h1 class="p-title">مقایسه نقاط</h1><span class="chip">${state.sites.length} نقطه</span></div>
      <div class="p-sub">برآورد روز کاری · روی نقشه کلیک کنید تا نقطه جدید اضافه شود</div>
    </div>
    <div class="cards">${rows}</div>
    <div class="p-sec" style="border:0;padding-bottom:6px">
      <button class="btn btn-primary btn-block" data-act="compare" ${nCmp < 1 ? 'disabled' : ''}>${icon('compare')} مقایسه و برآورد کمپین <span class="count">${nCmp}</span></button>
    </div>
    <div class="list-actions">
      ${DEMO ? `<button class="btn btn-ghost" data-act="copy-tsv">${icon('compare')} کپی برای اکسل</button>` : `<button class="btn btn-ghost" data-act="share">${icon('share')} لینک اشتراک</button>
      <button class="btn btn-ghost" data-act="csv">${icon('download')} اکسل (CSV)</button>`}
      <button class="btn btn-ghost" data-act="clear" title="حذف همه" aria-label="حذف همه">${icon('trash')}</button>
    </div>`;
}

function loadSamples() {
  SAMPLES.forEach(s => analyzeAt(s.lat, s.lng, { save: true, sample: true, ...s }));
  state.selectedId = null;
  renderPanel();
  if (state.listTab === 'sites') setTimeout(fitSites, 50);
}

function updateDataChip() {
  const chip = $('#dataChip');
  if (!chip) return;
  const st = state.settings;
  const prof = providers.activeFor('profile', st);
  const sp = providers.activeFor('speed', st);
  const primary = st.providers.order.find(id => st.providers[id]?.key && st.providers[id]?.enabled);
  let cls = 'model', label = 'فقط مدل', sub = 'کلید API ندارد';
  if (DEMO) {
    const M = state.market;
    chip.className = 'data-chip model';
    chip.innerHTML = `<i></i><span><b>${M ? num(M.count) + ' سازه واقعی' : 'مدل ترافیک'}</b><small>ترافیک با مدل · قیمت‌ها ${M ? 'از آگهی‌های بازار' : ''}</small></span>`;
    chip.title = 'منبع داده‌ها';
    return;
  }
  if (!primary && state.traffic?.items && Object.keys(state.traffic.items).length) {
    cls = 'live'; label = 'ترافیک نشان (هفتگی)';
    sub = `${num(Object.keys(state.traffic.items).length)} سازه · ${new Date(state.traffic.updatedAt).toLocaleDateString('fa-IR-u-nu-latn')}`;
  }
  if (primary) {
    const act = prof || sp;
    if (!act) { cls = 'warn'; label = 'مدل (منابع متوقف)'; sub = 'سهمیه یا دسترسی همه منابع قطع است'; }
    else if (act !== primary) { cls = 'warn'; label = `جایگزین: ${PROVIDERS[act].en}`; sub = `${PROVIDERS[primary].fa}: ${providers.status(primary, st).label}`; }
    else { cls = 'live'; label = `داده زنده: ${PROVIDERS[act].en}`; sub = `${num(providers.usageOf(act).count)} درخواست این ماه`; }
  }
  chip.className = `data-chip ${cls}`;
  chip.innerHTML = `<i></i><span><b>${label}</b><small>${sub}</small></span>`;
  $('#dataDot')?.classList.toggle('live', cls === 'live');
}

function emptyHTML() {
  return `<div class="empty">
    <div class="empty-art">
      <svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice">
        <path d="M-10 118 C 80 90, 140 130, 220 84 S 330 40, 380 52" fill="none" stroke="#2E3B53" stroke-width="18" stroke-linecap="round"/>
        <path d="M-10 118 C 80 90, 140 130, 220 84 S 330 40, 380 52" fill="none" stroke="#5B8CFF" stroke-width="2" stroke-dasharray="8 8" opacity=".7"/>
        <path d="M120 112 C 150 112, 175 104, 200 92" fill="none" stroke="#5B8CFF" stroke-width="12" stroke-linecap="round" opacity=".35"/>
        <rect x="196" y="40" width="58" height="30" rx="5" fill="#111723" stroke="#5B8CFF" stroke-width="2"/>
        <rect x="203" y="48" width="30" height="4" rx="2" fill="#5B8CFF"/><rect x="203" y="56" width="42" height="4" rx="2" fill="#2E3B53"/>
        <path d="M224 70 v18" stroke="#5B8CFF" stroke-width="3"/>
        <circle cx="300" cy="50" r="5" fill="#2BD9A6"/><circle cx="70" cy="104" r="5" fill="#F5C451"/>
      </svg>
    </div>
    <h2>کدام سازه بیلبورد بهتر دیده می‌شود؟</h2>
    <p>نقطه را روی نقشه انتخاب کنید؛ بیلبوردسنج تردد، سرعت، زمان مواجهه و ایمپرشن تخمینی را محاسبه می‌کند و نقاط را کنار هم می‌گذارد.</p>
    <ol class="steps">
      <li><i>1</i><div><b>روی بزرگراه یا پل کلیک کنید</b><span>معبر نزدیک خودکار شناسایی می‌شود. از لایه «سازه‌های بالقوه» هم می‌توانید پل‌های عابر را ببینید.</span></div></li>
      <li><i>2</i><div><b>سازه و جهت دید را مشخص کنید</b><span>نوع تابلو، جهت ترافیکی که آن را می‌بیند و قیمت اجاره ماهانه.</span></div></li>
      <li><i>3</i><div><b>مقایسه کنید و تصمیم بگیرید</b><span>امتیاز، CPM، ساعات طلایی، نقشه ارزش و بهینه‌ساز بودجه.</span></div></li>
    </ol>
    <button class="btn btn-ghost btn-block" data-act="samples" style="margin-bottom:14px">${icon('spark')} با 5 نقطه نمونه شروع کنید</button>
    <div class="note"><b>دقت بیشتر:</b> بدون هیچ تنظیمی با مدل ترافیک تهران و داده OpenStreetMap کار می‌کند. با کلید نشان یا Map.ir، داده ترافیک واقعی هر نقطه هم وارد محاسبه می‌شود؛ اگر سهمیه یکی تمام شود، خودکار سراغ دیگری می‌رود.</div>
  </div>`;
}

function detailSkeleton(site) {
  return `<div class="p-head"><div class="p-head-row">
      <button class="icon-btn" data-act="back" aria-label="بازگشت">${icon('back')}</button>
      <h1 class="p-title">در حال تحلیل نقطه…</h1></div>
      <div class="p-sub ltr">${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}</div></div>
    <div class="p-sec"><div class="hero"><div class="skel" style="width:64px;height:64px;border-radius:50%"></div><div style="flex:1"><div class="skel" style="height:16px;width:60%"></div><div class="skel" style="height:12px;width:40%;margin-top:8px"></div></div></div>
      <div class="kpis">${'<div class="skel" style="height:74px"></div>'.repeat(4)}</div></div>
    <div class="p-sec"><div class="skel" style="height:170px"></div></div>`;
}

function detailHTML(site) {
  if (site.status === 'loading' || !site.road) return detailSkeleton(site);
  const sum = summarize(site, state.settings);
  const est = pickDay(sum);
  const d = est.daily;
  const r = site.road;
  const cls = ROAD_CLASSES[r.cls];
  const idx = state.sites.indexOf(site);
  const { facing } = directionsFor(site);
  const tab = state.detailTab;

  const roadChips = [
    `<span class="chip acc">${esc(cls?.fa || r.cls)}</span>`,
    `<span class="chip">${facing.map(f => f.lanes).join(' + ')} خط</span>`,
    r.maxspeed ? `<span class="chip">سقف <bdi dir="ltr">${r.maxspeed} km/h</bdi></span>` : '',
    r.bridge ? '<span class="chip">روی پل/روگذر</span>' : '',
    r.source === 'manual' ? '<span class="chip warn">مشخصات دستی</span>' : '',
    site.sample ? '<span class="chip">نمونه</span>' : '',
  ].join('');
  const warn = site.roadWarn === 'far' ? `<div class="note" style="margin-top:10px">نزدیک‌ترین معبر اصلی ${r.distance} متر فاصله دارد؛ مطمئن شوید نقطه درست انتخاب شده است.</div>`
    : site.roadWarn === 'none' ? `<div class="note" style="margin-top:10px">معبر اصلی در نزدیکی پیدا نشد. نوع معبر و تعداد خطوط را در تب «سازه و هزینه» تنظیم کنید.</div>`
    : site.roadWarn === 'offline' ? `<div class="note" style="margin-top:10px">اتصال به OpenStreetMap برقرار نشد؛ محاسبه با مشخصات پیش‌فرض انجام شده است.</div>` : '';

  const head = `<div class="p-head">
    <div class="p-head-row">
      <button class="icon-btn" data-act="back" aria-label="بازگشت به لیست">${icon('back')}</button>
      <span class="badge-num" style="background:${site.color}">${site.draft ? '+' : idx + 1}</span>
      <input class="d-name" id="siteName" value="${esc(site.name)}" data-act="name" aria-label="نام نقطه">
      ${site.draft ? '' : `<button class="icon-btn danger" data-act="delete" aria-label="حذف">${icon('trash')}</button>`}
    </div>
    <div class="chips">${roadChips}</div>${warn}
    <div class="tabs" role="tablist">
      ${[['summary', 'خلاصه', 'eye'], ['schedule', 'زمان‌بندی', 'clock'], ['setup', 'سازه و هزینه', 'board']].map(([k, l, ic]) =>
        `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${icon(ic)}${l}</button>`).join('')}
    </div>
  </div>`;

  const body = tab === 'schedule' ? scheduleTab(site, sum, est)
    : tab === 'setup' ? setupTab(site, sum, est)
    : summaryTab(site, sum, est);

  const foot = site.draft
    ? `<div class="d-foot"><button class="btn btn-primary" data-act="save">${icon('plus')} افزودن به مقایسه</button><button class="btn btn-ghost" data-act="discard" style="flex:0 0 auto">انصراف</button></div>`
    : `<div class="d-foot"><button class="btn btn-primary" data-act="compare">${icon('compare')} مقایسه با سایر نقاط</button></div>`;
  return head + body + foot;
}

const pickDay = sum => state.dayType === 'thursday' ? sum.th : state.dayType === 'friday' ? sum.fr : sum.wk;
const dayLabelFa = () => state.dayType === 'weekday' ? 'روز کاری' : state.dayType === 'thursday' ? 'پنجشنبه' : 'جمعه';
const daySeg = (act = 'day') => `<div class="seg" role="tablist" aria-label="نوع روز">${[['weekday', 'روز کاری'], ['thursday', 'پنجشنبه'], ['friday', 'جمعه']].map(([k, l]) => `<button class="${state.dayType === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;

function summaryTab(site, sum, est) {
  const d = est.daily;
  const scoreCol = sum.score >= 65 ? 'var(--good)' : sum.score >= 45 ? 'var(--warn)' : 'var(--bad)';
  const [impV, impU] = compactParts(d.impressions);
  const [vehV, vehU] = compactParts(d.vehicles);
  const [monV, monU] = compactParts(sum.monthly);
  const exps = est.hourly.filter(h => h.vehicles > 50).map(h => h.exposure);
  const ins = insights(site, sum, est).map(t => `<li>${icon('spark')}<span>${t}</span></li>`).join('');
  return `<div class="p-sec">
    <div class="hero">
      ${ring(sum.score, scoreCol)}
      <div class="hero-txt">
        <b>${scoreLabel(sum.score)} برای دیده شدن</b>
        <span>امتیاز ترکیبی از حجم مخاطب و زمان مواجهه</span>
        <div class="conf" title="${esc(sum.sources.join(' + '))}">${[1, 2, 3, 4].map(i => `<i class="${i <= sum.confidence ? 'on' : ''}"></i>`).join('')}<small>${CONFIDENCE_FA[sum.confidence]}</small></div>
      </div>
    </div>
    <div style="margin-top:14px">${daySeg()}</div>
    <div class="kpis">
      <div class="kpi hl"><div class="kpi-l">${icon('eye')} ایمپرشن روزانه</div><div class="kpi-v">${impV}<small>${impU}</small></div><div class="kpi-s">دیده‌شدن مؤثر (VAC)</div></div>
      <div class="kpi"><div class="kpi-l">${icon('car')} تردد روزانه</div><div class="kpi-v">${vehV}<small>${vehU}</small></div><div class="kpi-s">${compact(d.ots)} نفر در معرض دید</div></div>
      <div class="kpi"><div class="kpi-l">${icon('clock')} زمان مواجهه</div><div class="kpi-v">${num1(d.avgExposure)}<small>ثانیه</small></div><div class="kpi-s">از ${num1(Math.min(...exps))} تا ${num1(Math.max(...exps))} ثانیه</div></div>
      <div class="kpi"><div class="kpi-l">${icon('speed')} میانگین سرعت</div><div class="kpi-v">${Math.round(d.avgSpeed)}<small>km/h</small></div><div class="kpi-s">سرعت آزاد <bdi dir="ltr">${Math.round(est.freeFlow)} km/h</bdi></div></div>
      <div class="kpi wide"><div><div class="kpi-l">${icon('board')} ایمپرشن ماهانه</div><div class="kpi-v">${monV}<small>${monU}</small></div></div>
        <div style="text-align:left"><div class="kpi-l" style="justify-content:flex-end">${icon('money')} CPM</div><div class="kpi-v">${sum.cpm ? compact(sum.cpm) : '—'}<small>${sum.cpm ? 'تومان' : ''}</small></div>${sum.cpm ? '' : '<div class="kpi-s"><a href="#" data-act="go-price" style="color:var(--accent)">قیمت را وارد کنید</a></div>'}</div></div>
    </div>
  </div>
  <div class="p-sec"><div class="sec-title"><span>بینش‌ها</span></div><ul class="insights">${ins}</ul></div>
  ${sourcesSec(site)}`;
}

function scheduleTab(site, sum, est) {
  const d = est.daily;
  const top = est.hourly.slice().sort((a, b) => b.impressions - a.impressions).slice(0, 6);
  const rows = top.map(h => `<tr><td class="ltr">${hourLabel(h.h)}</td><td>${num(h.impressions)}</td><td>${num(h.vehicles)}</td><td><bdi dir="ltr">${Math.round(h.speed)} km/h</bdi></td><td>${num1(h.exposure)} ث</td></tr>`).join('');
  return `<div class="p-sec">
    ${daySeg()}
    <div class="sec-title" style="margin-top:16px"><span>ایمپرشن و سرعت در طول ${dayLabelFa()}</span></div>
    <div class="chart-box" id="chartHourly"></div>
    <div class="legend"><span><i style="background:${site.color}"></i>ایمپرشن ساعتی</span><span><i class="line" style="background:var(--warn)"></i>سرعت (km/h، محور چپ)</span><span>ساعات طلایی: <b style="color:var(--text)">${hourRange(d.peak)}</b></span></div>
  </div>
  <div class="p-sec">
    <div class="sec-title"><span>نقشه حرارتی هفته</span><span class="chip">ایمپرشن هر ساعت</span></div>
    <div class="chart-box" id="chartHeat"></div>
    <div class="legend"><span>کم</span><span class="heat-scale" style="--c:${site.color}"></span><span>زیاد</span><span>· برای خرید ساعتی تابلوهای دیجیتال</span></div>
  </div>
  <div class="p-sec">
    <div class="sec-title"><span>پربازدیدترین ساعت‌ها — ${dayLabelFa()}</span></div>
    <div class="tbl-wrap"><table class="mini-tbl"><thead><tr><th>ساعت</th><th>ایمپرشن</th><th>تردد</th><th>سرعت</th><th>مواجهه</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

function visCard(site, est) {
  const g = est.geo[0];
  if (!g) return '';
  const spec = g.spec;
  const vFree = est.freeFlow, vPeak = Math.max(5, Math.min(...est.hourly.map(h => h.speed)));
  const tFree = g.window / (vFree / 3.6), tPeak = Math.min(60, g.window / (vPeak / 3.6));
  // ── top-down diagram: traffic drives right → left toward the face at x0
  const W = 360, x0 = 40, span = 300, laneH = 11, top = 46;
  const R = Math.max(g.legible, Math.min(g.sight, g.legible * 1.35), 120) + 20;
  const X = m => x0 + Math.min(m, R) / R * span;
  const roadH = laneH * g.lanes.length + 6;
  const H = top + roadH + 46;
  let lanes = '';
  for (let i = 1; i < g.lanes.length; i++) lanes += `<line x1="${x0 - 30}" x2="${W - 8}" y1="${top + 3 + laneH * i}" y2="${top + 3 + laneH * i}" class="vd-lane"/>`;
  // lane i = 0 is the lane nearest the board (top edge)
  const bands = g.lanes.map((l, i) => `<rect x="${X(l.cutoff)}" y="${top + 3 + laneH * i + 2}" width="${Math.max(2, X(l.start) - X(l.cutoff))}" height="${laneH - 4}" rx="2" class="vd-win"/>`).join('');
  const face = spec.mount === 'overhead'
    ? `<rect x="${x0 - 4}" y="${top - 6}" width="8" height="${roadH + 12}" rx="2" class="vd-face"/><text x="${x0}" y="${top - 11}" text-anchor="middle" class="vd-t">پل</text>`
    : `<rect x="${x0 - 3}" y="${top - 8 - Math.min(14, spec.setback)}" width="${Math.max(10, spec.w * 1.4)}" height="5" rx="1.5" class="vd-face"/><text x="${x0 + 4}" y="${top - 14 - Math.min(14, spec.setback)}" text-anchor="middle" class="vd-t">تابلو</text>`;
  const legX = X(g.legible), sightX = X(g.sight);
  const sightMark = g.sight < g.legible - 10
    ? `<line x1="${sightX}" x2="${sightX}" y1="${top - 4}" y2="${top + roadH + 4}" class="vd-sight"/><text x="${sightX}" y="${top + roadH + 16}" text-anchor="middle" class="vd-t warn">پیچ جاده · ${num(g.sight)} م</text>` : '';
  const avgCut = g.lanes.reduce((a, l) => a + l.cutoff, 0) / g.lanes.length;
  const avgStart = avgCut + g.window;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart vd" dir="ltr" role="img" aria-label="هندسه دید تابلو">
    <rect x="${x0 - 30}" y="${top}" width="${W - x0 + 22}" height="${roadH}" rx="3" class="vd-road"/>
    ${lanes}${bands}
    <line x1="${legX}" x2="${legX}" y1="${top - 4}" y2="${top + roadH + 4}" class="vd-leg"/>
    <text x="${Math.min(W - 30, legX)}" y="${top - 9}" text-anchor="middle" class="vd-t">خوانایی از ${num(g.legible)} م</text>
    ${sightMark}${face}
    <text x="${W - 12}" y="${top + roadH / 2 + 4}" text-anchor="middle" class="vd-arrow">←</text>
    <line x1="${X(avgCut)}" x2="${X(avgStart)}" y1="${H - 14}" y2="${H - 14}" class="vd-dim"/>
    <line x1="${X(avgCut)}" x2="${X(avgCut)}" y1="${H - 19}" y2="${H - 9}" class="vd-dim"/><line x1="${X(avgStart)}" x2="${X(avgStart)}" y1="${H - 19}" y2="${H - 9}" class="vd-dim"/>
    <text x="${(X(avgCut) + X(avgStart)) / 2}" y="${H - 19}" text-anchor="middle" class="vd-t acc">پنجره دید ≈ ${num(g.window)} م</text>
  </svg>`;
  const b = site.board || {};
  return `<div class="p-sec">
    <div class="sec-title"><span>هندسه دید و زمان مواجهه</span><span class="chip">${esc(g.label.replace('ترافیک ', ''))}</span></div>
    <div class="chart-box">${svg}</div>
    <div class="vd-stats">
      <div><small>عرض سواره‌رو</small><b>${num1(g.roadW)} م</b><span>${g.lanes.length} خط${site.road.width ? ' · OSM' : ' · تخمینی'}</span></div>
      <div><small>فاصله خوانایی</small><b>${num(g.legible)} م</b><span>تابلو ${num1(spec.w)}×${num1(spec.h)} متر</span></div>
      <div><small>دید مستقیم</small><b>${g.sight >= VIS.sightMax ? `${num(VIS.sightMax)}+` : num(g.sight)} م</b><span>${g.limitedBy === 'sight' ? 'پیچ جاده محدودش کرده' : 'مانعی ندارد'}</span></div>
      <div><small>زمان مواجهه</small><b>${num1(tFree)} تا ${num1(tPeak)} ث</b><span>سرعت آزاد تا اوج ترافیک</span></div>
    </div>
    <div class="grid3">
      <div class="field"><label for="bdW">عرض تابلو</label><div class="inp-wrap sm"><input id="bdW" class="inp ltr" inputmode="decimal" data-act="board" data-k="w" placeholder="${FORMATS[site.format].w}" value="${b.w ?? ''}"><span class="unit">م</span></div></div>
      <div class="field"><label for="bdH">ارتفاع تابلو</label><div class="inp-wrap sm"><input id="bdH" class="inp ltr" inputmode="decimal" data-act="board" data-k="h" placeholder="${FORMATS[site.format].h}" value="${b.h ?? ''}"><span class="unit">م</span></div></div>
      ${spec.mount === 'side' ? `<div class="field"><label for="bdS">فاصله از لبه جاده</label><div class="inp-wrap sm"><input id="bdS" class="inp ltr" inputmode="decimal" data-act="board" data-k="setback" placeholder="${FORMATS[site.format].setback}" value="${b.setback ?? ''}"><span class="unit">م</span></div></div>` : ''}
    </div>
    <small class="hint-sm">هر متر ارتفاع تابلو حدود ${VIS.legiblePerMetre} متر فاصله خوانایی می‌دهد. تابلوی کنار جاده وقتی بیش از ${VIS.coneDeg} درجه از امتداد جاده فاصله بگیرد از دید راحت خارج می‌شود؛ برای همین خطوط دورتر پنجره کوتاه‌تری دارند.</small>
  </div>`;
}

function setupTab(site, sum, est) {
  const r = site.road;
  const { all, facing } = directionsFor(site);
  const ov = site.overrides || {};
  const cands = (site.candidates || []).length > 1 ? `<div class="field"><label for="selRoad">معبر</label>
      <select class="sel" id="selRoad" data-act="road">${site.candidates.map((c, i) => `<option value="${i}" ${c.name === r.name && c.cls === r.cls && c.bearing === r.bearing ? 'selected' : ''}>${esc(c.name || 'بی‌نام')} · ${esc(ROAD_CLASSES[c.cls]?.short)} · ${c.distance} متر</option>`).join('')}</select></div>` : '';
  const fmtList = Object.entries(FORMATS).map(([k, f]) => `<button class="fmt ${site.format === k ? 'on' : ''}" data-act="format" data-v="${k}"><span class="dot"></span><span><b>${f.fa}</b><small>${f.hint} · ${f.w}×${f.h} متر · خوانا از ${legibleFor(f)} متری</small></span></button>`).join('');
  const facingBtns = [
    ...all.map(a => `<button class="${site.facing === a.key ? 'on' : ''}" data-act="facing" data-v="${a.key}"><b>${a.arrow}</b>${a.label.replace('ترافیک ', '')}</button>`),
    `<button class="${site.facing === 'both' ? 'on' : ''}" data-act="facing" data-v="both"><b>⇅</b>هر دو جهت (دو رو)</button>`,
  ].join('');
  return `<div class="p-sec">
    <div class="sec-title"><span>قیمت و کمپین</span></div>
    <div class="grid2">
      <div class="field"><label for="inpPrice">اجاره ماهانه</label><div class="inp-wrap"><input id="inpPrice" class="inp ltr" inputmode="numeric" data-act="price" placeholder="450,000,000" value="${site.price ? num(site.price) : ''}"><span class="unit">تومان</span></div></div>
      <div class="field"><label for="inpWeeks">مدت کمپین</label><div class="inp-wrap"><input id="inpWeeks" class="inp ltr" inputmode="numeric" data-act="weeks" value="${state.settings.campaignWeeks}"><span class="unit">هفته</span></div></div>
    </div>
    <div class="camp">
      <div class="kpi"><div class="kpi-l">ایمپرشن کل کمپین</div><div class="kpi-v">${compact(sum.campaign.impressions)}</div></div>
      <div class="kpi"><div class="kpi-l">هزینه کمپین</div><div class="kpi-v" style="font-size:17px">${sum.campaign.cost ? toman(sum.campaign.cost) : '—'}</div></div>
      <div class="kpi"><div class="kpi-l">CPM</div><div class="kpi-v" style="font-size:17px">${sum.cpm ? toman(sum.cpm) : '—'}</div></div>
    </div>
  </div>
  <div class="p-sec">
    <div class="sec-title"><span>نوع سازه</span></div>
    <div class="fmt-list">${fmtList}</div>
    ${site.format === 'digital' ? `<div class="field" style="margin-top:12px"><label for="inpLoop">سهم نمایش آگهی شما در چرخه</label><div class="inp-wrap"><input id="inpLoop" class="inp ltr" inputmode="numeric" data-act="loop" value="${Math.round((site.loopShare ?? 1) * 100)}"><span class="unit">درصد</span></div><small>اگر آگهی شما 1 اسلات از 6 اسلات است، 17٪ وارد کنید.</small></div>` : ''}
  </div>
  <div class="p-sec">
    <div class="sec-title"><span>تابلو رو به کدام ترافیک است؟</span></div>
    <div class="facing">${facingBtns}</div>
  </div>
  ${visCard(site, est)}
  <div class="p-sec">
    <details class="adv" ${ov && Object.keys(ov).length ? 'open' : ''}>
      <summary><span>مشخصات معبر و فرض‌های محاسبه</span>${icon('chev')}</summary>
      <div class="adv-body">
        ${cands}
        <div class="grid2">
          <div class="field"><label for="selCls">نوع معبر</label><select class="sel" id="selCls" data-act="cls">${Object.entries(ROAD_CLASSES).map(([k, c]) => `<option value="${k}" ${r.cls === k ? 'selected' : ''}>${c.fa}</option>`).join('')}</select></div>
          <div class="field"><label for="ovLanes">خط در هر جهت</label><input class="inp ltr" id="ovLanes" inputmode="numeric" data-act="ov" data-k="lanes" placeholder="${facing[0]?.lanes ?? ''}" value="${ov.lanes ?? ''}"></div>
          <div class="field"><label for="ovFree">سرعت آزاد (km/h)</label><input class="inp ltr" id="ovFree" inputmode="numeric" data-act="ov" data-k="freeFlow" placeholder="${Math.round(est.freeFlow)}" value="${ov.freeFlow ?? ''}"></div>
          <div class="field"><label for="ovVis">فاصله دید تابلو (متر)</label><input class="inp ltr" id="ovVis" inputmode="numeric" data-act="ov" data-k="visDist" placeholder="${est.visDist}" value="${ov.visDist ?? ''}"></div>
        </div>
        <div class="field"><label for="ovVol">حجم تردد واقعی (اگر دارید)</label><div class="inp-wrap"><input class="inp ltr" id="ovVol" inputmode="numeric" data-act="ov" data-k="dailyVolume" placeholder="${num(sum.wk.daily.vehicles)}" value="${ov.dailyVolume ? num(ov.dailyVolume) : ''}"><span class="unit">خودرو/روز</span></div><small>مجموع جهت‌های رو به تابلو در روز کاری؛ از آمار شرکت کنترل ترافیک یا مالک سازه.</small></div>
        <div class="field"><label for="ovNotice">احتمال توجه در زمان کافی</label><div class="inp-wrap"><input class="inp ltr" id="ovNotice" inputmode="numeric" data-act="ov" data-k="notice" placeholder="${Math.round(est.notice * 100)}" value="${ov.notice ? Math.round(ov.notice * 100) : ''}"><span class="unit">درصد</span></div></div>
        ${Object.keys(ov).length ? `<button class="btn btn-ghost btn-block" data-act="reset-ov" style="margin-bottom:12px">${icon('refresh')} بازگشت به مقادیر پیش‌فرض</button>` : ''}
      </div>
    </details>
  </div>`;
}

function sourcesSec(site) {
  const r = site.road, live = site.live, st = state.settings;
  const has = anyConfigured(st);
  const row = (label, s, extra = '') => `<div class="src-row"><i class="st ${s === 'ok' ? 'ok' : s === 'err' ? 'err' : s === 'wait' ? 'wait' : ''}"></i><span>${label}</span><small>${extra}</small></div>`;
  const via = k => {
    const p = live?.via?.[k], tried = live?.tried?.[k] || [];
    if (!p) return liveLabel(live?.status?.[k]);
    const fell = tried.length > 1 && tried[0] !== p;
    return `${PROVIDERS[p].fa}${fell ? ' (جایگزین)' : ''}`;
  };
  if (DEMO) return `<div class="p-sec">
    <div class="sec-title"><span>منابع داده این نقطه</span></div>
    ${row('هندسه معبر: نقشه ساده‌شده تهران (تقریبی)', 'ok', r.distance != null ? `${r.distance} متر` : '')}
    ${row('مدل ترافیک تهران (پروفایل ساعتی)', 'ok', 'فعال')}
    ${row('داده زنده نشان / Map.ir', '', 'فقط در نسخه نصب‌شده')}
  </div>`;
  return `<div class="p-sec">
    <div class="sec-title"><span>منابع داده این نقطه</span>${has ? `<a href="#" class="link" data-act="refresh-live">به‌روزرسانی</a>` : `<a href="#" class="link" data-act="settings">اتصال داده زنده</a>`}</div>
    ${row('هندسه و مشخصات معبر — OpenStreetMap', r.source === 'osm' ? 'ok' : 'err', r.source === 'osm' ? `${r.distance ?? 0} متر` : 'دستی')}
    ${row('مدل ترافیک تهران (پروفایل ساعتی)', 'ok', 'همیشه فعال')}
    ${live?.shared ? row('الگوی ترافیک 24 ساعته', live.status.traffic, `نشان · به‌روزرسانی هفتگی (${new Date(live.at).toLocaleDateString('fa-IR-u-nu-latn')})`) : row('الگوی ترافیک 24 ساعته', !has ? '' : live?.status?.traffic || '', !has ? 'بدون کلید' : via('traffic'))}
    ${live?.shared ? row('سرعت مسیر', live.status.speed, live.speed ? `<bdi dir="ltr">${Math.round(live.speed.kmh)} km/h</bdi> · نشان، هفتگی` : '—') : row('سرعت مسیر', !has ? '' : live?.status?.speed || '', !has ? 'بدون کلید' : live?.speed ? `<bdi dir="ltr">${Math.round(live.speed.kmh)} km/h</bdi> · ${via('speed')}` : via('speed'))}
  </div>`;
}

function liveLabel(st) {
  return st === 'ok' ? 'دریافت شد' : st === 'wait' ? 'در حال دریافت…' : st === 'err' ? 'خطا' : st === 'empty' ? 'داده‌ای نبود' : '—';
}

function insights(site, sum, est) {
  const out = [];
  const d = est.daily;
  out.push(`بیشترین ایمپرشن در ساعات <b>${hourRange(d.peak)}</b> است${site.format === 'digital' ? ' — برای تابلو دیجیتال این ساعات را رزرو کنید.' : '.'}`);
  const minExp = Math.min(...est.hourly.filter(h => h.vehicles > 50).map(h => h.exposure));
  if (minExp < 6) out.push(`در ساعات خلوت مواجهه به <b>${num1(minExp)} ثانیه</b> می‌رسد؛ پیام را زیر <b>7 کلمه</b> و با لوگوی درشت طراحی کنید.`);
  else out.push(`حداقل زمان مواجهه <b>${num1(minExp)} ثانیه</b> است؛ جا برای یک پیام کوتاه به‌همراه پیشنهاد (آفر) وجود دارد.`);
  if (site.facing !== 'both') {
    const both = summarize({ ...site, facing: 'both' }, state.settings);
    const gain = both.wk.daily.impressions / Math.max(1, sum.wk.daily.impressions) - 1;
    if (gain > 0.05) out.push(`اجاره نمای دوم (جهت مقابل) ایمپرشن را حدود <b>${Math.round(gain * 100)}٪</b> بیشتر می‌کند.`);
  }
  const g = est.geo?.[0];
  if (g?.limitedBy === 'sight') out.push(`پیچ جاده دید مستقیم را به <b>${num(g.sight)} متر</b> محدود کرده (تابلو از ${num(g.legible)} متر خواناست)؛ جابه‌جایی چندصد متری به سمت بخش مستقیم، زمان مواجهه را بیشتر می‌کند.`);
  else if (g) out.push(`عرض سواره‌رو حدود <b>${num1(g.roadW)} متر</b> است؛ هر راننده حدود <b>${num(g.window)} متر</b> فرصت دیدن تابلو را دارد.`);
  if (site.clutter) out.push(`<b>${site.clutter}</b> تابلوی دیگر در شعاع ${VIS.clutterRadius} متری هست؛ توجه بین آن‌ها تقسیم می‌شود (${Math.round(Math.min(30, site.clutter * VIS.clutterPenalty * 100))}٪ کاهش در برآورد).`);
  const fri = sum.fr.daily.impressions / Math.max(1, sum.wk.daily.impressions);
  out.push(`ایمپرشن جمعه‌ها حدود <b>${Math.round((1 - fri) * 100)}٪</b> کمتر از روز کاری است.`);
  if (!site.price) out.push('با وارد کردن اجاره ماهانه، هزینه هر هزار ایمپرشن (CPM) محاسبه و در مقایسه رتبه‌بندی می‌شود.');
  if (!anyConfigured(state.settings)) out.push('این برآورد بر پایه مدل است. برای وارد کردن الگوی ترافیک واقعی این نقطه، کلید نشان یا Map.ir را در تنظیمات وارد کنید.');
  return out;
}

function mountDetailCharts(site) {
  const sum = summarize(site, state.settings);
  const est = pickDay(sum);
  const host = $('#chartHourly');
  if (host) hourlyChart(host, est.hourly, { color: site.color, nowHour: tehranHour(), peak: est.daily.peak });
  const heat = $('#chartHeat');
  if (heat) heatmap(heat, sum.grid, { rows: WEEK.map(w => w.fa), color: site.color });
}

// ════════════════════════════════════════════════════════════
//  panel events
// ════════════════════════════════════════════════════════════
function onPanelClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const s = selected();
  if (['name', 'price', 'weeks', 'ov', 'loop', 'road', 'cls', 'board', 'fd-fmt', 'fd-num'].includes(act)) return; // handled on change
  e.preventDefault();
  switch (act) {
    case 'open': {
      selectSite(t.dataset.id);
      const site = findSite(t.dataset.id);
      if (site) map.flyTo([site.lat, site.lng], Math.max(map.getZoom(), DEMO ? 14 : 15), { duration: 0.6 });
      break;
    }
    case 'toggle-cmp': {
      e.stopPropagation();
      const site = findSite(t.dataset.id); site.inCompare = site.inCompare === false; emit('cmp'); break;
    }
    case 'back': backToList(); break;
    case 'save': {
      s.draft = false; delete s.draft; state.sites.push(s); state.draft = null;
      emit('save'); toast('به فهرست مقایسه اضافه شد', 'ok'); break;
    }
    case 'discard': state.draft = null; state.selectedId = null; drawAllSites(); renderPanel(); break;
    case 'delete': {
      state.sites = state.sites.filter(x => x.id !== s.id); state.selectedId = null; emit('delete'); break;
    }
    case 'format': s.format = t.dataset.v; if (s.autoName) s.name = autoName(s); commit(s); break;
    case 'facing': s.facing = t.dataset.v; commit(s); if (anyConfigured(state.settings)) fetchLive(s); break;
    case 'day': state.dayType = t.dataset.v; renderPanel(); save(); break;
    case 'tab': state.detailTab = t.dataset.v; $('#panelBody').scrollTop = 0; renderPanel(); break;
    case 'go-price': state.detailTab = 'setup'; renderPanel(); setTimeout(() => $('#inpPrice')?.focus(), 30); break;
    case 'samples': loadSamples(); break;
    case 'open-plan': openPlanner('plan'); break;
    case 'open-board': openPlanner('board'); break;
    case 'ltab':
      state.listTab = t.dataset.v; state.mapMode = null; setModeHint(null); document.body.classList.remove('picking'); map.closePopup();
      if (state.listTab === 'sites' && !state.sites.length) setModeHint('روی هر نقطه از بزرگراه یا پل کلیک کنید تا تحلیل شود');
      if (state.listTab === 'inventory') { setStructuresLayer(true); }
      if (state.listTab !== 'finder' && finderLayer && !state.finder.result) drawFinder();
      renderPanel(); if (state.listTab === 'inventory') rerank();
      break;
    case 'guide-close': state.guide = null; renderPanel(); break;
    case 'inv-filter': state.invFilter = t.dataset.v; rerank(); break;
    case 'sc-mode': {
      const v = t.dataset.v, S = state.scope;
      S.mode = v;
      if (v === 'district') { setDistrictLayer(true).then(highlightDistricts); if (S.districts.length) { selectDistricts(S.districts); break; } }
      renderPanel(); rerank(); break;
    }
    case 'sc-dist': { map.closePopup(); const n = +t.dataset.v, S = state.scope; selectDistricts(S.districts.includes(n) ? S.districts.filter(x => x !== n) : [...S.districts, n]); break; }
    case 'sc-clear': e.preventDefault(); state.scope.districts = []; state.scope.mode = 'district'; highlightDistricts(); renderPanel(); rerank(); break;
    case 'sc-sort': state.scope.sort = t.dataset.v; rerank(); break;
    case 'sc-plan': state.plan.districts = [...state.scope.districts]; state.plan.excludes = {}; openPlanner('plan'); break;
    case 'sc-board': state.board.districts = [...state.scope.districts]; openPlanner('board'); break;
    case 'inv-import': openImport(); break;
    case 'inv-catalog': loadCatalogSample(); break;
    case 'inv-add':
      state.mapMode = state.mapMode === 'addStructure' ? null : 'addStructure';
      document.body.classList.toggle('picking', !!state.mapMode);
      setModeHint(state.mapMode ? 'روی محل سازه موجود کلیک کنید' : null);
      if (state.mapMode && map.getZoom() < 14) map.setZoom(14);
      renderPanel(); break;
    case 'inv-focus': {
      e.preventDefault();
      const st = allStructures().find(x => x.id === t.dataset.id); if (!st) break;
      map.flyTo([st.lat, st.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
      setTimeout(() => invLayer?.eachLayer(l => { const ll = l.getLatLng(); if (Math.abs(ll.lat - st.lat) < 1e-7 && Math.abs(ll.lng - st.lng) < 1e-7) l.openPopup(); }), 650);
      break;
    }
    case 'inv-analyze': {
      const st = allStructures().find(x => x.id === t.dataset.id); if (!st) break;
      e.stopPropagation();
      analyzeAt(st.lat, st.lng, { format: TYPE_TO_FORMAT[st.type] || null, name: st.name, price: st.price || null, facing: st.type === 'bridge' ? 'both' : undefined });
      break;
    }
    case 'fd-cls': {
      const o = state.finder.opts, v = t.dataset.v;
      o.classes = o.classes.includes(v) ? o.classes.filter(x => x !== v) : [...o.classes, v];
      renderPanel(); break;
    }
    case 'fd-run': runFinder(); break;
    case 'fd-scope': {
      const S = state.scope;
      if (t.dataset.v === 'district') { S.mode = 'district'; setDistrictLayer(true); if (!state.plan.entries) evaluateMarket().then(() => renderPanel()); }
      else S.mode = 'view';
      renderPanel(); break;
    }
    case 'fd-clear': state.finder.result = null; state.finder.status = 'idle'; drawFinder(); renderPanel(); break;
    case 'fd-focus': { const p = state.finder.result.picks[+t.dataset.i]; map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.5 }); break; }
    case 'fd-analyze': {
      e.stopPropagation();
      const i = +t.dataset.i, p = state.finder.result.picks[i];
      analyzeAt(p.lat, p.lng, { format: p.format, name: `جایگاه پیشنهادی ${i + 1} — ${p.road}`, facing: p.facing });
      break;
    }
    case 'reset-ov': s.overrides = {}; commit(s); break;
    case 'refresh-live': fetchLive(s); break;
    case 'settings': openSettings(); break;
    case 'compare': openCompare(); break;
    case 'share': copyShare(); break;
    case 'csv': exportCSV(); break;
    case 'copy-tsv': copyTable(); break;
    case 'clear':
      if (confirmInline(t, 'برای حذف همه دوباره بزنید')) { state.sites = []; state.selectedId = null; emit('clear'); }
      break;
  }
}

function confirmInline(btn, msg) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  toast(msg);
  setTimeout(() => { delete btn.dataset.armed; }, 3000);
  return false;
}

function commit(site) {
  if (site.draft) { renderPanel(); drawAllSites(); } else emit('edit');
}

function onPanelChange(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'fd-fmt') { state.finder.opts.format = t.value; return; }
  if (t.dataset.act === 'fd-num') { const v = parseNum(t.value); if (v > 0) state.finder.opts[t.dataset.k] = Math.round(v); return; }
  const s = selected();
  if (!s) return;
  const act = t.dataset.act;
  if (act === 'name') { s.name = t.value.trim() || s.name; s.autoName = false; commit(s); }
  else if (act === 'price') { s.price = parseNum(t.value) || null; commit(s); }
  else if (act === 'weeks') { const w = parseNum(t.value); if (w > 0 && w < 105) state.settings.campaignWeeks = Math.round(w); commit(s); }
  else if (act === 'loop') { const v = parseNum(t.value); s.loopShare = v > 0 && v <= 100 ? v / 100 : 1; commit(s); }
  else if (act === 'ov') {
    const k = t.dataset.k; let v = parseNum(t.value);
    s.overrides = { ...(s.overrides || {}) };
    if (v == null || v <= 0) delete s.overrides[k];
    else { if (k === 'notice') v = Math.min(100, v) / 100; s.overrides[k] = v; }
    commit(s);
  } else if (act === 'road') {
    s.road = s.candidates[+t.value]; s.roadWarn = null;
    if (s.autoName) s.name = autoName(s);
    commit(s); fetchLive(s);
  } else if (act === 'board') {
    const v = parseNum(t.value);
    s.board = { ...(s.board || {}) };
    if (v == null || v <= 0) delete s.board[t.dataset.k]; else s.board[t.dataset.k] = v;
    commit(s);
  } else if (act === 'cls') {
    s.road = { ...s.road, cls: t.value }; commit(s);
  }
}

function onPanelInput(e) {
  const t = e.target;
  if (t.dataset.act === 'name') {
    const s = selected(); if (!s) return;
    s.name = t.value; s.autoName = false;
    siteLayers.get(s.id)?.eachLayer(l => l.getTooltip?.()?.setContent(esc(s.name)));
  }
}

function backToList() {
  if (state.draft) { state.draft = null; }
  state.selectedId = null;
  drawAllSites(); renderPanel();
}

// ════════════════════════════════════════════════════════════
//  comparison
// ════════════════════════════════════════════════════════════
function openCompare() {
  const sites = state.sites.filter(s => s.inCompare !== false);
  if (state.draft && state.selectedId === state.draft.id) { toast('اول این نقطه را به مقایسه اضافه کنید'); return; }
  if (!sites.length) { toast('حداقل یک نقطه را برای مقایسه انتخاب کنید'); return; }
  state.sheet = 'compare';
  $('#sheet').hidden = false;
  renderCompare();
}

function renderCompare() {
  const sites = state.sites.filter(s => s.inCompare !== false && isReady(s));
  const rows = sites.map(s => ({ s, idx: state.sites.indexOf(s), sum: summarize(s, state.settings) }));
  const pick = r => state.dayType === 'thursday' ? r.sum.th : state.dayType === 'friday' ? r.sum.fr : r.sum.wk;
  const best = (fn, dir = 1) => rows.reduce((a, b) => (fn(b) ?? -Infinity) * dir > (fn(a) ?? -Infinity) * dir ? b : a, rows[0]);
  const bImp = best(r => pick(r).daily.impressions);
  const bExp = best(r => pick(r).daily.avgExposure);
  const priced = rows.filter(r => r.sum.cpm);
  const bCpm = priced.length ? priced.reduce((a, b) => b.sum.cpm < a.sum.cpm ? b : a) : null;
  const bScore = best(r => r.sum.score);

  const win = (label, r, val) => r ? `<div class="win"><div class="win-l">${icon('spark')}${label}</div><div class="win-n"><i style="background:${r.s.color}"></i>${esc(r.s.name)}</div><div class="win-v">${val}</div></div>` : '';

  const metrics = [
    ['امتیاز دیده‌شدن', r => r.sum.score, v => `${v}/100`, 1],
    ['نوع معبر', r => ROAD_CLASSES[r.s.road.cls]?.short, v => esc(v), 0],
    ['نوع سازه', r => FORMATS[r.s.format]?.fa, v => esc(v), 0],
    ['جهت دید', r => r.s.facing === 'both' ? 'هر دو جهت' : directionsFor(r.s).facing[0]?.label.replace('ترافیک ', ''), v => esc(v), 0],
    ['تردد روزانه (خودرو)', r => pick(r).daily.vehicles, num, 1],
    ['افراد در معرض دید/روز', r => pick(r).daily.ots, num, 1],
    ['ایمپرشن روزانه', r => pick(r).daily.impressions, num, 1],
    ['ایمپرشن ماهانه', r => r.sum.monthly, num, 1],
    ['میانگین زمان مواجهه', r => pick(r).daily.avgExposure, v => `${num1(v)} ثانیه`, 1],
    ['میانگین سرعت', r => pick(r).daily.avgSpeed, v => `<bdi dir="ltr">${Math.round(v)} km/h</bdi>`, 0],
    ['ساعات طلایی', r => hourRange(pick(r).daily.peak), v => v, 0],
    ['اجاره ماهانه', r => r.s.price, v => v ? toman(v) : '—', 0],
    ['CPM (تومان)', r => r.sum.cpm, v => v ? num(v) : '—', -1],
    [`ایمپرشن کمپین ${state.settings.campaignWeeks} هفته‌ای`, r => r.sum.campaign.impressions, num, 1],
    ['سطح اطمینان داده', r => CONFIDENCE_FA[r.sum.confidence], v => v, 0],
  ];
  const tbody = metrics.map(([label, get, f, dir]) => {
    const vals = rows.map(get);
    let bestI = -1;
    if (dir && rows.length > 1) {
      const nums = vals.map(v => (typeof v === 'number' && v) ? v : null);
      const cand = nums.filter(v => v != null);
      if (cand.length > 1) {
        const target = dir > 0 ? Math.max(...cand) : Math.min(...cand);
        bestI = nums.indexOf(target);
      }
    }
    return `<tr><th>${label}</th>${vals.map((v, i) => `<td class="${i === bestI ? 'best' : ''}">${f(v)}</td>`).join('')}</tr>`;
  }).join('');
  const thead = `<tr><th></th>${rows.map(r => `<th><span class="th-site"><i style="background:${r.s.color}">${r.idx + 1}</i>${esc(r.s.name)}</span></th>`).join('')}</tr>`;

  const maxM = Math.max(...rows.map(r => r.sum.monthly));
  const bars = rows.slice().sort((a, b) => b.sum.monthly - a.sum.monthly).map(r => `<div class="hbar-row"><span class="nm">${esc(r.s.name)}</span><span class="tr"><i style="width:${(r.sum.monthly / maxM * 100).toFixed(1)}%;background:${r.s.color}"></i></span><span class="vl">${compact(r.sum.monthly)}</span></div>`).join('');
  const cpmBars = priced.length ? (() => {
    const mx = Math.max(...priced.map(r => r.sum.cpm));
    return priced.slice().sort((a, b) => a.sum.cpm - b.sum.cpm).map(r => `<div class="hbar-row"><span class="nm">${esc(r.s.name)}</span><span class="tr"><i style="width:${(r.sum.cpm / mx * 100).toFixed(1)}%;background:${r.s.color}"></i></span><span class="vl">${compact(r.sum.cpm)}</span></div>`).join('');
  })() : '<p class="s-desc">برای مقایسه CPM، اجاره ماهانه هر نقطه را در صفحه آن وارد کنید.</p>';

  const totImp = rows.reduce((a, r) => a + r.sum.campaign.impressions, 0);
  const totCost = rows.reduce((a, r) => a + (r.sum.campaign.cost || 0), 0);
  const allPriced = rows.every(r => r.s.price);
  const blended = allPriced && totImp ? totCost / (totImp / 1000) : null;
  const dayLabel = state.dayType === 'weekday' ? 'روز کاری' : state.dayType === 'thursday' ? 'پنجشنبه' : 'جمعه';

  $('#sheetInner').innerHTML = `
    <div class="s-head">
      <button class="icon-btn" data-act="close-cmp" aria-label="بستن">${icon('close')}</button>
      <h2>مقایسه ${rows.length} نقطه</h2>
      <div class="seg">${[['weekday', 'روز کاری'], ['thursday', 'پنجشنبه'], ['friday', 'جمعه']].map(([k, l]) => `<button class="${state.dayType === k ? 'on' : ''}" data-act="cmp-day" data-v="${k}">${l}</button>`).join('')}</div>
      <button class="btn btn-ghost" data-act="copy-tsv">${icon('compare')} کپی برای اکسل</button>
      ${DEMO ? '' : `<button class="btn btn-ghost" data-act="csv">${icon('download')} CSV</button>
      <button class="btn btn-ghost" data-act="print">${icon('print')} گزارش PDF</button>`}
    </div>
    <div class="s-body">
      <div class="winners">
        ${win('بهترین امتیاز کلی', bScore, `${bScore.sum.score} از 100 · ${scoreLabel(bScore.sum.score)}`)}
        ${win('بیشترین ایمپرشن', bImp, `${compact(pick(bImp).daily.impressions)} در ${dayLabel}`)}
        ${win('طولانی‌ترین مواجهه', bExp, `${num1(pick(bExp).daily.avgExposure)} ثانیه به‌طور میانگین`)}
        ${bCpm ? win('ارزان‌ترین CPM', bCpm, `${num(bCpm.sum.cpm)} تومان به ازای هر هزار ایمپرشن`) : ''}
      </div>
      <div class="tbl-wrap"><table class="cmp"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>
      <div class="s-grid">
        <div class="s-card"><h3>ایمپرشن ساعتی — ${dayLabel}</h3><p class="s-desc">برای انتخاب ساعات نمایش تابلوهای دیجیتال و زمان‌بندی کمپین‌های هم‌زمان</p>
          <div class="chart-box" id="cmpChart"></div>
          <div class="legend">${rows.map(r => `<span><i style="background:${r.s.color}"></i>${esc(r.s.name)}</span>`).join('')}</div></div>
        <div class="s-card"><h3>ایمپرشن ماهانه</h3><p class="s-desc">مجموع 30 روز با الگوی هفتگی تهران</p><div class="hbar">${bars}</div>
          <h3 style="margin-top:18px">CPM (کمتر بهتر است)</h3><p class="s-desc">تومان به ازای هر هزار ایمپرشن</p><div class="hbar">${cpmBars}</div></div>
      </div>
      <div class="s-grid">
        <div class="s-card"><h3>نقشه ارزش</h3><p class="s-desc">هر نقطه بر اساس ایمپرشن روزانه و CPM؛ گوشه پایین‌راست یعنی پربازدید و ارزان. فقط نقاط قیمت‌دار.</p>
          ${priced.length >= 2 ? '<div class="chart-box" id="valueMap"></div>' : '<p class="s-desc">برای این نمودار، اجاره ماهانه حداقل دو نقطه را وارد کنید.</p>'}</div>
        <div class="s-card" id="budgetCard">${budgetHTML()}</div>
      </div>
      <div class="s-card"><h3>برآورد کمپین با همه نقاط انتخاب‌شده</h3><p class="s-desc">${state.settings.campaignWeeks} هفته · همپوشانی مخاطب بین نقاط کسر نشده است</p>
        <div class="camp">
          <div class="kpi"><div class="kpi-l">کل ایمپرشن</div><div class="kpi-v">${compact(totImp)}</div></div>
          <div class="kpi"><div class="kpi-l">کل افراد در معرض دید</div><div class="kpi-v">${compact(rows.reduce((a, r) => a + r.sum.campaign.ots, 0))}</div></div>
          <div class="kpi"><div class="kpi-l">هزینه کل</div><div class="kpi-v" style="font-size:17px">${totCost ? toman(totCost) : '—'}</div>${allPriced ? '' : '<div class="kpi-s">قیمت همه نقاط وارد نشده</div>'}</div>
          <div class="kpi"><div class="kpi-l">CPM ترکیبی</div><div class="kpi-v">${blended ? compact(blended) : '—'}</div></div>
        </div></div>
      <p class="disclaimer">اعداد تخمینی‌اند و از مدل ترافیک تهران، مشخصات معبر در OpenStreetMap${anyConfigured(state.settings) ? ' و داده ترافیک نشان / Map.ir' : ''} به‌دست آمده‌اند. «ایمپرشن» یعنی برآورد افرادی که تابلو را واقعاً می‌بینند (Visibility-Adjusted Contact)، نه صرفاً عبورکنندگان. برای تصمیم نهایی، عدد تردد را با آمار مالک سازه یا شرکت کنترل ترافیک تطبیق دهید. تاریخ گزارش: ${new Date().toLocaleDateString('fa-IR-u-nu-latn')}</p>
    </div>`;
  multiLine($('#cmpChart'), rows.map(r => ({ name: r.s.name, color: r.s.color, values: pick(r).hourly.map(h => h.impressions) })));
  if ($('#valueMap')) valueMap($('#valueMap'), priced.map(r => ({ name: r.s.name, color: r.s.color, label: r.idx + 1, x: pick(r).daily.impressions, y: r.sum.cpm })));
}

/** Best set of priced sites within a monthly budget (exact for ≤ 16 sites, greedy by CPM beyond). */
function optimizeBudget(budget) {
  const items = state.sites.filter(s => s.price && isReady(s)).map(s => ({ s, price: s.price, imp: summarize(s, state.settings).monthly }));
  const n = items.length;
  let best = { imp: 0, cost: 0, set: [] };
  if (n <= 16) {
    for (let m = 1; m < (1 << n); m++) {
      let c = 0, imp = 0;
      for (let i = 0; i < n; i++) if (m >> i & 1) { c += items[i].price; imp += items[i].imp; }
      if (c <= budget && imp > best.imp) best = { imp, cost: c, mask: m };
    }
    best.set = items.filter((_, i) => best.mask >> i & 1);
  } else {
    let c = 0;
    items.sort((a, b) => a.price / a.imp - b.price / b.imp).forEach(it => { if (c + it.price <= budget) { c += it.price; best.set.push(it); best.imp += it.imp; } });
    best.cost = c;
  }
  return { ...best, total: n };
}

function budgetHTML() {
  const pricedSum = state.sites.filter(isReady).reduce((a, s) => a + (s.price || 0), 0);
  if (!pricedSum) return `<h3>بهینه‌ساز بودجه</h3><p class="s-desc">برای پیشنهاد بهترین ترکیب سازه‌ها، اجاره ماهانه نقاط را وارد کنید.</p>`;
  if (state.budget == null) state.budget = Math.round(pricedSum * 0.6 / 1e7) * 1e7;
  const r = optimizeBudget(state.budget);
  const left = state.budget - r.cost;
  return `<h3>بهینه‌ساز بودجه</h3><p class="s-desc">بیشترین ایمپرشن ماهانه که با این بودجه می‌شود خرید، از بین ${r.total} نقطه قیمت‌دار.</p>
    <div class="field"><label for="inpBudget">بودجه ماهانه</label><div class="inp-wrap"><input id="inpBudget" class="inp ltr" inputmode="numeric" data-act="budget" value="${num(state.budget)}"><span class="unit">تومان</span></div></div>
    ${r.set.length ? `<div class="pick-list">${r.set.map(it => `<span class="pick"><i style="background:${it.s.color}"></i>${esc(it.s.name)}<small>${toman(it.price)}</small></span>`).join('')}</div>
    <div class="camp camp-3">
      <div class="kpi"><div class="kpi-l">ایمپرشن ماهانه</div><div class="kpi-v">${compact(r.imp)}</div></div>
      <div class="kpi"><div class="kpi-l">هزینه</div><div class="kpi-v" style="font-size:16px">${toman(r.cost)}</div><div class="kpi-s">باقیمانده ${toman(left)}</div></div>
      <div class="kpi"><div class="kpi-l">CPM ترکیبی</div><div class="kpi-v" style="font-size:16px">${num(r.cost / (r.imp / 1000))}</div></div>
    </div>
    <button class="btn btn-ghost btn-block" data-act="apply-budget" data-ids="${r.set.map(it => it.s.id).join(',')}" style="margin-top:10px">فقط همین‌ها را مقایسه کن</button>`
    : '<p class="s-desc">با این بودجه هیچ نقطه‌ای قابل خرید نیست.</p>'}`;
}

async function onSheetClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  if (state.sheet === 'plan' && t.tagName !== 'INPUT' && t.tagName !== 'SELECT' && (await onBoardClick(t, e) || await onPlannerClick(t, e))) return;
  if (a === 'close-cmp') { $('#sheet').hidden = true; state.sheet = null; }
  else if (a === 'cmp-day') { state.dayType = t.dataset.v; save(); renderCompare(); renderPanel(); }
  else if (a === 'csv') exportCSV();
  else if (a === 'copy-tsv') copyTable();
  else if (a === 'print') window.print();
  else if (a === 'apply-budget') {
    const ids = new Set(t.dataset.ids.split(','));
    state.sites.forEach(s => { s.inCompare = ids.has(s.id); });
    emit('budget'); renderCompare();
    toast(`${ids.size} نقطه پیشنهادی در مقایسه ماند`, 'ok');
  }
}

function onSheetChange(e) {
  if (state.sheet === 'plan' && (onBoardChange(e.target) || onPlannerChange(e.target))) return;
  if (e.target.dataset.act !== 'budget') return;
  const v = parseNum(e.target.value);
  if (v > 0) { state.budget = v; $('#budgetCard').innerHTML = budgetHTML(); }
}

function tableRows() {
  const head = ['#', 'نام', 'عرض جغرافیایی', 'طول جغرافیایی', 'نوع معبر', 'نوع سازه', 'جهت دید', 'خط', 'امتیاز',
    'تردد روزانه (روز کاری)', 'افراد در معرض دید/روز', 'ایمپرشن روزانه', 'ایمپرشن هفتگی', 'ایمپرشن ماهانه',
    'زمان مواجهه (ثانیه)', 'سرعت میانگین', 'ساعات طلایی', 'اجاره ماهانه (تومان)', 'CPM (تومان)', 'سطح اطمینان'];
  const rows = state.sites.filter(isReady).map((s, i) => {
    const sum = summarize(s, state.settings); const d = sum.wk.daily;
    const dirs = directionsFor(s).facing;
    return [i + 1, s.name, s.lat.toFixed(6), s.lng.toFixed(6), ROAD_CLASSES[s.road.cls]?.fa, FORMATS[s.format]?.fa,
      s.facing === 'both' ? 'هر دو جهت' : dirs[0]?.label, dirs.map(x => x.lanes).join('+'), sum.score,
      Math.round(d.vehicles), Math.round(d.ots), Math.round(d.impressions), Math.round(sum.weekly), Math.round(sum.monthly),
      d.avgExposure.toFixed(1), Math.round(d.avgSpeed), hourRange(d.peak), s.price || '', sum.cpm ? Math.round(sum.cpm) : '', CONFIDENCE_FA[sum.confidence]];
  });
  return [head, ...rows];
}

/** Copy to clipboard; when the browser refuses, show the text selected so Ctrl+C works. */
function copyText(text, okMsg) {
  const fallback = () => {
    const d = $('#dlgCopy');
    d.innerHTML = `<div class="dlg-head"><h2>کپی دستی</h2><button class="icon-btn" data-close aria-label="بستن">${icon('close')}</button></div>
      <div class="dlg-body"><p>مرورگر اجازه کپی خودکار نداد. متن زیر انتخاب شده است؛ Ctrl+C (یا ⌘+C) را بزنید و در اکسل یا گوگل‌شیت Paste کنید.</p>
      <textarea id="copyArea" class="inp ta ltr" rows="10" readonly></textarea></div>
      <div class="dlg-foot"><button class="btn btn-ghost" data-close>بستن</button></div>`;
    d.querySelector('#copyArea').value = text;
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
    d.showModal();
    const ta = d.querySelector('#copyArea'); ta.focus(); ta.select();
  };
  try {
    const p = navigator.clipboard?.writeText(text);
    if (!p) { fallback(); return; }
    p.then(() => toast(okMsg, 'ok'), fallback);
  } catch { fallback(); }
}

async function copyTable() {
  if (!state.sites.length) { toast('نقطه‌ای برای کپی وجود ندارد'); return; }
  const tsv = tableRows().map(r => r.map(v => String(v ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
  copyText(tsv, 'جدول کپی شد؛ در اکسل یا گوگل‌شیت Paste کنید');
}

// ════════════════════════════════════════════════════════════
//  export / share
// ════════════════════════════════════════════════════════════
function exportCSV() {
  if (!state.sites.length) { toast('نقطه‌ای برای خروجی وجود ندارد'); return; }
  const [head, ...rows] = tableRows();
  const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `billboard-insight-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copyShare() {
  if (!state.sites.length) return;
  const url = shareUrl();
  copyText(url, 'لینک اشتراک کپی شد؛ گیرنده همین نقاط و تنظیمات را می‌بیند');
}

// ════════════════════════════════════════════════════════════
//  layers: highways & structures
// ════════════════════════════════════════════════════════════
async function toggleHighways(on) {
  if (!on) { if (hwLayer) map.removeLayer(hwLayer); return; }
  if (hwLayer) { hwLayer.addTo(map); return; }
  toast('در حال بارگذاری شبکه بزرگراه‌ها…');
  try {
    const ways = await highwayNetwork();
    const renderer = L.canvas({ padding: 0.3 });
    hwLayer = L.layerGroup(ways.map(w => L.polyline(w.line, {
      color: w.cls === 'motorway' ? '#5B8CFF' : '#8E6BFF', weight: w.cls === 'motorway' ? 3 : 2, opacity: 0.55, renderer, interactive: false,
    })));
    if ($('#lyrHighways').checked) hwLayer.addTo(map);
    toast(`${ways.length} قطعه بزرگراه نمایش داده شد`, 'ok');
  } catch (e) {
    $('#lyrHighways').checked = false;
    toast('بارگذاری شبکه بزرگراه‌ها ممکن نشد. اتصال اینترنت یا Overpass را بررسی کنید.', 'err');
  }
}

// ════════════════════════════════════════════════════════════
//  existing structures (inventory + OSM) and ranking
// ════════════════════════════════════════════════════════════
const TILE = 0.02;
let invLayer = null;
const roadCache = { tiles: new Set(), ways: new Map() };
const rankById = new Map();
let refreshTimer = null;

/** The part of the map not covered by the side panel. */
function visibleBounds() {
  const size = map.getSize();
  const right = isMobile() ? size.x : Math.max(200, size.x - ($('#panel').offsetWidth + 32));
  const bottom = isMobile() ? Math.max(200, size.y - $('#panel').offsetHeight) : size.y;
  return L.latLngBounds(map.containerPointToLatLng([60, 70]), map.containerPointToLatLng([right, bottom]));
}

const allStructures = () => [...state.inventory, ...structCache.items.values()];
const bboxOf = b => [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];

function missingTiles(bounds, cache) {
  const need = [];
  for (let la = Math.floor(bounds.getSouth() / TILE); la <= Math.floor(bounds.getNorth() / TILE); la++)
    for (let lo = Math.floor(bounds.getWest() / TILE); lo <= Math.floor(bounds.getEast() / TILE); lo++) {
      const k = `${la}:${lo}`; if (!cache.has(k)) need.push([la, lo, k]);
    }
  if (!need.length) return null;
  return { need, bbox: [Math.min(...need.map(n => n[0])) * TILE, Math.min(...need.map(n => n[1])) * TILE, (Math.max(...need.map(n => n[0])) + 1) * TILE, (Math.max(...need.map(n => n[1])) + 1) * TILE] };
}

async function loadOsmStructures(bounds = map.getBounds()) {
  const m = missingTiles(bounds, structCache.tiles);
  if (!m) return;
  m.need.forEach(n => structCache.tiles.add(n[2]));
  try {
    const items = await structuresIn(m.bbox);
    items.forEach(it => {
      if (structCache.items.has(it.id)) return;
      // skip OSM objects that duplicate an inventory entry or another part of the same bridge
      if (state.inventory.some(x => dist([x.lat, x.lng], [it.lat, it.lng]) < 25)) return;
      if ([...structCache.items.values()].some(x => dist([x.lat, x.lng], [it.lat, it.lng]) < 30)) return;
      structCache.items.set(it.id, { ...it, type: it.kind === 'bridge' ? 'bridge' : 'ad', source: it.source || 'osm' });
    });
  } catch {
    m.need.forEach(n => structCache.tiles.delete(n[2]));
    toast('بارگذاری سازه‌ها از OpenStreetMap ممکن نشد.', 'err');
  }
}

/** Weekly Neshan traffic for every market structure (data/traffic.json, built by the data workflow). */
async function loadTraffic() {
  try {
    const r = await fetch(dataPath('traffic.json'), { cache: 'no-cache' });
    if (!r.ok) return;
    const t = await r.json();
    if (t?.items && Object.keys(t.items).length) state.traffic = t;
    else if (t?.seasonality) state.traffic = { ...t, items: {} };
  } catch { /* model profile only */ }
}
function sharedLive(rec) {
  if (!rec) return null;
  return {
    traffic: rec.traffic ? { ...rec.traffic, provider: 'neshan' } : null,
    speed: rec.speed && Number.isFinite(rec.speed.kmh) ? { ...rec.speed, hour: Number.isInteger(rec.speed.hour) ? rec.speed.hour : tehranHour(new Date(rec.at)) } : null,
    status: { traffic: rec.traffic ? 'ok' : 'none', speed: rec.speed ? 'ok' : 'none' },
    via: { traffic: rec.traffic ? 'neshan' : null, speed: rec.speed ? 'neshan' : null },
    tried: { traffic: ['neshan'], speed: ['neshan'] }, at: rec.at, shared: true,
  };
}
/** Shared Neshan data of the closest structure on the same road (≤ 250 m), for points analysed without a key. */
function nearbyShared(site) {
  const T = state.traffic?.items; if (!T) return null;
  let best = null;
  for (const it of state.inventory) {
    const rec = T[it.id]; if (!rec) continue;
    const d = dist([it.lat, it.lng], [site.lat, site.lng]);
    if (d < 250 && (!best || d < best.d)) best = { d, rec };
  }
  return best ? sharedLive(best.rec) : null;
}

/** Load the prebuilt Tehran road file and mark the tiles it fully covers as loaded. */
async function preloadRoads() {
  const d = await net.staticRoads?.();
  if (!d) return;
  d.ways.forEach(w => roadCache.ways.set(w.osmId, w));
  // the file covers all of Tehran (the bbox is the city plus a margin), so every tile touching it counts as
  // loaded; otherwise edge tiles would trigger slow Overpass queries for empty desert
  const [s, w, n, e] = d.bbox;
  for (let la = Math.floor(s / TILE); la <= Math.floor(n / TILE); la++)
    for (let lo = Math.floor(w / TILE); lo <= Math.floor(e / TILE); lo++) roadCache.tiles.add(`${la}:${lo}`);
}

async function loadRoadsFor(bounds, classes = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link']) {
  const m = missingTiles(bounds, roadCache.tiles);
  if (!m) return;
  m.need.forEach(n => roadCache.tiles.add(n[2]));
  try {
    const ways = await net.roadsInBbox(m.bbox, classes);
    ways.forEach(w => roadCache.ways.set(w.osmId, w));
  } catch {
    m.need.forEach(n => roadCache.tiles.delete(n[2]));
    throw new Error('roads');
  }
}

// Ranking of existing structures. Uses the market-wide evaluation (P.entries), so it needs no zoom:
// scope = all of Tehran, chosen municipal districts, or the visible map area.
const SCOPE_SORT = {
  score: ['امتیاز', e => e.score],
  imp: ['ایمپرشن', e => e.ev.dailyImp],
  value: ['ارزش خرید', e => e.valueIdx ?? -1],
  cpm: ['CPM ارزان', e => -(e.cpm ?? Infinity)],
};
async function rankView() {
  const S = state.scope, P = state.plan;
  if (!P.entries) { state.ranking = { status: 'loading', list: [] }; if (state.listTab === 'inventory' && !state.selectedId) renderPanel(); }
  await evaluateMarket();
  if (P.status === 'error' || !P.entries) { state.ranking = { status: 'error', list: [] }; return; }
  revalue();
  let list = P.entries.filter(e => e.src === 'inv').map(e => {
    const monthly = monthlyPrice(e, state.pricing);
    return { ...e, monthly, cpm: monthly ? monthly / (e.ev.weeklyImp * 30 / 7 / 1000) : null };
  });
  if (S.mode === 'district' && S.districts.length) list = list.filter(e => S.districts.includes(e.district));
  let extra = [];
  if (S.mode === 'view') {
    const b = visibleBounds();
    list = list.filter(e => b.contains([e.lat, e.lng]));
    // OSM-only structures (pedestrian bridges etc.) are fetched per area, so only when zoomed in
    if (map.getZoom() >= 14 && !DEMO) {
      try { await loadOsmStructures(b); await loadRoadsFor(b.pad(0.1)); } catch { /* keep market list */ }
      const osm = [...structCache.items.values()].filter(x => b.contains([x.lat, x.lng]));
      extra = rankStructures(osm, [...roadCache.ways.values()], state.settings).filter(r => r.ranked)
        .map(r => ({ ...r, src: 'osm', ev: { dailyImp: r.imp, exp: r.exp, weeklyImp: r.imp * 7 }, monthly: null, cpm: null, valueIdx: null }));
    }
  }
  const f = state.invFilter || 'all';
  list = [...list, ...extra].filter(x => f === 'all' || x.type === f || (f === 'bulletin' && x.type === 'ad'));
  const get = SCOPE_SORT[S.sort]?.[1] || SCOPE_SORT.score[1];
  list.sort((a, b) => get(b) - get(a));
  rankById.clear();
  list.forEach((x, i) => rankById.set(x.id, { rank: i + 1, score: x.score, imp: x.ev.dailyImp, exp: x.ev.exp, road: x.road, ranked: true }));
  state.ranking = { status: 'ready', list };
  highlightDistricts();
}

/** Select municipal districts as the ranking scope; shows and frames them on the map. */
async function selectDistricts(ns, { fit = true } = {}) {
  const S = state.scope;
  S.districts = ns; S.mode = ns.length ? 'district' : 'city';
  if (state.listTab !== 'inventory' && state.listTab !== 'finder') { state.listTab = 'inventory'; state.selectedId = null; }
  setStructuresLayer(true);
  if (ns.length) {
    await setDistrictLayer(true);
    const ds = state.districts.filter(d => ns.includes(d.n));
    const pts = ds.flatMap(d => (d.rings || [d.poly]).flat());
    if (fit && pts.length) map.fitBounds(L.latLngBounds(pts), { maxZoom: 14, paddingTopLeft: [60, 70], paddingBottomRight: isMobile() ? [0, 220] : [$('#panel').offsetWidth + 40, 20] });
  }
  renderPanel();
  rerank();
}

function highlightDistricts() {
  if (!districtLayer) return;
  const sel = state.scope.mode === 'district' ? state.scope.districts : [];
  districtLayer.eachLayer(l => {
    if (!l.setStyle || l._dn == null) return;
    const on = sel.includes(l._dn);
    l._on = on;
    l.setStyle({ weight: on ? 3 : 1.4, fillOpacity: on ? 0.12 : sel.length ? 0.015 : 0.04, opacity: sel.length && !on ? 0.45 : 1 });
  });
}

function structIcon(st) {
  const r = rankById.get(st.id);
  const tier = !r?.ranked ? '' : r.score >= 70 ? 't1' : r.score >= 50 ? 't2' : 't3';
  const glyph = st.type === 'bridge' ? 'target' : 'board';
  const label = r?.ranked && r.rank <= 30 ? `<b>${r.rank}</b>` : '';
  return L.divIcon({ className: '', iconSize: [24, 24], html: `<div class="struct ${tier} src-${st.source} ${locApprox(st) ? 'approx' : ''}">${icon(glyph)}${label}</div>` });
}

let dotRenderer = null;
const TIER_COL = { t1: '#2BD9A6', t2: '#F5C451', t3: '#FF6B6B' };
const unlockedIds = new Set();
function drawStructures() {
  if (!invLayer) return;
  invLayer.clearLayers();
  const z = map.getZoom();
  const showOsm = z >= 14 || DEMO;
  const scoped = state.listTab === 'inventory' && state.scope.mode !== 'city';
  const scoreOf = new Map((state.plan.entries || []).map(e => [e.id, e.score]));
  const tierOf = sc => sc == null ? '' : sc >= 70 ? 't1' : sc >= 50 ? 't2' : 't3';
  // zoomed out: light dots coloured by score, so 400+ structures stay readable; top 10 of the ranking get numbers
  if (z < 13) {
    dotRenderer ||= L.canvas({ padding: 0.3 });
    allStructures().forEach(st => {
      if (st.source === 'osm' && !showOsm) return;
      const r = rankById.get(st.id);
      const inScope = !scoped || !!r;
      const col = TIER_COL[tierOf(r?.score ?? scoreOf.get(st.id))] || '#7C8AA5';
      const m = L.circleMarker([st.lat, st.lng], { renderer: dotRenderer, radius: inScope ? 5 : 3, color: '#0D1119', weight: 1, fillColor: inScope ? col : '#5A6378', fillOpacity: inScope ? 0.9 : 0.45 });
      m.bindTooltip(esc(st.name), { direction: 'top', offset: [0, -4] });
      m.bindPopup(() => structPopup(st, rankById.get(st.id)));
      m.addTo(invLayer);
    });
    if (state.listTab === 'inventory') (state.ranking?.list || []).slice(0, 10).forEach((x, i) => {
      const m = L.marker([x.lat, x.lng], { icon: L.divIcon({ className: '', iconSize: [22, 22], html: `<div class="rank-pin ${tierOf(x.score)}">${i + 1}</div>` }), zIndexOffset: 800 - i, title: x.name });
      const st = allStructures().find(y => y.id === x.id);
      if (st) m.bindPopup(() => structPopup(st, rankById.get(st.id)));
      m.addTo(invLayer);
    });
    return;
  }
  allStructures().forEach(st => {
    if (st.source === 'osm' && !showOsm) return;
    const r = rankById.get(st.id);
    if (scoped && !r && z < 14) return;   // keep the chosen district readable
    // structures stay put unless moving is unlocked (for all, in the layers menu, or for one, from its popup)
    const free = st.source !== 'osm' && (state.settings.unlockMove || unlockedIds.has(st.id));
    const m = L.marker([st.lat, st.lng], { icon: structIcon(st), title: st.name, draggable: free, zIndexOffset: r?.ranked ? 500 - (r.rank || 0) : 0 });
    m.bindPopup(() => structPopup(st, rankById.get(st.id)));
    m.on('dragend', ev => { const ll = ev.target.getLatLng(); const it = state.inventory.find(x => x.id === st.id); unlockedIds.delete(st.id); if (!state.settings.unlockMove) setTimeout(drawStructures, 0); if (it) { it.lat = ll.lat; it.lng = ll.lng; it.approx = false; it.userMoved = true; it.loc = 'user'; it.locNote = ''; persistInventory(); rankById.delete(it.id); state.plan.evalKey = ''; toast('مکان سازه اصلاح شد و ذخیره ماند'); scheduleRefresh(); } });
    m.addTo(invLayer);
  });
}

// used by hotspot popups only (the structure list keeps its own handler above)
function focusStructure(id) {
  const st = allStructures().find(x => x.id === id); if (!st) return;
  if (!$('#lyrStructures').checked) setStructuresLayer(true);
  map.flyTo([st.lat, st.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
  setTimeout(() => invLayer?.eachLayer(l => { const ll = l.getLatLng?.(); if (ll && Math.abs(ll.lat - st.lat) < 1e-7 && Math.abs(ll.lng - st.lng) < 1e-7) l.openPopup(); }), 900);
}

function structPopup(st, r) {
  const pe = state.plan.entries?.find(x => x.id === st.id);
  if (!r?.ranked && pe) r = { ranked: true, rank: '—', score: pe.score, imp: pe.ev.dailyImp, exp: pe.ev.exp };
  const stats = r?.ranked ? `<div class="pop-stats"><span>رتبه <b>${r.rank}</b></span><span>امتیاز <b>${r.score}</b></span><span><b>${compact(r.imp)}</b> ایمپرشن/روز</span><span><b>${num1(r.exp)}</b> ثانیه</span></div>` : '<div class="pop-sub">این سازه به معبر اصلی نزدیک وصل نشد و رتبه ندارد</div>';
  const e = state.plan.entries?.find(x => x.id === st.id);
  const price = st.price ? `<div class="pop-price"><span>${toman(st.price)} <small>در ماه${st.priceEstimated && st.priceSource !== 'manual' ? ' · برآورد منبع' : ''}</small></span>${e?.valueIdx != null ? valueChip(e.valueIdx) : ''}</div>` : '';
  const addr = st.address && st.address !== st.name ? `<div class="pop-addr">${esc(st.address)}</div>` : '';
  const loc = locApprox(st) ? `<div class="pop-warn">${icon('target')} ${LOC_FA[st.loc] || 'مکان تقریبی'}${st.locNote ? ` (${esc(st.locNote)})` : ''} — با «جابه‌جا کردن» اصلاح کنید</div>` : '';
  const hs = hot?.at(st.lat, st.lng);
  const hsLine = hs ? `<button class="pop-hot" data-act="hs-open" data-id="${hs.id}">${icon('flame')} داخل هات‌اسپات «${esc(hs.title)}» · پتانسیل ${hs.score}</button>` : '';
  return `<b>${esc(st.name)}</b><div class="pop-sub">${TYPE_FA[st.type] || 'سازه'} · ${SOURCE_FA[st.source] || ''}${st.owner ? ' · ' + esc(st.owner) : ''}${st.w && st.h ? ` · <bdi dir="ltr">${st.w}×${st.h}</bdi> م` : ''}</div>${addr}${price}${loc}${hsLine}${stats}
    <button class="btn btn-primary btn-block" data-act="analyze-struct" data-lat="${st.lat}" data-lng="${st.lng}" data-kind="${st.type}" data-name="${esc(st.name)}" data-price="${st.price || ''}">${icon('target')} تحلیل کامل</button>
    <button class="pop-geo" data-act="geo-copy" data-lat="${st.lat}" data-lng="${st.lng}" title="دایره ${SMS_POINT_RADIUS} متری دور سازه با قالب پنل پیامک لوکیشن: [[lng,lat],…]">${icon('copy')} مختصات برای پیامک لوکیشن (شعاع ${SMS_POINT_RADIUS} م)</button>
    ${st.source !== 'osm' && !state.settings.unlockMove ? `<button class="pop-move ${unlockedIds.has(st.id) ? 'on' : ''}" data-act="unlock-move" data-id="${esc(st.id)}">${icon(unlockedIds.has(st.id) ? 'unlock' : 'lock')} ${unlockedIds.has(st.id) ? 'آزاد است؛ نشانگر را بکشید (بعد از رها کردن دوباره قفل می‌شود)' : 'جابه‌جا کردن این سازه'}</button>` : ''}`;
}

function setStructuresLayer(on) {
  $('#lyrStructures').checked = on;
  if (on) {
    if (!invLayer) invLayer = L.layerGroup().addTo(map);
    else invLayer.addTo(map);
    scheduleRefresh(0);
  } else if (invLayer) map.removeLayer(invLayer);
}

function scheduleRefresh(delay = 350) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!invLayer || !map.hasLayer(invLayer)) return;
    try {
    if (state.listTab === 'inventory' && (state.scope.mode === 'view' || state.rankDirty || state.ranking?.status !== 'ready')) { state.rankDirty = false; await rankView(); }
    else if (map.getZoom() >= 14 && !DEMO) await loadOsmStructures();
    drawStructures();
    if (state.listTab === 'inventory' && !state.selectedId) renderPanel();
    } catch (e) { console.error('refresh', e); state.ranking = { status: 'error', list: [] }; if (!state.selectedId) renderPanel(); }
  }, delay);
}

function persistInventory() { saveInventory(state.inventory); state.rankDirty = true; }
function rerank() { state.rankDirty = true; scheduleRefresh(0); }

/** Real structures + prices rebuilt weekly by .github/workflows/data.yml (data/market.json). */
async function loadMarket() {
  try {
    const r = await fetch(dataPath('market.json'), { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const m = await r.json();
    state.market = { updatedAt: m.updatedAt, stats: m.stats, source: m.source, count: (m.items || []).length };
    const { added } = mergeMarket(state.inventory, m);
    persistInventory(); rankById.clear();
    if (added) toast(`${added} سازه واقعی از فهرست بازار اضافه شد`, 'ok');
  } catch { state.market = null; }
}

/** Re-sync manual coefficients and recompute fair price / value index on the evaluated entries. */
function revalue() {
  const P = state.plan; if (!P.entries) return;
  const byId = new Map(state.inventory.map(x => [x.id, x]));
  P.entries.forEach(e => { const it = byId.get(e.id); if (it) { e.coef = it.coef || 1; e.price = it.price; e.negotiated = it.negotiated; e.priceEstimated = it.priceEstimated && it.priceSource !== 'manual'; e.priceUpdated = it.priceUpdated; } });
  P.bench = applyValue(P.entries, e => monthlyPrice(e, state.pricing));
}

const COEF_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const coefSelect = (id, v = 1) => `<select class="sel sel-sm coef-sel ${v !== 1 ? 'on' : ''}" data-act="pr-coef" data-id="${id}" aria-label="ضریب ارزشمندی" title="ضریب ارزشمندی: کیفیت‌هایی که مدل نمی‌بیند (مخاطب منطقه، تناسب با برند، دید واقعی)">${COEF_OPTIONS.map(c => `<option value="${c}" ${Math.abs(c - v) < 1e-6 ? 'selected' : ''}>×${c}</option>`).join('')}</select>`;
const valueChip = (v, approx) => { const l = valueLabel(v); return v == null ? '<span class="muted">—</span>' : `<span class="val-chip ${l.c} ${approx ? 'unsure' : ''}" title="ارزش خرید = قیمت منصفانه ÷ قیمت${approx ? ' — مکان تقریبی است، ترافیک و ارزش هم تقریبی‌اند' : ''}"><b>${num1(v)}${approx ? '?' : ''}</b>${l.t}</span>`; };
function priceAge(iso) {
  const d = daysSince(iso);
  if (d == null) return '—';
  return `<span class="${d > 60 ? 'stale' : ''}" title="${new Date(iso).toLocaleDateString('fa-IR-u-nu-latn')}">${d === 0 ? 'امروز' : d + ' روز'}${d > 60 ? ' · قدیمی' : ''}</span>`;
}
const locApprox = st => st.loc === 'moved' || st.loc === 'onroad' || st.loc === 'address' || st.approx;

function addInventory(items, source) {
  const added = items.map(x => ({ id: uid(), name: x.name || 'سازه بی‌نام', lat: x.lat, lng: x.lng, type: x.type || 'bulletin', owner: x.owner || '', price: x.price || null, address: x.address || '', size: x.size || '', approx: !!x.approx, source }));
  state.inventory.push(...added);
  persistInventory();
  rankById.clear();
  return added;
}

function clutterAt(lat, lng) {
  return allStructures().filter(s => { const d = dist([s.lat, s.lng], [lat, lng]); return d > 15 && d < VIS.clutterRadius; }).length;
}

// district numbers of this city: Tehran's fixed 22, elsewhere whatever OSM has
const distNums = () => IS_TEHRAN ? Array.from({ length: 22 }, (_, k) => k + 1) : [...new Set((state.districts || []).map(d => d.n))].sort((a, b) => a - b);
const distFa = n => (IS_TEHRAN ? DISTRICT_CENTERS[n - 1]?.fa : '') || '';
function distPickerHTML() {
  const S = state.scope;
  const counts = new Map(); (state.plan.entries || []).forEach(e => { if (e.src === 'inv' && e.district) counts.set(e.district, (counts.get(e.district) || 0) + 1); });
  if (!distNums().length) return `<div class="dist-pick-foot"><small>${CITY.districts ? 'مرز مناطق شهرداری هنوز بارگذاری نشده؛ چند لحظه بعد دوباره بزنید.' : `برای ${CITY.fa} مرز مناطق شهرداری در OpenStreetMap ثبت نشده؛ از «کل شهر» یا «محدوده نقشه» استفاده کنید.`}</small></div>`;
  const btns = distNums().map(n => `<button class="${S.districts.includes(n) ? 'on' : ''} ${counts.get(n) ? '' : 'empty'}" data-act="sc-dist" data-v="${n}" title="منطقه ${n}${distFa(n) ? ` — ${esc(distFa(n))}` : ''}: ${counts.get(n) || 0} سازه">${n}<small>${counts.get(n) ?? ''}</small></button>`).join('');
  return `<div class="dist-pick">${btns}</div><div class="dist-pick-foot"><small>${S.districts.length ? S.districts.map(n => `${n}${distFa(n) ? `: ${esc(distFa(n))}` : ''}`).join(' · ') : 'یک یا چند منطقه را بزنید یا روی نقشه کلیک کنید · عدد کوچک = تعداد سازه'}</small>${S.districts.length ? '<a href="#" class="link" data-act="sc-clear">پاک کردن</a>' : ''}</div>`;
}

function inventoryHTML() {
  const rk = state.ranking || { status: 'idle', list: [] }, S = state.scope;
  const types = ['all', 'bridge', 'bulletin', 'poster', 'digital'];
  const f = state.invFilter || 'all';
  const list = rk.list || [];
  const P = state.plan;
  const scopeName = S.mode === 'district' && S.districts.length ? `منطقه ${S.districts.join('، ')}` : S.mode === 'view' ? 'محدوده نقشه' : `کل ${CITY.fa}`;
  const status = rk.status === 'loading' ? 'در حال سنجش همه سازه‌ها…' : rk.status === 'error' ? 'دریافت معابر از OpenStreetMap ممکن نشد. دوباره تلاش کنید.' : '';
  const priced = list.filter(x => x.monthly);
  const best = priced.filter(x => x.valueIdx != null).sort((a, b) => b.valueIdx - a.valueIdx)[0];
  const sumImp = list.reduce((a, x) => a + x.ev.dailyImp, 0);
  const medPrice = priced.length ? priced.map(x => x.monthly).sort((a, b) => a - b)[priced.length >> 1] : null;
  const summary = rk.status === 'ready' && list.length ? `<div class="scope-sum">
      <div><b>${num(list.length)}</b><span>سازه</span></div>
      <div><b>${compact(sumImp)}</b><span>ایمپرشن روزانه کل</span></div>
      <div><b>${medPrice ? compact(medPrice) : '—'}</b><span>میانه اجاره ماهانه</span></div>
    </div>${best ? `<div class="note good-note">${icon('spark')} بهترین ارزش خرید در ${esc(scopeName)}: <a href="#" data-act="inv-focus" data-id="${best.id}">${esc(best.name)}</a> · ${valueChip(best.valueIdx, best.approx)}</div>` : ''}` : '';
  const rows = list.slice(0, 80).map((x, i) => {
    const col = x.score >= 70 ? 'var(--good)' : x.score >= 50 ? 'var(--warn)' : 'var(--bad)';
    return `<div class="inv-row" data-act="inv-focus" data-id="${x.id}" role="button" tabindex="0">
      <span class="inv-rank">${i + 1}</span>
      <div class="inv-main"><div class="card-name">${esc(x.name)}</div>
        <div class="card-meta">${TYPE_FA[x.type] || 'سازه'} · ${esc(x.road || '')}${x.district ? ` · منطقه ${x.district}` : ''}${x.owner ? ' · ' + esc(x.owner) : x.src === 'osm' ? ' · OSM' : ''}${x.approx ? ' · <span style="color:var(--warn)">مکان تقریبی</span>' : ''}</div>
        <div class="card-stats"><span>${icon('eye')} <b>${compact(x.ev.dailyImp)}</b>/روز</span><span><b>${num1(x.ev.exp)}</b> ثانیه</span>${x.monthly ? `<span><b>${compact(x.monthly)}</b> ماهانه</span>` : ''}${x.valueIdx != null ? valueChip(x.valueIdx, x.approx) : ''}</div>
      </div>
      <div class="card-side"><span class="mini-score" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)">${x.score}</span>
        <button class="icon-btn" data-act="inv-analyze" data-id="${x.id}" aria-label="تحلیل کامل" title="تحلیل کامل">${icon('target')}</button></div>
    </div>`;
  }).join('');
  return `${guideHTML('district')}<div class="p-head flat">
      <div class="p-head-row"><h1 class="p-title">بهترین سازه‌ها${S.mode !== 'city' ? ` · <span class="scope-t">${esc(scopeName)}</span>` : ''}</h1><span class="chip">${state.inventory.length} در فهرست</span></div>
      <div class="p-sub">سازه‌های موجود با برآورد ترافیک، زمان مواجهه و قیمت رتبه‌بندی شده‌اند. منطقه را انتخاب کنید یا روی نقشه روی منطقه کلیک کنید.</div>
    </div>
    <div class="p-sec">
      <div class="seg seg-sm scope-seg">
        <button class="${S.mode === 'city' ? 'on' : ''}" data-act="sc-mode" data-v="city">کل ${CITY.fa}</button>
        ${CITY.districts ? `<button class="${S.mode === 'district' ? 'on' : ''}" data-act="sc-mode" data-v="district">مناطق شهرداری</button>` : ''}
        <button class="${S.mode === 'view' ? 'on' : ''}" data-act="sc-mode" data-v="view">محدوده نقشه</button>
      </div>
      ${S.mode === 'district' ? distPickerHTML() : ''}
      <div class="sort-row"><span class="field-l">مرتب‌سازی</span><div class="seg seg-sm">${Object.entries(SCOPE_SORT).map(([k, [l]]) => `<button class="${S.sort === k ? 'on' : ''}" data-act="sc-sort" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="seg seg-sm">${types.map(t => `<button class="${f === t ? 'on' : ''}" data-act="inv-filter" data-v="${t}">${t === 'all' ? 'همه' : TYPE_FA[t]}</button>`).join('')}</div>
      ${status ? `<div class="inv-status">${status}</div>` : ''}
      ${summary}
      ${S.mode === 'district' && S.districts.length && list.length ? `<div class="btn-row" style="margin:10px 0 4px"><button class="btn btn-primary btn-sm" data-act="sc-plan">${icon('money')} کمپین با بودجه در همین منطقه</button><button class="btn btn-ghost btn-sm" data-act="sc-board">${icon('sort')} لیدربورد کامل</button></div>` : ''}
      <div class="inv-list">${rows || (rk.status === 'ready' ? `<div class="note">${S.mode === 'district' && !S.districts.length ? 'منطقه‌ای انتخاب نشده.' : 'سازه‌ای در این محدوده نیست.'}</div>` : '<div class="skel" style="height:120px"></div>')}</div>
      ${list.length > 80 ? `<p class="s-desc">${list.length - 80} سازه دیگر — برای همه، لیدربورد را باز کنید.</p>` : ''}
    </div>
    <div class="p-sec">
      <div class="inv-actions">
        <button class="btn btn-ghost btn-sm" data-act="inv-import">${icon('download')} ورود فهرست (اکسل/CSV)</button>
        <button class="btn btn-ghost btn-sm ${state.mapMode === 'addStructure' ? 'on' : ''}" data-act="inv-add">${icon('plus')} ثبت روی نقشه</button>
      </div>
      <div class="note" style="margin-top:10px"><b>منبع سازه‌ها:</b> ${state.market ? `${num(state.market.count)} سازه واقعی از آگهی‌های عمومی اجاره بیلبورد (Rasamap)` : 'فهرست واردشده'}${DEMO ? '' : '، به‌علاوه پل‌های عابر OpenStreetMap در زوم 14 به بالا'}. مکان تقریبی با حاشیه خط‌چین مشخص است؛ با «جابه‌جا کردن» در پاپ‌آپ سازه اصلاحش کنید.</div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  new-site finder
// ════════════════════════════════════════════════════════════
let finderLayer = null;
const HEAT = ['#2a3550', '#3d5a9e', '#5B8CFF', '#2BD9A6', '#F5C451'];

function finderHTML() {
  const S = state.scope;
  const o = state.finder.opts, R = state.finder.result, st = state.finder.status;
  const clsChip = (k, l) => `<button class="${o.classes.includes(k) ? 'on' : ''}" data-act="fd-cls" data-v="${k}">${l}</button>`;
  const picks = R?.picks || [];
  const rows = picks.map((p, i) => `<div class="inv-row" data-act="fd-focus" data-i="${i}" role="button" tabindex="0">
      <span class="inv-rank pick-rank">${i + 1}</span>
      <div class="inv-main"><div class="card-name">${esc(p.road)} <span class="dir">${p.arrow}</span></div>
        <div class="card-meta">${esc(ROAD_CLASSES[p.cls]?.short || '')} · ${p.lanes} خط · ${p.facing === 'both' ? 'دو جهت' : 'یک جهت'}</div>
        <div class="card-stats"><span>${icon('eye')} <b>${compact(p.imp)}</b>/روز</span><span><b>${num1(p.exp)}</b> ثانیه</span><span>دید مستقیم <b>${num(p.sight)}</b> م</span></div></div>
      <div class="card-side"><span class="mini-score" style="color:var(--good);background:rgba(43,217,166,.14)">${p.score}</span>
        <button class="icon-btn" data-act="fd-analyze" data-i="${i}" aria-label="تحلیل کامل" title="تحلیل کامل">${icon('target')}</button></div>
    </div>`).join('');
  return `${guideHTML('finder')}<div class="p-head flat">
      <div class="p-head-row"><h1 class="p-title">جای بیلبورد جدید</h1></div>
      <div class="p-sub">همه معابر داخل محدوده نقشه هر ${o.step} متر سنجیده می‌شوند: تردد، سرعت، طول دید مستقیم، و فاصله از سازه‌های موجود. از هر معبر حداکثر ${o.perRoad || 2} پیشنهاد انتخاب می‌شود.</div>
    </div>
    <div class="p-sec">
      <div class="field"><label for="fdFmt">نوع سازه جدید</label><select class="sel" id="fdFmt" data-act="fd-fmt">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${o.format === k ? 'selected' : ''}>${f.fa}</option>`).join('')}</select></div>
      <div class="field"><span class="field-l">معابر</span><div class="seg seg-sm">${clsChip('motorway', 'بزرگراه')}${clsChip('trunk', 'بزرگراه شهری')}${clsChip('primary', 'شریانی')}</div></div>
      <div class="grid2">
        <div class="field"><label for="fdSpace">حداقل فاصله از سازه موجود</label><div class="inp-wrap"><input id="fdSpace" class="inp ltr" inputmode="numeric" data-act="fd-num" data-k="spacing" value="${o.spacing}"><span class="unit">متر</span></div></div>
        <div class="field"><label for="fdCount">تعداد پیشنهاد</label><input id="fdCount" class="inp ltr" inputmode="numeric" data-act="fd-num" data-k="count" value="${o.count}"></div>
      </div>
      <div class="field"><span class="field-l">محدوده جستجو</span><div class="seg seg-sm scope-seg">
        <button class="${S.mode !== 'district' ? 'on' : ''}" data-act="fd-scope" data-v="view">محدوده نقشه</button>
        <button class="${S.mode === 'district' ? 'on' : ''}" data-act="fd-scope" data-v="district">مناطق شهرداری</button></div></div>
      ${S.mode === 'district' ? distPickerHTML() : ''}
      <button class="btn btn-primary btn-block" data-act="fd-run" ${st === 'loading' ? 'disabled' : ''}>${icon('search')} ${st === 'loading' ? 'در حال بررسی…' : S.mode === 'district' && S.districts.length ? `جستجو در منطقه ${S.districts.join('، ')}` : 'جستجو در محدوده فعلی نقشه'}</button>
      ${S.mode !== 'district' && map && map.getZoom() < 12 ? '<div class="inv-status">محدوده نقشه بزرگ است؛ زوم کنید یا منطقه انتخاب کنید.</div>' : ''}
    </div>
    ${R ? `<div class="p-sec">
      <div class="sec-title"><span>${picks.length} جایگاه پیشنهادی</span><a href="#" class="link" data-act="fd-clear">پاک کردن</a></div>
      <div class="legend" style="margin:0 0 10px"><span>کم</span>${HEAT.map(c => `<i style="background:${c};width:18px"></i>`).join('')}<span>ایمپرشن زیاد</span><span>· ${num(R.total)} نقطه سنجیده شد، ${num(R.blocked)} نقطه نزدیک سازه موجود</span></div>
      <div class="inv-list">${rows || '<div class="note">جایگاه مناسبی پیدا نشد؛ فاصله از سازه‌ها را کم کنید یا محدوده را بزرگ‌تر کنید.</div>'}</div>
    </div>` : ''}`;
}

async function runFinder() {
  const o = state.finder.opts, S = state.scope;
  const inDistricts = S.mode === 'district' && S.districts.length;
  if (!inDistricts && map.getZoom() < 12) { toast('محدوده نقشه خیلی بزرگ است؛ زوم کنید یا یک منطقه شهرداری انتخاب کنید'); return; }
  if (!o.classes.length) { toast('حداقل یک نوع معبر انتخاب کنید'); return; }
  state.finder.status = 'loading'; renderPanel();
  let b = visibleBounds(), within = null;
  if (inDistricts) {
    const ds = (await loadDistricts()).filter(d => S.districts.includes(d.n));
    b = L.latLngBounds(ds.flatMap(d => (d.rings || [d.poly]).flat()));
    within = p => ds.some(d => (d.rings || [d.poly]).some(r => pointInPoly(p, r)));
  }
  try {
    await loadOsmStructures(b.pad(0.1));
    await loadRoadsFor(b.pad(0.15));
  } catch {
    state.finder.status = 'idle'; renderPanel();
    toast('دریافت معابر از OpenStreetMap ممکن نشد.', 'err'); return;
  }
  const ways = [...roadCache.ways.values()].filter(w => o.classes.includes(w.cls));
  const avoid = [...allStructures(), ...state.sites].map(s => [s.lat, s.lng]);
  await new Promise(r => setTimeout(r, 20));
  const { cands, picks } = findSites(ways, { ...o, step: o.step, within }, state.settings, avoid, bboxOf(b));
  const sorted = cands.map(c => c.imp).sort((a, b) => a - b);
  const q = v => { let i = 0; while (i < sorted.length && sorted[i] < v) i++; return i / Math.max(1, sorted.length); };
  state.finder.result = {
    total: cands.length, blocked: cands.filter(c => c.blocked).length,
    cells: cands.map(c => ({ seg: walk(c.way.line, nearestOnLine(c.p, c.way.line), o.step / 2, -1).reverse().concat(walk(c.way.line, nearestOnLine(c.p, c.way.line), o.step / 2, 1).slice(1)), bin: Math.min(4, Math.floor(q(c.imp) * 5)), blocked: c.blocked })),
    picks: picks.map(c => ({ lat: c.site.lat, lng: c.site.lng, road: c.way.name || ROAD_CLASSES[c.way.cls]?.short, cls: c.way.cls,
      lanes: directionsFor(c.site).facing.map(d => d.lanes).join('+'), facing: c.facing, imp: c.imp, exp: c.exp, sight: c.sight, score: c.score,
      arrow: c.facing === 'both' ? '⇅' : directionsFor(c.site).facing[0].arrow, format: o.format })),
  };
  state.finder.status = 'done';
  drawFinder(); renderPanel();
  if (inDistricts) { map.closePopup(); map.fitBounds(b, { maxZoom: 14, paddingTopLeft: [60, 70], paddingBottomRight: isMobile() ? [0, 220] : [$('#panel').offsetWidth + 40, 20] }); }
}

function drawFinder() {
  if (finderLayer) { map.removeLayer(finderLayer); finderLayer = null; }
  const R = state.finder.result;
  if (!R) return;
  const renderer = L.canvas({ padding: 0.3 });
  finderLayer = L.layerGroup();
  R.cells.forEach(c => L.polyline(c.seg, { color: c.blocked ? '#3a4255' : HEAT[c.bin], weight: c.blocked ? 3 : 6, opacity: c.blocked ? 0.5 : 0.9, renderer, interactive: false, lineCap: 'butt' }).addTo(finderLayer));
  R.picks.forEach((p, i) => {
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="pick-pin">${i + 1}</div>` }), zIndexOffset: 900 });
    m.bindPopup(`<b>جایگاه پیشنهادی ${i + 1}</b><div class="pop-sub">${esc(p.road)} · ${p.arrow}</div><div class="pop-stats"><span><b>${compact(p.imp)}</b> ایمپرشن/روز</span><span><b>${num1(p.exp)}</b> ثانیه</span><span>دید <b>${num(p.sight)}</b> م</span></div><button class="btn btn-primary btn-block" data-act="analyze-struct" data-lat="${p.lat}" data-lng="${p.lng}" data-kind="${p.format}" data-name="جایگاه پیشنهادی ${i + 1} — ${esc(p.road)}">${icon('target')} تحلیل کامل</button>`);
    m.addTo(finderLayer);
  });
  finderLayer.addTo(map);
}

function openImport() {
  const d = $('#dlgImport');
  d.innerHTML = `<div class="dlg-head"><h2>ورود فهرست سازه‌ها</h2><button class="icon-btn" data-close aria-label="بستن">${icon('close')}</button></div>
  <div class="dlg-body">
    <p>ردیف‌ها را از اکسل کپی و این‌جا Paste کنید، یا فایل CSV را انتخاب کنید. ستون‌های شناخته‌شده: <b>نام</b>، <b>عرض</b> و <b>طول</b> جغرافیایی، <b>آدرس</b>، <b>نوع</b> (پل، بیلبورد، استرابورد، دیجیتال)، <b>مالک</b>، <b>قیمت</b>. ردیف بدون مختصات با آدرس یا نام مکان‌یابی می‌شود و «تقریبی» علامت می‌خورد؛ روی نقشه با کشیدن اصلاحش کنید.</p>
    <div class="field"><label for="impText">داده</label><textarea id="impText" class="inp ta ltr" rows="8" placeholder="نام&#9;عرض&#9;طول&#9;نوع&#9;مالک&#9;قیمت&#10;همت — پل عابر کوثر&#9;35.7480&#9;51.3420&#9;پل&#9;شرکت الف&#9;450000000"></textarea></div>
    <div class="field"><label for="impFile">یا فایل CSV / TSV</label><input type="file" id="impFile" accept=".csv,.tsv,.txt" class="inp"></div>
    <div id="impOut"></div>
  </div>
  <div class="dlg-foot"><button class="btn btn-primary" id="impGo">بررسی و افزودن</button><button class="btn btn-ghost" data-close>بستن</button></div>`;
  d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
  d.querySelector('#impFile').onchange = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { d.querySelector('#impText').value = String(r.result); }; r.readAsText(f, 'utf-8');
  };
  d.querySelector('#impGo').onclick = async () => {
    const rows = parseTable(d.querySelector('#impText').value);
    const out = d.querySelector('#impOut');
    if (!rows.length) { out.innerHTML = '<div class="status-line err">ردیفی پیدا نشد. ستون نام یا مختصات لازم است.</div>'; return; }
    await importRows(rows, 'import', msg => { out.innerHTML = `<div class="status-line wait">${msg}</div>`; });
    out.innerHTML = `<div class="status-line ok">${rows.length} ردیف بررسی شد. نتیجه روی نقشه و در فهرست است.</div>`;
  };
  d.showModal();
}

/** Add rows; geocode the ones without coordinates (sequential, gentle on quotas). */
async function importRows(rows, source, progress = () => {}) {
  const ok = [], failed = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.lat && r.lng) { ok.push(r); continue; }
    progress(`مکان‌یابی ${i + 1} از ${rows.length}: ${esc(r.name)}`);
    try {
      const q = (r.address || r.name).replace(/\(.*?\)/g, '').trim();
      const res = await providers.search(`${q} ${CITY.fa}`, state.settings);
      const hit = res.items.find(x => L.latLngBounds(CITY.bounds).contains([x.lat, x.lng]));
      if (hit) ok.push({ ...r, lat: hit.lat, lng: hit.lng, approx: true }); else failed.push(r);
    } catch { failed.push(r); }
    await new Promise(res => setTimeout(res, DEMO ? 60 : 350));
  }
  const added = addInventory(ok, source);
  setStructuresLayer(true);
  if (added.length) map.fitBounds(L.latLngBounds(added.map(a => [a.lat, a.lng])).pad(0.2), { maxZoom: 14 });
  toast(`${added.length} سازه اضافه شد${failed.length ? ` · ${failed.length} مورد مکان‌یابی نشد` : ''}`, failed.length ? '' : 'ok');
  scheduleRefresh(200);
  return { added, failed };
}

async function loadCatalogSample() {
  if (state.inventory.some(x => x.source === 'catalog')) { toast('کاتالوگ نمونه قبلاً اضافه شده است'); return; }
  const rows = CATALOG_SAMPLE.map(c => ({ name: c.name, type: c.type, owner: c.owner, lat: DEMO ? c.demo[0] : null, lng: DEMO ? c.demo[1] : null }));
  toast(DEMO ? 'کاتالوگ نمونه اضافه شد' : 'در حال مکان‌یابی 14 سازه کاتالوگ…');
  await importRows(rows, 'catalog');
}

// ════════════════════════════════════════════════════════════
//  campaign planner (budget → recommended structures)
// ════════════════════════════════════════════════════════════
const PLAN_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link'];
const WEEK_OPTIONS = [1, 2, 4, 8, 12, 26];
const ADJ_OPTIONS = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const DISC_OPTIONS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
const MINW_OPTIONS = [0, 1, 2, 4, 8, 12];
const pct = v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}٪`;

function persistPricing() { savePricing(state.pricing); }

function openPlanner(tab) {
  state.sheet = 'plan';
  if (tab) state.plan.tab = tab;
  $('#sheet').hidden = false;
  renderPlanner();
  evaluateMarket().then(() => {
    computePlan(); renderPlanner();
    if (state.listTab === 'inventory' && state.ranking?.status !== 'ready') rerank();
  });
}

// single flight: the structures tab and the planner often ask at the same moment on first load
let evalFlight = null;
function evaluateMarket(force = false) {
  if (evalFlight && !force) return evalFlight;
  evalFlight = evaluateMarketNow(force).catch(e => { console.error('evaluateMarket', e); state.plan.status = 'error'; })
    .finally(() => { evalFlight = null; });
  return evalFlight;
}
async function evaluateMarketNow(force = false) {
  const P = state.plan;
  const inv = state.inventory;
  const key = `${inv.map(x => x.id + x.type).join('|')}|${state.sites.map(s => s.id + (s.price || '')).join('|')}|${P.includeSites}|${state.traffic?.updatedAt || ''}`;
  if (!force && P.entries && P.evalKey === key) return;
  P.status = 'loading'; if (state.sheet === 'plan') renderPlanner();
  const ds = await loadDistricts();
  if (inv.length) {
    const b = L.latLngBounds(inv.map(x => [x.lat, x.lng])).pad(0.03);
    try { await loadRoadsFor(b, PLAN_CLASSES); } catch { P.status = 'error'; return; }
  }
  await new Promise(r => setTimeout(r, 10));
  const ranked = rankStructures(inv, [...roadCache.ways.values()], state.settings);
  // weekly Neshan data replaces the built-in Tehran profile where the data workflow has it
  ranked.forEach(r => { const live = sharedLive(state.traffic?.items?.[r.id]); if (live && r.vsite) r.vsite.live = live; });
  const byId = new Map(inv.map(x => [x.id, x]));
  const entries = ranked.filter(r => r.ranked).map(r => ({
    id: r.id, name: r.name, owner: r.owner || '', type: r.type, price: r.price, negotiated: r.negotiated, lat: r.lat, lng: r.lng,
    coef: r.coef || 1, priceEstimated: r.priceEstimated && r.priceSource !== 'manual', priceUpdated: r.priceUpdated, loc: r.loc, locNote: r.locNote,
    address: r.address, site: byId.get(r.id)?.site, roadGuessed: r.roadGuessed, approx: locApprox(r),
    road: r.road, roadKey: `${r.road}|${r.facing}`, score: r.score, sight: r.sight, clutter: r.clutter,
    district: districtOf(r.lat, r.lng, ds), ev: evalSite(r.vsite, state.settings), src: 'inv',
  }));
  if (P.includeSites) state.sites.filter(s => isReady(s)).forEach(s => {
    const sum = summarize(s, state.settings);
    entries.push({
      id: s.id, name: s.name, owner: '', type: s.format, price: s.price, lat: s.lat, lng: s.lng, road: s.road.name, roadKey: `${s.road.name}|${s.facing}`,
      score: sum.score, sight: sum.wk.geo?.[0]?.sight, clutter: s.clutter || 0, district: districtOf(s.lat, s.lng, ds), ev: evalSite(s, state.settings), src: 'site',
    });
  });
  P.entries = entries; P.evalKey = key; P.unranked = ranked.filter(r => !r.ranked).length; P.status = 'ready';
  revalue();
}

/** Months with overrides and Neshan-observed traffic merged in. */
const months = () => monthTable(state.pricing.months, state.traffic?.seasonality || {});
function planStart() {
  const opts = startOptions();
  return (opts.find(o => o.key === state.plan.start) || opts[0]);
}
function planCalendar() {
  const sc = state.pricing.scenario;
  return campaignFactors(planStart().date, state.plan.weeks, months(), { useTraffic: sc.seasonTraffic !== false, usePrice: sc.seasonPrice !== false });
}
const pctF = f => { const v = Math.round((f - 1) * 100); return v === 0 ? 'بدون تغییر' : `${v > 0 ? '+' : ''}${v}٪`; };

/** 12-month strip: traffic, price and value per month, campaign months highlighted. */
function seasonHTML(cal) {
  const M = months(), cur = persianMonth(new Date());
  const order = Array.from({ length: 12 }, (_, i) => M[(cur - 1 + i) % 12]);
  const inCamp = new Set(cal.perMonth.map(x => x.n));
  const maxV = Math.max(...M.map(m => m.traffic / m.price));
  const opts = startOptions();
  return `<div class="s-card season">
    <div class="sec-title" style="margin-bottom:4px"><h3 style="margin:0">بهترین زمان کمپین</h3><span class="s-desc" style="margin:0">ارتفاع = ایمپرشن به ازای هر تومان (ترافیک ماه ÷ ضریب قیمت ماه) · روی ماه بزنید تا کمپین از اول همان ماه شروع شود</span></div>
    <div class="season-strip">${order.map(m => {
      const v = m.traffic / m.price, o = opts.find(x => x.key !== 'now' && persianMonth(x.date) === m.n);
      return `<button class="sm ${inCamp.has(m.n) ? 'on' : ''}" ${o ? `data-act="pl-start" data-v="${o.key}"` : 'disabled'} title="${m.fa}: ترافیک ${pctF(m.traffic)} · قیمت ${pctF(m.price)}${m.trafficSource === 'neshan' ? ' · ترافیک از داده نشان' : ''}">
        <i style="height:${Math.round(v / maxV * 100)}%"></i><b>${m.fa}</b><small>${m.traffic >= 1 ? '▲' : '▼'} ${Math.round(m.traffic * 100)}</small></button>`;
    }).join('')}</div>
    <p class="s-desc" style="margin:8px 0 0">این کمپین: ${cal.perMonth.map(x => `${x.days} روز ${x.fa}`).join(' + ')} · ایمپرشن ${pctF(cal.impF)} نسبت به هفته معمول · هزینه ${pctF(cal.priceF)} نسبت به قیمت لیست. ضریب ماه‌ها در تب «قیمت‌ها» قابل تغییر است.</p>
  </div>`;
}

function computePlan() {
  const P = state.plan;
  if (!P.entries) return;
  revalue();
  P.cal = planCalendar();
  const entries = P.entries.filter(e => (!P.types.length || P.types.includes(e.type === 'ad' ? 'bulletin' : e.type)) && (e.score ?? 0) >= P.minScore &&
    (!P.districts.length || P.districts.includes(e.district)));
  const { options, skipped } = buildOptions(entries, state.pricing, P);
  const cons = { perRoad: P.perRoad, locks: P.locks, excludes: P.excludes };
  const res = optimize(options, P.budget, P.objective, cons);
  const alt = Object.keys(OBJECTIVES).map(k => ({ k, r: k === P.objective ? res : optimize(options, P.budget, k, cons) }));
  P.result = { res, alt, curve: budgetCurve(options, P.budget, P.objective, cons), skipped, nOptions: options.length, nEntries: entries.length };
}

function curveSVG(curve, budgetNow) {
  const W = 420, H = 190, l = 56, r = 14, t = 14, b = 34;
  const iw = W - l - r, ih = H - t - b;
  const maxX = Math.max(...curve.map(c => c.budget)), maxY = Math.max(1, ...curve.map(c => c.imp)) * 1.1;
  const X = v => l + v / maxX * iw, Y = v => t + ih - v / maxY * ih;
  const pts = curve.map(c => `${X(c.budget)},${Y(c.imp)}`).join(' ');
  const area = `${X(curve[0].budget)},${t + ih} ${pts} ${X(curve[curve.length - 1].budget)},${t + ih}`;
  const cur = curve.find(c => c.f === 1);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const yv = maxY * k / 4;
    g += `<line x1="${l}" x2="${l + iw}" y1="${Y(yv)}" y2="${Y(yv)}" class="grid"/><text x="${l - 6}" y="${Y(yv) + 3}" text-anchor="end" class="ax">${compact(yv).replace(' هزار', 'K').replace(' میلیون', 'M')}</text>`;
  }
  curve.forEach(c => { g += `<text x="${X(c.budget)}" y="${t + ih + 14}" text-anchor="middle" class="ax">${compact(c.budget).replace(' میلیارد', 'B').replace(' میلیون', 'M')}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" dir="ltr" role="img" aria-label="منحنی بودجه و ایمپرشن">
    ${g}<polygon points="${area}" class="curve-area"/><polyline points="${pts}" class="curve-line"/>
    ${curve.map(c => `<circle cx="${X(c.budget)}" cy="${Y(c.imp)}" r="${c.f === 1 ? 6 : 3.5}" class="${c.f === 1 ? 'curve-now' : 'curve-pt'}"><title>${toman(c.budget)} → ${num(c.imp)} ایمپرشن، ${c.count} سازه</title></circle>`).join('')}
    <text x="${X(cur.budget)}" y="${Y(cur.imp) - 12}" text-anchor="middle" class="ax curve-lbl">بودجه فعلی</text>
    <text x="${l + iw / 2}" y="${H - 3}" text-anchor="middle" class="ax">بودجه کمپین (تومان) →</text>
  </svg>`;
}

function renderPlanner() {
  if (state.sheet !== 'plan') return;
  const P = state.plan;
  const tabs = `<div class="seg" role="tablist">${[['plan', 'پیشنهاد کمپین'], ['board', 'لیدربورد'], ['prices', 'قیمت‌ها، باندل‌ها و قوانین']].map(([k, l]) => `<button class="${P.tab === k ? 'on' : ''}" data-act="pl-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
  $('#sheetInner').innerHTML = `<div class="s-head">
      <button class="icon-btn" data-act="close-cmp" aria-label="بستن">${icon('close')}</button>
      <h2>${P.tab === 'board' ? 'لیدربورد سازه‌ها' : 'برنامه‌ریز کمپین'}</h2>${tabs}
      ${P.tab === 'plan' ? `<button class="btn btn-ghost" data-act="pl-copy">${icon('compare')} کپی برای اکسل</button>` : ''}
    </div>
    <div class="s-body">${P.tab === 'prices' ? pricesHTML() : P.tab === 'board' ? boardHTML() : planHTML()}</div>`;
  const c = $('#planCurve'); if (c && P.result) c.innerHTML = curveSVG(P.result.curve, P.budget);
}

function planHTML() {
  const P = state.plan, R = P.result, pr = state.pricing;
  const cfg = `<aside class="plan-cfg">
    <div class="s-card">
      <h3>بودجه و مدت</h3>
      <div class="field"><label for="plBudget">بودجه کل کمپین</label><div class="inp-wrap"><input id="plBudget" class="inp ltr" inputmode="numeric" data-act="pl-budget" value="${num(P.budget)}"><span class="unit">تومان</span></div></div>
      <div class="field"><label for="plWeeks">مدت کمپین</label><select id="plWeeks" class="sel" data-act="pl-weeks">${WEEK_OPTIONS.map(w => `<option value="${w}" ${P.weeks === w ? 'selected' : ''}>${w} هفته</option>`).join('')}</select></div>
      <div class="field"><label for="plStart">شروع کمپین</label><select id="plStart" class="sel" data-act="pl-start">${startOptions().map(o => `<option value="${o.key}" ${planStart().key === o.key ? 'selected' : ''}>${o.label}</option>`).join('')}</select><small>روزهای هفته و ماه‌های سال روی ایمپرشن و قیمت اثر دارند</small></div>
    </div>
    <div class="s-card">
      <h3>هدف کمپین</h3>
      <div class="fmt-list">${Object.entries(OBJECTIVES).map(([k, o]) => `<button class="fmt ${P.objective === k ? 'on' : ''}" data-act="pl-obj" data-v="${k}"><span class="dot"></span><span><b>${o.fa}</b><small>${o.hint}</small></span></button>`).join('')}</div>
    </div>
    <div class="s-card">
      <h3>سناریوی قیمت</h3>
      <div class="field"><label for="plAdj">تغییر قیمت لیست</label><select id="plAdj" class="sel" data-act="pl-adj">${ADJ_OPTIONS.map(a => `<option value="${a}" ${Math.abs((pr.scenario.adj || 0) - a) < 1e-6 ? 'selected' : ''}>${a === 0 ? 'قیمت لیست' : pct(a)}</option>`).join('')}</select><small>برای دیدن اثر تخفیف یا تورم قیمت روی پیشنهاد</small></div>
      <label class="switch-row"><input type="checkbox" data-act="pl-neg" ${pr.scenario.useNegotiated ? 'checked' : ''}><span class="switch"></span><span><b>قیمت مذاکره‌شده</b><small>هرجا وارد شده، به‌جای قیمت لیست</small></span></label>
      <label class="switch-row"><input type="checkbox" data-act="pl-season-t" ${pr.scenario.seasonTraffic !== false ? 'checked' : ''}><span class="switch"></span><span><b>اثر ماه و روز هفته بر ترافیک</b><small>نوروز خلوت، مهر و اسفند شلوغ؛ جمعه و پنجشنبه کم‌تردد</small></span></label>
      <label class="switch-row"><input type="checkbox" data-act="pl-season-p" ${pr.scenario.seasonPrice !== false ? 'checked' : ''}><span class="switch"></span><span><b>اثر فصل بر قیمت</b><small>نرخ بالاتر اسفند و فروردین و فصل مهر</small></span></label>
      <label class="switch-row"><input type="checkbox" data-act="pl-longer" ${pr.scenario.allowLonger ? 'checked' : ''}><span class="switch"></span><span><b>خرید حداقل دوره مجری</b><small>اگر حداقل مدت مجری بیشتر از کمپین است، هزینه کامل حساب شود</small></span></label>
    </div>
    <div class="s-card">
      <h3>محدودیت‌ها</h3>
      <div class="field"><span class="field-l">نوع سازه</span><div class="chips-toggle">${['bridge', 'bulletin', 'poster', 'digital'].map(t => `<button class="${P.types.includes(t) ? 'on' : ''}" data-act="pl-type" data-v="${t}">${TYPE_FA[t]}</button>`).join('')}</div><small>${P.types.length ? '' : 'همه انواع'}</small></div>
      <div class="grid2">
        <div class="field"><label for="plRoad">حداکثر در هر مسیر</label><select id="plRoad" class="sel" data-act="pl-perroad">${[[1, '1 سازه'], [2, '2 سازه'], [3, '3 سازه'], [0, 'بدون محدودیت']].map(([v, l]) => `<option value="${v}" ${P.perRoad === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="plScore">حداقل امتیاز</label><select id="plScore" class="sel" data-act="pl-minscore">${[0, 40, 50, 60, 70].map(v => `<option value="${v}" ${P.minScore === v ? 'selected' : ''}>${v ? v + '+' : 'همه'}</option>`).join('')}</select></div>
      </div>
      <div class="field"><span class="field-l">مناطق شهرداری</span><div class="dist-mini">${distNums().map(n => `<button class="${P.districts.includes(n) ? 'on' : ''}" data-act="pl-dist" data-v="${n}" title="منطقه ${n}${distFa(n) ? ` — ${esc(distFa(n))}` : ''}">${n}</button>`).join('') || '<small>مناطق شهرداری برای این شهر در دسترس نیست</small>'}</div><small>${P.districts.length ? `فقط مناطق ${P.districts.join('، ')}` : 'همه مناطق'}</small></div>
      <label class="switch-row"><input type="checkbox" data-act="pl-sites" ${P.includeSites ? 'checked' : ''}><span class="switch"></span><span><b>نقاط مقایسه هم شرکت کنند</b><small>نقاطی که اجاره ماهانه دارند</small></span></label>
    </div>
  </aside>`;

  if (P.status === 'loading' || !R) return `<div class="plan-grid">${cfg}<main class="plan-main"><div class="s-card"><div class="skel" style="height:120px"></div><p class="s-desc" style="margin-top:12px">در حال سنجش سازه‌های قیمت‌دار…</p></div></main></div>`;
  if (!P.entries.length) return `<div class="plan-grid">${cfg}<main class="plan-main"><div class="s-card"><h3>سازه قیمت‌داری وجود ندارد</h3><p class="s-desc">برای پیشنهاد کمپین، سازه‌های موجود باید قیمت داشته باشند. فهرست قیمت را از تب «قیمت‌ها، باندل‌ها و قوانین» وارد کنید یا فید قیمت را وصل کنید.</p><button class="btn btn-primary" data-act="pl-tab" data-v="prices">رفتن به قیمت‌ها</button></div></main></div>`;

  const res = R.res, T = res.total;
  const used = Math.min(1, T.cost / P.budget);
  const kpis = `<div class="plan-kpis">
    <div class="kpi hl"><div class="kpi-l">بودجه مصرف‌شده</div><div class="kpi-v">${toman(T.cost).replace(' تومان', '')}<small>تومان</small></div><div class="usage-bar"><i style="width:${(used * 100).toFixed(1)}%"></i></div><div class="kpi-s">${Math.round(used * 100)}٪ از ${toman(P.budget)}</div></div>
    <div class="kpi"><div class="kpi-l">${icon('eye')} ایمپرشن کل</div><div class="kpi-v">${compactParts(T.imp)[0]}<small>${compactParts(T.imp)[1]}</small></div><div class="kpi-s">${compact(T.ots)} نفر در معرض دید</div></div>
    <div class="kpi"><div class="kpi-l">${icon('clock')} زمان مواجهه کل</div><div class="kpi-v">${compactParts(T.expH)[0]}<small>${compactParts(T.expH)[1]} نفر-ساعت</small></div><div class="kpi-s">${num1(T.imp ? T.expH * 3600 / T.imp : 0)} ثانیه به ازای هر ایمپرشن</div></div>
    <div class="kpi"><div class="kpi-l">${icon('money')} CPM ترکیبی</div><div class="kpi-v">${T.cpm ? compact(T.cpm) : '—'}<small>${T.cpm ? 'تومان' : ''}</small></div><div class="kpi-s">${T.count} سازه روی ${T.roads} مسیر</div></div>
  </div>`;
  const altRows = R.alt.map(({ k, r }) => `<tr class="${k === P.objective ? 'cur' : ''}"><th>${OBJECTIVES[k].fa}</th><td>${compact(r.total.imp)}</td><td>${compact(r.total.expH)}</td><td>${toman(r.total.cost)}</td><td>${r.total.count}</td><td>${r.total.cpm ? compact(r.total.cpm) : '—'}</td><td>${k === P.objective ? '<span class="pill ok">انتخاب فعلی</span>' : `<button class="btn btn-ghost btn-sm" data-act="pl-obj" data-v="${k}">انتخاب</button>`}</td></tr>`).join('');
  const rows = res.selected.slice().sort((a, b) => b.imp - a.imp).map(o => {
    const lock = !!P.locks[o.id];
    const fair = o.members.reduce((a, m) => a + (m.fair || 0), 0), mp = o.members.reduce((a, m) => a + (monthlyPrice(m, pr) || 0), 0);
    const coefd = o.members.some(m => (m.coef || 1) !== 1);
    const members = o.kind === 'bundle' ? `<div class="bundle-members">${o.members.map(m => esc(m.name)).join(' · ')}</div>` : '';
    return `<tr>
      <td><button class="tg ${lock ? 'on' : ''}" data-act="pl-lock" data-id="${o.id}" title="${lock ? 'قفل است؛ همیشه در کمپین' : 'قفل کن'}" aria-label="قفل">${icon(lock ? 'lock' : 'unlock')}</button></td>
      <td class="nm"><b>${esc(o.name)}</b>${o.kind === 'bundle' ? ' <span class="chip acc">باندل</span>' : ''}${members}</td>
      <td>${esc(o.owner || (o.members[0]?.src === 'site' ? 'نقاط مقایسه' : '—'))}</td>
      <td>${o.weeks} هفته${o.weeks > P.weeks ? ' <span class="chip warn">حداقل مجری</span>' : ''}</td>
      <td>${toman(o.cost)}</td><td>${compact(o.imp)}</td><td>${num1(o.imp ? o.expH * 3600 / o.imp : 0)} ث</td><td>${compact(o.cost / (o.imp / 1000))}</td>
      <td>${valueChip(fair && mp ? fair / mp : null)}${coefd ? ` <span class="chip acc" title="ضریب ارزشمندی دستی">×${num1(o.members[0].coef || 1)}</span>` : ''}</td>
      <td><button class="tg" data-act="pl-excl" data-id="${o.id}" title="حذف از پیشنهاد" aria-label="حذف">${icon('close')}</button></td></tr>`;
  }).join('');
  const next = res.next.map(o => `<li><b>${esc(o.name)}</b> · ${toman(o.cost)} · ${compact(o.imp)} ایمپرشن <button class="btn btn-ghost btn-sm" data-act="pl-lock" data-id="${o.id}">اضافه کن</button></li>`).join('');
  const excluded = Object.keys(P.excludes).filter(k => P.excludes[k]);
  const warn = [
    res.over ? '<div class="note warnbox">هزینه سازه‌های قفل‌شده از بودجه بیشتر است.</div>' : '',
    R.skipped.length ? `<details class="adv"><summary><span>${R.skipped.length} سازه به‌خاطر قوانین مجری وارد پیشنهاد نشد</span>${icon('chev')}</summary><div class="adv-body"><ul class="mini-list">${R.skipped.slice(0, 20).map(s => `<li>${esc(s.name)} — ${esc(s.why)}</li>`).join('')}</ul></div></details>` : '',
    P.unranked ? `<div class="note">${P.unranked} سازه به معبر اصلی وصل نشد و کنار گذاشته شد.</div>` : '',
    excluded.length ? `<div class="note">${excluded.length} مورد را کنار گذاشته‌اید. <a href="#" data-act="pl-reset-ex" style="color:var(--accent)">بازگرداندن</a></div>` : '',
  ].join('');
  return `${guideHTML('plan')}<div class="plan-grid">${cfg}<main class="plan-main">
    ${kpis}${P.cal ? seasonHTML(P.cal) : ''}${warn}
    <div class="s-card"><h3>سازه‌های پیشنهادی</h3><p class="s-desc">هدف «${OBJECTIVES[P.objective].fa}» · ${P.weeks} هفته · از بین ${R.nOptions} گزینه خرید (${R.nEntries} سازه). قفل = حتماً در کمپین؛ ✕ = کنار بگذار و دوباره بچین. ضریب ارزشمندی هر سازه (لیدربورد یا تب قیمت‌ها) در هدف بهینه‌سازی ضرب می‌شود.</p>
      ${rows ? `<div class="tbl-wrap"><table class="cmp plan-tbl"><thead><tr><th></th><th>سازه</th><th>مجری</th><th>مدت قابل پرداخت</th><th>هزینه</th><th>ایمپرشن</th><th>مواجهه</th><th>CPM</th><th>ارزش خرید</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="s-desc">با این بودجه هیچ سازه‌ای قابل خرید نیست.</p>'}
      ${next ? `<h3 style="margin-top:16px">گزینه‌های بعدی (اگر بودجه بیشتر شود)</h3><ul class="next-list">${next}</ul>` : ''}
    </div>
    <div class="s-grid">
      <div class="s-card"><h3>اگر هدف را عوض کنید</h3><p class="s-desc">همین بودجه و محدودیت‌ها، با هر هدف</p>
        <div class="tbl-wrap"><table class="cmp"><thead><tr><th>هدف</th><th>ایمپرشن</th><th>نفر-ساعت</th><th>هزینه</th><th>سازه</th><th>CPM</th><th></th></tr></thead><tbody>${altRows}</tbody></table></div></div>
      <div class="s-card"><h3>منحنی بودجه</h3><p class="s-desc">ایمپرشن قابل خرید در بودجه‌های مختلف؛ جایی که منحنی صاف می‌شود، افزایش بودجه بازده کمتری دارد.</p><div class="chart-box" id="planCurve"></div></div>
    </div>
    <p class="disclaimer">ایمپرشن و زمان مواجهه با مدل ترافیک برآورد شده‌اند. پیشنهاد با روش حریصانه و بهبود جابه‌جایی ساخته می‌شود و ممکن است با بهینه مطلق کمی فاصله داشته باشد. قیمت‌ها قیمت اعلام‌شده بازارند و قبل از قرارداد باید استعلام شوند. ${DEMO ? 'باندل نمونه و قوانین مجری‌ها در این دمو فرضی‌اند.' : ''}</p>
  </main></div>`;
}

function pricesHTML() {
  const pr = state.pricing, P = state.plan;
  const owners = [...new Set(state.inventory.map(x => x.owner).filter(Boolean))];
  const ownerRows = owners.map(o => {
    const r = ruleFor(pr, o), n = state.inventory.filter(x => x.owner === o).length;
    return `<tr><th>${esc(o)}</th><td>${n}</td>
      <td><label class="switch-row inline"><input type="checkbox" data-act="pr-rule" data-k="bundleOnly" data-owner="${esc(o)}" ${r.bundleOnly ? 'checked' : ''}><span class="switch"></span></label></td>
      <td><select class="sel sel-sm" data-act="pr-rule" data-k="minWeeks" data-owner="${esc(o)}">${MINW_OPTIONS.map(w => `<option value="${w}" ${r.minWeeks === w ? 'selected' : ''}>${w ? w + ' هفته' : 'ندارد'}</option>`).join('')}</select></td>
      <td><select class="sel sel-sm" data-act="pr-rule" data-k="discount" data-owner="${esc(o)}">${DISC_OPTIONS.map(d => `<option value="${d}" ${Math.abs(r.discount - d) < 1e-6 ? 'selected' : ''}>${d ? Math.round(d * 100) + '٪' : '—'}</option>`).join('')}</select></td></tr>`;
  }).join('');
  const bundles = pr.bundles.map(b => `<div class="bundle-card">
      <div class="bundle-head"><b>${esc(b.name)}</b><span class="chip">${esc(b.owner || '—')}</span>${b.only ? '<span class="chip warn">فقط باندل</span>' : ''}</div>
      <div class="bundle-meta">${b.ids.length} سازه · ${toman(b.price)} در ماه · حداقل ${b.minWeeks || 0} هفته</div>
      <div class="bundle-members">${b.ids.map(id => esc(state.inventory.find(x => x.id === id)?.name || id)).join(' · ')}</div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="pr-bedit" data-id="${b.id}">ویرایش</button><button class="btn btn-ghost btn-sm" data-act="pr-bdel" data-id="${b.id}">حذف</button></div>
    </div>`).join('');
  const E = P.editBundle;
  const editor = E ? `<div class="s-card bundle-editor">
      <h3>${E.id ? 'ویرایش باندل' : 'باندل جدید'}</h3>
      <div class="grid2">
        <div class="field"><label for="beName">نام باندل</label><input id="beName" class="inp" data-act="pr-be" data-k="name" value="${esc(E.name)}"></div>
        <div class="field"><label for="beOwner">مجری</label><select id="beOwner" class="sel" data-act="pr-be" data-k="owner"><option value="">—</option>${owners.map(o => `<option ${E.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
        <div class="field"><label for="bePrice">قیمت ماهانه کل باندل</label><div class="inp-wrap"><input id="bePrice" class="inp ltr" inputmode="numeric" data-act="pr-be" data-k="price" value="${E.price ? num(E.price) : ''}"><span class="unit">تومان</span></div></div>
        <div class="field"><label for="beMin">حداقل مدت</label><select id="beMin" class="sel" data-act="pr-be" data-k="minWeeks">${MINW_OPTIONS.map(w => `<option value="${w}" ${E.minWeeks === w ? 'selected' : ''}>${w ? w + ' هفته' : 'ندارد'}</option>`).join('')}</select></div>
      </div>
      <label class="switch-row"><input type="checkbox" data-act="pr-be" data-k="only" ${E.only ? 'checked' : ''}><span class="switch"></span><span><b>این سازه‌ها فقط داخل باندل فروخته می‌شوند</b><small>تکی در پیشنهاد نمی‌آیند</small></span></label>
      <div class="field-l" style="margin:8px 0">سازه‌های باندل (${E.ids.length})</div>
      <div class="pick-grid">${state.inventory.filter(x => !E.owner || x.owner === E.owner).map(x => `<label class="pick-item"><input type="checkbox" data-act="pr-be-item" data-id="${x.id}" ${E.ids.includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}<small>${x.price ? toman(x.price) : 'بدون قیمت'}</small></span></label>`).join('')}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-act="pr-bsave">ذخیره باندل</button><button class="btn btn-ghost" data-act="pr-bcancel">انصراف</button></div>
    </div>` : '';
  const q = (P.priceQuery || '').trim();
  revalue();
  const evById = new Map((P.entries || []).map(e => [e.id, e]));
  const list = state.inventory.filter(x => !q || x.name.includes(q) || (x.owner || '').includes(q) || (x.address || '').includes(q));
  const PS = { feed: 'فید', manual: 'دستی', import: 'فایل', market: 'بازار' };
  const priceRows = list.slice(0, 200).map(x => {
    const d = x.prevPrice && x.price ? x.price / x.prevPrice - 1 : null;
    const e = evById.get(x.id);
    return `<tr><th class="nm">${esc(x.name)}<small>${TYPE_FA[x.type] || ''}</small></th><td>${esc(x.owner || '—')}</td>
      <td><div class="inp-wrap sm"><input class="inp ltr inp-sm" inputmode="numeric" data-act="pr-price" data-k="price" data-id="${x.id}" value="${x.price ? num(x.price) : ''}" placeholder="—" aria-label="قیمت لیست"></div></td>
      <td><div class="inp-wrap sm"><input class="inp ltr inp-sm" inputmode="numeric" data-act="pr-price" data-k="negotiated" data-id="${x.id}" value="${x.negotiated ? num(x.negotiated) : ''}" placeholder="—" aria-label="قیمت مذاکره‌شده"></div></td>
      <td>${coefSelect(x.id, x.coef || 1)}</td>
      <td>${e?.fair ? toman(e.fair) : '—'}</td><td>${valueChip(e?.valueIdx)}</td>
      <td>${x.priceSource ? `<span class="chip ${x.priceSource === 'manual' ? 'warn' : ''}">${PS[x.priceSource] || x.priceSource}${x.site && x.priceSource === 'market' ? ' · ' + esc(x.site) : ''}</span>` : '—'}${x.priceEstimated && x.priceSource !== 'manual' ? ' <span class="chip" title="قیمت را خود منبع با فرمول برآورد کرده">برآورد</span>' : ''}</td>
      <td>${priceAge(x.priceUpdated)}</td>
      <td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null || Math.abs(d) < 0.001 ? '—' : pct(d)}</td></tr>`;
  }).join('');
  const f = pr.feed, M = state.market;
  const mk = M ? (() => {
    const st = M.stats || {}, age = daysSince(M.updatedAt), srcAge = daysSince(state.inventory.find(x => x.source === 'market' && x.priceUpdated)?.priceUpdated);
    const priced = state.inventory.filter(x => x.source === 'market' && x.price);
    const est = priced.filter(x => x.priceEstimated && x.priceSource !== 'manual').length, man = state.inventory.filter(x => x.source === 'market' && x.priceSource === 'manual').length;
    return `<div class="s-card market-card"><h3>داده بازار (واقعی)</h3>
      <p class="s-desc">فهرست سازه‌ها و قیمت‌های اعلام‌شده در سایت‌های اجاره بیلبورد ${CITY.fa} (${(M.source?.sites || []).map(x => `<span class="ltr">${esc(x)}</span>`).join('، ')})، از مجموعه‌داده باز <a href="${esc(M.source?.url || '#')}" target="_blank" rel="noopener">Rasamap</a> (MIT). مخزن هر 7 روز آن را دوباره می‌خواند.</p>
      <div class="mk-stats">
        <div><b>${num(M.count)}</b><span>سازه در ${CITY.fa}</span></div>
        <div><b>${num(priced.length)}</b><span>قیمت‌دار</span></div>
        <div><b>${num((st.moved || 0) + (st.onRoad || 0))}</b><span>مکان تقریبی</span></div>
        <div><b>${srcAge ?? '—'}</b><span>روز از آخرین برداشت قیمت</span></div>
      </div>
      <div class="status-line ${srcAge > 60 ? 'err' : 'ok'}">به‌روزرسانی فهرست: ${age === 0 ? 'امروز' : age + ' روز پیش'} · ${est} قیمت برآورد خود منبع است · ${man} قیمت دستی شما${srcAge > 60 ? ' · قیمت‌ها کهنه‌اند، قبل از خرید استعلام بگیرید' : ''}</div>
      ${(st.unknown || st.noCoords || st.outside) ? `<p class="s-desc" style="margin-top:8px">${num((st.unknown || 0) + (st.noCoords || 0))} آگهی بی‌مکان قابل‌اعتماد و ${num(st.outside || 0)} آگهی بیرون از تهران کنار گذاشته شده‌اند.</p>` : ''}
    </div>`;
  })() : '';
  const FAC = Array.from({ length: 17 }, (_, i) => +(0.6 + i * 0.05).toFixed(2));
  const SRC = { default: 'پیش‌فرض', neshan: 'داده نشان', manual: 'دستی' };
  const mrows = months().map(m => {
    const o = pr.months[m.n] || {};
    const sel = (k, cur, src) => `<select class="sel sel-sm" data-act="pr-month" data-n="${m.n}" data-k="${k}" aria-label="ضریب ${k === 'traffic' ? 'ترافیک' : 'قیمت'} ${m.fa}"><option value="" ${o[k] == null ? 'selected' : ''}>${Math.round(cur * 100)}٪ (${SRC[src]})</option>${FAC.map(f => `<option value="${f}" ${o[k] === f ? 'selected' : ''}>${Math.round(f * 100)}٪</option>`).join('')}</select>`;
    return `<tr><th>${m.fa}</th><td>${sel('traffic', o.traffic ?? m.traffic, m.trafficSource)}</td><td>${sel('price', o.price ?? m.price, m.priceSource)}</td><td>${(m.traffic / m.price).toFixed(2)}</td></tr>`;
  }).join('');
  const seasonCard = `<div class="s-card"><div class="sec-title" style="margin-bottom:6px"><h3 style="margin:0">ضریب ماه‌های سال</h3>${Object.keys(pr.months).length ? '<a href="#" class="link" data-act="pr-months-reset">بازگشت به پیش‌فرض</a>' : ''}</div>
      <p class="s-desc">ترافیک = حجم تردد آن ماه نسبت به میانگین سال؛ قیمت = نرخ آن ماه نسبت به قیمت لیست. پیش‌فرض‌ها برآوردند (نوروز خلوت، مهر و اسفند شلوغ، نرخ بالاتر اسفند و فروردین). ترافیکِ هر ماهی که به‌روزرسانی هفتگی نشان دیده باشد، با داده نشان جایگزین می‌شود. روزهای هفته هم جدا حساب می‌شوند: پنجشنبه 86٪ و جمعه 62٪ روز کاری.</p>
      <div class="tbl-wrap"><table class="cmp months-tbl"><thead><tr><th>ماه</th><th>ترافیک</th><th>قیمت</th><th>ارزش زمانی</th></tr></thead><tbody>${mrows}</tbody></table></div></div>`;
  return `${mk}${seasonCard}<div class="s-grid">
      ${DEMO ? `<div class="s-card"><h3>به‌روزرسانی قیمت</h3><p class="s-desc">در این نسخه نمایشی قیمت‌ها همان آخرین برداشت بازارند. قیمت هر سازه را می‌توانید در جدول پایین دستی عوض کنید؛ تغییر شما فقط در همین مرورگر ذخیره می‌شود. اتصال فید قیمت روزانه (گوگل‌شیت یا CSV) در نسخه نصب‌شده روی GitHub فعال است.</p></div>` : `<div class="s-card"><h3>فید قیمت تیم (به‌روزرسانی هفتگی)</h3>
        <p class="s-desc">یک فایل CSV یا JSON قیمت — مثلاً گوگل‌شیتی که تیم یا مجری‌ها به‌روز می‌کنند و «Publish to web» شده — یا خروجی خود مخزن (<span class="ltr">data/prices.json</span>) که GitHub Actions هر 7 روز می‌سازد. ستون‌ها: نام یا کد سازه، مختصات (اختیاری)، مجری، قیمت لیست، قیمت مذاکره‌شده.</p>
        <div class="field"><label for="feedUrl">آدرس فید</label><input id="feedUrl" class="inp ltr" data-act="pr-feedurl" value="${esc(f.url || '')}" placeholder="https://docs.google.com/spreadsheets/d/…/pub?output=csv"></div>
        <div class="btn-row"><button class="btn btn-primary" data-act="pr-feed">${icon('refresh')} دریافت الان</button></div>
        <div class="status-line ${f.status === 'err' ? 'err' : f.updatedAt ? 'ok' : 'wait'}">${f.status === 'err' ? 'دریافت فید ممکن نشد — آدرس یا دسترسی را بررسی کنید.' : f.updatedAt ? `آخرین به‌روزرسانی: ${new Date(f.updatedAt).toLocaleString('fa-IR-u-nu-latn')} · ${f.count} قیمت` : 'هنوز فیدی دریافت نشده است.'}</div>
      </div>`}
      <div class="s-card"><h3>قوانین مجری‌ها</h3><p class="s-desc">برای هر مجری: فروش فقط به‌صورت باندل، حداقل مدت قرارداد و تخفیف توافقی.</p>
        ${owners.length ? `<div class="tbl-wrap"><table class="cmp rules-tbl"><thead><tr><th>مجری</th><th>سازه</th><th>فقط باندل</th><th>حداقل مدت</th><th>تخفیف</th></tr></thead><tbody>${ownerRows}</tbody></table></div>` : '<p class="s-desc">هنوز مجری‌ای در فهرست سازه‌ها ثبت نشده (ستون «مالک» در فایل ورودی).</p>'}
      </div>
    </div>
    <div class="s-card"><div class="sec-title" style="margin-bottom:6px"><h3 style="margin:0">باندل‌ها</h3><button class="btn btn-ghost btn-sm" data-act="pr-bnew">${icon('plus')} باندل جدید</button></div>
      <p class="s-desc">بسته‌هایی که مجری‌ها با هم می‌فروشند. در پیشنهاد کمپین، باندل یکجا انتخاب یا رد می‌شود.</p>
      ${editor}<div class="bundle-list">${bundles || '<p class="s-desc">باندلی تعریف نشده است.</p>'}</div></div>
    <div class="s-card"><div class="sec-title" style="margin-bottom:6px"><h3 style="margin:0">قیمت سازه‌ها</h3><input class="inp inp-sm" style="max-width:220px" data-act="pr-q" value="${esc(q)}" placeholder="جستجوی نام یا مجری" aria-label="جستجو"></div>
      <p class="s-desc">قیمت ماهانه به تومان. قیمت بازار هر 7 روز از فهرست‌های عمومی به‌روز می‌شود؛ اگر قیمتی قدیمی یا نادرست است همین‌جا عوض کنید — با برچسب «دستی» ذخیره می‌شود و به‌روزرسانی روزانه رویش نمی‌نویسد. قیمت مذاکره‌شده جدا نگه داشته می‌شود. «ضریب» ارزش سازه را برای چیزهایی که مدل نمی‌بیند بالا و پایین می‌برد.</p>
      <div class="tbl-wrap"><table class="cmp price-tbl"><thead><tr><th>سازه</th><th>مجری</th><th>قیمت لیست</th><th>قیمت مذاکره‌شده</th><th>ضریب</th><th>قیمت منصفانه</th><th>ارزش خرید</th><th>منبع</th><th>عمر قیمت</th><th>تغییر</th></tr></thead><tbody>${priceRows}</tbody></table></div>
      ${list.length > 200 ? `<p class="s-desc">${list.length - 200} مورد دیگر — با جستجو محدود کنید.</p>` : ''}
    </div>`;
}

function replan() { computePlan(); renderPlanner(); }

function setCoef(t) {
  const it = state.inventory.find(x => x.id === t.dataset.id); if (!it) return true;
  const v = +t.value; if (v === 1) delete it.coef; else it.coef = v;
  persistInventory(); replan();
  return true;
}

async function onPlannerClick(t, e) {
  const P = state.plan, pr = state.pricing, a = t.dataset.act;
  if (a === 'guide-close') { state.guide = null; renderPlanner(); return true; }
  if (a === 'pl-tab') { P.tab = t.dataset.v; renderPlanner(); return true; }
  if (a === 'pl-obj') { P.objective = t.dataset.v; replan(); return true; }
  if (a === 'pl-start') { P.start = t.dataset.v; replan(); return true; }
  if (a === 'pr-months-reset') { e.preventDefault(); pr.months = {}; persistPricing(); replan(); return true; }
  if (a === 'pl-dist') { const n = +t.dataset.v; P.districts = P.districts.includes(n) ? P.districts.filter(x => x !== n) : [...P.districts, n]; replan(); return true; }
  if (a === 'pl-type') { const v = t.dataset.v; P.types = P.types.includes(v) ? P.types.filter(x => x !== v) : [...P.types, v]; replan(); return true; }
  if (a === 'pl-lock') { P.locks[t.dataset.id] = !P.locks[t.dataset.id]; delete P.excludes[t.dataset.id]; replan(); return true; }
  if (a === 'pl-excl') { P.excludes[t.dataset.id] = true; delete P.locks[t.dataset.id]; replan(); return true; }
  if (a === 'pl-reset-ex') { e.preventDefault(); P.excludes = {}; replan(); return true; }
  if (a === 'pl-copy') {
    const R = P.result?.res; if (!R) return true;
    const rows = [['سازه', 'مجری', 'نوع خرید', 'هفته', 'هزینه (تومان)', 'ایمپرشن', 'نفر-ساعت', 'CPM'],
      ...R.selected.map(o => [o.name, o.owner || '', o.kind === 'bundle' ? 'باندل' : 'تکی', o.weeks, Math.round(o.cost), Math.round(o.imp), Math.round(o.expH), Math.round(o.cost / (o.imp / 1000))])];
    copyText(rows.map(r => r.join('\t')).join('\n'), 'جدول پیشنهاد کپی شد؛ در اکسل یا گوگل‌شیت Paste کنید');
    return true;
  }
  if (a === 'pr-bnew') { P.editBundle = { name: 'باندل جدید', owner: '', price: null, minWeeks: 4, only: false, ids: [] }; renderPlanner(); return true; }
  if (a === 'pr-bedit') { const b = pr.bundles.find(x => x.id === t.dataset.id); P.editBundle = JSON.parse(JSON.stringify(b)); renderPlanner(); return true; }
  if (a === 'pr-bdel') { pr.bundles = pr.bundles.filter(x => x.id !== t.dataset.id); persistPricing(); computePlan(); renderPlanner(); return true; }
  if (a === 'pr-bcancel') { P.editBundle = null; renderPlanner(); return true; }
  if (a === 'pr-bsave') {
    const E = P.editBundle;
    if (!E.ids.length || !E.price) { toast('حداقل یک سازه و قیمت باندل لازم است', 'err'); return true; }
    if (E.id) pr.bundles = pr.bundles.map(b => b.id === E.id ? E : b); else pr.bundles.push({ ...E, id: uid() });
    P.editBundle = null; persistPricing(); computePlan(); renderPlanner(); toast('باندل ذخیره شد', 'ok'); return true;
  }
  if (a === 'pr-feed') { await refreshFeed(true); return true; }
  return false;
}

function onPlannerChange(t) {
  const P = state.plan, pr = state.pricing, a = t.dataset.act;
  if (a === 'pl-budget') { const v = parseNum(t.value); if (v > 0) { P.budget = v; replan(); } return true; }
  if (a === 'pl-weeks') { P.weeks = +t.value; replan(); return true; }
  if (a === 'pl-start') { P.start = t.value; replan(); return true; }
  if (a === 'pl-season-t') { pr.scenario.seasonTraffic = t.checked; persistPricing(); replan(); return true; }
  if (a === 'pl-season-p') { pr.scenario.seasonPrice = t.checked; persistPricing(); replan(); return true; }
  if (a === 'pr-month') {
    const n = +t.dataset.n, k = t.dataset.k, v = t.value;
    const o = { ...(pr.months[n] || {}) };
    if (v === '') delete o[k]; else o[k] = +v;
    if (Object.keys(o).length) pr.months[n] = o; else delete pr.months[n];
    persistPricing(); replan(); return true;
  }
  if (a === 'pl-adj') { pr.scenario.adj = +t.value; persistPricing(); replan(); return true; }
  if (a === 'pl-neg') { pr.scenario.useNegotiated = t.checked; persistPricing(); replan(); return true; }
  if (a === 'pl-longer') { pr.scenario.allowLonger = t.checked; persistPricing(); replan(); return true; }
  if (a === 'pl-perroad') { P.perRoad = +t.value; replan(); return true; }
  if (a === 'pl-minscore') { P.minScore = +t.value; replan(); return true; }
  if (a === 'pl-sites') { P.includeSites = t.checked; evaluateMarket().then(replan); return true; }
  if (a === 'pr-rule') {
    const o = t.dataset.owner, k = t.dataset.k;
    pr.rules[o] = { ...ruleFor(pr, o), [k]: k === 'bundleOnly' ? t.checked : +t.value };
    persistPricing(); computePlan(); renderPlanner(); return true;
  }
  if (a === 'pr-coef') return setCoef(t);
  if (a === 'pr-price') {
    const it = state.inventory.find(x => x.id === t.dataset.id); if (!it) return true;
    const v = parseNum(t.value);
    if (t.dataset.k === 'price') { if (it.price && v !== it.price) it.prevPrice = it.price; it.price = v || null; } else it.negotiated = v || null;
    it.priceSource = 'manual'; it.priceUpdated = new Date().toISOString();
    persistInventory(); P.evalKey = ''; evaluateMarket().then(() => { computePlan(); renderPlanner(); });
    return true;
  }
  if (a === 'pr-be') {
    const E = P.editBundle, k = t.dataset.k;
    E[k] = k === 'only' ? t.checked : k === 'price' ? parseNum(t.value) : k === 'minWeeks' ? +t.value : t.value;
    if (k === 'owner') renderPlanner();
    return true;
  }
  if (a === 'pr-be-item') {
    const E = P.editBundle, id = t.dataset.id;
    E.ids = t.checked ? [...E.ids, id] : E.ids.filter(x => x !== id);
    return true;
  }
  if (a === 'pr-feedurl') { pr.feed.url = t.value.trim(); persistPricing(); return true; }
  if (a === 'pr-q') { P.priceQuery = t.value; renderPlanner(); return true; }
  return false;
}

/** Daily feed: the repo's data/prices.json (built by GitHub Actions) and/or a user URL. */
async function refreshFeed(manual = false) {
  const pr = state.pricing;
  const urls = [];
  if (!DEMO && IS_TEHRAN) urls.push('data/prices.json'); // the team price sheet covers Tehran
  if (pr.feed.url) urls.push(pr.feed.url);
  if (DEMO) {
    if (manual) { pr.feed.updatedAt = new Date().toISOString(); pr.feed.count = state.inventory.filter(x => x.price).length; pr.feed.status = 'ok'; persistPricing(); toast('فید دمو به‌روز شد (قیمت‌ها فرضی‌اند)', 'ok'); renderPlanner(); }
    return;
  }
  let total = 0, ok = false;
  for (const u of urls) {
    try {
      const { rows, updatedAt } = await fetchFeed(u, parseTable);
      const m = mergeFeed(state.inventory, rows, dist, updatedAt || new Date().toISOString());
      total += m.matched + m.added; ok = true;
    } catch { /* try next */ }
  }
  pr.feed.status = ok ? 'ok' : (manual ? 'err' : pr.feed.status);
  if (ok) { pr.feed.updatedAt = new Date().toISOString(); pr.feed.count = total; persistInventory(); state.plan.evalKey = ''; }
  persistPricing();
  if (manual) {
    toast(ok ? `${total} قیمت به‌روز شد` : 'دریافت فید ممکن نشد', ok ? 'ok' : 'err');
    if (ok) { await evaluateMarket(true); computePlan(); }
    renderPlanner();
  }
}

// ════════════════════════════════════════════════════════════
//  municipal districts + leaderboard
// ════════════════════════════════════════════════════════════
let districtLayer = null;

async function loadDistricts() {
  if (state.districts) return state.districts;
  let d = null;
  try { d = await net.districts(); } catch { d = null; }
  state.districts = d || (IS_TEHRAN ? approximateDistricts() : []);
  state.districtsApprox = !d;
  return state.districts;
}

async function setDistrictLayer(on) {
  $('#lyrDistricts').checked = on;
  if (!on) { if (districtLayer) map.removeLayer(districtLayer); return; }
  const ds = await loadDistricts();
  if (!districtLayer) {
    districtLayer = L.layerGroup();
    ds.forEach(d => {
      const poly = L.polygon(d.rings || [d.poly], { color: '#8E6BFF', weight: 1.4, dashArray: d.approx ? '5 5' : null, fillColor: '#8E6BFF', fillOpacity: 0.04, interactive: true, bubblingMouseEvents: false });
      poly._dn = d.n;
      poly.on('mouseover', () => { if (!poly._on) poly.setStyle({ fillOpacity: 0.14 }); });
      poly.on('mouseout', () => { if (!poly._on) highlightDistricts(); });
      poly.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        if (state.mapMode === 'addStructure') { map.fire('click', { latlng: ev.latlng }); return; }
        // clicking a district selects it as the ranking scope (shift/ctrl adds to the selection)
        const add = ev.originalEvent && (ev.originalEvent.shiftKey || ev.originalEvent.ctrlKey || ev.originalEvent.metaKey);
        const S = state.scope;
        selectDistricts(add ? [...new Set([...(S.mode === 'district' ? S.districts : []), d.n])] : [d.n], { fit: false });
        const n = (state.plan.entries || []).filter(x => x.src === 'inv' && x.district === d.n).length;
        L.popup({ autoPan: false }).setLatLng(ev.latlng).setContent(`<b>منطقه ${d.n}</b><div class="pop-sub">${esc(d.fa)}${d.approx ? ' · مرز تقریبی' : ''}</div><div class="pop-stats"><span><b>${n}</b> سازه · رتبه‌ها در پنل</span></div><button class="btn btn-ghost btn-block" data-act="district-board" data-n="${d.n}">${icon('sort')} لیدربورد کامل منطقه ${d.n}</button><button class="btn btn-ghost btn-block" style="margin-top:6px" data-act="district-analyze" data-lat="${ev.latlng.lat}" data-lng="${ev.latlng.lng}">${icon('target')} تحلیل همین نقطه</button>`).openOn(map);
      });
      poly.addTo(districtLayer);
      L.marker(d.center, { interactive: false, pane: 'markerPane', icon: L.divIcon({ className: '', iconSize: null, html: `<div class="district-lbl">منطقه ${d.n}</div>` }) }).addTo(districtLayer);
    });
    if (state.districtsApprox && !DEMO) toast('مرز مناطق از OpenStreetMap دریافت نشد؛ مرزها تقریبی‌اند', '');
  }
  districtLayer.addTo(map);
  highlightDistricts();
}

const BOARD_COLS = [
  ['rank', '#', null],
  ['name', 'سازه', x => x.name],
  ['district', 'منطقه', x => x.district ?? 99],
  ['road', 'مسیر', x => x.road || ''],
  ['type', 'نوع', x => x.type],
  ['owner', 'مجری', x => x.owner || ''],
  ['score', 'امتیاز', x => x.score],
  ['imp', 'ایمپرشن روزانه', x => x.ev.dailyImp],
  ['exp', 'مواجهه (ث)', x => x.ev.exp],
  ['sight', 'دید مستقیم', x => x.sight ?? 0],
  ['price', 'اجاره ماهانه', x => x.monthly ?? -1],
  ['cpm', 'CPM', x => x.cpm ?? Infinity],
  ['value', 'ارزش خرید', x => x.valueIdx ?? -1],
  ['fair', 'قیمت منصفانه', x => x.fair ?? -1],
  ['coef', 'ضریب', x => x.coef || 1],
  ['age', 'عمر قیمت', x => daysSince(x.priceUpdated) ?? 1e9],
  ['clutter', 'تابلوی نزدیک', x => x.clutter ?? 0],
];

function boardRows() {
  const P = state.plan, B = state.board;
  const q = B.q.trim();
  let rows = (P.entries || []).map(e => {
    const monthly = monthlyPrice(e, state.pricing);
    return { ...e, monthly, cpm: monthly ? monthly / (e.ev.weeklyImp * 30 / 7 / 1000) : null };
  });
  rows = rows.filter(r => (!B.districts.length || B.districts.includes(r.district)) && (!B.types.length || B.types.includes(r.type === 'ad' ? 'bulletin' : r.type)) &&
    (!B.owner || r.owner === B.owner) && (!B.pricedOnly || r.monthly) && (!q || r.name.includes(q) || (r.road || '').includes(q)));
  const col = BOARD_COLS.find(c => c[0] === B.sort) || BOARD_COLS[6];
  const get = col[2] || (x => x.score);
  rows.sort((a, b) => {
    const va = get(a), vb = get(b);
    const c = typeof va === 'string' ? va.localeCompare(vb, 'fa') : va - vb;
    return c * B.dir;
  });
  return rows;
}

function boardHTML() {
  const B = state.board, P = state.plan;
  if (P.status === 'loading' || !P.entries) return '<div class="s-card"><div class="skel" style="height:140px"></div><p class="s-desc" style="margin-top:12px">در حال سنجش همه سازه‌ها…</p></div>';
  revalue();
  const rows = boardRows();
  const owners = [...new Set((P.entries || []).map(e => e.owner).filter(Boolean))];
  const ds = state.districts || [];
  const allD = distNums();
  const perD = allD.map(n => {
    const r = (P.entries || []).filter(e => e.district === n);
    return { n, count: r.length, imp: r.reduce((a, e) => a + e.ev.dailyImp, 0), score: r.length ? Math.round(r.reduce((a, e) => a + e.score, 0) / r.length) : 0 };
  });
  const maxImp = Math.max(1, ...perD.map(d => d.imp));
  const dGrid = allD.map(n => {
    const d = perD[n - 1];
    return `<button class="dist ${B.districts.includes(n) ? 'on' : ''} ${d.count ? '' : 'empty'}" data-act="bd-dist" data-v="${n}" title="منطقه ${n}${distFa(n) ? ` — ${esc(distFa(n))}` : ""}: ${d.count} سازه، میانگین امتیاز ${d.score}">
      <b>${n}</b><i style="height:${Math.round(d.imp / maxImp * 100)}%"></i><small>${d.count}</small></button>`;
  }).join('');
  const sel = B.sel;
  const head = BOARD_COLS.map(([k, l]) => k === 'rank' ? `<th class="ck"><input type="checkbox" data-act="bd-all" aria-label="انتخاب همه" ${rows.length && rows.every(r => sel.has(r.id)) ? 'checked' : ''}></th><th>#</th>`
    : `<th><button class="sort ${B.sort === k ? 'on' : ''}" data-act="bd-sort" data-v="${k}">${l}${B.sort === k ? (B.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
  const body = rows.slice(0, 300).map((r, i) => {
    const col = r.score >= 70 ? 'var(--good)' : r.score >= 50 ? 'var(--warn)' : 'var(--bad)';
    const inPlan = P.result?.res.selected.some(o => o.ids.includes(r.id));
    return `<tr class="${sel.has(r.id) ? 'sel-row' : ''}">
      <td class="ck"><input type="checkbox" data-act="bd-row" data-id="${r.id}" ${sel.has(r.id) ? 'checked' : ''} aria-label="انتخاب"></td>
      <td>${i + 1}</td>
      <td class="nm"><b>${esc(r.name)}</b>${r.approx ? ` <span class="chip warn" title="${esc(LOC_FA[r.loc] || '')}${r.locNote ? ' — ' + esc(r.locNote) : ''}">مکان تقریبی</span>` : ''}${inPlan ? ' <span class="chip good">در کمپین</span>' : ''}${P.locks[r.id] ? ` <span class="chip warn">${icon('lock')}</span>` : ''}</td>
      <td>${r.district ?? '—'}</td><td class="rd" title="${esc(r.road || '')}">${esc(r.road || '—')}</td><td>${TYPE_FA[r.type] || '—'}</td><td>${esc(r.owner || (r.src === 'site' ? 'نقاط مقایسه' : '—'))}</td>
      <td><span class="mini-score" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)">${r.score}</span></td>
      <td>${num(r.ev.dailyImp)}</td><td>${num1(r.ev.exp)}</td><td>${r.sight ? num(r.sight) + ' م' : '—'}</td>
      <td>${r.monthly ? toman(r.monthly) : '—'}${r.priceEstimated ? ' <span class="chip" title="قیمت را خود منبع با فرمول برآورد کرده">برآورد</span>' : ''}</td><td>${r.cpm ? num(r.cpm) : '—'}</td>
      <td>${valueChip(r.valueIdx, r.approx)}</td><td>${r.fair ? toman(r.fair) : '—'}</td><td>${r.src === 'inv' ? coefSelect(r.id, r.coef || 1) : '—'}</td><td>${priceAge(r.priceUpdated)}</td>
      <td>${r.clutter || 0}</td></tr>`;
  }).join('');
  const nSel = [...sel].filter(id => rows.some(r => r.id === id)).length;
  return `<div class="s-card">
      <div class="sec-title" style="margin-bottom:8px"><h3 style="margin:0">مناطق شهرداری</h3><span class="s-desc" style="margin:0">ارتفاع ستون = ایمپرشن روزانه کل سازه‌های منطقه · عدد پایین = تعداد سازه${state.districtsApprox ? ' · مرزها تقریبی' : ''}</span></div>
      <div class="dist-grid">${dGrid}</div>
      <div class="btn-row" style="margin-top:10px;justify-content:flex-start;flex-wrap:wrap">
        ${B.districts.length ? `<button class="btn btn-ghost btn-sm" data-act="bd-dclear">همه مناطق</button><button class="btn btn-ghost btn-sm" data-act="bd-dmap">${icon('layers')} نمایش این مناطق روی نقشه</button>` : ''}
      </div>
    </div>
    <div class="s-card">
      <div class="board-filters">
        <input class="inp inp-sm" data-act="bd-q" value="${esc(B.q)}" placeholder="جستجوی نام یا مسیر" aria-label="جستجو">
        <div class="chips-toggle">${['bridge', 'bulletin', 'poster', 'digital'].map(t => `<button class="${B.types.includes(t) ? 'on' : ''}" data-act="bd-type" data-v="${t}">${TYPE_FA[t]}</button>`).join('')}</div>
        <select class="sel sel-sm" data-act="bd-owner" aria-label="مجری"><option value="">همه مجری‌ها</option>${owners.map(o => `<option ${B.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <label class="switch-row inline"><input type="checkbox" data-act="bd-priced" ${B.pricedOnly ? 'checked' : ''}><span class="switch"></span><span>فقط قیمت‌دار</span></label>
      </div>
      <div class="bulk ${nSel ? '' : 'idle'}">
        <span><b>${nSel}</b> سازه انتخاب شده از ${rows.length}</span>
        <button class="btn btn-ghost btn-sm" data-act="bd-selall">انتخاب همه نتایج</button>
        <button class="btn btn-ghost btn-sm" data-act="bd-none" ${nSel ? '' : 'disabled'}>لغو انتخاب</button>
        <button class="btn btn-primary btn-sm" data-act="bd-lock" ${nSel ? '' : 'disabled'}>${icon('lock')} قفل در کمپین</button>
        <button class="btn btn-ghost btn-sm" data-act="bd-excl" ${nSel ? '' : 'disabled'}>کنار گذاشتن از کمپین</button>
        <button class="btn btn-ghost btn-sm" data-act="bd-only" ${nSel ? '' : 'disabled'}>کمپین فقط از همین‌ها</button>
        <button class="btn btn-ghost btn-sm" data-act="bd-show" ${nSel ? '' : 'disabled'}>${icon('target')} روی نقشه</button>
      </div>
      <div class="tbl-wrap board-wrap"><table class="cmp board-tbl"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="18" class="s-desc">سازه‌ای با این فیلترها نیست.</td></tr>'}</tbody></table></div>
      ${rows.length > 300 ? `<p class="s-desc">${rows.length - 300} مورد دیگر — فیلتر کنید.</p>` : ''}
      <p class="disclaimer">امتیاز و ایمپرشن با مدل (بدون مصرف سهمیه API) محاسبه شده‌اند. CPM = اجاره ماهانه پس از قوانین مجری ÷ ایمپرشن ماهانه. <b>ارزش خرید</b> = قیمت منصفانه ÷ قیمت؛ قیمت منصفانه = ایمپرشن ماهانه × CPM میانه بازار برای همان نوع سازه × ضریب ارزشمندی. بالای 1 یعنی این سازه بیش از قیمتش مخاطب می‌دهد. ضریب را برای چیزهایی که مدل نمی‌بیند تنظیم کنید (مخاطب منطقه، تناسب با برند، کیفیت واقعی دید)؛ پیشنهاد کمپین هم با همین ضریب وزن می‌گیرد.</p>
    </div>`;
}

async function onBoardClick(t, e) {
  const B = state.board, P = state.plan, a = t.dataset.act;
  const visible = () => boardRows().map(r => r.id);
  if (a === 'bd-sort') { const k = t.dataset.v; if (B.sort === k) B.dir *= -1; else { B.sort = k; B.dir = ['name', 'road', 'owner', 'type', 'district', 'cpm', 'clutter', 'age'].includes(k) ? 1 : -1; } renderPlanner(); return true; }
  if (a === 'bd-dist') { const n = +t.dataset.v; B.districts = B.districts.includes(n) ? B.districts.filter(x => x !== n) : [...B.districts, n]; renderPlanner(); return true; }
  if (a === 'bd-dclear') { B.districts = []; renderPlanner(); return true; }
  if (a === 'bd-type') { const v = t.dataset.v; B.types = B.types.includes(v) ? B.types.filter(x => x !== v) : [...B.types, v]; renderPlanner(); return true; }
  if (a === 'bd-selall') { visible().forEach(id => B.sel.add(id)); renderPlanner(); return true; }
  if (a === 'bd-none') { B.sel.clear(); renderPlanner(); return true; }
  const chosen = () => [...B.sel].filter(id => visible().includes(id));
  if (a === 'bd-lock') { chosen().forEach(id => { P.locks[id] = true; delete P.excludes[id]; }); computePlan(); renderPlanner(); toast(`${chosen().length} سازه در کمپین قفل شد`, 'ok'); return true; }
  if (a === 'bd-excl') { chosen().forEach(id => { P.excludes[id] = true; delete P.locks[id]; }); computePlan(); renderPlanner(); toast('از کمپین کنار گذاشته شد'); return true; }
  if (a === 'bd-only') {
    const keep = new Set(chosen());
    P.excludes = {}; (P.entries || []).forEach(e => { if (!keep.has(e.id)) P.excludes[e.id] = true; });
    P.tab = 'plan'; computePlan(); renderPlanner(); toast(`پیشنهاد کمپین فقط از ${keep.size} سازه انتخاب‌شده`, 'ok'); return true;
  }
  if (a === 'bd-show' || a === 'bd-dmap') {
    const ids = a === 'bd-show' ? new Set(chosen()) : new Set(visible());
    const pts = (P.entries || []).filter(e => ids.has(e.id)).map(e => [e.lat, e.lng]).filter(p => p[0]);
    $('#sheet').hidden = true; state.sheet = null;
    setStructuresLayer(true); if (a === 'bd-dmap') setDistrictLayer(true);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 15, paddingBottomRight: isMobile() ? [0, 0] : [440, 0] });
    return true;
  }
  return false;
}

function onBoardChange(t) {
  const B = state.board, a = t.dataset.act;
  if (a === 'pr-coef') return setCoef(t);
  if (a === 'bd-row') { if (t.checked) B.sel.add(t.dataset.id); else B.sel.delete(t.dataset.id); renderPlanner(); return true; }
  if (a === 'bd-all') { const ids = boardRows().map(r => r.id); ids.forEach(id => t.checked ? B.sel.add(id) : B.sel.delete(id)); renderPlanner(); return true; }
  if (a === 'bd-owner') { B.owner = t.value; renderPlanner(); return true; }
  if (a === 'bd-priced') { B.pricedOnly = t.checked; renderPlanner(); return true; }
  if (a === 'bd-q') { B.q = t.value; renderPlanner(); return true; }
  return false;
}

// ════════════════════════════════════════════════════════════
//  search
// ════════════════════════════════════════════════════════════
let searchTimer = null, searchSeq = 0, searchItems = [], searchActive = -1;
function bindSearch() {
  const inp = $('#search'), box = $('#searchResults'), clr = $('#searchClear');
  const SRC = { neshan: 'نشان', mapir: 'Map.ir', osm: 'OpenStreetMap' };
  const show = (items, src) => {
    searchItems = items; searchActive = -1;
    box.hidden = false;
    box.innerHTML = (items.length ? items.map((it, i) => `<button class="sr-item" data-i="${i}" role="option">${icon(it.coord ? 'target' : 'search')}<span><b>${esc(it.title)}</b><small>${esc(it.sub || '')}</small></span></button>`).join('')
      : `<div class="sr-empty">نتیجه‌ای در ${CITY.fa} پیدا نشد</div>`) + (src ? `<div class="sr-src">نتایج از ${SRC[src] || src}</div>` : '');
  };
  inp.addEventListener('input', () => {
    const q = inp.value.trim();
    clr.hidden = !q;
    clearTimeout(searchTimer);
    if (q.length < 2) { box.hidden = true; return; }
    const m = q.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).match(/^\s*(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) { show([{ title: 'رفتن به مختصات', sub: `${m[1]}, ${m[2]}`, lat: +m[1], lng: +m[2], coord: true }]); return; }
    box.hidden = false; box.innerHTML = '<div class="sr-empty">در حال جستجو…</div>';
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try { const r = await providers.search(q, state.settings); if (seq === searchSeq) show(r.items, r.provider); }
      catch { if (seq === searchSeq) box.innerHTML = '<div class="sr-empty">جستجو در دسترس نیست — اتصال اینترنت را بررسی کنید</div>'; }
    }, 380);
  });
  inp.addEventListener('keydown', e => {
    if (box.hidden || !searchItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchActive = (searchActive + (e.key === 'ArrowDown' ? 1 : -1) + searchItems.length) % searchItems.length;
      box.querySelectorAll('.sr-item').forEach((b, i) => b.classList.toggle('active', i === searchActive));
    } else if (e.key === 'Enter') { e.preventDefault(); goTo(searchItems[Math.max(0, searchActive)]); }
    else if (e.key === 'Escape') box.hidden = true;
  });
  box.addEventListener('click', e => { const b = e.target.closest('.sr-item'); if (b) goTo(searchItems[+b.dataset.i]); });
  clr.addEventListener('click', () => { inp.value = ''; clr.hidden = true; box.hidden = true; if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; } inp.focus(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
}
function goTo(it) {
  if (!it) return;
  $('#searchResults').hidden = true;
  $('#search').value = it.title;
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([it.lat, it.lng], { icon: L.divIcon({ className: '', html: '<div class="search-pin"></div>', iconSize: [22, 22] }) }).addTo(map);
  searchMarker.bindPopup(`<b>${esc(it.title)}</b><div style="color:var(--muted);font-size:12px;margin:2px 0 10px">${esc(it.sub || '')}</div><button class="btn btn-primary btn-block" data-act="analyze-struct" data-lat="${it.lat}" data-lng="${it.lng}" data-kind="" data-name="">${icon('target')} تحلیل این نقطه</button>`).openPopup();
  map.flyTo([it.lat, it.lng], 16, { duration: 0.8 });
}

// ════════════════════════════════════════════════════════════
//  dialogs
// ════════════════════════════════════════════════════════════
function openSettings() {
  const d = $('#dlgSettings');
  const st = state.settings;
  const work = JSON.parse(JSON.stringify(st.providers));
  const tests = {};

  const card = (id, i) => {
    const P = PROVIDERS[id], cfg = work[id];
    const s = providers.status(id, { providers: work });
    const use = providers.usageOf(id);
    const pct = cfg.cap ? Math.min(100, use.count / cfg.cap * 100) : 0;
    const pill = s.state === 'ready' ? (i === firstReady() ? '<span class="pill ok">در حال استفاده</span>' : '<span class="pill">رزرو</span>')
      : s.state === 'paused' ? `<span class="pill warn">${esc(s.label)}</span>` : `<span class="pill">${esc(s.label)}</span>`;
    return `<div class="prov" data-id="${id}">
      <div class="prov-head">
        <span class="prov-rank">${i + 1}</span>
        <div class="prov-name"><b>${P.fa}</b><small>${P.note}</small></div>
        ${pill}
        <div class="prov-move">
          <button type="button" class="icon-btn" data-pact="up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="اولویت بالاتر"><svg style="transform:rotate(180deg)"><use href="#i-chev"/></svg></button>
          <button type="button" class="icon-btn" data-pact="down" data-id="${id}" ${i === work.order.length - 1 ? 'disabled' : ''} aria-label="اولویت پایین‌تر"><svg><use href="#i-chev"/></svg></button>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label for="k-${id}">کلید API</label><input class="inp ltr" id="k-${id}" data-pf="key" data-id="${id}" value="${esc(cfg.key)}" placeholder="${P.keyHint}" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="c-${id}">سقف ماهانه (درخواست)</label><input class="inp ltr" id="c-${id}" data-pf="cap" data-id="${id}" value="${cfg.cap || ''}" placeholder="بدون سقف" inputmode="numeric"></div>
      </div>
      ${id === 'neshan' ? `<div class="field"><label for="p-${id}">آدرس پروکسی (اختیاری)</label><input class="inp ltr" id="p-${id}" data-pf="proxy" data-id="${id}" value="${esc(cfg.proxy || '')}" placeholder="https://your-worker.workers.dev"></div>` : ''}
      <div class="usage"><div class="usage-bar"><i style="width:${pct}%"></i></div><small>${num(use.count)} درخواست در این ماه${cfg.cap ? ` از ${num(cfg.cap)}` : ''}</small></div>
      <div class="prov-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-pact="test" data-id="${id}">${icon('refresh')} تست اتصال</button>
        ${use.pausedUntil > Date.now() ? `<button type="button" class="btn btn-ghost btn-sm" data-pact="resume" data-id="${id}">از سرگیری</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-pact="reset" data-id="${id}">صفر کردن شمارنده</button>
        ${DEMO ? `<button type="button" class="btn btn-ghost btn-sm" data-pact="exhaust" data-id="${id}">شبیه‌سازی اتمام سهمیه</button>` : ''}
        <a class="prov-link" href="${P.site}" target="_blank" rel="noopener">دریافت کلید ↗</a>
      </div>
      ${tests[id] ? `<div class="status-line ${tests[id].cls}">${tests[id].msg}</div>` : ''}
    </div>`;
  };
  const firstReady = () => work.order.findIndex(id => providers.status(id, { providers: work }).state === 'ready');

  const render = () => {
    d.querySelector('#provList').innerHTML = work.order.map(card).join('');
  };

  d.innerHTML = `<form method="dialog">
    <div class="dlg-head"><h2>تنظیمات و منابع داده</h2><button class="icon-btn" value="cancel" aria-label="بستن">${icon('close')}</button></div>
    <div class="dlg-body">
      <h3>منابع داده زنده</h3>
      <p>به ترتیب اولویت استفاده می‌شوند. وقتی یکی به سقف ماهانه برسد، خطای سهمیه بدهد یا در دسترس نباشد، درخواست خودکار به منبع بعدی می‌رود. اگر هیچ‌کدام در دسترس نباشد، مدل ترافیک تهران جای آن را می‌گیرد و ابزار متوقف نمی‌شود.</p>
      <div id="provList" class="prov-list"></div>
      <p class="hint-sm">بلد در حال حاضر API عمومی برای توسعه‌دهندگان ارائه نمی‌کند. در صورت دریافت دسترسی سازمانی، به‌عنوان منبع سوم اضافه می‌شود. کلیدها فقط در مرورگر شما ذخیره می‌شوند و در لینک اشتراکی قرار نمی‌گیرند.</p>
      <h3>فرض‌های عمومی</h3>
      <div class="grid2">
        <div class="field"><label for="setOcc">میانگین سرنشین هر خودرو</label><input class="inp ltr" id="setOcc" value="${st.occupancy}" inputmode="decimal"><small>ترکیب سواری، تاکسی و اتوبوس</small></div>
        <div class="field"><label for="setWeeks">مدت پیش‌فرض کمپین (هفته)</label><input class="inp ltr" id="setWeeks" value="${st.campaignWeeks}" inputmode="numeric"></div>
      </div>
    </div>
    <div class="dlg-foot"><button class="btn btn-primary" value="save">ذخیره</button><button class="btn btn-ghost" value="cancel">انصراف</button></div>
  </form>`;
  render();

  d.querySelector('#provList').addEventListener('input', e => {
    const f = e.target.dataset.pf; if (!f) return;
    const cfg = work[e.target.dataset.id];
    if (f === 'cap') cfg.cap = Math.max(0, Math.round(parseNum(e.target.value) || 0));
    else cfg[f] = e.target.value.trim();
  });
  d.querySelector('#provList').addEventListener('click', async e => {
    const b = e.target.closest('[data-pact]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.pact, i = work.order.indexOf(id);
    if (a === 'up' && i > 0) [work.order[i - 1], work.order[i]] = [work.order[i], work.order[i - 1]];
    if (a === 'down' && i < work.order.length - 1) [work.order[i + 1], work.order[i]] = [work.order[i], work.order[i + 1]];
    if (a === 'resume') providers.resume(id);
    if (a === 'reset') { providers.resetUsage(id); }
    if (a === 'exhaust') { work[id].cap = work[id].cap || 50; providers.setUsage(id, work[id].cap); }
    if (a === 'test') {
      if (!work[id].key) { tests[id] = { cls: 'err', msg: 'کلید وارد نشده است' }; render(); return; }
      tests[id] = { cls: 'wait', msg: 'در حال تست…' }; render();
      try { await providers.test(id, work[id]); tests[id] = { cls: 'ok', msg: 'اتصال برقرار است' }; }
      catch (err) {
        const s = err?.status;
        tests[id] = { cls: 'err', msg: s === 401 || s === 403 ? 'کلید نامعتبر است یا این سرویس برای کلید فعال نشده'
          : s === 429 || s === 402 ? 'سهمیه این کلید تمام شده'
          : s ? `پاسخ ${s} از سرور` : `در دسترس نیست — اگر خطای CORS است، از پروکسی استفاده کنید` };
      }
    }
    render();
  });

  d.onclose = () => {
    if (d.returnValue !== 'save') return;
    const had = anyConfigured(st);
    st.providers = work;
    const occ = parseFloat(d.querySelector('#setOcc').value); if (occ >= 1 && occ <= 5) st.occupancy = occ;
    const wk = parseNum(d.querySelector('#setWeeks').value); if (wk > 0 && wk < 105) st.campaignWeeks = Math.round(wk);
    emit('settings');
    updateDataChip();
    if (anyConfigured(st) && !had) { state.sites.forEach(fetchLive); if (state.draft) fetchLive(state.draft); }
    toast('تنظیمات ذخیره شد', 'ok');
  };
  d.showModal();
}

// ════════════════════════════════════════════════════════════
//  welcome screen + task guides
// ════════════════════════════════════════════════════════════
const WELCOME_KEY = 'billboard-insight:welcome:v1';
const TASKS = {
  district: { icon: 'board', t: 'بهترین بیلبوردهای یک منطقه', d: 'سازه‌های هر منطقه شهرداری، رتبه‌بندی‌شده با ایمپرشن، زمان مواجهه و ارزش خرید',
    steps: ['یک یا چند منطقه را از شبکه 22تایی بزنید، یا روی نقشه روی منطقه کلیک کنید.', 'معیار «مرتب‌سازی» را انتخاب کنید: امتیاز، ایمپرشن، ارزش خرید یا CPM ارزان.', 'روی هر سازه بزنید تا روی نقشه دیده شود؛ دکمه هدف کنار آن، تحلیل ساعتی کامل را باز می‌کند.', '«کمپین با بودجه در همین منطقه» بهترین ترکیب را برای بودجه شما می‌چیند.'] },
  plan: { icon: 'money', t: 'چیدن کمپین با بودجه مشخص', d: 'با بودجه و مدت کمپین، بهترین ترکیب سازه‌ها برای بیشترین ایمپرشن یا زمان مواجهه',
    steps: ['بودجه کل و مدت کمپین را در بخش «بودجه و مدت» وارد کنید.', 'هدف را انتخاب کنید: بیشترین ایمپرشن، بیشترین زمان مواجهه یا پوشش گسترده.', 'در صورت نیاز نوع سازه و مناطق را محدود کنید؛ پیشنهاد همان لحظه به‌روز می‌شود.', 'با قفل، سازه‌ای را نگه دارید و با ✕ حذف کنید؛ «کپی برای اکسل» جدول را برمی‌دارد.'] },
  compare: { icon: 'compare', t: 'مقایسه چند نقطه مشخص', d: 'هر نقطه از بزرگراه یا پل را روی نقشه بزنید و نقاط را کنار هم مقایسه کنید',
    steps: ['روی هر نقطه از بزرگراه یا پل در نقشه کلیک کنید؛ تحلیل همان نقطه باز می‌شود.', '«افزودن به مقایسه» را بزنید. 5 نقطه نمونه از قبل در فهرست هستند.', '«مقایسه و برآورد کمپین» نقاط را کنار هم و ساعت‌به‌ساعت نشان می‌دهد.'] },
  finder: { icon: 'spark', t: 'پیدا کردن جای بیلبورد جدید', d: 'بهترین نقاط خالی معابر یک منطقه برای نصب سازه تازه، دور از سازه‌های موجود',
    steps: ['نوع سازه جدید و نوع معابر را انتخاب کنید.', 'محدوده را «مناطق شهرداری» بگذارید و منطقه را بزنید، یا روی محدوده دلخواه زوم کنید.', '«جستجو» را بزنید؛ معابر رنگی می‌شوند و بهترین جایگاه‌ها شماره می‌گیرند.'] },
};

function guideHTML(key) {
  const g = TASKS[key];
  if (!g || state.guide !== key) return '';
  return `<div class="guide" role="note">
    <div class="guide-head"><b>${icon(g.icon)} ${g.t}</b><button class="icon-btn sm" data-act="guide-close" aria-label="بستن راهنما" title="بستن راهنما">${icon('close')}</button></div>
    <ol>${g.steps.map(x => `<li>${x}</li>`).join('')}</ol>
  </div>`;
}

function openWelcome() {
  const d = $('#dlgWelcome');
  const M = state.market;
  const priceDate = (() => { const it = state.inventory.find(x => x.source === 'market' && x.priceUpdated); return it ? new Date(it.priceUpdated).toLocaleDateString('fa-IR-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) : null; })();
  d.innerHTML = `<div class="dlg-body welcome">
    <div class="w-hero">
      <span class="brand-logo lg">${icon('board')}</span>
      <div><h2>بیلبوردسنج</h2><p>انتخاب سازه تبلیغاتی در ${CITY.fa} با برآورد ترافیک، زمان مواجهه، ایمپرشن و قیمت بازار.</p></div>
    </div>
    <div class="w-q">چه کاری می‌خواهید انجام دهید؟</div>
    <div class="w-tasks">${Object.entries(TASKS).filter(([k]) => CITY.districts || k !== 'district').map(([k, g]) => `<button class="w-task" data-task="${k}"><span class="w-ic">${icon(g.icon)}</span><span><b>${g.t}</b><small>${g.d}</small></span></button>`).join('')}</div>
    <div class="w-facts">
      <div><b>داده سازه‌ها</b><span>${M ? `${num(M.count)} سازه واقعی ${CITY.fa} از آگهی‌های عمومی اجاره بیلبورد` : 'فهرست سازه‌های واردشده'}${priceDate ? `؛ قیمت‌ها برداشت ${priceDate}` : ''}${DEMO ? '' : '؛ هر 7 روز به‌روز می‌شود'}. مکان بعضی سازه‌ها تقریبی است (حاشیه خط‌چین).</span></div>
      <div><b>ترافیک</b><span>${state.traffic?.items && Object.keys(state.traffic.items).length ? `الگوی ساعتی ترافیک و سرعت ${num(Object.keys(state.traffic.items).length)} سازه از API نشان، هر 7 روز به‌روز می‌شود؛ حجم تردد از تعداد خط و نوع معبر برآورد می‌شود.` : 'با مدل برآورد می‌شود: تعداد خط، نوع معبر، الگوی ساعتی ترافیک تهران و هندسه دید.'} اثر روزهای هفته و ماه‌های سال هم حساب می‌شود. عدد دقیق شمارش نیست.</span></div>
    </div>
    <dl class="w-gloss">
      <div><dt>ایمپرشن</dt><dd>تعداد دفعاتی که تابلو احتمالاً دیده می‌شود</dd></div>
      <div><dt>زمان مواجهه</dt><dd>ثانیه‌هایی که راننده تابلو را در میدان دید دارد</dd></div>
      <div><dt>امتیاز</dt><dd>0 تا 100؛ ترکیب حجم ایمپرشن و زمان مواجهه</dd></div>
      <div><dt>ارزش خرید</dt><dd>قیمت منصفانه ÷ قیمت؛ بالای 1 یعنی ارزان‌تر از بازار</dd></div>
    </dl>
  </div>
  <div class="dlg-foot"><span class="w-foot-note">این صفحه از دکمه «راهنما» بالای نقشه دوباره باز می‌شود.</span><button class="btn btn-ghost" data-close>فقط نقشه را نشان بده</button></div>`;
  d.querySelector('[data-close]').onclick = () => { markWelcomed(); d.close(); };
  d.querySelectorAll('[data-task]').forEach(b => b.onclick = () => { markWelcomed(); d.close(); startTask(b.dataset.task); });
  d.showModal();
}
function markWelcomed() { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* per-visit only */ } }
function welcomed() { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; } }

async function startTask(key) {
  state.guide = key;
  state.selectedId = null; map.closePopup();
  $('#sheet').hidden = true; state.sheet = null;
  if (isMobile()) setPanelSize('');
  if (key === 'district') {
    state.listTab = 'inventory'; state.scope.mode = 'district';
    setStructuresLayer(true); await setDistrictLayer(true);
    map.setView(CITY.center, CITY.zoom);
    renderPanel(); rerank();
  } else if (key === 'plan') {
    state.listTab = 'inventory'; renderPanel(); openPlanner('plan');
  } else if (key === 'compare') {
    state.listTab = 'sites'; renderPanel(); fitSites();
    if (!state.sites.length) setModeHint('روی هر نقطه از بزرگراه یا پل کلیک کنید تا تحلیل شود');
  } else if (key === 'finder') {
    state.listTab = 'finder'; renderPanel();
  }
}

function openHelp() {
  const d = $('#dlgHelp');
  d.innerHTML = `<div class="dlg-head"><h2>روش محاسبه</h2><button class="icon-btn" data-close aria-label="بستن">${icon('close')}</button></div>
  <div class="dlg-body">
    <h3>1. تردد</h3>
    <p>با کلیک روی نقشه، نزدیک‌ترین معبر اصلی از OpenStreetMap پیدا می‌شود (نوع معبر، تعداد خط، سقف سرعت، یک‌طرفه بودن). تردد روزانه هر جهت = تعداد خط × ظرفیت روزانه هر خط برای آن نوع معبر در شرایط تهران. توزیع ساعتی با پروفایل ترافیک تهران انجام می‌شود و سقف ظرفیت ساعتی هر خط رعایت می‌شود (مازاد به ساعت بعد منتقل می‌شود).</p>
    <table class="mini"><tr><th>نوع معبر</th><th>خودرو/خط/روز</th><th>خط پیش‌فرض در هر جهت</th><th>سرعت آزاد</th></tr>
      ${Object.values(ROAD_CLASSES).slice(0, 5).map(c => `<tr><td>${c.fa}</td><td class="ltr">${num(c.laneDaily)}</td><td>${c.lanes}</td><td><bdi dir="ltr">${c.freeFlow} km/h</bdi></td></tr>`).join('')}</table>
    <h3>2. سرعت و زمان مواجهه</h3>
    <p>سرعت هر ساعت = سرعت آزاد × ضریب ترافیک آن ساعت. ضریب از الگوی 24 ساعته نشان (در صورت وجود کلید) یا پروفایل پیش‌فرض تهران می‌آید و با «سرعت معمول» مسیر در نشان کالیبره می‌شود.</p>
    <div class="formula">پنجره دید (متر) = کمترینِ «فاصله خوانایی» و «طول دید مستقیم جاده» − نقطه‌ای که تابلو از دید راحت خارج می‌شود<br>زمان مواجهه (ثانیه) = پنجره دید ÷ سرعت — مثلاً 220 متر با سرعت <bdi dir="ltr">80 km/h</bdi> ≈ 10 ثانیه؛ در ترافیک <bdi dir="ltr">20 km/h</bdi> ≈ 40 ثانیه.</div>
    <ul>
      <li><b>فاصله خوانایی</b> از ارتفاع تابلو می‌آید: هر متر ارتفاع حدود ${VIS.legiblePerMetre} متر (تیتر حدود 15٪ ارتفاع تابلوست).</li>
      <li><b>عرض سواره‌رو</b> = تعداد خط × ${VIS.laneWidth} متر + شانه (یا تگ width در OSM). هر خط جدا حساب می‌شود؛ خط دورتر از تابلوی کنار جاده، زاویه بیشتری دارد و زودتر تابلو را از دست می‌دهد (مخروط ${VIS.coneDeg} درجه).</li>
      <li><b>دید مستقیم</b>: مسیر از محل تابلو به عقب دنبال می‌شود تا جایی که پیچ جاده آن را از خط دید بیرون ببرد (حداکثر ${VIS.sightMax} متر).</li>
      <li><b>شلوغی بصری</b>: هر تابلوی دیگر در شعاع ${VIS.clutterRadius} متری ${Math.round(VIS.clutterPenalty * 100)}٪ از احتمال توجه کم می‌کند (حداکثر 30٪).</li>
    </ul>
    <h3>3. ایمپرشن</h3>
    <div class="formula">افراد در معرض دید = تردد × میانگین سرنشین<br>ایمپرشن = افراد در معرض دید × احتمال توجه سازه × ضریب زمان مواجهه × سهم نمایش<br>ضریب زمان مواجهه = <bdi dir="ltr">1 − e<sup>−t/6</sup></bdi> (t = زمان مواجهه به ثانیه)</div>
    <p>«احتمال توجه» به نوع و زاویه سازه بستگی دارد (عرشه پل روبه‌رو بالاترین) و «ضریب زمان مواجهه» نشان می‌دهد مواجهه کوتاه‌تر احتمال دیده شدن را کم می‌کند. این همان منطق Visibility-Adjusted Contact در استانداردهای اندازه‌گیری تبلیغات محیطی است.</p>
    <table class="mini"><tr><th>نوع سازه</th><th>ابعاد پیش‌فرض (متر)</th><th>فاصله خوانایی</th><th>محل نصب</th><th>احتمال توجه</th></tr>
      ${Object.values(FORMATS).map(f => `<tr><td>${f.fa}</td><td class="ltr">${f.w}×${f.h}</td><td>${legibleFor(f)} متر</td><td>${f.mount === 'overhead' ? 'بالای سواره‌رو' : `کنار جاده، ${f.setback} متر از لبه`}</td><td>${Math.round(f.notice * 100)}٪</td></tr>`).join('')}</table>
    <h3>4. هفته، ماه و امتیاز</h3>
    <p>ضریب روزهای هفته: ${WEEK.map(w => `${w.fa} ${w.f}`).join('، ')}. ماهانه = هفتگی × 30/7. امتیاز 0 تا 100 = 70٪ حجم ایمپرشن روزانه (مقیاس لگاریتمی) + 30٪ زمان مواجهه.</p>
    <h3>5. رتبه‌بندی سازه‌ها و جایگاه‌یابی</h3>
    <p>سازه‌های موجود (فهرست واردشده، ثبت دستی، و پل‌های عابر و تابلوهای OpenStreetMap) به نزدیک‌ترین معبر اصلی وصل و با همین مدل رتبه‌بندی می‌شوند. جایگاه‌یابی همه معابر محدوده نقشه را هر 120 متر می‌سنجد، نقاط نزدیک سازه‌های موجود را کنار می‌گذارد و بهترین‌ها را با حداقل 600 متر فاصله از هم پیشنهاد می‌دهد. این دو بخش سهمیه API مصرف نمی‌کنند؛ «تحلیل کامل» داده زنده را اضافه می‌کند.</p>
    <h3>6. هات‌اسپات‌ها</h3>
    <p>هات‌اسپات‌ها جاهایی‌اند که مردم جمع می‌شوند: مال و بازار، راسته خرید، بورس‌های تخصصی کالا (موبایل، طلا، لوستر، پوشاک و…)، قطب‌های رستوران و کافه، مراکز سرگرمی، ایستگاه‌های مترو و پایانه‌ها، و دانشگاه‌ها. نقاط از OpenStreetMap خوانده و تجمع‌های پرتراکم با جست‌وجوی چگالی پیدا می‌شوند.</p>
    <ul>
      <li><b>شکل و اندازه</b>: برای راسته‌ها، بورس‌ها، رستوران‌ها، مراکز اداری و درمانی، شکل از جایی کشیده می‌شود که مغازه‌ها و مراکز به هم نزدیک‌ترند. با دکمه «اندازه هات‌اسپات‌ها» تعیین می‌کنید شکل چند درصد آن‌ها را دربر بگیرد: هسته 50٪، متعادل 70٪ (پیش‌فرض)، گسترده 85٪ یا کامل 95٪. برای مال، مترو، هایپرمارکت، پارک، ورزشگاه و دانشگاه همین دکمه حریم اطراف را کوچک و بزرگ می‌کند. اگر تجمع تکه‌تکه باشد، هر تکه یک چندضلعی جدا می‌شود.</li>
      <li><b>پتانسیل</b> 0 تا 100 = وزن نوع مکان × (45٪ جایگاه اندازه در بین هم‌نوع‌ها + 55٪ اندازه نسبت به یک هات‌اسپات قوی) + امتیاز هم‌پوشانی با انواع دیگر. 75 به بالا «خیلی زیاد»، 55 به بالا «زیاد».</li>
      <li><b>خروجی مختصات</b>: هر هات‌اسپات را می‌توان به‌صورت چندضلعی (رئوس lat,lng؛ برای چند بخش، چند چندضلعی)، GeoJSON، WKT یا مرکز و شعاعِ دایره‌ای که کل محدوده را می‌پوشاند کپی کرد، یا همه هات‌اسپات‌های فیلترشده را CSV، GeoJSON و KML گرفت؛ برای جئوفنس تبلیغات موبایل و پلتفرم‌های نقشه. دکمه «پیامک لوکیشن» همان قالب پنل پیامک لوکیشن را می‌دهد: <code>[[lng,lat],…]</code> با نقطه اول تکرارشده در انتها؛ اگر محدوده چند بخش داشته باشد هر بخش در یک خط می‌آید. در پنجره هر سازه هم دکمه‌ای هست که دایره‌ای 300 متری دور آن سازه را با همین قالب کپی می‌کند.</li>
      <li><b>دسته‌ها</b>: مال و بازار، راسته خرید، 14 بورس تخصصی (موبایل، لوازم خانگی، پوشاک، طلا، آرایشی، کودک، ورزش، کتاب، ساز، خانه، ابزار، خودرو، دارو، حیوانات خانگی)، رستوران و کافه، سرگرمی، مترو و پایانه، دانشگاه، هایپرمارکت، مرکز اداری و تجاری، مراکز درمانی، پارک و ورزشگاه.</li>
      <li><b>دستیار کمپین</b>: بنویسید چه چیزی، با چه بودجه‌ای، چند ماه و کجا تبلیغ می‌کنید. انتخاب سازه‌ها همیشه با موتور خود سایت است: هر سازه بر اساس نزدیکی به هات‌اسپات‌های آن دسته کالا (داخل محدوده، تا 250 متر و مسیر رسیدن تا 900 متر، وزن‌دار با پتانسیل) و امتیاز ترافیکی‌اش رتبه می‌گیرد و تا سقف بودجه انتخاب می‌شود. متن پیشنهاد و ایده‌های طراحی را یک مدل رایگان می‌نویسد (با کلید رایگان OpenRouter، Gemini یا Groq، وگرنه Pollinations) و اگر هیچ مدلی در دسترس نباشد، موتور داخلی سایت متن را می‌نویسد.</li>
      <li><b>انتخاب و اشتراک</b>: با تیک کنار هر هات‌اسپات چند تا را انتخاب کنید، فقط همان‌ها را روی نقشه نگه دارید، مختصاتشان را یک‌جا کپی کنید یا لینکش را برای همکار بفرستید. دکمه‌های «برای تبلیغ چه چیزی؟» نوع‌های مناسب هر دسته کالا را یک‌جا انتخاب می‌کنند. پاپ‌آپ هر هات‌اسپات سازه‌های داخل محدوده و سازه‌های مسیر رسیدن (تا 900 متر) را با امتیاز و قیمت نشان می‌دهد؛ «اوج حضور» الگوی معمول هر نوع مکان است، نه داده اندازه‌گیری‌شده.</li>
      <li>کامل بودن داده به ثبت مغازه‌ها در OpenStreetMap بستگی دارد؛ بعضی راسته‌ها کمتر از واقع دیده می‌شوند.</li>
    </ul>
    <h3>7. شهرهای دیگر</h3>
    <p>کرج، اصفهان، مشهد، شیراز، کرمان، یزد، ساری و گرگان از منوی شهر (کنار نام سایت) باز می‌شوند. هر شهر فهرست سازه‌ها، قیمت‌ها، نقاط ذخیره‌شده، هات‌اسپات‌ها و گفتگوی دستیار جدای خودش را دارد و همه امکانات تهران روی آن کار می‌کند. حجم تردد شهرها با مدل تهران × یک ضریب برآوردی حساب می‌شود (کرج و اصفهان 0.75، مشهد 0.8، شیراز 0.7، کرمان و یزد 0.55، ساری و گرگان 0.5) و الگوی ساعتی با داده نشان هر شهر به‌مرور جایگزین می‌شود. منبع آگهی‌ها برای کرمان، ساری و گرگان سازه کمی داخل شهر دارد («داده محدود»). یزد و گرگان مرز مناطق شهرداری در OpenStreetMap ندارند. سازه‌هایی که آگهی‌شان مختصات ندارد از روی نشانی (میدان، محله، نشانه شهری یا تقاطع دو خیابان) روی نقشه می‌آیند و «مکان تقریبی» علامت می‌خورند. پتانسیل هات‌اسپات‌ها در هر شهر نسبت به خود همان شهر سنجیده می‌شود؛ عدد کم‌رنگ «+» کنار هر نوع یعنی چند مورد دیگر با پتانسیل کمتر پنهان است.</p>
    <h3>محدودیت‌ها</h3>
    <ul>
      <li>حجم تردد مدل‌سازی شده است؛ اگر آمار شمارش واقعی دارید، در «مشخصات معبر» وارد کنید تا جایگزین شود.</li>
      <li>مانع دید (درخت، ساختمان) دیده نمی‌شود و شلوغی بصری فقط از روی تعداد تابلوهای نزدیک تخمین زده می‌شود؛ پیش از قرارداد بازدید میدانی کنید.</li>
      <li>مکان بخشی از سازه‌های بازار تقریبی است (حاشیه خط‌چین)؛ ترافیک و ارزش خرید آن‌ها هم تقریبی است.</li>
      <li>قیمت‌ها قیمت اعلام‌شده در آگهی‌ها هستند و ممکن است قدیمی باشند؛ پیش از خرید استعلام بگیرید.</li>
      <li>همپوشانی مخاطب بین چند نقطه کسر نمی‌شود؛ مجموع ایمپرشن‌ها برابر ریچ یکتا نیست.</li>
    </ul>
  </div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  d.showModal();
}

// ════════════════════════════════════════════════════════════
//  chrome bindings & helpers
// ════════════════════════════════════════════════════════════
function bindChrome() {
  const body = $('#panelBody');
  body.addEventListener('click', onPanelClick);
  body.addEventListener('change', onPanelChange);
  body.addEventListener('input', onPanelInput);
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.card')) e.target.click();
    if (e.key === 'Enter' && e.target.matches('input.inp, input.d-name')) e.target.blur();
  });
  $('#sheet').addEventListener('click', onSheetClick);
  $('#sheet').addEventListener('change', onSheetChange);
  $('#dataChip')?.addEventListener('click', () => DEMO ? openWelcome() : openSettings());
  providers.onUsage(updateDataChip);

  $('#basemaps').innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<button class="bm bm-${k}" data-bm="${k}"><i></i>${b.fa}</button>`).join('');
  $('#basemaps').addEventListener('click', e => { const b = e.target.closest('.bm'); if (b) { setBasemap(b.dataset.bm); save(); } });
  $('#btnLayers').addEventListener('click', e => { e.stopPropagation(); const p = $('#layersPop'); p.hidden = !p.hidden; $('#btnLayers').classList.toggle('on', !p.hidden); $('#hotPop').hidden = true; $('#btnHot').classList.remove('on'); });
  $('#btnHot').addEventListener('click', e => { e.stopPropagation(); $('#layersPop').hidden = true; $('#btnLayers').classList.remove('on'); $('#btnHot').classList.toggle('on', !!hot?.toggle()); });
  document.addEventListener('click', e => { const b = e.target.closest('[data-act="hs-open"]'); if (b) { map.closePopup(); hot?.open(b.dataset.id); } });
  document.addEventListener('click', e => { if (!e.target.closest('.map-tools')) closePops(); });
  $('#lyrHighways').addEventListener('change', e => toggleHighways(e.target.checked));
  $('#lyrStructures').addEventListener('change', e => setStructuresLayer(e.target.checked));
  $('#lyrDistricts').addEventListener('change', e => setDistrictLayer(e.target.checked));
  if (!CITY.districts) $('#lyrDistricts').closest('.switch-row').hidden = true;
  $('#lyrUnlock').checked = !!state.settings.unlockMove;
  $('#lyrUnlock').addEventListener('change', e => { state.settings.unlockMove = e.target.checked; save(); unlockedIds.clear(); drawStructures(); toast(e.target.checked ? 'سازه‌ها آزادند؛ با کشیدن جابه‌جا می‌شوند' : 'سازه‌ها قفل شدند', 'ok'); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="geo-copy"]'); if (!b) return;
    copyText(smsText([circleRing(+b.dataset.lat, +b.dataset.lng, SMS_POINT_RADIUS)]), `مختصات پیامک لوکیشن کپی شد (دایره ${SMS_POINT_RADIUS} متری، [[lng,lat],…])`);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="unlock-move"]'); if (!b) return;
    const id = b.dataset.id;
    if (unlockedIds.has(id)) unlockedIds.delete(id); else unlockedIds.add(id);
    map.closePopup(); drawStructures();
    if (unlockedIds.has(id)) toast('این سازه آزاد شد؛ نشانگرش را بکشید و رها کنید', 'ok');
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="district-board"], [data-act="district-analyze"]');
    if (!b) return;
    map.closePopup();
    if (b.dataset.act === 'district-board') { state.board.districts = [+b.dataset.n]; openPlanner('board'); }
    else analyzeAt(+b.dataset.lat, +b.dataset.lng);
  });
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnGuide').addEventListener('click', openWelcome);

  // popups (structures, search result) → analyse
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="analyze-struct"]');
    if (!b) return;
    map.closePopup();
    const kind = b.dataset.kind;
    analyzeAt(+b.dataset.lat, +b.dataset.lng, { format: TYPE_TO_FORMAT[kind] || null, name: b.dataset.name || undefined, price: +b.dataset.price || null, facing: kind === 'bridge' ? 'both' : undefined });
  });

  // mobile bottom-sheet grip
  $('#panelGrip').addEventListener('click', () => {
    const p = $('#panel');
    setPanelSize(p.classList.contains('tall') ? 'mini' : p.classList.contains('mini') ? '' : 'tall');
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet').hidden) { $('#sheet').hidden = true; state.sheet = null; return; }
    if (state.selectedId && !document.querySelector('dialog[open]')) backToList();
  });
  bindSearch();
  initCitySwitcher();
}

// ── city switcher: each city is its own page (?city=slug); Tehran is the plain address ──
function initCitySwitcher() {
  const btn = $('#btnCity'), pop = $('#cityPop');
  btn.firstChild.textContent = CITY.fa;
  if (!IS_TEHRAN) document.title = document.title.replace('تهران', CITY.fa);
  if (DEMO) { btn.disabled = true; btn.querySelector('svg')?.remove(); return; }
  let manifest = null;
  const render = () => {
    pop.innerHTML = `<div class="pop-title">شهر</div>${CITY_SLUGS.map(slug => {
      const c = CITIES[slug], m = slug === 'tehran' ? { ready: true } : manifest?.cities?.[slug];
      const ready = !!m?.ready, cur = slug === CITY.slug;
      const sub = slug === 'tehran' ? '' : !manifest ? '…' : ready ? `${num(m.count || 0)} سازه${c.limited ? ' · داده محدود' : ''}` : 'در حال آماده‌سازی';
      return `<a class="city-row ${cur ? 'on' : ''} ${ready ? '' : 'off'}" ${ready && !cur ? `href="${cityUrl(slug)}"` : ''} aria-disabled="${!ready}"><b>${c.fa}</b><small>${sub}</small>${cur ? icon('check') : ''}</a>`;
    }).join('')}<div class="city-foot">هر شهر فهرست سازه‌ها، قیمت‌ها و نقاط ذخیره‌شده جدای خودش را دارد.</div>`;
  };
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    render();
    if (!manifest) { try { manifest = await (await fetch('data/cities.json', { cache: 'no-cache' })).json(); } catch { manifest = { cities: {} }; } render(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('#cityPop, #btnCity')) pop.hidden = true; });
}

function setPanelSize(cls) {
  const p = $('#panel');
  p.classList.remove('tall', 'mini');
  if (cls) p.classList.add(cls);
}
function closePops() { $('#layersPop').hidden = true; $('#btnLayers').classList.remove('on'); $('#hotPop').hidden = true; $('#btnHot').classList.remove('on'); }

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3600);
  setTimeout(() => el.remove(), 4000);
}

init();
