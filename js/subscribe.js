import { configured, sb, access, pageUrl, nextUrl, toman, num, faDate, daysLeft, esc, errFa, toast, KIND_FA } from './auth.js';
import { renderTop, ic } from './site-shell.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
let A = { signed_in: false }, plans = [], sel = params.get('plan') || 'quarterly', code = '', quote = null, settings = {};

const STATUS_FA = { pending: ['در انتظار پرداخت', 'warn'], paid: ['پرداخت‌شده', 'good'], failed: ['ناموفق', 'bad'], cancelled: ['لغوشده', ''] };

async function start() {
  if (!configured) {
    renderTop($('#top'), null, 'pricing');
    $('#plans').innerHTML = `<div class="alert warn" style="grid-column:1/-1">${ic('alert')}<span>اشتراک هنوز راه‌اندازی نشده (اتصال Supabase خالی است). سایت فعلاً رایگان و بدون ورود باز است.</span></div>`;
    renderStatic(); return;
  }
  try { A = await access(); } catch { A = { signed_in: false }; }
  renderTop($('#top'), A, 'pricing');
  hero();
  const [{ data: p, error }, { data: st }] = await Promise.all([
    sb.from('plans').select('*').eq('active', true).order('sort'),
    sb.from('settings').select('key,value'),
  ]);
  if (error) { $('#plans').innerHTML = `<div class="alert bad" style="grid-column:1/-1">${ic('alert')}<span>${esc(errFa(error))}</span></div>`; return; }
  plans = p || [];
  (st || []).forEach(r => { settings[r.key] = r.value; });
  if (!plans.some(x => x.id === sel)) sel = plans.find(x => x.badge)?.id || plans[0]?.id;
  renderPlans(); await requote(); renderStatic();
  if (A.signed_in) renderMine();
}

function hero() {
  const r = A.active ? '' : params.get('reason');
  if (r === 'expired') { $('#h1').textContent = 'اشتراک شما تمام شده'; $('#lead').textContent = 'با تمدید، همه سازه‌ها، کمپین‌ها و تنظیمات قبلی‌تان دوباره در دسترس است.'; }
  else if (r === 'new') { $('#h1').textContent = 'یک پلن انتخاب کنید و شروع کنید'; }
  else if (r === 'blocked') { $('#h1').textContent = 'دسترسی حساب شما غیرفعال است'; $('#lead').textContent = 'برای بررسی با پشتیبانی تماس بگیرید.'; }
  if (params.get('paid') === '1') toast(`پرداخت موفق بود${params.get('ref') ? ` · کد پیگیری ${params.get('ref')}` : ''}؛ اشتراک فعال شد`, 'good');
  else if (params.get('paid') === '0') toast('پرداخت انجام نشد یا لغو شد؛ مبلغی کسر نشده باشد تا 72 ساعت برمی‌گردد.', 'bad');
  if (!A.signed_in) return;
  const left = daysLeft(A.ends_at);
  const total = A.kind === 'trial' ? 7 : 30 * (plans.find(p => p.id === A.plan_id)?.months || 1);
  let cls, title, sub, icon;
  if (A.blocked) { cls = 'bad'; icon = 'lock'; title = 'حساب غیرفعال است'; sub = `برای بررسی با ${esc(settings.support_contact || 'پشتیبانی')} تماس بگیرید.`; }
  else if (A.active && A.ends_at) { cls = 'ok'; icon = 'shield'; title = `${KIND_FA[A.kind] || 'اشتراک'} فعال تا ${faDate(A.ends_at)}`; sub = `${left} روز باقی مانده${left <= 7 ? ' · برای ادامه بدون وقفه همین حالا تمدید کنید؛ روزهای باقی‌مانده از بین نمی‌رود.' : ''}`; }
  else if (A.active) { cls = 'ok'; icon = 'shield'; title = 'دسترسی مدیر'; sub = 'همه امکانات بدون اشتراک در دسترس است.'; }
  else { cls = 'no'; icon = 'clock'; title = A.had_subscription ? 'اشتراک فعالی ندارید' : 'هنوز اشتراکی ندارید'; sub = 'با خرید یکی از پلن‌های زیر، دسترسی فوراً پس از تأیید فعال می‌شود.'; }
  $('#status').innerHTML = `<div class="status ${cls}"><span class="st-ic">${ic(icon)}</span><div class="st-t"><b>${title}</b><span>${sub}</span>${cls === 'ok' && A.ends_at ? `<div class="status-bar"><i style="width:${Math.min(100, Math.round(left / total * 100))}%"></i></div>` : ''}</div>
    ${A.active ? `<a class="btn btn-ghost" href="${nextUrl('index.html')}">${ic('map')} رفتن به نقشه</a>` : ''}</div>`;
}

function renderPlans() {
  const monthly = plans.find(p => p.months === 1)?.price;
  $('#plans').innerHTML = plans.map(p => {
    const perM = p.price / p.months;
    const save = monthly && p.months > 1 ? Math.round((1 - perM / monthly) * 100) : 0;
    const feats = Array.isArray(p.features) ? p.features : [];
    return `<article class="plan ${p.badge ? 'feat' : ''} ${p.id === sel ? 'is-sel' : ''}" data-plan="${esc(p.id)}" tabindex="0" role="button" aria-pressed="${p.id === sel}">
      ${p.badge ? `<span class="plan-badge">${esc(p.badge)}</span>` : ''}
      <h3>${esc(p.title)}</h3>
      <div class="p-sub">${p.months === 1 ? 'برای یک کمپین یا آزمودن' : p.months < 12 ? `${p.months} ماه دسترسی کامل` : 'یک سال دسترسی کامل'}</div>
      <div class="price">${p.compare_price && p.compare_price > p.price ? `<s>${toman(p.compare_price)}</s>` : ''}<b>${num(p.price)}</b><span>تومان</span></div>
      <div class="per-month">${p.months > 1 ? `ماهی ${toman(perM)}` : 'پرداخت یک‌باره، بدون تمدید خودکار'}${save > 0 ? ` <span class="chip good">${save}٪ صرفه‌جویی</span>` : ''}</div>
      <ul>${feats.map(f => `<li>${ic('check')}<span>${esc(f)}</span></li>`).join('')}</ul>
      <button class="btn ${p.badge ? 'btn-primary' : 'btn-ghost'} btn-block" data-buy="${esc(p.id)}">${A.active && A.ends_at ? 'تمدید با این پلن' : 'انتخاب این پلن'}</button>
    </article>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1">فعلاً پلنی برای فروش تعریف نشده.</div>`;
  $('#plans').querySelectorAll('.plan').forEach(el => {
    el.onclick = e => { if (e.target.closest('[data-buy]')) return; pick(el.dataset.plan); };
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(el.dataset.plan); } };
  });
  $('#plans').querySelectorAll('[data-buy]').forEach(b => { b.onclick = () => { pick(b.dataset.buy); buy(); }; });
}
async function pick(id) {
  sel = id;
  $('#plans').querySelectorAll('.plan').forEach(el => { el.classList.toggle('is-sel', el.dataset.plan === id); el.setAttribute('aria-pressed', el.dataset.plan === id); });
  await requote();
}

async function requote() {
  const p = plans.find(x => x.id === sel);
  if (!p) return;
  const { data } = await sb.rpc('quote', { p_plan: sel, p_code: code || null });
  quote = data || { base: p.price, discount: 0, amount: p.price };
  const box = $('#buy'); box.hidden = false;
  const cm = code ? (quote.code_error ? `<div class="code-msg bad">${esc(quote.code_error)}</div>` : quote.discount > 0 ? `<div class="code-msg good">${ic('check')} ${toman(quote.discount)} تخفیف اعمال شد</div>` : '') : '<div class="code-msg"></div>';
  box.innerHTML = `<div>
      <div class="field"><label for="code">کد تخفیف دارید؟</label>
        <div class="code-row"><input class="inp ltr" id="code" value="${esc(code)}" placeholder="CODE" autocomplete="off"><button class="btn btn-ghost" id="apply">اعمال</button></div>${cm}</div>
    </div>
    <div class="total"><small>پلن ${esc(p.title)} · قابل پرداخت</small>${quote.discount > 0 ? `<s>${num(quote.base)}</s>` : ''}<b>${toman(quote.amount)}</b>
      <div style="margin-top:10px"><button class="btn btn-primary" id="go">${ic('card')} ${A.signed_in ? 'ادامه خرید' : 'ورود و خرید'}</button></div></div>`;
  $('#apply').onclick = async () => { code = $('#code').value.trim(); await requote(); };
  $('#code').onkeydown = async e => { if (e.key === 'Enter') { code = e.target.value.trim(); await requote(); } };
  $('#go').onclick = buy;
}

async function buy() {
  if (!A.signed_in) { location.href = pageUrl('login.html', { mode: 'signup', next: `pricing.html?plan=${sel}` }); return; }
  if (A.blocked) { toast('حساب شما غیرفعال است', 'bad'); return; }
  const b = $('#go'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; }
  try {
    const { data, error } = await sb.rpc('request_subscription', { p_plan: sel, p_code: code || null });
    if (error) throw error;
    if (data.method === 'zarinpal') {
      const { data: z, error: ze } = await sb.functions.invoke('zarinpal', { body: { payment_id: data.payment_id } });
      if (ze || !z?.url) throw ze || new Error(z?.error || 'درگاه پرداخت در دسترس نیست');
      location.href = z.url; return;
    }
    const p = plans.find(x => x.id === sel);
    const d = $('#dlg');
    d.innerHTML = `<div class="modal-head"><h3>درخواست خرید ثبت شد</h3><button class="x-btn" data-close aria-label="بستن">×</button></div>
      <div class="modal-body">
        <div class="sum-list"><div><span>پلن</span><b>${esc(p?.title)}</b></div><div><span>مبلغ پلن</span><span>${toman(data.base)}</span></div>
          ${data.discount > 0 ? `<div><span>تخفیف (${esc(data.code)})</span><span style="color:var(--good)">− ${toman(data.discount)}</span></div>` : ''}
          <div class="tot"><span>قابل پرداخت</span><span>${toman(data.amount)}</span></div></div>
        <div class="alert">${ic('alert')}<span>${esc(settings.manual_payment_note || 'پس از تأیید پرداخت، اشتراک فعال می‌شود.')}${settings.support_contact ? `<br>پشتیبانی: <b class="ltr">${esc(settings.support_contact)}</b>` : ''}</span></div>
        <button class="btn btn-primary btn-block" data-close>متوجه شدم</button>
      </div>`;
    d.querySelectorAll('[data-close]').forEach(x => { x.onclick = () => d.close(); });
    d.showModal();
    renderMine();
  } catch (e) { toast(errFa(e), 'bad'); } finally { if (b) { b.disabled = false; b.innerHTML = `${ic('card')} ادامه خرید`; } }
}

async function renderMine() {
  const box = $('#mine'); box.hidden = false;
  const [{ data: pays }, { data: subs }, { data: me }] = await Promise.all([
    sb.from('payments').select('*').order('created_at', { ascending: false }).limit(20),
    sb.from('subscriptions').select('*').order('starts_at', { ascending: false }).limit(20),
    sb.from('profiles').select('full_name,company,phone,email').eq('id', A.user.id).single(),
  ]);
  const title = id => plans.find(p => p.id === id)?.title || id || '—';
  box.innerHTML = `<h2>حساب من</h2><div class="cols">
    <div class="card"><h3>اشتراک‌ها و خریدها</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>نوع</th><th>از</th><th>تا</th><th>وضعیت</th></tr></thead><tbody>
      ${(subs || []).map(s => { const live = s.status === 'active' && new Date(s.ends_at) > new Date(); return `<tr><td>${KIND_FA[s.kind]}${s.plan_id ? ` · ${esc(title(s.plan_id))}` : ''}</td><td>${faDate(s.starts_at)}</td><td>${faDate(s.ends_at)}</td><td>${s.status === 'revoked' ? '<span class="chip bad">لغوشده</span>' : live ? '<span class="chip good"><i></i>فعال</span>' : '<span class="chip">پایان‌یافته</span>'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">هنوز اشتراکی ثبت نشده</td></tr>'}
      </tbody></table></div>
      ${(pays || []).length ? `<h3 style="margin-top:18px">درخواست‌ها و پرداخت‌ها</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>تاریخ</th><th>پلن</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>
      ${pays.map(p => `<tr><td>${faDate(p.created_at)}</td><td>${esc(title(p.plan_id))}</td><td>${toman(p.amount)}</td><td><span class="chip ${STATUS_FA[p.status]?.[1] || ''}">${STATUS_FA[p.status]?.[0] || p.status}</span>${p.ref_id ? `<br><small class="ltr" style="color:var(--muted)">${esc(p.ref_id)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <div class="card"><h3>مشخصات</h3>
      <form id="prof" style="display:grid;gap:12px">
        <div class="field"><label>ایمیل</label><input class="inp ltr" value="${esc(me?.email || A.email)}" disabled></div>
        <div class="field"><label for="pn">نام و نام خانوادگی</label><input class="inp" id="pn" value="${esc(me?.full_name || '')}"></div>
        <div class="field"><label for="pc">شرکت / برند</label><input class="inp" id="pc" value="${esc(me?.company || '')}" placeholder="اختیاری"></div>
        <div class="field"><label for="pp">موبایل</label><input class="inp ltr" id="pp" value="${esc(me?.phone || '')}" placeholder="09xxxxxxxxx" inputmode="tel"><small>برای هماهنگی پرداخت و پشتیبانی</small></div>
        <button class="btn btn-ghost" type="submit">ذخیره مشخصات</button>
      </form>
    </div></div>`;
  $('#prof').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.rpc('update_my_profile', { p_name: $('#pn').value, p_company: $('#pc').value, p_phone: $('#pp').value });
    toast(error ? errFa(error) : 'ذخیره شد', error ? 'bad' : 'good');
  };
}

function renderStatic() {
  $('#trust').innerHTML = [['bolt', 'فعال‌سازی فوری پس از تأیید'], ['shield', 'بدون تمدید خودکار'], ['map', '10 شهر، همه سازه‌ها'], ['spark', 'قابلیت‌های تازه بدون هزینه اضافه']]
    .map(([i, t]) => `<div>${ic(i)}<span>${t}</span></div>`).join('');
  $('#faq').innerHTML = [
    ['عددها از کجا می‌آیند؟', 'تردد هر جهت از تعداد خط و نوع معبر (OpenStreetMap) و الگوی ساعتی ترافیک، سرعت از نشان، و زمان مواجهه از فاصله خوانایی تابلو و سرعت هر ساعت حساب می‌شود. روش کامل، قدم‌به‌قدم و با عددهای همان سازه، داخل سایت در بخش «این عددها چطور حساب شد» آمده است.'],
    ['تمدید زودتر از موعد، روزهای باقی‌مانده را از بین می‌برد؟', 'نه. اشتراک تازه از پایان اشتراک فعلی شروع می‌شود و روزهای باقی‌مانده حفظ می‌شود.'],
    ['تمدید خودکار دارد؟', 'نه. هر خرید یک‌باره است و پیش از پایان، داخل سایت یادآوری می‌بینید.'],
    ['می‌شود قبل از خرید امتحان کرد؟', 'بله. برای تیم‌ها و آژانس‌ها دسترسی دموی 7 روزه فعال می‌کنیم؛ از طریق پشتیبانی درخواست دهید.'],
    ['برای تیم چند نفره چطور؟', 'هر نفر با ایمیل خودش ثبت‌نام می‌کند. برای خرید چند حساب با هم، تخفیف تیمی با پشتیبانی هماهنگ می‌شود.'],
    ['اطلاعات و کمپین‌های من کجا ذخیره می‌شود؟', 'نقطه‌ها، کمپین‌ها و تنظیمات روی مرورگر خودتان می‌ماند؛ حساب کاربری فقط برای ورود و اشتراک است.'],
  ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('');
}

start();
