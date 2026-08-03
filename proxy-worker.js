/* ══════════════════════════════════════════════════════════════════
   proxy-worker.js — 东财数据代理（解锁主力资金流）
   部署步骤（全程网页操作，约5分钟，免费）：
     1. 打开 https://dash.cloudflare.com 注册/登录（支持邮箱注册）
     2. 左侧 Workers & Pages → Create → Create Worker → 起个名 → Deploy
     3. 点 Edit code，清空默认代码，粘贴本文件全部内容 → Deploy
     4. 回到 Overview 拿到地址，形如 https://xxx.yyy.workers.dev
     5. 在 ETFBoard ⚙️设置 的「东财代理地址」填入：
          https://xxx.yyy.workers.dev/?u=
        （注意末尾保留 ?u= ）
   安全说明：仅放行东方财富三个域名，不会被当开放代理滥用。
   免费额度：100,000 请求/天，本应用每天约几百次，绰绰有余。
   ══════════════════════════════════════════════════════════════════ */

const ALLOW_HOSTS = [
  'push2.eastmoney.com',        // 实时行情/资金流
  'push2his.eastmoney.com',     // 历史资金流（备用）
  'datacenter-web.eastmoney.com' // 数据中心：融资融券/龙虎榜（备用）
];

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    const url = new URL(request.url);
    const u = url.searchParams.get('u');
    if (!u) {
      return json({ error: 'missing param: u（目标URL需encodeURIComponent）' }, 400);
    }
    let target;
    try { target = new URL(u); } catch {
      return json({ error: 'invalid url' }, 400);
    }
    if (!ALLOW_HOSTS.includes(target.hostname)) {
      return json({ error: 'host not allowed: ' + target.hostname }, 403);
    }
    try {
      const resp = await fetch(target.toString(), {
        headers: {
          // 东财WAF校验Referer，必须伪装成东财页面来源
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
      });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          ...cors(),
          'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
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
    'Access-Control-Allow-Headers': '*',
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
