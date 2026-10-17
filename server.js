'use strict';
// Streax, local server. No dependencies. Needs Node.js 18 or newer; accounts and the on-chain monitor need 22.5 or newer.
// Serves the boards from ./public, live data from /api/real, the on-chain monitor and member accounts.

const http = require('http');
const fs = require('fs');
const path = require('path');

const onchainApi = require('./onchain/api');
const accountsApi = require('./accounts/api');
const contentApi = require('./content/api');
const trustApi = require('./trust/api');
const { baseUrl } = require('./accounts/http');
let ONCHAIN = null; // on-chain monitor state, started once the server listens
let ACCOUNTS = null; // accounts state (sign-up, login, member perks)
let CONTENT = null; // articles (Studio and /articles pages)
let TRUST = null; // complaints, payout reports, casino reviews and the Streax Score

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const CACHE_MS = 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// Circulating supply snapshot (CoinGecko, 11 Oct 2026). Used for market cap only if CoinGecko is unreachable.
const TOKENS = [
  { sym: 'SHFL', id: 'shuffle-2', supply: 237187720 / 0.4837 },
  { sym: 'BC', id: 'bc-token', supply: 119445863 / 0.0372 },
  { sym: 'RLB', id: 'rollbit-coin', supply: 119113038 / 0.07646 },
  { sym: 'FUN', id: 'funfair', supply: 96466803 / 0.00877 },
  { sym: 'DESU', id: 'dexsport', supply: 12011501 / 0.02184 },
  { sym: 'TGC', id: 'tg-casino', supply: 11484731 / 0.1509 },
  { sym: 'BFG', id: 'bfg-token', supply: 9752192 / 0.004155 },
  { sym: 'SCS', id: 'solcasino-token', supply: 5053668 / 0.001647 },
  { sym: 'WINR', id: 'winr-protocol', supply: 2246775 / 0.002573 }
];
// DefiLlama keys for the market strip. SOL, BNB and TRX use their wrapped tokens, which DefiLlama prices continuously.
const MARKET = [
  { sym: 'BTC', key: 'coingecko:bitcoin' }, { sym: 'ETH', key: 'coingecko:ethereum' },
  { sym: 'SOL', key: 'solana:So11111111111111111111111111111111111111112' },
  { sym: 'BNB', key: 'bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  { sym: 'TRX', key: 'tron:TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR' }
];
const LOGO_DIR = path.join(PUBLIC, 'assets', 'logos', 'casinos');
const LOGO_EXT = ['.png', '.webp', '.svg', '.jpg', '.jpeg'];

// Casino logo files you add yourself: public/assets/logos/casinos/<domain>.png, for example stake.com.png
function casinoLogos() {
  const out = {};
  try {
    fs.readdirSync(LOGO_DIR).forEach(f => {
      const ext = path.extname(f).toLowerCase();
      if (LOGO_EXT.includes(ext)) out[f.slice(0, -ext.length).toLowerCase()] = 'assets/logos/casinos/' + encodeURIComponent(f);
    });
  } catch (e) { /* folder missing: no custom logos */ }
  return out;
}
const CREATORS = ['westcol', 'adinross', 'trainwreckstv', 'roshtein', 'stevewilldoit', 'classybeef', 'xposed', 'ayezee', 'yassuo', 'cabrzy', 'bigfoltz', 'haddzy', 'casinodaddy', 'mitchjones'];
const WALLETS = [
  { casino: 'Stake.com', addr: '0x974CaA59e49682CdA0AD2bbe82983419A2ECC400' },
  { casino: 'Rollbit', addr: '0x8ae57a027c63fca8070d1bf38622321de8004c67' }
];
const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'];

async function getJSON(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      body: opts.body,
      signal: ctl.signal,
      headers: Object.assign({ accept: 'application/json', 'user-agent': UA }, opts.headers || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function getKick(slug) {
  const j = await getJSON('https://kick.com/api/v2/channels/' + slug, {
    headers: { 'accept-language': 'en-US,en;q=0.9', referer: 'https://kick.com/' + slug }
  });
  const ls = j.livestream && (j.livestream.is_live !== false) ? j.livestream : null;
  const followers = Number(j.followers_count != null ? j.followers_count : j.followersCount);
  if (!Number.isFinite(followers)) throw new Error('no follower count');
  const cats = Array.isArray(j.recent_categories) ? j.recent_categories.map(c => c && c.name).filter(Boolean).slice(0, 5) : [];
  let since = '';
  if (ls && ls.start_time) {
    const t = Date.parse(String(ls.start_time).replace(' ', 'T') + 'Z');
    if (Number.isFinite(t)) since = shortDate(t);
  }
  return [
    (j.user && j.user.username) || slug, slug, followers, !!j.verified, !!ls,
    ls ? Number(ls.viewer_count) || 0 : 0, ls ? String(ls.session_title || '').slice(0, 90) : '', since,
    cats.length ? cats : ['Slots & Casino']
  ];
}

async function getEthBalance(addr) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] });
  let lastErr;
  for (const url of RPCS) {
    try {
      const j = await getJSON(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } }, 8000);
      if (j && typeof j.result === 'string') return Number(BigInt(j.result)) / 1e18;
      lastErr = new Error('bad RPC reply');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no RPC reachable');
}

async function buildLive() {
  const llama = 'https://coins.llama.fi';
  const tokKeys = TOKENS.map(t => 'coingecko:' + t.id);
  const allKeys = tokKeys.concat(MARKET.map(m => m.key)).join(',');
  const errors = [];
  const [prices, p24, p7, chart, cg, kick] = await Promise.allSettled([
    getJSON(llama + '/prices/current/' + allKeys),
    getJSON(llama + '/percentage/' + allKeys + '?period=24h'),
    getJSON(llama + '/percentage/' + allKeys + '?period=7d'),
    getJSON(llama + '/chart/' + tokKeys.join(',') + '?span=30&period=1d'),
    getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + TOKENS.map(t => t.id).join(',')),
    Promise.allSettled(CREATORS.map(getKick))
  ]);
  const ok = r => r.status === 'fulfilled' && r.value;
  [['DefiLlama prices', prices], ['DefiLlama 24h', p24], ['DefiLlama 7d', p7], ['DefiLlama chart', chart], ['CoinGecko markets', cg]]
    .forEach(([n, r]) => { if (r.status === 'rejected') errors.push(n + ': ' + r.reason.message); });

  const out = { meta: { updatedAt: Date.now(), errors } };
  const P = ok(prices) ? prices.value.coins || {} : {};
  const C24 = ok(p24) ? p24.value.coins || {} : {};
  const C7 = ok(p7) ? p7.value.coins || {} : {};

  const fresh = p => p && typeof p.price === 'number' && (!p.timestamp || p.timestamp * 1000 > Date.now() - 36 * 3600 * 1000);
  const market = MARKET.map(m => {
    const k = m.key;
    return fresh(P[k]) && typeof C24[k] === 'number' ? { sym: m.sym, price: P[k].price, ch: C24[k] } : null;
  });
  if (market.every(Boolean)) out.market = market;

  const cgById = {};
  if (ok(cg) && Array.isArray(cg.value)) cg.value.forEach(c => { cgById[c.id] = c; });
  const CH = ok(chart) ? chart.value.coins || {} : {};
  const tokens = [];
  TOKENS.forEach(t => {
    const k = 'coingecko:' + t.id, p = P[k];
    if (!p || typeof p.price !== 'number') return;
    const row = { sym: t.sym, price: p.price };
    if (typeof C24[k] === 'number') row.ch24 = C24[k];
    if (typeof C7[k] === 'number') row.ch7 = C7[k];
    const c = cgById[t.id];
    if (c && c.market_cap > 0) { row.mcap = c.market_cap; row.mcapLive = true; } else { row.mcap = t.supply * p.price; row.mcapLive = false; }
    if (c && c.total_volume >= 0) row.vol = c.total_volume;
    const series = CH[k] && Array.isArray(CH[k].prices) ? CH[k].prices : [];
    if (series.length >= 2) {
      row.h = series.map(s => s.price);
      row.ts = series.map(s => s.timestamp * 1000);
      row.h[row.h.length - 1] = p.price;
    }
    tokens.push(row);
  });
  if (tokens.length) out.tokens = tokens;

  if (ok(kick)) {
    const rows = [];
    kick.value.forEach((r, i) => {
      if (r.status === 'fulfilled') rows.push(r.value);
      else errors.push('Kick ' + CREATORS[i] + ': ' + r.reason.message);
    });
    if (rows.length) out.creators = rows;
  }

  const ethPrice = P['coingecko:ethereum'] ? P['coingecko:ethereum'].price : null;
  const wallets = await Promise.allSettled(WALLETS.map(w => getEthBalance(w.addr)));
  const wl = [];
  wallets.forEach((r, i) => {
    if (r.status === 'fulfilled') wl.push({ casino: WALLETS[i].casino, ethNum: r.value, ethUsdNum: ethPrice ? r.value * ethPrice : null });
    else errors.push('ETH RPC ' + WALLETS[i].casino + ': ' + r.reason.message);
  });
  if (wl.length) out.wallets = wl;
  return out;
}

let cache = null, cacheAt = 0, inflight = null;
async function live() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = buildLive()
      .then(d => { cache = d; cacheAt = Date.now(); return d; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
};

const SITE = { publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''), port: PORT };
// What a server-rendered page needs to know about the visitor: site address, light or night, and who is logged in.
function pageCtx(req) {
  let user = null;
  if (ACCOUNTS) {
    const u = accountsApi.userFromReq(ACCOUNTS, req);
    if (u) user = { id: u.id, name: u.name || u.email.split('@')[0], initials: (String(u.name || u.email).trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || 'S').toUpperCase() };
  }
  return { base: baseUrl(SITE, req), night: /(?:^|;\s*)sx_theme=night(?:;|$)/.test(req.headers.cookie || ''), user };
}

const zlib = require('zlib');
// Text responses (pages, scripts, JSON, feeds) are compressed with Brotli or gzip when the browser accepts it.
// Pages are 100 to 150 KB of markup and shrink to about a fifth. Every handler ends with writeHead + end, so wrapping
// those two covers the whole site without touching the handlers.
const COMPRESS = /^(text\/|application\/(json|javascript|xml|rss\+xml)|image\/svg\+xml)/;
function compression(req, res) {
  const ae = String(req.headers['accept-encoding'] || '');
  const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
  if (!enc || req.method === 'HEAD') return;
  const writeHead = res.writeHead.bind(res), end = res.end.bind(res);
  let held = null;
  res.writeHead = (code, a, b) => { held = [code, typeof a === 'string' ? b : a, typeof a === 'string' ? a : undefined]; return res; };
  res.end = (body, ...rest) => {
    if (!held) return end(body, ...rest);
    const [code, headers = {}, reason] = held;
    held = null;
    const type = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
    const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (!buf || buf.length < 1024 || code === 304 || code === 204 || !COMPRESS.test(type) || headers['content-encoding']) {
      return reason ? writeHead(code, reason, headers) && end(body, ...rest) : (writeHead(code, headers), end(body, ...rest));
    }
    const out = enc === 'br' ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(buf, { level: 6 });
    const h = Object.assign({}, headers, { 'content-encoding': enc, 'content-length': out.length, vary: 'Accept-Encoding' });
    delete h['Content-Length'];
    writeHead(code, h);
    return end(out);
  };
}

// Static files: pages always revalidate (cheap with ETag), images and fonts are cached for a day and refreshed in the background.
function cacheHeaders(file, stat) {
  const etag = 'W/"' + stat.size.toString(36) + '-' + Math.floor(stat.mtimeMs).toString(36) + '"';
  const page = /\.(html|js|css|json)$/i.test(file);
  return { etag, 'cache-control': page ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800', 'last-modified': stat.mtime.toUTCString() };
}

const server = http.createServer(async (req, res) => {
  compression(req, res);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (url.pathname.startsWith('/api/onchain')) { await onchainApi.handle(ONCHAIN, req, res, url); return; }
  if (await accountsApi.handle(ACCOUNTS, req, res, url)) return;
  if (await contentApi.handle(CONTENT, req, res, url, pageCtx)) return;
  if (await trustApi.handle(TRUST, req, res, url, pageCtx)) return;
  // Short addresses: /login, /signup, /account and referral links /r/CODE
  const short = { '/login': '/Login.dc.html', '/signup': '/Signup.dc.html', '/join': '/Signup.dc.html', '/account': '/Account.dc.html' }[url.pathname.replace(/\/+$/, '')];
  if (short) { res.writeHead(302, { location: short + url.search, 'cache-control': 'no-store' }); res.end(); return; }
  const refLink = /^\/r\/([A-Za-z0-9]{4,12})$/.exec(url.pathname);
  if (refLink) { res.writeHead(302, { location: '/Signup.dc.html?ref=' + refLink[1].toUpperCase(), 'cache-control': 'no-store' }); res.end(); return; }
  // The account page needs a login; the login and sign-up pages send members straight to their account.
  if (ACCOUNTS && /^\/(night\/)?Account\.dc\.html$/.test(url.pathname) && !accountsApi.userFromReq(ACCOUNTS, req)) {
    res.writeHead(302, { location: '/Login.dc.html?next=' + encodeURIComponent('/Account.dc.html' + url.search), 'cache-control': 'no-store' }); res.end(); return;
  }
  if (ACCOUNTS && /^\/(night\/)?(Login|Signup)\.dc\.html$/.test(url.pathname) && !url.searchParams.get('reset') && accountsApi.userFromReq(ACCOUNTS, req)) {
    const next = url.searchParams.get('next') || '';
    const dest = /^\/[A-Za-z0-9._~\/-]*(\?[A-Za-z0-9._~=&%-]*)?$/.test(next) && !next.startsWith('//') ? next : '/Account.dc.html';
    res.writeHead(302, { location: dest, 'cache-control': 'no-store' }); res.end(); return;
  }
  if (url.pathname === '/api/real') {
    try {
      const data = Object.assign({}, await live(), { casinoLogos: casinoLogos() });
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'content-type': TYPES['.json'] });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }
  // Light or night: the choice is kept in a cookie and the same address serves the matching version.
  if (url.pathname === '/theme/night' || url.pathname === '/theme/light') {
    const mode = url.pathname.slice(7);
    let back = '/';
    try { const r = new URL(req.headers.referer || ''); if (r.host === req.headers.host) back = r.pathname + r.search + r.hash; } catch (e) { /* no referer */ }
    res.writeHead(302, { 'set-cookie': 'sx_theme=' + mode + '; Path=/; Max-Age=31536000; SameSite=Lax', location: back, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const night = /(?:^|;\s*)sx_theme=night(?:;|$)/.test(req.headers.cookie || '');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  if (rel === '/') rel = '/Home.dc.html';
  if (night && rel.endsWith('.dc.html') && !rel.startsWith('/night/') && fs.existsSync(path.join(PUBLIC, 'night', rel))) rel = '/night' + rel;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (serr, stat) => {
  if (serr || !stat.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  const ch = cacheHeaders(file, stat);
  if (req.headers['if-none-match'] === ch.etag) { res.writeHead(304, ch); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    let body = buf;
    if (file.endsWith('.dc.html')) {
      // Wrap the board template in an inert <template> so the browser does not render or parse it as live markup.
      body = buf.toString('utf8').replace('<x-dc>', '<template id="dc-tpl"><x-dc>').replace('</x-dc>', '</x-dc></template>');
    }
    res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }, ch));
    res.end(body);
  });
  });
});

const FIXED_PORT = !!process.env.PORT;
let port = PORT;

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  exec(cmd, () => {});
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE' && !FIXED_PORT && port < PORT + 20) {
    console.log('  Port ' + port + ' is busy, trying ' + (port + 1) + '...');
    port += 1;
    setTimeout(() => server.listen(port), 150);
    return;
  }
  if (err.code === 'EADDRINUSE') console.log('\n  Port ' + port + ' is already in use. Close the other program or pick another port.\n');
  else if (err.code === 'EACCES') console.log('\n  Your system blocked port ' + port + '. Try another port, for example 4000.\n');
  else console.log('\n  Server error: ' + err.message + '\n');
  process.exit(1);
});

server.on('listening', () => {
  const url = 'http://localhost:' + port;
  console.log('');
  console.log('  Streax is running');
  console.log('  Open ' + url + ' in your browser (it should open by itself)');
  console.log('  Live data: ' + url + '/api/real');
  console.log('  Keep this window open. Press Ctrl+C to stop.');
  console.log('');
  if (typeof fetch !== 'function') console.log('  Your Node.js is older than version 18, so live data is off. Install the LTS version from https://nodejs.org\n');
  openBrowser(url);
  try { ONCHAIN = require('./onchain').start(process.env, m => console.log('  ' + m)); } catch (e) { console.log('  On-chain monitor failed to start: ' + e.message); }
  try {
    ACCOUNTS = require('./accounts').start(process.env, m => console.log('  ' + m), ONCHAIN);
    if (ACCOUNTS && ONCHAIN) ONCHAIN.viewer = r => accountsApi.userFromReq(ACCOUNTS, r);
  } catch (e) { console.log('  Accounts failed to start: ' + e.message); }
  try { CONTENT = require('./content').start(process.env, m => console.log('  ' + m)); } catch (e) { console.log('  Articles failed to start: ' + e.message); }
  try { TRUST = require('./trust').start(process.env, m => console.log('  ' + m), { onchain: ONCHAIN, accounts: ACCOUNTS, content: CONTENT }); } catch (e) { console.log('  Complaints and scores failed to start: ' + e.message); }
  live().then(d => {
    const parts = ['market', 'tokens', 'creators', 'wallets'].map(k => k + (d[k] ? ' live' : ' snapshot'));
    console.log('  First data pull: ' + parts.join(', '));
    if (d.meta.errors.length) console.log('  Not reachable: ' + d.meta.errors.join(' | '));
  }).catch(e => console.log('  First data pull failed: ' + e.message));
});

process.on('uncaughtException', e => console.log('  Error (server keeps running): ' + e.message));
process.on('unhandledRejection', e => console.log('  Error (server keeps running): ' + (e && e.message ? e.message : e)));

server.listen(port);
