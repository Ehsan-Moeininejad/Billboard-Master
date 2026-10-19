// Exposure & impression model. Pure functions — no DOM, no network.
import { ROAD_CLASSES, FORMATS, HOURLY_SHARE, SPEED_RATIO, ATTENTION_TAU, WEEK, VIS } from './config.js';
import { compassFa, arrow, nearestOnLine, sightline } from './geo.js';
import { CITY, IS_TEHRAN } from './city.js';
// outside Tehran the same road carries less traffic; first estimate per city (1 in Tehran)
const CITY_VOLF = CITY.volF || 1;

const LANE_HOUR_CAP = { motorway: 1900, trunk: 1700, primary: 950, secondary: 800, tertiary: 650,
  motorway_link: 1500, trunk_link: 1300, primary_link: 800 };

export function tehranHour(d = new Date()) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(d), 10);
  } catch { return d.getHours(); }
}

/** Directions that can see the face, with lanes and bearing. */
export function directionsFor(site) {
  const r = site.road;
  const cls = ROAD_CLASSES[r.cls] || ROAD_CLASSES.secondary;
  const ov = site.overrides || {};
  const b = r.bearing ?? 0;
  let fwdLanes, bwdLanes;
  if (r.oneway) {
    fwdLanes = r.lanes?.total ?? cls.lanes;
    bwdLanes = r.twinLanes ?? fwdLanes; // opposite carriageway of a split road
  } else {
    const t = r.lanes?.total;
    fwdLanes = r.lanes?.fwd ?? (t ? Math.max(1, Math.ceil(t / 2)) : Math.max(1, cls.lanes - 1));
    bwdLanes = r.lanes?.bwd ?? (t ? Math.max(1, Math.floor(t / 2)) : Math.max(1, cls.lanes - 1));
  }
  if (ov.lanes) { fwdLanes = ov.lanes; bwdLanes = ov.lanes; }
  const fwd = { key: 'fwd', bearing: b, lanes: fwdLanes, label: `ترافیک به سمت ${compassFa(b)}`, arrow: arrow(b) };
  const bwd = { key: 'bwd', bearing: (b + 180) % 360, lanes: bwdLanes, label: `ترافیک به سمت ${compassFa(b + 180)}`, arrow: arrow(b + 180) };
  const all = [fwd, bwd];
  const facing = site.facing === 'both' ? all : all.filter(d => d.key === site.facing);
  return { all, facing };
}

// ── viewing geometry ───────────────────────────────────────
export function boardSpec(site) {
  const f = FORMATS[site.format] || FORMATS.bulletin;
  const b = site.board || {};
  return { w: b.w || f.w, h: b.h || f.h, mount: f.mount, setback: b.setback ?? f.setback };
}
export const legibleFor = spec => Math.max(VIS.minLegible, Math.min(VIS.maxLegible, Math.round(spec.h * VIS.legiblePerMetre)));

/** Carriageway width for one direction (m). Uses OSM `width` when tagged. */
export function carriagewayWidth(cls, lanes, widthTag, twoWay) {
  if (widthTag) return twoWay ? widthTag / 2 : widthTag;
  return lanes * VIS.laneWidth + (VIS.shoulder[cls] ?? 1);
}

function dirLine(site, key) {
  const r = site.road;
  if (!r?.line) return null;
  const p = [site.lat, site.lng];
  let line = r.line;
  if (key === 'bwd') line = r.oneway && r.twinLine ? r.twinLine : r.line.slice().reverse();
  return { line, snap: nearestOnLine(p, line) };
}

/**
 * How long each lane can actually read the face, in metres of approach.
 * window = min(legible distance, straight approach) − the point where the board leaves comfortable view.
 */
export function visibility(site, dirs) {
  const r = site.road;
  const spec = boardSpec(site);
  const ov = site.overrides || {};
  const legible = ov.visDist || legibleFor(spec);
  const twoWay = !r.oneway;
  const tan = d => Math.tan(d * Math.PI / 180);
  const all = dirs || directionsFor(site).facing;
  const widths = Object.fromEntries(directionsFor(site).all.map(d => [d.key, carriagewayWidth(r.cls, d.lanes, r.width, twoWay)]));
  const median = VIS.median[r.cls] ?? 0;
  return all.map((d, k) => {
    const roadW = widths[d.key];
    const dl = dirLine(site, d.key);
    const sight = dl ? sightline(dl.line, dl.snap, VIS.sightMax, roadW / 2 + 10) : VIS.sightMax;
    const lanes = [];
    for (let i = 0; i < d.lanes; i++) {
      let lateral, cutoff;
      if (spec.mount === 'overhead') {
        lateral = 0;
        cutoff = VIS.overheadElev / tan(VIS.overheadCutDeg);
      } else {
        // the face stands on the right of the main facing direction; the opposite flow sees it across the road
        const near = k === 0 || site.facing !== 'both';
        const shoulder = VIS.shoulder[r.cls] ?? 1;
        lateral = near
          ? spec.setback + shoulder + (i + 0.5) * VIS.laneWidth
          : spec.setback + widths[all[0].key] + median + (i + 0.5) * VIS.laneWidth;
        cutoff = lateral / tan(VIS.coneDeg);
      }
      const reach = Math.sqrt(Math.max(0, legible * legible - lateral * lateral));
      const start = Math.min(reach, sight);
      lanes.push({ lateral, cutoff, start, window: Math.max(15, start - cutoff) });
    }
    const window = lanes.reduce((a, l) => a + l.window, 0) / lanes.length;
    return { key: d.key, label: d.label, arrow: d.arrow, lanes, roadW, sight, legible, window, mount: spec.mount, spec,
      limitedBy: sight < legible - 10 ? 'sight' : 'legibility' };
  });
}

function dayAdjust(dayType, share, ratio) {
  if (dayType === 'weekday') return { volF: 1, share, ratio };
  if (dayType === 'thursday') {
    return { volF: 0.86, share, ratio: ratio.map(r => 1 - (1 - r) * 0.7) };
  }
  // friday: late, flat profile; light congestion
  const s = share.map((v, h) => v * (h >= 6 && h <= 9 ? 0.45 : h >= 10 && h <= 23 ? 1.12 : 1));
  const sum = s.reduce((a, b) => a + b, 0);
  return { volF: 0.62, share: s.map(v => v / sum), ratio: ratio.map(r => 1 - (1 - r) * 0.35) };
}

/**
 * Main estimate for one site.
 * @param site      site object (see store.js)
 * @param settings  {occupancy}
 * @param dayType   weekday | thursday | friday
 */
export function estimate(site, settings, dayType = 'weekday') {
  const r = site.road;
  const cls = ROAD_CLASSES[r.cls] || ROAD_CLASSES.secondary;
  const fmt = FORMATS[site.format] || FORMATS.bulletin;
  const ov = site.overrides || {};
  const occupancy = settings.occupancy || 1.5;
  const notice = (ov.notice || fmt.notice) * Math.max(1 - VIS.clutterPenalty * 4.3, 1 - VIS.clutterPenalty * (site.clutter || 0));
  const loopShare = site.format === 'digital' ? (site.loopShare ?? 1) : 1;
  const freeFlow = ov.freeFlow || r.maxspeed || cls.freeFlow;

  // hourly speed ratio: Neshan pattern if present, else Tehran default
  let ratio = site.live?.traffic?.ratio ? site.live.traffic.ratio.slice() : SPEED_RATIO.slice();
  if (cls.rank <= 2) ratio = ratio.map(x => 1 - (1 - x) * 0.8); // minor roads: congestion matters less
  // demand profile: tilt toward congested hours if Neshan says so
  let share = HOURLY_SHARE.slice();
  if (site.live?.traffic?.congestion) {
    const c = site.live.traffic.congestion, m = c.reduce((a, b) => a + b, 0) / 24 || 1;
    share = share.map((v, h) => v * (0.8 + 0.4 * (c[h] / m)));
    const s = share.reduce((a, b) => a + b, 0); share = share.map(v => v / s);
  }
  // calibrate the whole speed curve with Neshan's measured typical speed (if any)
  let calib = 1;
  const sp = site.live?.speed;
  if (sp?.kmh) {
    const modelled = freeFlow * ratio[sp.hour];
    const raw = Math.max(0.6, Math.min(1.5, sp.kmh / modelled));
    // a traffic-aware source (Neshan typical) counts fully; a plain route time (Map.ir) counts half
    calib = sp.trafficAware === false ? 1 + (raw - 1) * 0.5 : raw;
  }

  const adj = dayAdjust(dayType, share, ratio);
  const { facing } = directionsFor(site);
  const geo = visibility(site, facing);

  const hourly = Array.from({ length: 24 }, (_, h) => ({ h, vehicles: 0, ots: 0, impressions: 0, speed: 0, exposure: 0 }));
  const dirs = facing.map((d, k) => {
    const win = geo[k].window;
    const daily = (ov.dailyVolume ? ov.dailyVolume / facing.length : d.lanes * cls.laneDaily * CITY_VOLF) * adj.volF;
    const cap = d.lanes * (LANE_HOUR_CAP[r.cls] || 900);
    // demand per hour, capped by capacity with spill-over into the following hours
    const vol = new Array(24).fill(0);
    let carry = 0;
    for (let k = 0; k < 48; k++) {
      const h = k % 24;
      const want = (k < 24 ? daily * adj.share[h] : 0) + carry;
      const take = Math.min(want, cap - vol[h]);
      vol[h] += take; carry = want - take;
    }
    let tot = 0;
    for (let h = 0; h < 24; h++) {
      const speed = Math.max(5, Math.min(freeFlow * 1.05, freeFlow * adj.ratio[h] * calib));
      const exposure = Math.min(60, win / (speed / 3.6));
      const attention = 1 - Math.exp(-exposure / ATTENTION_TAU);
      const ots = vol[h] * occupancy;
      const imp = ots * notice * attention * loopShare;
      const H = hourly[h];
      H.speed = (H.speed * H.vehicles + speed * vol[h]) / ((H.vehicles + vol[h]) || 1);
      H.exposure = (H.exposure * H.vehicles + exposure * vol[h]) / ((H.vehicles + vol[h]) || 1);
      H.vehicles += vol[h]; H.ots += ots; H.impressions += imp;
      tot += vol[h];
    }
    return { ...d, dailyVehicles: tot };
  });

  const sum = k => hourly.reduce((s, x) => s + x[k], 0);
  const vehicles = sum('vehicles');
  const avgSpeed = hourly.reduce((s, x) => s + x.speed * x.vehicles, 0) / (vehicles || 1);
  const avgExposure = hourly.reduce((s, x) => s + x.exposure * x.vehicles, 0) / (vehicles || 1);
  const peak = hourly.slice().sort((a, b) => b.impressions - a.impressions).slice(0, 3).map(x => x.h).sort((a, b) => a - b);

  return {
    dayType, dirs, hourly, freeFlow, visDist: geo[0]?.legible, geo, notice, loopShare, calib,
    daily: { vehicles, ots: sum('ots'), impressions: sum('impressions'), avgSpeed, avgExposure, peak },
  };
}

/** Score 0–100: reach (log scale) 70% + dwell 30%. */
export function scoreFrom(daily) {
  const clamp = v => Math.max(0, Math.min(1, v));
  const sReach = clamp((Math.log10(Math.max(1, daily.impressions)) - 3.3) / (5.4 - 3.3));
  const sDwell = clamp((daily.avgExposure - 3) / 14);
  return Math.round(100 * (0.7 * sReach + 0.3 * sDwell));
}

/** Full summary: weekday detail + weekly/monthly totals, CPM and score. */
export function summarize(site, settings) {
  const wk = estimate(site, settings, 'weekday');
  const th = estimate(site, settings, 'thursday');
  const fr = estimate(site, settings, 'friday');
  const days = WEEK.map(d => d.key === 'thu' ? th : d.key === 'fri' ? fr : wk);
  const weekly = days.reduce((s, e) => s + e.daily.impressions, 0);
  const weeklyOts = days.reduce((s, e) => s + e.daily.ots, 0);
  const monthly = weekly * 30 / 7;
  const monthlyOts = weeklyOts * 30 / 7;
  const cpm = site.price ? site.price / (monthly / 1000) : null;
  const campaignWeeks = settings.campaignWeeks || 4;

  const score = scoreFrom(wk.daily);

  let confidence = 1; const sources = [IS_TEHRAN ? 'مدل ترافیک تهران' : `مدل ترافیک تهران × ضریب برآوردی ${CITY.fa} (${CITY_VOLF})`, 'OpenStreetMap'];
  if (site.road.lanes?.total || site.road.lanes?.fwd) confidence++;
  if (site.live?.traffic) { confidence++; sources.push('الگوی ترافیک نشان'); }
  if (site.live?.speed) { confidence++; sources.push(site.live.speed.provider === 'mapir' ? 'سرعت مسیر Map.ir' : 'سرعت معمول نشان'); }
  if (site.overrides?.dailyVolume) { confidence = 4; sources.push('حجم تردد واردشده'); }

  const grid = days.map(e => e.hourly.map(h => h.impressions)); // 7 × 24, Saturday first
  return {
    wk, th, fr, grid, weekly, weeklyOts, monthly, monthlyOts, cpm, score,
    campaign: { weeks: campaignWeeks, impressions: weekly * campaignWeeks, ots: weeklyOts * campaignWeeks,
      cost: site.price ? site.price * campaignWeeks * 7 / 30 : null },
    confidence: Math.min(4, confidence), sources,
  };
}

export const CONFIDENCE_FA = ['', 'تخمین اولیه', 'تخمین متوسط', 'تخمین خوب', 'دقت بالا'];
