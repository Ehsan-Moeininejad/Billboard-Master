// Campaign assistant: a chat where the marketer describes the campaign («گوشی موبایل، 2 میلیارد، 1 ماه، منطقه 3 و 6»).
// The site's own engine (campaign.js) always picks the hotspots and billboards, so every answer rests on real
// structures and prices. A free language model then writes the strategy, timing and creative ideas around them.
// Models are tried in order — the viewer's own free keys (OpenRouter, Gemini, Groq) first, then keyless
// Pollinations — and if none answers, a built-in writer produces the text, so a reply always comes back.
import { PRESETS } from './hotlayer.js';
import { parseBrief, planCampaign, fmtToman } from './campaign.js';
import { TYPE_BY_KEY, BOURSE } from './hotspots.js';

const KEY_STORE = 'billboard-insight:ai-keys:v1';
const CHAT_STORE = 'billboard-insight:ai-chat:v1';
const MODELS_STORE = 'billboard-insight:ai-or-models:v1';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// short creative starters per category (the model writes better ones when it answers)
const IDEAS = {
  digital: ['«جدیدترین گوشی‌ها، همین امروز در دیجی‌کالا»', '«ارتقا بده؛ اقساطی و با ارسال سریع»'],
  appliance: ['«خانه‌ات را به‌روز کن؛ لوازم خانگی با گارانتی اصلی»', '«خرید اقساطی لوازم خانگی، تحویل درب منزل»'],
  home: ['«هر چه خانه لازم دارد، یک‌جا»', '«آشپزخانه‌ات را تازه کن»'],
  fashion: ['«استایل این فصل، با تخفیف»', '«برندهای محبوب، ارسال رایگان»'],
  beauty: ['«مراقبت روزانه‌ات را کامل کن»', '«عطر و آرایشی اصل، با ضمانت اصالت»'],
  fmcg: ['«خرید هفتگی، بدون صف و ترافیک»', '«سبد خریدت تا در خانه»'],
  kids: ['«هر چه کوچولوها لازم دارند»', '«از سیسمونی تا اسباب‌بازی، یک‌جا»'],
  sport: ['«آماده سفر بعدی‌ات باش»', '«تجهیزات ورزشی، با تخفیف ویژه»'],
  books: ['«بازگشایی مدارس، همه لوازم یک‌جا»', '«کتاب بعدی‌ات اینجاست»'],
  tools: ['«ابزار حرفه‌ای، قیمت منصفانه»', '«هر ابزاری که کارگاهت لازم دارد»'],
  auto: ['«لوازم و قطعات اصلی خودرو، با ارسال سریع»', '«مراقبت از ماشینت را جدی بگیر»'],
  pet: ['«هر چه دوست کوچکت لازم دارد»', '«غذا و لوازم حیوانات خانگی، تحویل سریع»'],
  youth: ['«سبک تو، قیمت دانشجویی»', '«هر چیزی، هر وقت، با یک کلیک»'],
  b2b: ['«خرید سازمانی ساده، با فاکتور رسمی»', '«تجهیز دفتر کار، یک‌جا و سریع»'],
  reach: ['«هر چیزی که بخواهی، دیجی‌کالا»', '«خرید آنلاین، تحویل سریع در سراسر تهران»'],
};
const SUGGEST = [
  'کمپین گوشی موبایل با بودجه 2 میلیارد برای 1 ماه در منطقه 3 و 6',
  'برای محصولات مادر و کودک کجا بیلبورد بزنیم؟',
  'لوازم خانگی، 10 بیلبورد، یک ماه',
  'کمپین آرایشی و بهداشتی نزدیک مال‌ها با بودجه 800 میلیون',
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// minimal, safe markdown: **bold**, lists, line breaks
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(block => {
  const lines = block.split('\n');
  if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) return `<ul>${lines.map(l => `<li>${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}</li>`).join('')}</ul>`;
  return `<p>${lines.map(l => l.replace(/^#+\s*/, '')).join('<br>')}</p>`;
}).join('');
const latin = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

// ── language models ─────────────────────────────────────────
async function post(url, body, headers = {}, ms = 35000) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const openaiText = j => { const t = j?.choices?.[0]?.message?.content; if (!t || !t.trim()) throw new Error('empty'); return t; };

async function openrouterFree(key) {
  const c = store.get(MODELS_STORE);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.ids;
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
  const all = (await r.json()).data || [];
  const pref = [/deepseek/i, /qwen/i, /llama-(3\.3|4)/i, /gpt-oss/i, /gemma/i, /mistral/i];
  const ids = all.filter(m => m.id.endsWith(':free') && (m.context_length || 0) >= 8000)
    .map(m => ({ id: m.id, rank: pref.findIndex(p => p.test(m.id)) }))
    .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank)).slice(0, 5).map(m => m.id);
  store.set(MODELS_STORE, { at: Date.now(), ids });
  return ids;
}

function providers(keys) {
  const list = [];
  if (keys.openrouter) list.push({ name: 'OpenRouter', run: async (sys, user) => {
    let last;
    for (const id of await openrouterFree(keys.openrouter)) {
      try { return { text: openaiText(await post('https://openrouter.ai/api/v1/chat/completions', { model: id, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.5, max_tokens: 1100 }, { Authorization: `Bearer ${keys.openrouter}`, 'X-Title': 'Billboard-Master' })), model: id.replace(/:free$/, '') }; } catch (e) { last = e; }
    }
    throw last || new Error('no free model');
  } });
  if (keys.gemini) list.push({ name: 'Gemini', run: async (sys, user) => {
    let last;
    for (const m of ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']) {
      try {
        const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(keys.gemini)}`, { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 1100 } });
        const t = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join(''); if (t?.trim()) return { text: t, model: m };
      } catch (e) { last = e; }
    }
    throw last || new Error('gemini');
  } });
  if (keys.groq) list.push({ name: 'Groq', run: async (sys, user) => {
    let last;
    for (const m of ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant']) {
      try { return { text: openaiText(await post('https://api.groq.com/openai/v1/chat/completions', { model: m, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.5, max_tokens: 1100 }, { Authorization: `Bearer ${keys.groq}` })), model: m }; } catch (e) { last = e; }
    }
    throw last || new Error('groq');
  } });
  // keyless: Pollinations (shared free tier, about one reply per 30 s per network)
  list.push({ name: 'Pollinations', run: async (sys, user) => {
    try { return { text: openaiText(await post('https://text.pollinations.ai/openai', { model: 'openai', messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })), model: 'openai' }; } catch { /* try the plain endpoint */ }
    const u = `https://text.pollinations.ai/${encodeURIComponent(user.slice(0, 2600))}?model=openai&system=${encodeURIComponent(sys.slice(0, 1500))}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text(); if (!t.trim() || /^\s*\{"status"/.test(t)) throw new Error('empty');
    return { text: t, model: 'openai' };
  } });
  return list;
}

const SYSTEM = `تو مشاور رسانه و تبلیغات محیطی تیم مارکتینگ دیجی‌کالا در تهران هستی. فقط به فارسی و با اعداد لاتین (0-9) جواب بده، کوتاه و کاربردی (حداکثر 230 کلمه).
داده‌ای که در پیام کاربر به شکل JSON می‌آید از موتور خود سایت است: هات‌اسپات‌های مرتبط (محل تجمع مخاطب) و سازه‌های بیلبورد پیشنهادی با قیمت ماهانه. فقط از همین سازه‌ها و محل‌ها نام ببر؛ سازه یا قیمت از خودت نساز.
ساختار پاسخ: 1) **استراتژی** در 2-3 جمله؛ 2) **سازه‌های اولویت‌دار** (3 تا 5 مورد با دلیل کوتاه، با همان نام‌ها)؛ 3) **محل‌های هدف و زمان‌بندی**؛ 4) **ایده طراحی بیلبورد**: 2 تا 3 تیتر کوتاه (حداکثر 7 کلمه) و یک نکته طراحی متناسب با سرعت عبور. اگر سؤال ربطی به کمپین ندارد، کوتاه و بر اساس همین داده جواب بده.`;

// ── assistant UI ────────────────────────────────────────────
export function createAssistant(ctx) {
  // ctx: { $, icon, toast, copyText, hot, structures(), structInfo(st), districtOf(lat,lng), ensureScores(), focusStructure(id) }
  const { $, icon } = ctx;
  const el = $('#assistant');
  let keys = store.get(KEY_STORE) || {};
  let msgs = store.get(CHAT_STORE) || [];
  let busy = false, showKeys = false;
  const results = new Map(); // message index → engine result (rebuilt on open)

  function save() { store.set(CHAT_STORE, msgs.slice(-30)); }

  async function run(params) {
    const preset = PRESETS.find(p => p.k === params.preset) || PRESETS.find(p => p.k === 'reach');
    const hotspots = await ctx.hot.ready();
    await ctx.ensureScores().catch(() => {});
    return { preset, ...planCampaign({ preset, hotspots, structures: ctx.structures(), structInfo: ctx.structInfo, rings: ctx.hot.rings, districtOf: ctx.districtOf, districts: params.districts, budget: params.budget, months: params.months, count: params.count }) };
  }

  function contextJSON(params, R) {
    return JSON.stringify({
      category: R.preset.fa, districts: params.districts?.length ? params.districts : 'کل تهران', budget_toman: params.budget || null, months: R.months,
      planned_total_toman: R.spent || null,
      hotspots: R.spots.slice(0, 8).map(h => ({ name: h.title, type: TYPE_BY_KEY[h.t].fa + (h.t === 'bourse' ? ` (${BOURSE[h.sub]?.fa})` : ''), district: h.dist ? `منطقه ${h.dist}` : null, potential: h.score, peak: ctx.hot.peak(h.t) })),
      billboards: R.plan.slice(0, 10).map(b => ({ name: b.st.name, type: b.st.type, owner: b.st.owner || '', district: ctx.districtOf(b.st.lat, b.st.lng) ? `منطقه ${ctx.districtOf(b.st.lat, b.st.lng)}` : null, monthly_toman: b.price, traffic_score: b.score, category_fit: b.fitPct, near: b.why ? `${b.why.h.title} (${b.why.d} m)` : '' })),
    });
  }

  function localText(params, R) {
    const top = R.spots.slice(0, 3).map(h => h.title);
    const where = params.districts?.length ? ` در منطقه ${params.districts.join('، ')}` : '';
    const types = [...new Set(R.spots.slice(0, 6).map(h => h.t))];
    const lines = [
      `**استراتژی:** برای «${R.preset.fa}»${where}، ${R.spots.length} محل تجمع مرتبط پیدا شد${top.length ? `؛ قوی‌ترین‌ها: ${top.join('، ')}` : ''}. پیشنهاد روی سازه‌هایی است که داخل یا در مسیر رسیدن به این محل‌ها هستند و امتیاز ترافیکی بالاتری دارند.`,
      R.plan.length ? `**برنامه:** ${R.plan.length} سازه${R.spent ? `، حدود ${fmtToman(R.spent)} تومان برای ${R.months} ماه${params.budget ? ` از بودجه ${fmtToman(params.budget)}` : ''}` : ''}. فهرست کامل و دلیل هر انتخاب در کارت پایین است.` : '**برنامه:** سازه‌ای با قیمت مشخص که در این محدوده و بودجه جا شود پیدا نشد؛ بودجه یا منطقه را تغییر دهید.',
      `**زمان‌بندی:** ${types.slice(0, 3).map(t => `${TYPE_BY_KEY[t].short}: ${ctx.hot.peak(t)}`).join(' · ')}`,
      `**ایده طراحی:** ${(IDEAS[R.preset.k] || IDEAS.reach).join(' یا ')}. در مسیرهای سریع حداکثر 7 کلمه، لوگو بزرگ و تضاد رنگ بالا؛ کنار بورس‌ها و مال‌ها می‌شود پیشنهاد قیمت یا تخفیف مشخص گذاشت.`,
    ];
    if (!params.preset) lines.unshift('دسته کالا را از متن تشخیص ندادم؛ پیشنهاد بر اساس «بیشترین رفت‌وآمد» است. دسته را از کارت پایین عوض کنید.');
    return lines.join('\n\n');
  }

  async function answer(text, params) {
    const R = await run(params);
    let reply = null, via = 'موتور داخلی سایت';
    for (const p of providers(keys)) {
      try { const r = await p.run(SYSTEM, `درخواست: ${text}\n\nداده سایت (JSON):\n${contextJSON(params, R)}`); reply = latin(r.text).trim(); via = `${p.name} · ${r.model}`; break; } catch (e) { console.warn('assistant', p.name, e.message); }
    }
    return { reply: reply || localText(params, R), via, R };
  }

  async function send(text, forced = null) {
    text = (text || '').trim(); if (!text || busy) return;
    const params = forced || parseBrief(text);
    msgs.push({ role: 'user', text });
    busy = true; render(); scrollDown();
    try {
      const { reply, via, R } = await answer(text, params);
      msgs.push({ role: 'ai', text: reply, via, params: { ...params, preset: params.preset || R.preset.k } });
      results.set(msgs.length - 1, R);
    } catch (e) {
      console.error(e);
      msgs.push({ role: 'ai', text: 'داده سازه‌ها یا هات‌اسپات‌ها هنوز بارگذاری نشده؛ چند ثانیه دیگر دوباره بفرستید.', via: 'موتور داخلی سایت' });
    }
    busy = false; save(); render(); scrollToLast();
  }

  // ── rendering ─────────────────────────────────────────────
  function card(i, m) {
    const R = results.get(i);
    if (!m.params) return '';
    if (!R) return `<div class="as-card as-lazy" data-i="${i}"><button class="linkish" data-as="rerun" data-i="${i}">نمایش دوباره سازه‌ها و محل‌ها</button></div>`;
    const P = m.params;
    const shown = expanded.has(i) ? R.plan : R.plan.slice(0, 8);
    const rows = shown.map((b, k) => `<div class="as-row">
        <span class="as-n">${k + 1}</span>
        <button class="as-main" data-as="board" data-id="${esc(b.st.id)}"><b>${esc(b.st.name)}</b><small>${b.price ? fmtToman(b.price) + ' در ماه' : 'بدون قیمت'}${b.score != null ? ` · امتیاز ${b.score}` : ''} · تناسب ${b.fitPct}${b.why ? ` · ${b.why.d ? `${b.why.d} م تا` : 'داخل'} ${esc(b.why.h.title)}` : ''}</small></button>
        <button class="as-mini" title="تحلیل کامل" data-act="analyze-struct" data-lat="${b.st.lat}" data-lng="${b.st.lng}" data-kind="${esc(b.st.type || '')}" data-name="${esc(b.st.name)}" data-price="${b.st.price || ''}">${icon('target')}</button>
      </div>`).join('');
    return `<div class="as-card">
      <div class="as-params">
        <select data-as="preset" data-i="${i}">${PRESETS.map(p => `<option value="${p.k}" ${p.k === P.preset ? 'selected' : ''}>${p.fa}</option>`).join('')}</select>
        <label>بودجه <input data-as="budget" data-i="${i}" type="text" inputmode="numeric" value="${P.budget ? Math.round(P.budget / 1e6) : ''}" placeholder="—"> م</label>
        <label>ماه <input data-as="months" data-i="${i}" type="number" min="1" max="12" value="${P.months || 1}"></label>
        <label>مناطق <input data-as="districts" data-i="${i}" type="text" value="${(P.districts || []).join('، ')}" placeholder="همه"></label>
        <button class="as-redo" data-as="redo" data-i="${i}">${icon('refresh')} به‌روزرسانی</button>
      </div>
      <div class="as-sec">محل‌های هدف <b>${R.spots.length}</b></div>
      <div class="as-spots">${R.spots.slice(0, 8).map(h => `<button data-as="spot" data-i="${i}" data-id="${h.id}" style="--c:${TYPE_BY_KEY[h.t].color}"><i></i>${esc(h.title.length > 30 ? h.title.slice(0, 28) + '…' : h.title)}<small>${h.score}</small></button>`).join('') || '<span class="as-empty">محلی پیدا نشد</span>'}</div>
      <div class="as-sec">سازه‌های پیشنهادی <b>${R.plan.length}</b>${R.spent ? ` · ${fmtToman(R.spent)} تومان برای ${R.months} ماه` : ''}</div>
      <div class="as-rows">${rows || '<span class="as-empty">سازه‌ای پیدا نشد</span>'}</div>
      ${R.plan.length > 8 ? `<button class="linkish as-more" data-as="more" data-i="${i}">${expanded.has(i) ? 'نمایش کمتر' : `نمایش همه ${R.plan.length} سازه`}</button>` : ''}
      <div class="as-acts">
        <button data-as="show" data-i="${i}">${icon('flame')} محل‌ها روی نقشه</button>
        <button data-as="copy" data-i="${i}">${icon('copy')} کپی برنامه</button>
      </div>
    </div>`;
  }

  function render() {
    const list = msgs.map((m, i) => m.role === 'user'
      ? `<div class="as-msg me">${esc(m.text)}</div>`
      : `<div class="as-msg ai"><div class="as-txt">${md(m.text)}</div><div class="as-via">${esc(m.via || '')}</div>${card(i, m)}</div>`).join('');
    el.innerHTML = `
      <div class="as-head">
        <span class="as-title">${icon('spark')} دستیار کمپین</span>
        <button class="icon-btn" data-as="keys" title="مدل‌های هوش مصنوعی">${icon('settings')}</button>
        ${msgs.length ? `<button class="icon-btn" data-as="clear" title="گفتگوی تازه">${icon('trash')}</button>` : ''}
        <button class="icon-btn" data-as="close" aria-label="بستن">${icon('close')}</button>
      </div>
      ${showKeys ? keysHTML() : ''}
      <div class="as-body" id="asBody">
        ${msgs.length ? list : `<div class="as-intro"><p>بگویید چه چیزی را تبلیغ می‌کنید، با چه بودجه‌ای، چند ماه و کجای تهران. سازه‌ها و محل‌های تجمع مرتبط را پیشنهاد می‌دهم و برای طراحی بیلبورد هم ایده می‌دهم.</p>
          <div class="as-sugg">${SUGGEST.map(s => `<button data-as="sugg">${esc(s)}</button>`).join('')}</div></div>`}
        ${busy ? '<div class="as-msg ai as-wait"><span class="as-typing"><i></i><i></i><i></i></span><small>در حال پیدا کردن سازه‌ها و نوشتن پیشنهاد؛ تا حدود 30 ثانیه</small></div>' : ''}
      </div>
      <form class="as-input" data-as="form"><textarea rows="2" placeholder="مثلاً: کمپین گوشی موبایل، 2 میلیارد، 1 ماه، منطقه 3 و 6" ${busy ? 'disabled' : ''}></textarea><button class="btn btn-primary" ${busy ? 'disabled' : ''}>${icon('back')}</button></form>`;
    if (!busy) el.querySelector('textarea')?.focus({ preventScroll: true });
  }
  function keysHTML() {
    const f = (k, label, link) => `<label class="as-key"><span>${label} <a href="${link}" target="_blank" rel="noopener">ساخت کلید رایگان</a></span><input data-key="${k}" type="password" value="${esc(keys[k] || '')}" placeholder="اختیاری" autocomplete="off"></label>`;
    return `<div class="as-keys">
      <p>بدون کلید هم جواب می‌گیرید (مدل رایگان Pollinations و در صورت قطعی، موتور داخلی سایت). با کلید رایگان، مدل‌های قوی‌تر و بدون صف استفاده می‌شوند. کلیدها فقط در همین مرورگر ذخیره می‌شوند.</p>
      ${f('openrouter', 'OpenRouter', 'https://openrouter.ai/keys')}
      ${f('gemini', 'Google Gemini', 'https://aistudio.google.com/apikey')}
      ${f('groq', 'Groq', 'https://console.groq.com/keys')}
      <button class="btn btn-ghost btn-block" data-as="keys-save">ذخیره</button></div>`;
  }
  const scrollDown = () => { const b = $('#asBody'); if (b) b.scrollTop = b.scrollHeight; };
  // a new answer is read from its first line, not from the bottom of its card
  const scrollToLast = () => { const b = $('#asBody'), m = b?.querySelectorAll('.as-msg.ai'); const last = m?.[m.length - 1]; if (last) b.scrollTop = last.offsetTop - 8; };
  const expanded = new Set();

  function paramsFrom(i) {
    const q = s => el.querySelector(`[data-as="${s}"][data-i="${i}"]`);
    const b = parseFloat(latin(q('budget').value).replace(/,/g, ''));
    return {
      preset: q('preset').value, budget: b > 0 ? b * 1e6 : null, months: Math.max(1, +latin(q('months').value) || 1),
      districts: latin(q('districts').value).split(/[^\d]+/).map(Number).filter(n => n >= 1 && n <= 22), count: msgs[i].params?.count || null,
    };
  }

  el.addEventListener('submit', e => { e.preventDefault(); send(el.querySelector('textarea').value); });
  el.addEventListener('keydown', e => { if (e.target.matches('textarea') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-as]'); if (!b) return;
    const a = b.dataset.as, i = +b.dataset.i;
    if (a === 'close') close();
    else if (a === 'clear') { msgs = []; results.clear(); save(); render(); }
    else if (a === 'keys') { showKeys = !showKeys; render(); }
    else if (a === 'keys-save') { el.querySelectorAll('[data-key]').forEach(x => { keys[x.dataset.key] = x.value.trim(); }); store.set(KEY_STORE, keys); showKeys = false; ctx.toast('ذخیره شد', 'ok'); render(); }
    else if (a === 'sugg') send(b.textContent);
    else if (a === 'board') { ctx.focusStructure(b.dataset.id); if (matchMedia('(max-width: 860px)').matches) close(); }
    else if (a === 'spot') { const h = results.get(i)?.spots.find(x => x.id === b.dataset.id); if (h) { ctx.hot.focus(h); if (matchMedia('(max-width: 860px)').matches) close(); } }
    else if (a === 'show') { const R = results.get(i); if (R) { await ctx.hot.showOnly(R.spots.slice(0, 10)); ctx.toast(`${Math.min(10, R.spots.length)} محل هدف روی نقشه نمایش داده شد`, 'ok'); if (matchMedia('(max-width: 860px)').matches) close(); } }
    else if (a === 'copy') {
      const R = results.get(i); if (!R) return;
      const head = ['#', 'سازه', 'نوع', 'مجری', 'منطقه', 'قیمت ماهانه (تومان)', 'امتیاز', 'تناسب با دسته', 'نزدیک‌ترین محل هدف', 'فاصله (متر)', 'lat', 'lng'];
      const rows = R.plan.map((x, k) => [k + 1, x.st.name, x.st.type || '', x.st.owner || '', ctx.districtOf(x.st.lat, x.st.lng) ?? '', x.price || '', x.score ?? '', x.fitPct, x.why?.h.title || '', x.why?.d ?? '', x.st.lat, x.st.lng]);
      ctx.copyText([head, ...rows].map(r => r.join('\t')).join('\n'), 'برنامه کپی شد؛ در اکسل یا گوگل‌شیت Paste کنید');
    }
    else if (a === 'redo') { const p = paramsFrom(i); const label = PRESETS.find(x => x.k === p.preset)?.fa; await send(`${label}${p.budget ? `، بودجه ${fmtToman(p.budget)}` : ''}، ${p.months} ماه${p.districts.length ? `، منطقه ${p.districts.join('، ')}` : ''}`, p); }
    else if (a === 'more') { if (expanded.has(i)) expanded.delete(i); else expanded.add(i); const b0 = $('#asBody'), y = b0.scrollTop; render(); $('#asBody').scrollTop = y; }
    else if (a === 'rerun') { const m = msgs[i]; results.set(i, await run(m.params)); render(); }
  });

  function open(opts = {}) {
    el.hidden = false; document.body.classList.add('as-open');
    render(); scrollDown();
    // cards of a restored conversation are rebuilt from their saved parameters
    const last = msgs.map((m, i) => [m, i]).filter(([m]) => m.role === 'ai' && m.params).pop();
    if (last && !results.has(last[1]) && !opts.preset) run(last[0].params).then(R => { results.set(last[1], R); render(); scrollDown(); }).catch(() => {});
    if (opts.preset) { const p = PRESETS.find(x => x.k === opts.preset); if (p) send(`پیشنهاد کمپین برای ${p.fa}`, { preset: p.k, budget: null, months: 1, districts: [], count: null }); }
  }
  function close() { el.hidden = true; document.body.classList.remove('as-open'); }
  return { open, close, toggle() { if (el.hidden) open(); else close(); } };
}
