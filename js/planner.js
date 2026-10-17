// Campaign planner: pick the structures that make the most of a budget.
import { summarize } from './model.js';
import { monthlyPrice, ruleFor, billableWeeks, costFor } from './pricing.js';

/** Weekly figures for one structure (or one of «my sites»). */
export function evalSite(site, settings) {
  const s = summarize(site, settings);
  const sec = (e, days) => e.daily.impressions * e.daily.avgExposure * days;
  return {
    weeklyImp: s.weekly, weeklyOts: s.weeklyOts, score: s.score,
    weeklyExpSec: sec(s.wk, 5) + sec(s.th, 1) + sec(s.fr, 1),
    dailyImp: s.wk.daily.impressions, exp: s.wk.daily.avgExposure,
  };
}

export const OBJECTIVES = {
  impressions: { fa: 'بیشترین ایمپرشن', hint: 'بیشترین تعداد دیده‌شدن با این بودجه', unit: 'ایمپرشن' },
  exposure: { fa: 'بیشترین زمان مواجهه', hint: 'مجموع ثانیه‌هایی که مخاطبان تابلو را می‌بینند — برای پیام‌های طولانی‌تر و برندینگ', unit: 'نفر-ساعت' },
  spread: { fa: 'پوشش گسترده', hint: 'ایمپرشن، ولی هر سازه اضافه روی همان مسیر و جهت نصف ارزش دارد — پخش در شهر', unit: 'ایمپرشن مؤثر' },
};

/**
 * Turn evaluated structures + pricing rules into buyable options.
 * entries: [{ id, name, owner, type, roadKey, ev }]
 */
export function buildOptions(entries, pricing, plan) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const inBundleOnly = new Set();
  const opts = [], skipped = [];
  for (const b of pricing.bundles) {
    const members = b.ids.map(id => byId.get(id)).filter(Boolean);
    if (!members.length) continue;
    const r = ruleFor(pricing, b.owner || '');
    if (b.only) b.ids.forEach(id => inBundleOnly.add(id));
    if (r.bundleOnly) members.forEach(m => inBundleOnly.add(m.id));
    const monthly = b.price * (1 + (pricing.scenario.adj || 0)) * (1 - (r.discount || 0));
    opts.push(makeOption({ kind: 'bundle', id: `b:${b.id}`, name: b.name, owner: b.owner, members, monthly, minWeeks: Math.max(b.minWeeks || 0, r.minWeeks || 0) }, plan, pricing, skipped));
  }
  for (const e of entries) {
    const r = ruleFor(pricing, e.owner || '');
    if (inBundleOnly.has(e.id) || (r.bundleOnly && e.owner)) { if (r.bundleOnly && !pricing.bundles.some(b => b.ids.includes(e.id))) skipped.push({ name: e.name, why: 'مجری فقط باندل می‌فروشد و باندلی برای این سازه تعریف نشده' }); continue; }
    const monthly = monthlyPrice(e, pricing);
    if (!monthly) continue;
    opts.push(makeOption({ kind: 'single', id: e.id, name: e.name, owner: e.owner, members: [e], monthly, minWeeks: r.minWeeks || 0 }, plan, pricing, skipped));
  }
  return { options: opts.filter(Boolean), skipped };
}

function makeOption(o, plan, pricing, skipped) {
  if (o.minWeeks > plan.weeks && !pricing.scenario.allowLonger) {
    skipped.push({ name: o.name, why: `حداقل مدت ${o.minWeeks} هفته است` });
    return null;
  }
  const weeks = billableWeeks(plan.weeks, o.minWeeks);
  // calendar: weekdays and Persian months the campaign covers (see calendar.js); 1 when not set
  const cf = plan.cal?.impF ?? 1, pf = plan.cal?.priceF ?? 1;
  const cost = costFor(o.monthly, weeks) * pf;
  const imp = o.members.reduce((a, m) => a + m.ev.weeklyImp, 0) * plan.weeks * cf;
  const expH = o.members.reduce((a, m) => a + m.ev.weeklyExpSec, 0) * plan.weeks * cf / 3600;
  // value-weighted versions (manual value coefficient per structure) drive the optimisation
  const vImp = o.members.reduce((a, m) => a + m.ev.weeklyImp * (m.coef || 1), 0) * plan.weeks * cf;
  const vExpH = o.members.reduce((a, m) => a + m.ev.weeklyExpSec * (m.coef || 1), 0) * plan.weeks * cf / 3600;
  const ots = o.members.reduce((a, m) => a + m.ev.weeklyOts, 0) * plan.weeks * cf;
  return { ...o, ids: o.members.map(m => m.id), weeks, cost, imp, expH, vImp, vExpH, ots, roads: o.members.map(m => m.roadKey) };
}

function totals(sel) {
  const cost = sel.reduce((a, o) => a + o.cost, 0), imp = sel.reduce((a, o) => a + o.imp, 0);
  return {
    cost, imp, expH: sel.reduce((a, o) => a + o.expH, 0), ots: sel.reduce((a, o) => a + o.ots, 0),
    count: sel.reduce((a, o) => a + o.ids.length, 0), roads: new Set(sel.flatMap(o => o.roads)).size,
    cpm: imp ? cost / (imp / 1000) : null,
  };
}

function objectiveValue(sel, objective) {
  if (objective === 'exposure') return sel.reduce((a, o) => a + o.vExpH, 0);
  if (objective === 'impressions') return sel.reduce((a, o) => a + o.vImp, 0);
  // spread: diminishing returns on the same road + direction
  const seen = new Map(); let v = 0;
  for (const o of sel) o.members.forEach(m => {
    const k = m.roadKey, n = seen.get(k) || 0;
    v += (o.vImp / o.members.length) * Math.pow(0.5, n); seen.set(k, n + 1);
  });
  return v;
}

/**
 * Greedy selection by marginal value (per toman and absolute, two seeds), then improvement passes:
 * drop-one-and-refill, and swap one selected option for one of the best-ratio unselected ones.
 * Constraints: budget, no structure bought twice, max structures per road, locks and exclusions.
 * State is kept incrementally so a market of several hundred structures stays interactive.
 */
export function optimize(options, budget, objective, { perRoad = 0, locks = {}, excludes = {} } = {}, { quick = false } = {}) {
  const pool = options.filter(o => !o.ids.some(id => excludes[id]) && !excludes[o.id]);
  const locked = pool.filter(o => locks[o.id]);
  const lin = objective === 'exposure' ? o => o.vExpH : o => o.vImp;
  const gain = (st, o) => {
    if (objective !== 'spread') return lin(o);
    let g = 0; const tmp = new Map();
    for (const m of o.members) {
      const t = tmp.get(m.roadKey) || 0, n = (st.seen.get(m.roadKey) || 0) + t;
      g += o.vImp / o.members.length * Math.pow(0.5, n); tmp.set(m.roadKey, t + 1);
    }
    return g;
  };
  const add = (st, o) => {
    st.val += gain(st, o); st.sel.push(o); st.has.add(o); st.spent += o.cost;
    o.ids.forEach(id => st.ids.add(id));
    o.roads.forEach(r => st.roads.set(r, (st.roads.get(r) || 0) + 1));
    o.members.forEach(m => st.seen.set(m.roadKey, (st.seen.get(m.roadKey) || 0) + 1));
  };
  const mk = sel => { const st = { sel: [], has: new Set(), ids: new Set(), roads: new Map(), seen: new Map(), spent: 0, val: 0 }; sel.forEach(o => add(st, o)); return st; };
  const roadOk = (st, o) => {
    if (!perRoad) return true;
    const c = new Map(); o.roads.forEach(r => c.set(r, (c.get(r) || 0) + 1));
    for (const [r, n] of c) if ((st.roads.get(r) || 0) + n > perRoad) return false;
    return true;
  };
  const fits = (st, o) => !st.has.has(o) && o.cost <= budget - st.spent + 1e-6 && !o.ids.some(id => st.ids.has(id)) && roadOk(st, o);
  const fill = (start, byRatio) => {
    const st = mk(start);
    for (;;) {
      let best = null, bestScore = 0;
      for (const o of pool) {
        if (!fits(st, o)) continue;
        const g = gain(st, o), sc = byRatio ? g / o.cost : g;
        if (g > 0 && sc > bestScore) { best = o; bestScore = sc; }
      }
      if (!best) return st;
      add(st, best);
    }
  };
  let best = [fill(locked, true), fill(locked, false)].sort((a, b) => b.val - a.val)[0];
  if (!quick) {
    const byRatio = pool.slice().sort((a, b) => lin(b) / b.cost - lin(a) / a.cost);
    for (let round = 0; round < 3; round++) {
      let improved = false;
      for (const o of best.sel.filter(x => !locks[x.id])) {
        const trial = fill(best.sel.filter(x => x !== o), true);
        if (trial.val > best.val + 1e-6) { best = trial; improved = true; }
      }
      for (const out of best.sel.filter(x => !locks[x.id])) {
        const rest = mk(best.sel.filter(x => x !== out));
        let tried = 0;
        for (const inn of byRatio) {
          if (inn === out || best.has.has(inn) || !fits(rest, inn)) continue;
          const trial = fill([...rest.sel, inn], true);
          if (trial.val > best.val + 1e-6) { best = trial; improved = true; break; }
          if (++tried >= 15) break;
        }
      }
      if (!improved) break;
    }
  }
  const sel = best.sel;
  const lockedCost = locked.reduce((a, o) => a + o.cost, 0);
  const next = pool.filter(o => !best.has.has(o) && !o.ids.some(id => best.ids.has(id)))
    .map(o => ({ o, ratio: o.imp / o.cost })).sort((a, b) => b.ratio - a.ratio).slice(0, 3).map(x => x.o);
  return { selected: sel, total: totals(sel), value: best.val, over: lockedCost > budget, next };
}

/** Results at several budget levels (diminishing returns curve). */
export function budgetCurve(options, budget, objective, cons) {
  return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(f => {
    const r = optimize(options, budget * f, objective, cons, { quick: f !== 1 });
    return { f, budget: budget * f, imp: r.total.imp, expH: r.total.expH, cost: r.total.cost, count: r.total.count };
  });
}
