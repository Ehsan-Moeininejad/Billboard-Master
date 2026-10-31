// پرداخت آنلاین زرین‌پال برای بیلبوردسنج (Supabase Edge Function).
// فعلاً لازم نیست؛ بعد از خرید دامنه و گرفتن کد درگاه (merchant id) راه‌اندازی کنید (SETUP.md).
//
// دو کار انجام می‌دهد:
//   POST  { payment_id }         ← از صفحه اشتراک، با ورود کاربر → آدرس درگاه را برمی‌گرداند
//   GET   ?Authority=..&Status=.. ← زرین‌پال بعد از پرداخت کاربر را اینجا می‌فرستد → تأیید، فعال‌سازی و برگشت به سایت
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ZARINPAL_MERCHANT  کد 36 حرفی درگاه
//   SITE_URL           آدرس سایت، مثل https://ehsan-moeininejad.github.io/Billboard-Master/
//   ZARINPAL_SANDBOX   "1" برای آزمایش با درگاه تست (اختیاری)
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY را خود Supabase می‌گذارد.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MERCHANT = Deno.env.get('ZARINPAL_MERCHANT') ?? '';
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/?$/, '/');
const ZP = Deno.env.get('ZARINPAL_SANDBOX') === '1' ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const back = (q: string) => Response.redirect(`${SITE}pricing.html?${q}`, 303);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!MERCHANT || !SITE) return json({ error: 'درگاه هنوز تنظیم نشده (ZARINPAL_MERCHANT / SITE_URL)' }, 500);
  const url = new URL(req.url);

  // ── 1) start a payment ──
  if (req.method === 'POST') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'ابتدا وارد شوید' }, 401);
    const { payment_id } = await req.json().catch(() => ({}));
    const { data: pay } = await admin.from('payments').select('*').eq('id', payment_id).eq('user_id', u.user.id).single();
    if (!pay || pay.status !== 'pending') return json({ error: 'درخواست پرداخت پیدا نشد' }, 404);
    const r = await fetch(`${ZP}/pg/v4/payment/request.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant_id: MERCHANT, amount: pay.amount * 10, currency: 'IRR', // تومان → ریال
        description: `اشتراک بیلبوردسنج (${pay.plan_id})`,
        callback_url: `${SB_URL}/functions/v1/zarinpal`,
        metadata: { email: u.user.email ?? undefined, order_id: pay.id },
      }),
    }).then(x => x.json()).catch(() => null);
    const auth = r?.data?.authority;
    if (r?.data?.code !== 100 || !auth) return json({ error: `خطای درگاه: ${r?.errors?.message ?? r?.errors?.code ?? 'نامشخص'}` }, 502);
    await admin.from('payments').update({ method: 'zarinpal', authority: auth }).eq('id', pay.id);
    return json({ url: `${ZP}/pg/StartPay/${auth}` });
  }

  // ── 2) back from the gateway ──
  const authority = url.searchParams.get('Authority');
  if (!authority) return back('paid=0');
  const { data: pay } = await admin.from('payments').select('*').eq('authority', authority).single();
  if (!pay) return back('paid=0');
  if (pay.status === 'paid') return back('paid=1');
  if (url.searchParams.get('Status') !== 'OK') { await admin.from('payments').update({ status: 'failed' }).eq('id', pay.id); return back('paid=0'); }
  const v = await fetch(`${ZP}/pg/v4/payment/verify.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ merchant_id: MERCHANT, amount: pay.amount * 10, authority }),
  }).then(x => x.json()).catch(() => null);
  const code = v?.data?.code;
  if (code !== 100 && code !== 101) { await admin.from('payments').update({ status: 'failed', note: `verify ${code ?? v?.errors?.code ?? '?'}` }).eq('id', pay.id); return back('paid=0'); }
  const { error } = await admin.rpc('activate_payment', { p_payment: pay.id, p_ref: String(v.data.ref_id ?? '') });
  if (error) return back('paid=0&err=activate');
  return back(`paid=1&ref=${encodeURIComponent(v.data.ref_id ?? '')}`);
});
