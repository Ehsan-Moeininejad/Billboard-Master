// Optional Cloudflare Worker proxy for Neshan APIs (free tier is enough).
//
// Why: if the browser blocks direct calls to api.neshan.org (CORS), or you don't want the
// API key to live in each marketer's browser, deploy this worker and put its URL in
// «تنظیمات ← آدرس پروکسی». If you store the key as a Worker secret (NESHAN_KEY),
// type any placeholder (e.g. "proxy") in the app's key field — the worker replaces it.
//
// Deploy:  npx wrangler deploy proxy/cloudflare-worker.js --name billboard-neshan-proxy
// Secrets: npx wrangler secret put NESHAN_KEY        (optional)
//          npx wrangler secret put ALLOWED_ORIGIN    (e.g. https://your-user.github.io)

const UPSTREAM = 'https://api.neshan.org';
const ALLOWED_PATHS = [/^\/navigation\/traffic\/analytics\//, /^\/v1\/direction\//, /^\/v4\/direction/, /^\/v1\/search/, /^\/v5\/reverse/];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allow = env.ALLOWED_ORIGIN ? (origin === env.ALLOWED_ORIGIN ? origin : '') : '*';
    const cors = {
      'Access-Control-Allow-Origin': allow || 'null',
      'Access-Control-Allow-Headers': 'Api-Key, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allow) return new Response('origin not allowed', { status: 403, headers: cors });

    const url = new URL(req.url);
    if (!ALLOWED_PATHS.some(rx => rx.test(url.pathname))) return new Response('path not allowed', { status: 404, headers: cors });

    const key = env.NESHAN_KEY || req.headers.get('Api-Key') || '';
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, { headers: { 'Api-Key': key } });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=900' },
    });
  },
};
