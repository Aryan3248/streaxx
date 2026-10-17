'use strict';
// Small HTTP helpers for the accounts routes: cookies, JSON bodies, same-origin checks and rate limits.

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 1) return;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
    if (!(k in out)) out[k] = v;
  });
  return out;
}

function isHttps(req) {
  const p = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return p === 'https' || !!(req.socket && req.socket.encrypted);
}

function cookie(req, name, value, opts = {}) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=' + (opts.path || '/'), 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge != null) parts.push('Max-Age=' + Math.floor(opts.maxAge));
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function send(res, code, obj, headers) {
  res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {}));
  res.end(JSON.stringify(obj));
}

function redirect(res, location, headers) {
  res.writeHead(302, Object.assign({ location, 'cache-control': 'no-store' }, headers || {}));
  res.end();
}

function readJson(req, max = 20000) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/json/i.test(type)) { reject(Object.assign(new Error('Send JSON'), { status: 415 })); req.resume(); return; }
    let s = '';
    req.setEncoding('utf8');
    req.on('data', c => { s += c; if (s.length > max) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => {
      if (!s) return resolve({});
      try { const j = JSON.parse(s); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Blocks cross-site form posts: a browser always sends Origin on cross-site POSTs, and it must match this host.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Sliding-window counters kept in memory (reset on restart, which is fine for abuse limits).
class Limiter {
  constructor() { this.m = new Map(); }
  hit(key, max, windowMs) {
    const now = Date.now();
    const arr = (this.m.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) { this.m.set(key, arr); return false; }
    arr.push(now);
    this.m.set(key, arr);
    if (this.m.size > 20000) { for (const k of this.m.keys()) { this.m.delete(k); if (this.m.size < 15000) break; } }
    return true;
  }
}

function baseUrl(cfg, req) {
  if (cfg.publicUrl) return cfg.publicUrl.replace(/\/+$/, '');
  if (req && req.headers && req.headers.host) return (isHttps(req) ? 'https' : 'http') + '://' + req.headers.host;
  return 'http://localhost:' + (cfg.port || 3000);
}

// A same-site relative path only, so redirects after login can never leave the site.
function safeNext(p, fallback) {
  const s = String(p || '');
  return /^\/[A-Za-z0-9._~\/-]*(\?[A-Za-z0-9._~=&%-]*)?$/.test(s) && !s.startsWith('//') ? s : fallback;
}

module.exports = { parseCookies, cookie, send, redirect, readJson, sameOrigin, clientIp, Limiter, baseUrl, isHttps, safeNext };
