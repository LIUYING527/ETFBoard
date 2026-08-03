// proxy-worker.js - EastMoney data proxy (unlocks main-capital flow)
// Deploy (about 5 min, free, all in browser):
//   1. Open https://dash.cloudflare.com and sign up / log in
//   2. Left sidebar: Workers & Pages -> Create -> Create Worker
//      -> pick a name -> Deploy
//   3. Click "Edit code", delete all default code,
//      paste this whole file -> Deploy
//   4. Back on Overview, copy your worker URL, like
//      https://xxx.yyy.workers.dev
//   5. In ETFBoard settings, set "EastMoney proxy URL" to:
//      https://xxx.yyy.workers.dev/?u=
//      (keep the trailing ?u=)
// Security: only 3 eastmoney hosts are allowed, so this worker
// cannot be abused as an open proxy.
// Free tier: 100,000 requests/day; this app uses a few hundred.

const ALLOW_HOSTS = [
  'push2delay.eastmoney.com',    // delayed quotes / capital flow (push2 mirror)
  'push2.eastmoney.com',         // realtime quotes / capital flow
  'push2his.eastmoney.com',      // historical capital flow (spare)
  'datacenter-web.eastmoney.com' // data center: margin etc (spare)
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0 Safari/537.36';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    const url = new URL(request.url);
    const u = url.searchParams.get('u');
    if (!u) {
      return json({ error: 'missing param: u (target URL, encoded)' }, 400);
    }
    let target;
    try { target = new URL(u); } catch {
      return json({ error: 'invalid url' }, 400);
    }
    if (!ALLOW_HOSTS.includes(target.hostname)) {
      return json({ error: 'host not allowed: ' + target.hostname }, 403);
    }
    try {
      // EastMoney WAF checks Referer; must look like a quote page visit
      const resp = await fetch(target.toString(), {
        headers: { 'Referer': 'https://quote.eastmoney.com/', 'User-Agent': UA }
      });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          ...cors(),
          'Content-Type': resp.headers.get('Content-Type') ||
            'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    } catch (e) {
      return json({ error: 'upstream failed: ' + e.message }, 502);
    }
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
