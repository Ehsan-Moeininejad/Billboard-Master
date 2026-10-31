// Entry point of the map page: checks login and subscription, then loads the app.
// Without Supabase settings (js/auth-config.js empty) the app opens exactly as before.
import { configured, access, sb, pageUrl, here, daysLeft, faDate, esc, avatarHTML, KIND_FA, signOut } from './auth.js';

async function run() {
  if (!configured) { await import('./app.js'); return; }
  const cover = document.createElement('div');
  cover.className = 'gate-cover';
  cover.innerHTML = '<div class="gate-box"><span class="gate-spin"></span><span>در حال بررسی حساب…</span></div>';
  document.body.append(cover);
  let a;
  try { a = await access(); } catch (e) {
    cover.innerHTML = `<div class="gate-box"><b>اتصال به سرور حساب برقرار نشد</b><span>${esc(e.message || '')}</span><button onclick="location.reload()">تلاش دوباره</button></div>`;
    return;
  }
  if (!a.signed_in) { location.replace(pageUrl('login.html', { next: here() })); return; }
  if (!a.active) { location.replace(pageUrl('pricing.html', { reason: a.blocked ? 'blocked' : a.had_subscription ? 'expired' : 'new', next: here() })); return; }
  sb.rpc('touch_last_seen').then(() => {}, () => {});
  userChip(a);
  await import('./app.js');
  cover.classList.add('out'); setTimeout(() => cover.remove(), 300);
}

function userChip(a) {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const left = a.is_admin && !a.ends_at ? null : daysLeft(a.ends_at);
  const warn = left != null && left <= 5;
  const label = a.is_admin && !a.kind ? 'مدیر' : `${KIND_FA[a.kind] || 'اشتراک'} · ${left} روز`;
  const wrap = document.createElement('div');
  wrap.className = 'user-chip-wrap';
  wrap.innerHTML = `<button class="user-chip ${warn ? 'warn' : ''}" aria-haspopup="true" aria-label="حساب کاربری">${avatarHTML(a, 'uc-av')}<span class="uc-txt"><b>${esc(a.name || a.email)}</b><small>${label}</small></span></button>
    <div class="user-pop" hidden>
      <div class="up-head">${avatarHTML(a, 'uc-av lg')}<div><b>${esc(a.name || '—')}</b><small class="ltr">${esc(a.email)}</small></div></div>
      <div class="up-status ${warn ? 'warn' : ''}">${a.ends_at ? `${KIND_FA[a.kind] || 'اشتراک'} فعال تا <b>${faDate(a.ends_at)}</b> (${left} روز)` : 'دسترسی مدیر'}</div>
      <a href="${pageUrl('pricing.html')}" class="up-item">اشتراک و حساب من</a>
      ${warn ? `<a href="${pageUrl('pricing.html')}" class="up-item hl">تمدید اشتراک</a>` : ''}
      ${a.is_admin ? `<a href="${pageUrl('admin.html')}" class="up-item">پنل مدیریت</a>` : ''}
      <button class="up-item out" data-out>خروج</button>
    </div>`;
  bar.append(wrap);
  const btn = wrap.querySelector('.user-chip'), pop = wrap.querySelector('.user-pop');
  btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) pop.hidden = true; });
  wrap.querySelector('[data-out]').addEventListener('click', signOut);
}

run();
