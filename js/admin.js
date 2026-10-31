// Admin panel: users and access, purchase requests, plans and prices, discount codes, settings.
// Every write goes through Supabase with the admin's own login; the database rules (supabase/schema.sql) refuse non-admins.
import { configured, sb, access, pageUrl, here, toman, num, faDate, faShort, daysLeft, esc, errFa, toast, KIND_FA, avatarHTML, signOut } from './auth.js';
import { ic, logoHTML } from './site-icons.js';

const $ = s => document.querySelector(s);
const S = { tab: (location.hash || '#dash').slice(1), users: [], pays: [], plans: [], codes: [], invites: [], settings: {}, uf: 'all', uq: '', pf: 'pending', me: null };
const TABS = [
  ['dash', 'داشبورد', 'chart'], ['users', 'کاربران و دسترسی', 'users'], ['pays', 'خرید و پرداخت', 'card'],
  ['plans', 'پلن‌ها و قیمت', 'layers'], ['codes', 'کدهای تخفیف', 'tag'], ['settings', 'تنظیمات', 'settings'],
];
const PRESETS = [['trial7', 'دموی 7 روزه', 7, 'trial'], ['m1', '+ 1 ماه', 30, 'paid'], ['m3', '+ 3 ماه', 91, 'paid'], ['m12', '+ 12 ماه', 365, 'paid']];
const planFor = days => S.plans.find(p => Math.abs(p.months * 30.4 - days) < 6)?.id || null;
const now = () => Date.now();

// ── user status ──
function ustat(u) {
  if (u.blocked) return ['blocked', 'مسدود', 'bad'];
  const live = u.access_until && new Date(u.access_until) > now();
  if (live) {
    if (u.access_kind === 'trial') return ['trial', 'دمو', 'violet'];
    if (u.access_kind === 'gift') return ['active', 'هدیه', 'acc'];
    return ['active', 'فعال', 'good'];
  }
  if (u.is_admin) return ['admin', 'مدیر', 'acc'];
  return u.subs ? ['expired', 'منقضی', 'warn'] : ['none', 'بدون اشتراک', ''];
}
const FILTERS = [
  ['all', 'همه', () => true], ['active', 'فعال', u => ustat(u)[0] === 'active'], ['trial', 'دمو', u => ustat(u)[0] === 'trial'],
  ['soon', 'تا 7 روز تمام می‌شود', u => u.access_until && !u.blocked && daysLeft(u.access_until) <= 7 && new Date(u.access_until) > now()],
  ['pending', 'درخواست باز', u => u.pending_amount != null], ['expired', 'منقضی', u => ustat(u)[0] === 'expired'],
  ['none', 'بدون اشتراک', u => ustat(u)[0] === 'none'], ['blocked', 'مسدود', u => u.blocked], ['admins', 'مدیرها', u => u.is_admin],
];

// ── load ──
async function load(which = ['users', 'pays', 'plans', 'codes', 'invites', 'settings']) {
  const jobs = {
    users: () => sb.rpc('admin_users').then(r => { if (r.error) throw r.error; S.users = r.data || []; }),
    pays: () => sb.from('payments').select('*, profiles(email, full_name, phone)').order('created_at', { ascending: false }).limit(500).then(r => { if (r.error) throw r.error; S.pays = r.data || []; }),
    plans: () => sb.from('plans').select('*').order('sort').then(r => { if (r.error) throw r.error; S.plans = r.data || []; }),
    codes: () => sb.from('discount_codes').select('*').order('created_at', { ascending: false }).then(r => { if (r.error) throw r.error; S.codes = r.data || []; }),
    invites: () => sb.from('invites').select('*').is('used_at', null).order('created_at', { ascending: false }).then(r => { if (r.error) throw r.error; S.invites = r.data || []; }),
    settings: () => sb.from('settings').select('*').then(r => { if (r.error) throw r.error; S.settings = Object.fromEntries((r.data || []).map(x => [x.key, x.value])); }),
  };
  await Promise.all(which.map(k => jobs[k]()));
}

// ── shell ──
function shell() {
  const pend = S.pays.filter(p => p.status === 'pending').length;
  const nav = TABS.map(([k, l, i]) => `<button class="nav-btn ${S.tab === k ? 'on' : ''}" data-tab="${k}">${ic(i)}<span>${l}</span>${k === 'pays' && pend ? `<span class="cnt">${pend}</span>` : ''}</button>`).join('');
  $('#side').innerHTML = `${logoHTML(pageUrl('index.html'))}<div class="side-l">مدیریت</div>${nav}
    <div class="side-foot"><a class="nav-btn" href="${pageUrl('index.html')}">${ic('map')}<span>رفتن به نقشه</span></a><a class="nav-btn" href="${pageUrl('pricing.html')}">${ic('tag')}<span>صفحه اشتراک</span></a>
    <div class="tl" style="margin-top:6px">${avatarHTML(S.me, 'uav')}<div><b style="font-size:12.5px">${esc(S.me.name || 'مدیر')}</b><small class="ltr">${esc(S.me.email)}</small></div><button class="x-btn" data-out title="خروج">${ic('out')}</button></div></div>`;
  $('#mnav').innerHTML = nav;
  document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => go(b.dataset.tab); });
  $('#side [data-out]').onclick = signOut;
}
function go(tab) { S.tab = tab; history.replaceState(null, '', `#${tab}`); closeDrawer(); shell(); render(); window.scrollTo(0, 0); }
function render() { ({ dash, users, pays, plans, codes, settings }[S.tab] || dash)(); }
const head = (t, s, actions = '') => `<div class="page-h"><div><h1>${t}</h1>${s ? `<p>${s}</p>` : ''}</div><div class="inline">${actions}</div></div>`;
const kpi = (l, v, s = '', cls = '', icn = '') => `<div class="kpi ${cls}"><div class="kpi-l">${icn ? ic(icn) : ''}${l}</div><div class="kpi-v">${v}</div>${s ? `<div class="kpi-s">${s}</div>` : ''}</div>`;
const planTitle = id => S.plans.find(p => p.id === id)?.title || id || '';
const userCell = u => `<div class="u-cell">${avatarHTML({ avatar: u.avatar_url, name: u.full_name, email: u.email }, 'uav')}<div><b>${esc(u.full_name || u.email?.split('@')[0] || '—')}</b><small class="ltr">${esc(u.email || '')}</small></div></div>`;

// ── dashboard ──
function dash() {
  const U = S.users, st = U.map(ustat);
  const act = st.filter(s => s[0] === 'active').length, tri = st.filter(s => s[0] === 'trial').length, exp = st.filter(s => s[0] === 'expired').length;
  const paid = S.pays.filter(p => p.status === 'paid'), pend = S.pays.filter(p => p.status === 'pending');
  const rev = paid.reduce((a, p) => a + p.amount, 0), rev30 = paid.filter(p => now() - new Date(p.paid_at || p.created_at) < 30 * 864e5).reduce((a, p) => a + p.amount, 0);
  const soon = U.filter(FILTERS.find(f => f[0] === 'soon')[2]).sort((a, b) => new Date(a.access_until) - new Date(b.access_until));
  const newU = U.filter(u => now() - new Date(u.created_at) < 7 * 864e5).length;
  const conv = U.length ? Math.round(U.filter(u => u.paid_total > 0).length / U.length * 100) : 0;
  // signups per week, last 8 weeks
  const weeks = Array.from({ length: 8 }, (_, i) => { const end = now() - i * 7 * 864e5, st0 = end - 7 * 864e5; return U.filter(u => { const t = new Date(u.created_at).getTime(); return t > st0 && t <= end; }).length; }).reverse();
  const wmax = Math.max(1, ...weeks);
  $('#main').innerHTML = head('داشبورد', `امروز ${faDate(new Date())}`, `<button class="btn btn-primary btn-sm" data-invite>${ic('gift')} دسترسی با ایمیل</button>`) + `
    <div class="kpis">
      ${kpi('کاربران', num(U.length), `${newU} ثبت‌نام در 7 روز اخیر`, 'acc', 'users')}
      ${kpi('اشتراک فعال', num(act), `${tri} دموی فعال`, '', 'shield')}
      ${kpi('منقضی', num(exp), 'فرصت تمدید', '', 'clock')}
      ${kpi('درخواست در انتظار', num(pend.length), pend.length ? toman(pend.reduce((a, p) => a + p.amount, 0)) : 'همه رسیدگی شده', '', 'card')}
      ${kpi('درآمد 30 روز', `${num(rev30 / 1e6)}<small>میلیون تومان</small>`, `کل: ${num(rev / 1e6)} میلیون`, '', 'money')}
      ${kpi('تبدیل به خرید', `${conv}<small>٪</small>`, 'کاربرانی که حداقل یک بار خریده‌اند', '', 'target')}
    </div>
    <div class="cols">
      <div class="card"><h3>درخواست‌های در انتظار <button class="btn btn-ghost btn-xs" data-tab="pays">همه</button></h3>${payTable(pend.slice(0, 6), true)}</div>
      <div class="card"><h3>تا 7 روز دیگر تمام می‌شود <button class="btn btn-ghost btn-xs" data-goto="soon">همه</button></h3>
        ${soon.slice(0, 7).map(u => `<div class="tl rowbtn" data-user="${u.id}">${avatarHTML({ avatar: u.avatar_url, name: u.full_name, email: u.email }, 'uav')}<div><b>${esc(u.full_name || u.email)}</b><small>${KIND_FA[u.access_kind] || ''} · ${faDate(u.access_until)}</small></div><span class="chip warn">${daysLeft(u.access_until)} روز</span></div>`).join('') || '<div class="empty">موردی نیست</div>'}
      </div>
      <div class="card"><h3>ثبت‌نام هفتگی <span class="chip">8 هفته اخیر</span></h3>
        <div style="display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:8px">${weeks.map((w, i) => `<div style="flex:1;display:grid;justify-items:center;gap:6px"><small style="color:var(--muted);font-size:11px">${w}</small><i style="display:block;width:100%;height:${Math.max(3, w / wmax * 86)}px;border-radius:6px 6px 2px 2px;background:${i === 7 ? 'var(--accent)' : 'var(--surface-3)'}"></i></div>`).join('')}</div>
      </div>
      <div class="card"><h3>تازه‌ترین کاربران <button class="btn btn-ghost btn-xs" data-tab="users">همه</button></h3>
        ${U.slice(0, 6).map(u => { const [, l, c] = ustat(u); return `<div class="tl rowbtn" data-user="${u.id}" style="margin-bottom:6px">${avatarHTML({ avatar: u.avatar_url, name: u.full_name, email: u.email }, 'uav')}<div><b>${esc(u.full_name || u.email)}</b><small>${faDate(u.created_at)}</small></div><span class="chip ${c}">${l}</span></div>`; }).join('') || '<div class="empty">هنوز کاربری نیست</div>'}
      </div>
    </div>`;
  bindCommon();
}

// ── users ──
function users() {
  const counts = Object.fromEntries(FILTERS.map(([k, , f]) => [k, S.users.filter(f).length]));
  const q = S.uq.trim().toLowerCase();
  const f = FILTERS.find(x => x[0] === S.uf)?.[2] || (() => true);
  const list = S.users.filter(f).filter(u => !q || `${u.email} ${u.full_name || ''} ${u.company || ''} ${u.phone || ''}`.toLowerCase().includes(q));
  $('#main').innerHTML = head('کاربران و دسترسی', 'روی هر کاربر بزنید تا دسترسی بدهید، تمدید کنید یا بگیرید.', `<button class="btn btn-ghost btn-sm" data-csv>${ic('copy')} خروجی CSV</button><button class="btn btn-primary btn-sm" data-invite>${ic('gift')} دسترسی با ایمیل</button>`) + `
    <div class="toolbar"><input class="inp inp-sm" id="uq" placeholder="جستجوی ایمیل، نام، شرکت، موبایل" value="${esc(S.uq)}">
      <div class="seg">${FILTERS.map(([k, l]) => `<button class="${S.uf === k ? 'on' : ''}" data-uf="${k}">${l}<i>${counts[k]}</i></button>`).join('')}</div></div>
    <div class="card" style="padding:6px 8px"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>کاربر</th><th>وضعیت</th><th>دسترسی تا</th><th>پرداختی</th><th>عضویت</th><th>آخرین بازدید</th><th></th></tr></thead><tbody>
    ${list.map(u => { const [, l, c] = ustat(u); const live = u.access_until && new Date(u.access_until) > now(); return `<tr class="rowbtn" data-user="${u.id}">
      <td>${userCell(u)}</td>
      <td><span class="chip ${c}"><i></i>${l}</span>${u.is_admin && ustat(u)[0] !== 'admin' ? ' <span class="chip acc">مدیر</span>' : ''}${u.pending_amount != null ? ` <span class="chip warn">درخواست ${num(u.pending_amount / 1e6)}M</span>` : ''}</td>
      <td>${live ? `${faDate(u.access_until)}<div class="days">${daysLeft(u.access_until)} روز${u.plan_id ? ` · ${esc(planTitle(u.plan_id))}` : ''}</div>` : '—'}</td>
      <td>${u.paid_total ? toman(u.paid_total) : '—'}</td><td>${faShort(u.created_at)}</td><td>${u.last_seen ? faShort(u.last_seen) : '—'}</td>
      <td><button class="btn btn-ghost btn-xs">مدیریت</button></td></tr>`; }).join('') || `<tr><td colspan="7" class="empty">کاربری با این فیلتر نیست</td></tr>`}
    </tbody></table></div></div>
    ${S.invites.length ? `<div class="card" style="margin-top:16px"><h3>دسترسی‌های تعریف‌شده برای کسانی که هنوز ثبت‌نام نکرده‌اند</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>ایمیل</th><th>دسترسی</th><th>یادداشت</th><th>تاریخ</th><th></th></tr></thead><tbody>
      ${S.invites.map(i => `<tr><td class="ltr" style="text-align:right">${esc(i.email)}</td><td>${KIND_FA[i.kind]} · ${i.days} روز</td><td>${esc(i.note || '')}</td><td>${faShort(i.created_at)}</td><td><button class="btn btn-danger btn-xs" data-del-inv="${esc(i.email)}">حذف</button></td></tr>`).join('')}
    </tbody></table></div><p class="fine" style="text-align:start;margin-top:8px">این دسترسی با اولین ورود همان ایمیل (گوگل یا ایمیل و رمز) خودکار فعال می‌شود.</p></div>` : ''}`;
  const qi = $('#uq'); qi.oninput = () => { S.uq = qi.value; const pos = qi.selectionStart; users(); const n = $('#uq'); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll('[data-uf]').forEach(b => { b.onclick = () => { S.uf = b.dataset.uf; users(); }; });
  document.querySelectorAll('[data-del-inv]').forEach(b => { b.onclick = async () => { const { error } = await sb.from('invites').delete().eq('email', b.dataset.delInv); if (error) return toast(errFa(error), 'bad'); await load(['invites']); users(); toast('حذف شد'); }; });
  $('[data-csv]').onclick = () => csv(list);
  bindCommon();
}
function csv(list) {
  const rows = [['email', 'name', 'company', 'phone', 'status', 'access_until', 'plan', 'paid_total', 'joined', 'last_seen']]
    .concat(list.map(u => [u.email, u.full_name, u.company, u.phone, ustat(u)[1], u.access_until ? faShort(u.access_until) : '', planTitle(u.plan_id), u.paid_total || 0, faShort(u.created_at), u.last_seen ? faShort(u.last_seen) : '']));
  const text = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'billboard-users.csv'; a.click();
}

// ── user drawer ──
async function openUser(id) {
  const u = S.users.find(x => x.id === id); if (!u) return;
  const d = $('#drawer');
  d.innerHTML = `<div class="drawer-h">${avatarHTML({ avatar: u.avatar_url, name: u.full_name, email: u.email }, 'uav lg')}<div><b>${esc(u.full_name || '—')}</b><small class="ltr" style="text-align:right">${esc(u.email)}</small></div><button class="x-btn" data-close aria-label="بستن">×</button></div><div class="drawer-b"><div class="skel" style="height:300px"></div></div>`;
  d.classList.add('open'); $('#shade').classList.add('on');
  d.querySelector('[data-close]').onclick = closeDrawer;
  const [{ data: subs }, pays] = await Promise.all([
    sb.from('subscriptions').select('*').eq('user_id', id).order('starts_at', { ascending: false }),
    Promise.resolve(S.pays.filter(p => p.user_id === id)),
  ]);
  const [, l, c] = ustat(u);
  const live = u.access_until && new Date(u.access_until) > now();
  const isMe = id === S.me.user.id;
  d.querySelector('.drawer-b').innerHTML = `
    <div class="status ${u.blocked ? 'bad' : live ? 'ok' : 'no'}" style="margin:0"><span class="st-ic">${ic(u.blocked ? 'lock' : live ? 'shield' : 'clock')}</span><div class="st-t"><b>${l}${live ? ` تا ${faDate(u.access_until)}` : ''}</b><span>${live ? `${daysLeft(u.access_until)} روز باقی مانده` : u.blocked ? 'ورود به نقشه بسته است' : 'به نقشه دسترسی ندارد'}</span></div></div>
    <div class="d-sec"><h4>دادن یا تمدید دسترسی</h4>
      <div class="quick">${PRESETS.map(([k, t]) => `<button class="btn ${k === 'trial7' ? 'btn-ghost' : 'btn-good'} btn-sm" data-preset="${k}">${k === 'trial7' ? ic('gift') : ic('plus')} ${t}</button>`).join('')}</div>
      <div class="inline" style="margin-top:8px"><input class="inp inp-sm ltr" id="gd" type="number" min="1" placeholder="روز" style="max-width:90px">
        <select class="sel inp-sm" id="gk"><option value="paid">اشتراک (پرداخت خارج از سایت)</option><option value="gift">هدیه</option><option value="trial">دمو</option></select>
        <button class="btn btn-primary btn-sm" data-grant>اعمال</button></div>
      <input class="inp inp-sm" id="gn" placeholder="یادداشت (اختیاری) — مثلاً: کارت‌به‌کارت 12 آبان" style="margin-top:8px">
      <small style="color:var(--muted);font-size:11.5px;display:block;margin-top:6px">دسترسی تازه از پایان دسترسی فعلی ادامه پیدا می‌کند.</small>
    </div>
    <div class="d-sec"><h4>کنترل حساب</h4><div class="quick">
      <button class="btn btn-danger btn-sm" data-revoke ${live ? '' : 'disabled'}>${ic('lock')} گرفتن دسترسی</button>
      <button class="btn ${u.blocked ? 'btn-good' : 'btn-danger'} btn-sm" data-block ${isMe ? 'disabled' : ''}>${u.blocked ? 'رفع مسدودی' : 'مسدود کردن'}</button>
      <button class="btn btn-ghost btn-sm" data-admin ${isMe ? 'disabled' : ''}>${u.is_admin ? 'برداشتن مدیر' : 'مدیر کردن'}</button>
      <button class="btn btn-ghost btn-sm" data-code>${ic('tag')} کد تخفیف شخصی</button></div></div>
    <div class="d-sec"><h4>مشخصات</h4><div class="sum-list" style="font-size:13px">
      <div><span>شرکت</span><span>${esc(u.company || '—')}</span></div><div><span>موبایل</span><span class="ltr">${esc(u.phone || '—')}</span></div>
      <div><span>عضویت</span><span>${faDate(u.created_at)}</span></div><div><span>آخرین بازدید</span><span>${u.last_seen ? faDate(u.last_seen) : '—'}</span></div>
      <div><span>جمع پرداختی</span><span>${toman(u.paid_total)}</span></div></div>
      <textarea class="inp" id="unote" placeholder="یادداشت داخلی درباره این کاربر" style="margin-top:10px;min-height:70px">${esc(u.note || '')}</textarea>
      <button class="btn btn-ghost btn-sm" data-note style="margin-top:6px">ذخیره یادداشت</button></div>
    <div class="d-sec"><h4>تاریخچه دسترسی</h4><div class="timeline">
      ${(subs || []).map(s => { const on = s.status === 'active' && new Date(s.ends_at) > now(); return `<div class="tl ${on ? '' : 'off'}"><span class="chip ${s.kind === 'trial' ? 'violet' : s.kind === 'gift' ? 'acc' : 'good'}">${KIND_FA[s.kind]}</span><div><b>${faShort(s.starts_at)} ← ${faShort(s.ends_at)}</b><small>${s.plan_id ? esc(planTitle(s.plan_id)) + ' · ' : ''}${s.source === 'payment' ? 'پرداخت آنلاین' : s.source === 'auto_trial' ? 'دموی خودکار' : 'توسط مدیر'}${s.note ? ' · ' + esc(s.note) : ''}${s.status === 'revoked' ? ' · لغوشده' : ''}</small></div>${on ? `<button class="btn btn-danger btn-xs" data-sub-revoke="${s.id}">لغو</button>` : ''}</div>`; }).join('') || '<div class="empty">بدون سابقه</div>'}
    </div></div>
    ${pays.length ? `<div class="d-sec"><h4>درخواست‌ها و پرداخت‌ها</h4>${payTable(pays, true, true)}</div>` : ''}`;
  const reload = async () => { await load(['users', 'pays']); render(); openUser(id); };
  const grant = async (days, kind, plan) => {
    const { error } = await sb.rpc('admin_grant', { p_user: id, p_days: days, p_kind: kind, p_plan: plan, p_note: $('#gn').value.trim() || null });
    if (error) return toast(errFa(error), 'bad');
    toast(`${days} روز ${KIND_FA[kind]} اضافه شد`, 'good'); reload();
  };
  d.querySelectorAll('[data-preset]').forEach(b => { b.onclick = () => { const [, , days, kind] = PRESETS.find(p => p[0] === b.dataset.preset); grant(days, kind, kind === 'paid' ? planFor(days) : null); }; });
  d.querySelector('[data-grant]').onclick = () => { const days = +$('#gd').value; if (!(days > 0)) return toast('تعداد روز را بنویسید', 'bad'); grant(days, $('#gk').value, $('#gk').value === 'paid' ? planFor(days) : null); };
  d.querySelector('[data-revoke]').onclick = async () => {
    if (!(await confirmBox('گرفتن دسترسی', `دسترسی ${esc(u.email)} همین حالا قطع می‌شود و همه اشتراک‌های فعال و آینده‌اش لغو می‌شود.`, 'گرفتن دسترسی'))) return;
    const { error } = await sb.rpc('admin_revoke', { p_user: id, p_note: $('#gn').value.trim() || null });
    if (error) return toast(errFa(error), 'bad'); toast('دسترسی گرفته شد'); reload();
  };
  d.querySelector('[data-block]').onclick = async () => { const { error } = await sb.from('profiles').update({ blocked: !u.blocked }).eq('id', id); if (error) return toast(errFa(error), 'bad'); toast(u.blocked ? 'رفع مسدودی شد' : 'مسدود شد'); reload(); };
  d.querySelector('[data-admin]').onclick = async () => {
    if (!u.is_admin && !(await confirmBox('مدیر کردن', `${esc(u.email)} به همه کاربران، پرداخت‌ها و تنظیمات دسترسی پیدا می‌کند.`, 'مدیر شود'))) return;
    const { error } = await sb.from('profiles').update({ is_admin: !u.is_admin }).eq('id', id); if (error) return toast(errFa(error), 'bad'); reload();
  };
  d.querySelector('[data-note]').onclick = async () => { const { error } = await sb.from('profiles').update({ note: $('#unote').value.trim() || null }).eq('id', id); if (error) return toast(errFa(error), 'bad'); u.note = $('#unote').value.trim(); toast('ذخیره شد', 'good'); };
  d.querySelector('[data-code]').onclick = () => { go('codes'); setTimeout(() => { const e = $('#c_email'); if (e) { e.value = u.email; $('#c_code').value = `VIP-${(u.email.split('@')[0] || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`; $('#c_pct').focus(); } }, 50); };
  d.querySelectorAll('[data-sub-revoke]').forEach(b => { b.onclick = async () => { const { error } = await sb.from('subscriptions').update({ status: 'revoked' }).eq('id', b.dataset.subRevoke); if (error) return toast(errFa(error), 'bad'); toast('لغو شد'); reload(); }; });
  bindPayActions(d, reload);
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#shade').classList.remove('on'); }

// ── payments ──
const PSTAT = { pending: ['در انتظار', 'warn'], paid: ['پرداخت‌شده', 'good'], failed: ['ناموفق', 'bad'], cancelled: ['لغوشده', ''] };
function payTable(list, compact = false, noUser = false) {
  if (!list.length) return '<div class="empty">موردی نیست</div>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${noUser ? '' : '<th>کاربر</th>'}<th>پلن</th><th>مبلغ</th>${compact ? '' : '<th>تخفیف</th><th>روش</th>'}<th>تاریخ</th><th>وضعیت</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr>${noUser ? '' : `<td class="rowbtn" data-user="${p.user_id}"><b style="font-size:12.5px">${esc(p.profiles?.full_name || p.profiles?.email?.split('@')[0] || '—')}</b><br><small class="ltr" style="color:var(--muted)">${esc(p.profiles?.email || '')}</small>${p.profiles?.phone ? `<br><small class="ltr" style="color:var(--muted)">${esc(p.profiles.phone)}</small>` : ''}</td>`}
      <td>${esc(planTitle(p.plan_id))}</td><td><b>${toman(p.amount)}</b>${p.discount ? `<br><small style="color:var(--muted)"><s>${num(p.base_price)}</s></small>` : ''}</td>
      ${compact ? '' : `<td>${p.discount_code ? `<span class="chip acc">${esc(p.discount_code)}</span>` : '—'}</td><td>${p.method === 'zarinpal' ? 'زرین‌پال' : 'دستی'}</td>`}
      <td>${faShort(p.created_at)}</td><td><span class="chip ${PSTAT[p.status][1]}">${PSTAT[p.status][0]}</span>${p.ref_id ? `<br><small class="ltr" style="color:var(--muted)">${esc(p.ref_id)}</small>` : ''}</td>
      <td>${p.status === 'pending' ? `<div class="inline" style="flex-wrap:nowrap"><button class="btn btn-good btn-xs" data-approve="${p.id}">تأیید و فعال‌سازی</button><button class="btn btn-ghost btn-xs" data-cancel="${p.id}">لغو</button></div>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindPayActions(root, after) {
  root.querySelectorAll('[data-approve]').forEach(b => { b.onclick = async () => {
    const p = S.pays.find(x => x.id === b.dataset.approve);
    const ref = await promptBox('تأیید پرداخت', `${esc(p?.profiles?.email || '')} · ${esc(planTitle(p?.plan_id))} · <b>${toman(p?.amount)}</b><br>اشتراک بلافاصله فعال می‌شود (از پایان اشتراک فعلی).`, 'شماره پیگیری یا یادداشت پرداخت (اختیاری)', 'تأیید و فعال‌سازی');
    if (ref === null) return;
    const { error } = await sb.rpc('activate_payment', { p_payment: b.dataset.approve, p_ref: ref || null });
    if (error) return toast(errFa(error), 'bad'); toast('اشتراک فعال شد', 'good'); after();
  }; });
  root.querySelectorAll('[data-cancel]').forEach(b => { b.onclick = async () => { const { error } = await sb.from('payments').update({ status: 'cancelled' }).eq('id', b.dataset.cancel); if (error) return toast(errFa(error), 'bad'); toast('لغو شد'); after(); }; });
}
function pays() {
  const F = [['pending', 'در انتظار'], ['paid', 'پرداخت‌شده'], ['cancelled', 'لغوشده'], ['all', 'همه']];
  const list = S.pays.filter(p => S.pf === 'all' || p.status === S.pf);
  const paid = S.pays.filter(p => p.status === 'paid');
  const byPlan = S.plans.map(pl => [pl.title, paid.filter(p => p.plan_id === pl.id).length, paid.filter(p => p.plan_id === pl.id).reduce((a, p) => a + p.amount, 0)]);
  $('#main').innerHTML = head('درخواست‌ها و پرداخت‌ها', S.settings.payment_mode === 'zarinpal' ? 'پرداخت آنلاین با زرین‌پال فعال است؛ پرداخت‌های موفق خودکار فعال می‌شوند.' : 'پرداخت دستی: خریدار درخواست ثبت می‌کند، شما پس از دریافت مبلغ «تأیید و فعال‌سازی» را می‌زنید.') + `
    <div class="kpis">${byPlan.map(([t, n, s]) => kpi(t, num(n), toman(s), '', 'tag')).join('')}${kpi('میانگین هر خرید', paid.length ? `${num(paid.reduce((a, p) => a + p.amount, 0) / paid.length / 1e6)}<small>میلیون</small>` : '—', `${paid.length} خرید`, 'acc', 'money')}</div>
    <div class="toolbar"><div class="seg">${F.map(([k, l]) => `<button class="${S.pf === k ? 'on' : ''}" data-pf="${k}">${l}<i>${k === 'all' ? S.pays.length : S.pays.filter(p => p.status === k).length}</i></button>`).join('')}</div></div>
    <div class="card" style="padding:6px 8px">${payTable(list)}</div>`;
  document.querySelectorAll('[data-pf]').forEach(b => { b.onclick = () => { S.pf = b.dataset.pf; pays(); }; });
  bindCommon();
}

// ── plans ──
function plans() {
  const monthly = S.plans.find(p => p.months === 1)?.price;
  $('#main').innerHTML = head('پلن‌ها و قیمت', 'قیمت‌ها به تومان. تغییر قیمت روی خریدهای بعدی اثر دارد؛ اشتراک‌های فعلی دست نمی‌خورند.', `<button class="btn btn-primary btn-sm" data-newplan>${ic('plus')} پلن تازه</button>`) + `
    <div class="plan-ed">${S.plans.map(p => `<form class="card" data-plan="${esc(p.id)}">
      <h3><span>${esc(p.title)} <span class="chip ${p.active ? 'good' : ''}">${p.active ? 'در حال فروش' : 'غیرفعال'}</span></span>
        <span class="chip">${monthly && p.months > 1 ? `ماهی ${num(p.price / p.months)} · ${Math.round((1 - p.price / p.months / monthly) * 100)}٪ ارزان‌تر از ماهانه` : 'پایه مقایسه'}</span></h3>
      <div class="row">
        <div class="field"><label>عنوان</label><input class="inp inp-sm" name="title" value="${esc(p.title)}"></div>
        <div class="field"><label>ماه</label><input class="inp inp-sm ltr" name="months" type="number" min="1" value="${p.months}"></div>
        <div class="field"><label>قیمت (تومان)</label><input class="inp inp-sm ltr" name="price" inputmode="numeric" value="${num(p.price)}"></div>
        <div class="field"><label>قیمت خط‌خورده</label><input class="inp inp-sm ltr" name="compare_price" inputmode="numeric" value="${p.compare_price ? num(p.compare_price) : ''}" placeholder="اختیاری"></div>
        <div class="field"><label>برچسب</label><input class="inp inp-sm" name="badge" value="${esc(p.badge || '')}" placeholder="مثلاً محبوب‌ترین"></div>
      </div>
      <div class="field"><label>ویژگی‌ها (هر خط یکی)</label><textarea class="inp" name="features" style="min-height:90px">${esc((p.features || []).join('\n'))}</textarea></div>
      <div class="inline" style="justify-content:space-between"><div class="inline"><label class="switch"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}>در حال فروش</label>
        <span class="field" style="display:flex;align-items:center;gap:6px"><label style="margin:0">ترتیب</label><input class="inp inp-sm ltr" name="sort" type="number" value="${p.sort}" style="width:70px"></span></div>
        <button class="btn btn-primary btn-sm" type="submit">ذخیره</button></div>
    </form>`).join('')}</div>`;
  const toNum = v => { const n = +String(v || '').replace(/[^\d]/g, ''); return n || null; };
  document.querySelectorAll('form[data-plan]').forEach(f => { f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const row = { title: fd.get('title').trim(), months: +fd.get('months'), price: toNum(fd.get('price')) ?? 0, compare_price: toNum(fd.get('compare_price')),
      badge: fd.get('badge').trim() || null, features: fd.get('features').split('\n').map(s => s.trim()).filter(Boolean), active: !!fd.get('active'), sort: +fd.get('sort') || 0, updated_at: new Date().toISOString() };
    if (!row.title || !(row.months > 0)) return toast('عنوان و تعداد ماه لازم است', 'bad');
    const { error } = await sb.from('plans').update(row).eq('id', f.dataset.plan);
    if (error) return toast(errFa(error), 'bad'); toast('پلن ذخیره شد', 'good'); await load(['plans']); plans();
  }; });
  $('[data-newplan]').onclick = async () => {
    const months = await promptBox('پلن تازه', 'چند ماهه؟ (بعد از ساخت، قیمت و ویژگی‌ها را ویرایش کنید)', 'مثلاً 6', 'ساخت');
    if (!months || !(+months > 0)) return;
    const id = `m${+months}-${Date.now().toString(36).slice(-4)}`;
    const { error } = await sb.from('plans').insert({ id, title: `${+months} ماهه`, months: +months, price: (monthly || 0) * +months, active: false, sort: S.plans.length + 1 });
    if (error) return toast(errFa(error), 'bad'); await load(['plans']); plans();
  };
}

// ── discount codes ──
function codes() {
  $('#main').innerHTML = head('کدهای تخفیف', 'کد عمومی برای کمپین‌ها، یا کد شخصی که فقط برای یک ایمیل کار می‌کند.') + `
    <form class="card" id="cform" style="margin-bottom:16px"><h3>کد تازه</h3><div class="grid-form">
      <div class="field"><label>کد</label><input class="inp inp-sm ltr" id="c_code" placeholder="AUTUMN30" style="text-transform:uppercase" required></div>
      <div class="field"><label>درصد تخفیف</label><input class="inp inp-sm ltr" id="c_pct" type="number" min="0" max="100" placeholder="مثلاً 20"></div>
      <div class="field"><label>یا مبلغ ثابت (تومان)</label><input class="inp inp-sm ltr" id="c_amt" inputmode="numeric" placeholder="اختیاری"></div>
      <div class="field"><label>فقط برای ایمیل</label><input class="inp inp-sm ltr" id="c_email" type="email" placeholder="خالی = همه"></div>
      <div class="field"><label>سقف استفاده</label><input class="inp inp-sm ltr" id="c_max" type="number" min="1" placeholder="خالی = نامحدود"></div>
      <div class="field"><label>اعتبار (روز)</label><input class="inp inp-sm ltr" id="c_days" type="number" min="1" placeholder="خالی = بدون انقضا"></div>
      <div class="field" style="grid-column:span 2"><label>پلن‌ها</label><div class="inline">${S.plans.map(p => `<label class="switch"><input type="checkbox" name="c_plan" value="${esc(p.id)}" checked>${esc(p.title)}</label>`).join('')}</div></div>
      <div class="field" style="grid-column:span 2"><label>یادداشت</label><input class="inp inp-sm" id="c_note" placeholder="مثلاً کمپین پاییز / مشتری آژانس X"></div>
    </div><div class="inline" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost btn-sm" type="button" data-rand>کد تصادفی</button><button class="btn btn-primary btn-sm" type="submit">${ic('plus')} ساخت کد</button></div></form>
    <div class="card" style="padding:6px 8px"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>کد</th><th>تخفیف</th><th>محدودیت</th><th>استفاده</th><th>انقضا</th><th>وضعیت</th><th></th></tr></thead><tbody>
    ${S.codes.map(c => { const expired = c.expires_at && new Date(c.expires_at) < now(); const full = c.max_uses != null && c.used >= c.max_uses; return `<tr>
      <td><b class="ltr">${esc(c.code)}</b>${c.note ? `<br><small style="color:var(--muted)">${esc(c.note)}</small>` : ''}</td>
      <td>${c.percent ? `${c.percent}٪` : ''}${c.percent && c.amount ? ' + ' : ''}${c.amount ? toman(c.amount) : ''}</td>
      <td>${c.email ? `<span class="chip violet">شخصی</span> <small class="ltr">${esc(c.email)}</small>` : '<span class="chip">عمومی</span>'}${c.plan_ids && c.plan_ids.length < S.plans.length ? `<br><small style="color:var(--muted)">${c.plan_ids.map(planTitle).join('، ')}</small>` : ''}</td>
      <td>${c.used}${c.max_uses != null ? ` / ${c.max_uses}` : ''}</td><td>${c.expires_at ? faShort(c.expires_at) : '—'}</td>
      <td>${!c.active ? '<span class="chip">خاموش</span>' : expired ? '<span class="chip warn">منقضی</span>' : full ? '<span class="chip warn">تمام‌شده</span>' : '<span class="chip good"><i></i>فعال</span>'}</td>
      <td><div class="inline" style="flex-wrap:nowrap"><button class="btn btn-ghost btn-xs" data-ctoggle="${esc(c.code)}">${c.active ? 'خاموش' : 'روشن'}</button><button class="btn btn-ghost btn-xs" data-ccopy="${esc(c.code)}">${ic('copy')}</button>${c.used ? '' : `<button class="btn btn-danger btn-xs" data-cdel="${esc(c.code)}">${ic('trash')}</button>`}</div></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">هنوز کدی نساخته‌اید</td></tr>'}
    </tbody></table></div></div>`;
  $('[data-rand]').onclick = () => { $('#c_code').value = 'BB' + Math.random().toString(36).slice(2, 8).toUpperCase(); };
  $('#cform').onsubmit = async e => {
    e.preventDefault();
    const code = $('#c_code').value.trim().toUpperCase().replace(/\s+/g, '');
    const pct = +$('#c_pct').value || null, amt = +String($('#c_amt').value).replace(/[^\d]/g, '') || null;
    if (!code) return toast('کد را بنویسید', 'bad');
    if (!pct && !amt) return toast('درصد یا مبلغ تخفیف را بنویسید', 'bad');
    const planIds = [...document.querySelectorAll('[name=c_plan]:checked')].map(x => x.value);
    const days = +$('#c_days').value;
    const { error } = await sb.from('discount_codes').insert({ code, percent: pct, amount: amt, email: $('#c_email').value.trim().toLowerCase() || null,
      max_uses: +$('#c_max').value || null, expires_at: days ? new Date(now() + days * 864e5).toISOString() : null,
      plan_ids: planIds.length === S.plans.length ? null : planIds, note: $('#c_note').value.trim() || null });
    if (error) return toast(/duplicate/i.test(error.message) ? 'این کد قبلاً ساخته شده' : errFa(error), 'bad');
    toast(`کد ${code} ساخته شد`, 'good'); navigator.clipboard?.writeText(code).catch(() => {}); await load(['codes']); codes();
  };
  document.querySelectorAll('[data-ctoggle]').forEach(b => { b.onclick = async () => { const c = S.codes.find(x => x.code === b.dataset.ctoggle); const { error } = await sb.from('discount_codes').update({ active: !c.active }).eq('code', c.code); if (error) return toast(errFa(error), 'bad'); await load(['codes']); codes(); }; });
  document.querySelectorAll('[data-cdel]').forEach(b => { b.onclick = async () => { const { error } = await sb.from('discount_codes').delete().eq('code', b.dataset.cdel); if (error) return toast(errFa(error), 'bad'); await load(['codes']); codes(); }; });
  document.querySelectorAll('[data-ccopy]').forEach(b => { b.onclick = () => { navigator.clipboard?.writeText(b.dataset.ccopy).then(() => toast('کپی شد'), () => {}); }; });
}

// ── settings ──
function settings() {
  const st = S.settings;
  $('#main').innerHTML = head('تنظیمات') + `<form id="sform" style="display:grid;gap:16px;max-width:760px">
    <div class="card"><h3>دسترسی ثبت‌نام‌های جدید</h3><div class="field"><label>دموی خودکار برای هر ثبت‌نام (روز)</label><input class="inp ltr" id="s_trial" type="number" min="0" value="${+st.auto_trial_days || 0}" style="max-width:140px"><small>0 = خاموش؛ دمو را فقط شما از پنل می‌دهید. مثلاً 3 یعنی هر کس ثبت‌نام کند 3 روز دسترسی رایگان می‌گیرد.</small></div></div>
    <div class="card"><h3>پرداخت</h3>
      <div class="field"><label>روش پرداخت</label><select class="sel" id="s_mode" style="max-width:360px"><option value="manual" ${st.payment_mode !== 'zarinpal' ? 'selected' : ''}>دستی — درخواست خرید و فعال‌سازی توسط مدیر</option><option value="zarinpal" ${st.payment_mode === 'zarinpal' ? 'selected' : ''}>درگاه زرین‌پال (نیاز به راه‌اندازی تابع پرداخت)</option></select>
        <small>زرین‌پال را بعد از خرید دامنه و گرفتن کد درگاه روشن کنید (راهنما: SETUP.md).</small></div>
      <div class="field" style="margin-top:12px"><label>پیام بعد از ثبت درخواست (پرداخت دستی)</label><textarea class="inp" id="s_note">${esc(st.manual_payment_note || '')}</textarea><small>مثلاً شماره کارت، شبا یا شماره تماس برای هماهنگی پرداخت.</small></div>
      <div class="field" style="margin-top:12px"><label>راه ارتباط پشتیبانی</label><input class="inp ltr" id="s_support" value="${esc(st.support_contact || '')}"></div></div>
    <div class="card"><h3>مدیرها</h3><div class="field"><label>ایمیل‌هایی که با اولین ورود مدیر می‌شوند (هر خط یکی)</label><textarea class="inp ltr" id="s_admins" style="text-align:left">${esc((st.admin_emails || []).join('\n'))}</textarea><small>برای کاربری که الان عضو است، از «کاربران» → «مدیر کردن» استفاده کنید.</small></div></div>
    <div><button class="btn btn-primary" type="submit">ذخیره تنظیمات</button></div></form>`;
  $('#sform').onsubmit = async e => {
    e.preventDefault();
    const rows = [
      { key: 'auto_trial_days', value: Math.max(0, +$('#s_trial').value || 0) },
      { key: 'payment_mode', value: $('#s_mode').value },
      { key: 'manual_payment_note', value: $('#s_note').value.trim() },
      { key: 'support_contact', value: $('#s_support').value.trim() },
      { key: 'admin_emails', value: $('#s_admins').value.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean) },
    ];
    const { error } = await sb.from('settings').upsert(rows);
    if (error) return toast(errFa(error), 'bad'); toast('تنظیمات ذخیره شد', 'good'); await load(['settings']);
  };
}

// ── invite / grant by email ──
async function inviteBox() {
  const d = $('#dlg');
  d.innerHTML = `<div class="modal-head"><h3>دسترسی با ایمیل</h3><button class="x-btn" data-x>×</button></div>
    <form class="modal-body" id="ivf"><p style="margin:0;color:var(--text-2);font-size:13px">اگر این ایمیل عضو است، دسترسی فوراً اضافه می‌شود؛ اگر نه، با اولین ورودش (گوگل یا ایمیل) فعال می‌شود.</p>
      <div class="field"><label>ایمیل</label><input class="inp ltr" id="iv_e" type="email" required placeholder="name@company.com"></div>
      <div class="field"><label>دسترسی</label><div class="seg" id="iv_p">${PRESETS.map(([k, t], i) => `<button type="button" data-k="${k}" class="${i === 0 ? 'on' : ''}">${t.replace('+ ', '')}</button>`).join('')}<button type="button" data-k="custom">دلخواه</button></div></div>
      <div class="inline" id="iv_c" hidden><input class="inp inp-sm ltr" id="iv_d" type="number" min="1" placeholder="روز"><select class="sel inp-sm" id="iv_k"><option value="trial">دمو</option><option value="gift">هدیه</option><option value="paid">اشتراک</option></select></div>
      <div class="field"><label>یادداشت</label><input class="inp" id="iv_n" placeholder="اختیاری"></div>
      <button class="btn btn-primary btn-block" type="submit">${ic('gift')} ثبت دسترسی</button></form>`;
  let pick = 'trial7';
  d.querySelectorAll('#iv_p button').forEach(b => { b.onclick = () => { pick = b.dataset.k; d.querySelectorAll('#iv_p button').forEach(x => x.classList.toggle('on', x === b)); $('#iv_c').hidden = pick !== 'custom'; }; });
  d.querySelector('[data-x]').onclick = () => d.close();
  $('#ivf').onsubmit = async e => {
    e.preventDefault();
    let days, kind;
    if (pick === 'custom') { days = +$('#iv_d').value; kind = $('#iv_k').value; } else { [, , days, kind] = PRESETS.find(p => p[0] === pick); }
    if (!(days > 0)) return toast('تعداد روز را بنویسید', 'bad');
    const { data, error } = await sb.rpc('admin_grant_email', { p_email: $('#iv_e').value, p_days: days, p_kind: kind, p_plan: kind === 'paid' ? planFor(days) : null, p_note: $('#iv_n').value.trim() || null });
    if (error) return toast(errFa(error), 'bad');
    d.close(); toast(data.invited ? 'ثبت شد؛ با اولین ورود فعال می‌شود' : 'دسترسی اضافه شد', 'good');
    await load(['users', 'invites']); render();
  };
  d.showModal(); $('#iv_e').focus();
}

// ── small dialogs ──
function confirmBox(title, html, okText) {
  return new Promise(res => {
    const d = $('#dlg');
    d.innerHTML = `<div class="modal-head"><h3>${title}</h3></div><div class="modal-body"><p style="margin:0;color:var(--text-2)">${html}</p><div class="inline" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-n>انصراف</button><button class="btn btn-danger btn-sm" data-y>${okText}</button></div></div>`;
    d.querySelector('[data-n]').onclick = () => { d.close(); res(false); };
    d.querySelector('[data-y]').onclick = () => { d.close(); res(true); };
    d.onclose = () => res(false);
    d.showModal();
  });
}
function promptBox(title, html, ph, okText) {
  return new Promise(res => {
    const d = $('#dlg');
    d.innerHTML = `<div class="modal-head"><h3>${title}</h3></div><form class="modal-body"><p style="margin:0;color:var(--text-2);font-size:13px">${html}</p><input class="inp" placeholder="${esc(ph)}"><div class="inline" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" type="button" data-n>انصراف</button><button class="btn btn-primary btn-sm" type="submit">${okText}</button></div></form>`;
    let done = false;
    d.querySelector('[data-n]').onclick = () => { done = true; d.close(); res(null); };
    d.querySelector('form').onsubmit = e => { e.preventDefault(); done = true; const v = d.querySelector('input').value.trim(); d.close(); res(v); };
    d.onclose = () => { if (!done) res(null); };
    d.showModal(); d.querySelector('input').focus();
  });
}

function bindCommon() {
  const m = $('#main');
  m.querySelectorAll('[data-user]').forEach(el => { el.onclick = e => { if (e.target.closest('[data-approve],[data-cancel]')) return; openUser(el.dataset.user); }; });
  m.querySelectorAll('[data-invite]').forEach(b => { b.onclick = inviteBox; });
  m.querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => { S.uf = b.dataset.goto; go('users'); }; });
  m.querySelectorAll('.card [data-tab]').forEach(b => { b.onclick = () => go(b.dataset.tab); });
  bindPayActions(m, async () => { await load(['users', 'pays', 'codes']); shell(); render(); });
}

async function start() {
  if (!configured) { $('#main').innerHTML = `<div class="alert warn">${ic('alert')}<span>پنل مدیریت بعد از تکمیل اتصال Supabase در <code>js/auth-config.js</code> کار می‌کند (راهنما: SETUP.md).</span></div>`; return; }
  let a;
  try { a = await access(); } catch (e) { $('#main').innerHTML = `<div class="alert bad">${ic('alert')}<span>${esc(errFa(e))}</span></div>`; return; }
  if (!a.signed_in) { location.replace(pageUrl('login.html', { next: here() })); return; }
  if (!a.is_admin) { $('#main').innerHTML = `<div class="alert bad">${ic('lock')}<span>این صفحه فقط برای مدیرهاست. <a href="${pageUrl('index.html')}">برگشت به نقشه</a></span></div>`; return; }
  S.me = a;
  try { await load(); } catch (e) { $('#main').innerHTML = `<div class="alert bad">${ic('alert')}<span>${esc(errFa(e))}<br>اگر تازه راه‌اندازی کرده‌اید، مطمئن شوید فایل supabase/schema.sql را در SQL Editor اجرا کرده‌اید.</span></div>`; return; }
  if (!TABS.some(t => t[0] === S.tab)) S.tab = 'dash';
  shell(); render();
  $('#shade').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}
start();
