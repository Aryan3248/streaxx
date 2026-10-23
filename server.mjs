// Streax as one Node server, for Render (or any Node host).
// Serves the static pages, the same API as the Netlify functions, and runs the
// on-chain monitor every few minutes. Data is kept as files in STREAX_LOCAL_STORE,
// which on Render should be a persistent disk.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.env.STREAX_LOCAL_STORE = process.env.STREAX_LOCAL_STORE || path.join(ROOT, '.data');
if (!process.env.URL && process.env.RENDER_EXTERNAL_URL) process.env.URL = process.env.RENDER_EXTERNAL_URL;
fs.mkdirSync(process.env.STREAX_LOCAL_STORE, { recursive: true });

const { default: api } = await import('./netlify/functions/api.mjs');
const { run } = await import('./netlify/lib/onchain.mjs');

process.env.STREAX_SERVER = '1';
const PORT = Number(process.env.PORT || 10000);
const MONITOR_MINUTES = Number(process.env.MONITOR_MINUTES || 10);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const PRIVATE = /^\/(netlify|node_modules|\.data|\.git)(\/|$)|^\/(server\.mjs|package(-lock)?\.json|render\.yaml|netlify\.toml|DEPLOY\.md|\.gitignore)$/;

// ---------------------------------------------------------------- monitor
let running = false;
async function monitor() {
  if (running) return;
  running = true;
  try { await run((m) => console.log('[monitor]', m)); } catch (e) { console.error('[monitor] failed', e); }
  finally { running = false; }
}

// ------------------------------------------------------------------ server
// Old article addresses go to the article pages.
const ARTICLE_PAGES = { '': 'Articles.dc.html', 'how-the-streax-score-works': 'ArticleScore.dc.html', 'wagering-requirements-explained': 'ArticleWagering.dc.html', 'how-to-file-a-casino-complaint': 'ArticleComplaints.dc.html' };

function sendStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  const old = /^(\/night)?\/articles(?:\/([a-z0-9-]+))?\/?$/.exec(p);
  if (old && ARTICLE_PAGES[old[2] || ''] ) { res.writeHead(301, { location: (old[1] || '') + '/' + ARTICLE_PAGES[old[2] || ''] }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  if (PRIVATE.test(p)) return notFound(res);
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      // folders like /articles serve their index.html, with a trailing slash
      if (!p.endsWith('/')) { res.writeHead(301, { location: p + '/' }); return res.end(); }
      return sendStatic(req, res, p + 'index.html');
    }
    if (err || !st.isFile()) return notFound(res);
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return notFound(res);
    const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': /\.(webp|png|jpg|svg|ico)$/.test(file) ? 'public, max-age=86400' : 'no-cache' };
    const gzip = /^(text|application\/json)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}
function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:system-ui;padding:40px">Page not found. <a href="/">Go to Streax</a></p>');
}

http.createServer(async (req, res) => {
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const url = new URL(req.url, proto + '://' + (req.headers.host || 'localhost'));
    // the admin "Run the monitor now" button
    if (url.pathname === '/.netlify/functions/monitor-background' && req.method === 'POST') {
      const ok = process.env.ADMIN_TOKEN && req.headers['x-streax-key'] === process.env.ADMIN_TOKEN;
      if (ok) monitor();
      res.writeHead(ok ? 202 : 403); return res.end();
    }
    if (/^\/(api|auth|r)\//.test(url.pathname)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      const out = await api(request, { ip });
      const headers = {};
      out.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const cookies = out.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(out.status, headers);
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    sendStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => {
  console.log('Streax listening on ' + PORT + ', data in ' + process.env.STREAX_LOCAL_STORE);
  if (process.env.MONITOR !== 'off') {
    setTimeout(monitor, 15000);
    setInterval(monitor, MONITOR_MINUTES * 60000);
  }
});
