// Header of the account pages: logo, links, account menu.
import { pageUrl, esc, avatarHTML, signOut } from './auth.js';
import { ic, logoHTML } from './site-icons.js';

export function renderTop(el, a, active = '') {
  const links = [['index.html', 'نقشه و تحلیل', 'map'], ['pricing.html', 'اشتراک', 'pricing']];
  if (a?.is_admin) links.push(['admin.html', 'پنل مدیریت', 'admin']);
  el.innerHTML = `${logoHTML(pageUrl('index.html'))}
    <nav class="top-nav">${links.map(([h, l, k]) => `<a href="${pageUrl(h)}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <span class="top-sp"></span>
    ${a?.signed_in ? `<div class="me"><button class="me-btn" aria-haspopup="true"><small class="ltr">${esc(a.email || '')}</small>${avatarHTML(a, 'uav')}</button>
      <div class="me-pop" hidden>
        ${links.map(([h, l]) => `<a href="${pageUrl(h)}">${l}</a>`).join('')}
        <button class="out" data-out>${'خروج از حساب'}</button>
      </div></div>`
    : `<a class="btn btn-ghost btn-sm" href="${pageUrl('login.html', { next: location.pathname.split('/').pop() + location.search })}">ورود</a><a class="btn btn-primary btn-sm" href="${pageUrl('login.html', { mode: 'signup', next: location.pathname.split('/').pop() + location.search })}">ثبت‌نام</a>`}`;
  const me = el.querySelector('.me');
  if (me) {
    const pop = me.querySelector('.me-pop');
    me.querySelector('.me-btn').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; };
    document.addEventListener('click', e => { if (!me.contains(e.target)) pop.hidden = true; });
    me.querySelector('[data-out]').onclick = signOut;
  }
}
export { ic };
