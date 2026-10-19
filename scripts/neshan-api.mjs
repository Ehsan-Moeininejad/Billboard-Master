// Small Neshan client for the data scripts (key from the NESHAN_KEY repository secret).
// Counts calls, stops cleanly on a quota / disabled-service answer, and never prints the key.
export const QUOTA = [401, 402, 403, 429, 470, 480, 481, 482, 483, 484, 485];
// Neshan's own error codes, in words for the weekly email
const WHY = {
  480: 'کلید پیدا نشد', 481: 'سهمیه کلید تمام شده', 482: 'تعداد درخواست در دقیقه بیش از حد', 483: 'نوع کلید اشتباه است (باید کلید «سرویس‌ها» باشد، نه «وب»)',
  484: 'محدودیت دامنه/IP روی کلید', 485: 'این سرویس روی کلید فعال نیست', 429: 'تعداد درخواست بیش از حد', 403: 'دسترسی رد شد', 401: 'کلید نامعتبر',
};

export function neshanClient(key, maxCalls) {
  const st = { calls: 0, stop: '', max: maxCalls };
  async function get(path) {
    if (st.stop) return null;
    if (st.calls >= st.max) { st.stop = 'budget'; return null; }
    st.calls++;
    await new Promise(r => setTimeout(r, 150)); // gentle pace
    for (let t = 0; t < 2; t++) {
      try {
        const r = await fetch('https://api.neshan.org' + path, { headers: { 'Api-Key': key }, signal: AbortSignal.timeout(15000) });
        if (QUOTA.includes(r.status)) {
          let msg = ''; try { msg = (await r.text()).slice(0, 160); } catch { /* none */ }
          st.stop = `${WHY[r.status] || 'خطای نشان'} (HTTP ${r.status})`;
          console.warn('neshan:', path.split('?')[0], st.stop, msg.replace(/\s+/g, ' '));
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { if (t) { console.warn('neshan:', path.split('?')[0], e.message); return null; } await new Promise(r => setTimeout(r, 1500)); }
    }
    return null;
  }
  return { get, st };
}

// Persian digits → Latin
export const latin = s => String(s ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
