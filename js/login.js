import { configured, sb, access, nextUrl, pageUrl, errFa, esc, toast } from './auth.js';
import { ic, logoHTML } from './site-icons.js';

const $ = s => document.querySelector(s);
$('#logo').innerHTML = logoHTML('index.html');
$('#feats').innerHTML = [
  ['car', 'تردد هر جهت', 'چند خودرو از جلوی هر تابلو رد می‌شود، ساعت به ساعت'],
  ['clock', 'زمان و عمق مواجهه', 'ثانیه‌های دیده‌شدن و نفر-ساعت در ماه'],
  ['money', 'هزینه هر ایمپرشن', 'CPM و ارزش خرید هر سازه با قیمت روز'],
  ['flame', 'هات‌اسپات و کمپین', 'تجمع مردم، پلن با بودجه و دستیار کمپین'],
].map(([i, b, s]) => `<div class="hfeat"><span class="hfeat-ic">${ic(i)}</span><div><b>${b}</b><span>${s}</span></div></div>`).join('');

const params = new URLSearchParams(location.search);
const recovering = /type=recovery/.test(location.hash) || params.get('mode') === 'recovery';
let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
let busy = false;

function view() {
  const card = $('#card');
  if (!configured) {
    card.innerHTML = `<h1>ورود هنوز راه‌اندازی نشده</h1><p class="lead">اتصال Supabase در <code>js/auth-config.js</code> خالی است؛ تا آن موقع سایت بدون ورود باز می‌شود.</p><a class="btn btn-primary" href="index.html">رفتن به نقشه</a>`;
    return;
  }
  if (mode === 'recovery') {
    card.innerHTML = `<h1>رمز عبور تازه</h1><p class="lead">یک رمز تازه انتخاب کنید؛ بعد مستقیم وارد می‌شوید.</p>
      <form id="f" novalidate>
        <div class="field"><label for="pw">رمز عبور تازه</label>${pwField('pw', 'new-password')}</div>
        <div id="msg"></div>
        <button class="btn btn-primary btn-block" type="submit">ذخیره و ورود</button>
      </form>`;
  } else if (mode === 'forgot') {
    card.innerHTML = `<h1>بازیابی رمز عبور</h1><p class="lead">ایمیل حسابتان را بنویسید؛ لینک ساختن رمز تازه برایتان ارسال می‌شود.</p>
      <form id="f" novalidate>
        <div class="field"><label for="em">ایمیل</label><input class="inp ltr" id="em" type="email" autocomplete="email" placeholder="name@company.com" required></div>
        <div id="msg"></div>
        <button class="btn btn-primary btn-block" type="submit">ارسال لینک</button>
        <button class="link-btn" type="button" data-m="login">${ic('arrow')} برگشت به ورود</button>
      </form>`;
  } else {
    const up = mode === 'signup';
    card.innerHTML = `<div><h1>${up ? 'ساخت حساب بیلبوردسنج' : 'خوش برگشتید'}</h1><p class="lead">${up ? 'چند ثانیه طول می‌کشد. بعد از ثبت‌نام، پلن مناسبتان را انتخاب می‌کنید.' : 'برای دیدن نقشه، سازه‌ها و کمپین‌هایتان وارد شوید.'}</p></div>
      <div class="tabs" role="tablist"><button type="button" class="${up ? '' : 'on'}" data-m="login">ورود</button><button type="button" class="${up ? 'on' : ''}" data-m="signup">ثبت‌نام</button></div>
      <button class="btn btn-google btn-block" id="google" type="button">${ic('google')}<span>${up ? 'ثبت‌نام' : 'ورود'} با حساب گوگل</span></button>
      <div class="or">یا با ایمیل</div>
      <form id="f" novalidate>
        ${up ? '<div class="field"><label for="nm">نام و نام خانوادگی</label><input class="inp" id="nm" autocomplete="name" placeholder="مثلاً سارا احمدی"></div>' : ''}
        <div class="field"><label for="em">ایمیل</label><input class="inp ltr" id="em" type="email" autocomplete="email" placeholder="name@company.com" required></div>
        <div class="field"><label for="pw">رمز عبور</label>${pwField('pw', up ? 'new-password' : 'current-password')}${up ? '<small>حداقل 6 کاراکتر</small>' : ''}</div>
        ${up ? '' : '<div class="auth-row"><span></span><button class="link-btn" type="button" data-m="forgot">رمز را فراموش کرده‌اید؟</button></div>'}
        <div id="msg"></div>
        <button class="btn btn-primary btn-block" type="submit">${up ? 'ساخت حساب' : 'ورود'}</button>
      </form>
      <p class="fine">اگر ورود با گوگل باز نشد، با ایمیل و رمز ${up ? 'ثبت‌نام کنید' : 'وارد شوید'}.</p>`;
    $('#google').onclick = google;
  }
  card.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { mode = b.dataset.m; view(); }; });
  card.querySelectorAll('.pw-eye').forEach(b => { b.onclick = () => { const i = b.previousElementSibling; const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = ic(show ? 'eyeOff' : 'eye'); }; });
  $('#f').onsubmit = submit;
  card.querySelector('input')?.focus();
}
const pwField = (id, ac) => `<div class="pw-wrap"><input class="inp ltr" id="${id}" type="password" autocomplete="${ac}" minlength="6" required><button class="pw-eye" type="button" aria-label="نمایش رمز">${ic('eye')}</button></div>`;

function msg(text, type = 'bad') { const m = $('#msg'); if (m) m.innerHTML = text ? `<div class="alert ${type}">${ic(type === 'good' ? 'check' : 'alert')}<span>${text}</span></div>` : ''; }
function loading(on) {
  busy = on;
  const b = $('#f button[type=submit]');
  if (!b) return;
  b.disabled = on;
  if (on) { b.dataset.t = b.innerHTML; b.innerHTML = '<span class="spin"></span>'; } else if (b.dataset.t) b.innerHTML = b.dataset.t;
}

async function google() {
  try {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: pageUrl('login.html', { next: params.get('next') }) } });
    if (error) throw error;
  } catch (e) { msg(errFa(e)); }
}

async function submit(e) {
  e.preventDefault();
  if (busy) return;
  const em = $('#em')?.value.trim(), pw = $('#pw')?.value || '';
  msg('');
  if (mode !== 'recovery' && !/^\S+@\S+\.\S+$/.test(em || '')) { msg('ایمیل معتبر نیست.'); return; }
  if ((mode === 'login' || mode === 'signup' || mode === 'recovery') && pw.length < 6) { msg('رمز عبور باید حداقل 6 کاراکتر باشد.'); return; }
  loading(true);
  try {
    if (mode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) throw error;
      await go();
    } else if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email: em, password: pw, options: { data: { full_name: $('#nm')?.value.trim() || '' }, emailRedirectTo: pageUrl('login.html') } });
      if (error) throw error;
      if (data.session) { await go(); return; }
      if (data.user && !data.user.identities?.length) throw new Error('already registered');
      msg(`حساب ساخته شد. لینک تأیید به <b class="ltr">${esc(em)}</b> فرستاده شد؛ بعد از تأیید وارد شوید.`, 'good');
    } else if (mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: pageUrl('login.html', { mode: 'recovery' }) });
      if (error) throw error;
      msg('اگر این ایمیل حساب داشته باشد، لینک بازیابی تا چند دقیقه دیگر می‌رسد. پوشه اسپم را هم ببینید.', 'good');
    } else if (mode === 'recovery') {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      toast('رمز تازه ذخیره شد', 'good');
      await go();
    }
  } catch (err) { msg(errFa(err)); } finally { loading(false); }
}

/** logged in: to the page asked for, or to the plans when there is no active subscription */
async function go() {
  const a = await access();
  if (a.active) location.replace(nextUrl('index.html'));
  else location.replace(pageUrl('pricing.html', { reason: a.blocked ? 'blocked' : a.had_subscription ? 'expired' : 'new', next: params.get('next') }));
}

async function start() {
  if (!configured) { view(); return; }
  if (recovering) { mode = 'recovery'; view(); return; }
  sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') { mode = 'recovery'; view(); } });
  const { data } = await sb.auth.getSession();
  if (data.session) { try { await go(); return; } catch { /* show the form */ } }
  view();
}
start();
