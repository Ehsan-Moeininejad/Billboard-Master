// Account, subscription and access — shared by the app, login, pricing and admin pages.
// Needs vendor/supabase/supabase.js loaded first (window.supabase). With no config it reports "open access".
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './auth-config.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'billboard-insight:auth' } })
  : null;

// ── pages ──
const base = () => new URL('.', location.href);
export const pageUrl = (p, params) => { const u = new URL(p, base()); if (params) Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v)); return u.href; };
/** where to go after logging in (only pages of this site) */
export function nextUrl(fallback = 'index.html') {
  const n = new URLSearchParams(location.search).get('next');
  try { const u = new URL(n, base()); if (u.origin === location.origin) return u.href; } catch { /* bad */ }
  return pageUrl(fallback);
}
export const here = () => location.pathname.split('/').pop() + location.search + location.hash;

// ── session & access ──
export async function session() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}
/** {signed_in, active, is_admin, blocked, kind, plan_id, ends_at, email, name, avatar} */
export async function access() {
  if (!sb) return { open: true, signed_in: false, active: true };
  const s = await session();
  if (!s) return { signed_in: false, active: false };
  const { data, error } = await sb.rpc('my_access');
  if (error) throw error;
  const meta = s.user.user_metadata || {};
  return { ...data, name: data.name || meta.full_name || meta.name || '', avatar: data.avatar || meta.avatar_url || meta.picture || '', user: s.user };
}
export async function signOut() { if (sb) await sb.auth.signOut(); location.href = pageUrl('login.html'); }

// ── formatting ──
const nf = new Intl.NumberFormat('en-US');
export const toman = v => (v == null ? '—' : `${nf.format(Math.round(v))} تومان`);
export const num = v => (v == null ? '—' : nf.format(Math.round(v)));
const dfmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
const dshort = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' });
export const faDate = d => (d ? dfmt.format(new Date(d)) : '—');
export const faShort = d => (d ? dshort.format(new Date(d)) : '—');
export const daysLeft = d => (d ? Math.max(0, Math.ceil((new Date(d) - Date.now()) / 864e5)) : 0);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const KIND_FA = { paid: 'اشتراک', trial: 'دمو', gift: 'هدیه' };
export function initials(name, email) {
  const t = (name || email || '?').trim();
  const parts = t.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : t.slice(0, 2)).toUpperCase();
}
export const avatarHTML = (a, cls = 'av') => a.avatar
  ? `<img class="${cls}" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="${cls}">${esc(initials(a.name, a.email))}</span>`;

/** Supabase error → Persian sentence */
export function errFa(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'ایمیل یا رمز عبور درست نیست.';
  if (/Email not confirmed/i.test(m)) return 'ایمیل هنوز تأیید نشده؛ لینک تأیید را در صندوق ایمیل باز کنید.';
  if (/already registered|already exists/i.test(m)) return 'این ایمیل قبلاً ثبت‌نام کرده؛ از «ورود» استفاده کنید.';
  if (/Password should be at least/i.test(m)) return 'رمز عبور باید حداقل 6 کاراکتر باشد.';
  if (/rate limit|too many/i.test(m)) return 'تعداد درخواست زیاد بود؛ چند دقیقه دیگر دوباره امتحان کنید.';
  if (/provider is not enabled|Unsupported provider/i.test(m)) return 'ورود با گوگل هنوز در Supabase فعال نشده.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'اتصال به سرور برقرار نشد؛ اینترنت یا VPN را بررسی کنید.';
  if (/invalid.*email|Unable to validate email/i.test(m)) return 'ایمیل معتبر نیست.';
  return m || 'خطای ناشناخته';
}

export function toast(msg, type = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
}
