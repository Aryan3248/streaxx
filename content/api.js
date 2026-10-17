'use strict';
// Routes for articles: public pages and feeds, image files, and the Studio API (needs ADMIN_TOKEN).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const render = require('./render');
const md = require('./markdown');
const { CATEGORIES, slugify } = require('./store');

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const html = (res, code, body, cache) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache || 'no-cache' }); res.end(body); };
const fail = (status, message) => Object.assign(new Error(message), { status });
const IMG = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_UPLOAD = 6 * 1024 * 1024;

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

function readBody(req, max, asJson) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { reject(fail(413, 'File too large. The limit is ' + Math.round(max / 1048576) + ' MB.')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!asJson) return resolve(buf);
      if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) return reject(fail(415, 'Send JSON'));
      if (!buf.length) return resolve({});
      try { const j = JSON.parse(buf.toString('utf8')); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { reject(fail(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function tokenOk(cfg, req) {
  const a = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const b = Buffer.from(String(cfg.adminToken || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function previewKey(cfg, id) { return cfg.adminToken ? crypto.createHmac('sha256', cfg.adminToken).update('preview:' + id).digest('hex').slice(0, 24) : ''; }

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function validate(state, j, id) {
  const out = {};
  if (j.title !== undefined) { out.title = clean(j.title, 140).replace(/\s+/g, ' '); if (!out.title) throw fail(400, 'Add a title'); }
  if (j.dek !== undefined) out.dek = clean(j.dek, 300).replace(/\s+/g, ' ');
  if (j.body !== undefined) out.body = String(j.body || '').replace(/\r\n?/g, '\n').slice(0, 200000);
  if (j.slug !== undefined || (out.title && !id)) {
    const s = slugify(j.slug || out.title);
    if (!s) throw fail(400, 'The address needs letters or numbers');
    out.slug = state.store.uniqueSlug(s, id);
  }
  if (j.cover !== undefined) { const c = clean(j.cover, 400); if (c && !md.safeUrl(c)) throw fail(400, 'The cover must be an uploaded image or an https link'); out.cover = c; }
  if (j.cover_alt !== undefined) out.cover_alt = clean(j.cover_alt, 200);
  if (j.category !== undefined) { if (!CATEGORIES.find(c => c.id === j.category)) throw fail(400, 'Pick a category'); out.category = j.category; }
  if (j.tags !== undefined) out.tags = String(j.tags || '').split(',').map(t => clean(t, 30).replace(/[^\p{L}\p{N} -]/gu, '')).filter(Boolean).slice(0, 8).join(',');
  if (j.author !== undefined) out.author = clean(j.author, 60);
  if (j.author_role !== undefined) out.author_role = clean(j.author_role, 60);
  if (j.featured !== undefined) out.featured = j.featured ? 1 : 0;
  if (j.seo_title !== undefined) out.seo_title = clean(j.seo_title, 80);
  if (j.seo_desc !== undefined) out.seo_desc = clean(j.seo_desc, 200);
  if (j.keyword !== undefined) out.keyword = clean(j.keyword, 60);
  if (j.casinos !== undefined) {
    const known = new Set(state.casinos().map(c => c.slug));
    out.casinos = (Array.isArray(j.casinos) ? j.casinos : String(j.casinos || '').split(',')).map(s => String(s).trim()).filter(s => known.has(s)).slice(0, 12).join(',');
  }
  if (j.status !== undefined) { if (!['draft', 'published'].includes(j.status)) throw fail(400, 'Unknown status'); out.status = j.status; }
  if (j.published_at !== undefined) {
    if (j.published_at === null || j.published_at === '') out.published_at = null;
    else { const t = Number(j.published_at); if (!Number.isFinite(t) || t < 946684800000) throw fail(400, 'Pick a valid publish date'); out.published_at = Math.round(t); }
  }
  return out;
}

function adminRow(state, a) {
  if (!a) return null;
  const r = md.render(a.body || '');
  return Object.assign({}, a, { words: r.words, minutes: r.minutes, url: '/articles/' + a.slug, previewUrl: '/articles/' + a.slug + '?preview=' + previewKey(state.cfg, a.id), live: a.status === 'published' && a.published_at && a.published_at <= Date.now() });
}

function publicRow(a) {
  const r = md.render(a.body || '');
  return { slug: a.slug, title: a.title, dek: a.dek || '', cover: a.cover || '', category: a.category, categoryName: (CATEGORIES.find(c => c.id === a.category) || {}).name || '', published: a.published_at, minutes: r.minutes, url: '/articles/' + a.slug };
}

// ctx(req) -> { base, night, user }
async function handle(state, req, res, url, ctx) {
  const p = url.pathname;
  if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }); res.end(render.robots(ctx(req).base)); return true; }
  if (p.startsWith('/uploads/')) {
    const f = p.slice(9);
    if (!/^[a-f0-9]{16,64}\.(png|jpg|webp|gif)$/.test(f)) { res.writeHead(404); res.end('Not found'); return true; }
    const file = path.join(state.uploadDir, f);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, { 'content-type': IMG[f.split('.').pop()], 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      res.end(buf);
    });
    return true;
  }
  if (p === '/studio' || p === '/studio/') { res.writeHead(302, { location: '/studio.html', 'cache-control': 'no-store' }); res.end(); return true; }
  if (p === '/studio/score.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(path.join(__dirname, '..', 'trust', 'score.js')));
    return true;
  }
  if (p === '/studio/base.css') {
    const { CSS } = require('./layout');
    const vars = CSS.split('\n').filter(l => /^:root\{|^\[data-theme=night\]\{/.test(l)).join('\n');
    const prose = render.ARTICLE_CSS.split('\n').filter(l => l.startsWith('.prose')).join('\n');
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(vars + '\n' + prose + '\n');
    return true;
  }
  if (p === '/studio/markdown.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(path.join(__dirname, 'markdown.js')));
    return true;
  }
  if (!state) {
    if (p === '/articles' || p.startsWith('/articles/') || p === '/sitemap.xml' || p === '/rss.xml') { html(res, 503, '<!doctype html><title>Articles are off</title><p>Articles need Node.js 22.5 or newer on the server.</p>'); return true; }
    if (p.startsWith('/api/studio/') || p === '/api/articles') { send(res, 503, { error: 'Articles are off on this server' }); return true; }
    return false;
  }
  try {
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' }); res.end(render.sitemap(ctx(req).base, state.store, state.casinos().map(c => c.slug))); return true; }
    if (p === '/rss.xml') { res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' }); res.end(render.rss(ctx(req).base, state.store)); return true; }
    if (p === '/articles' || p === '/articles/') {
      html(res, 200, render.indexPage(ctx(req), state.store, { page: Number(url.searchParams.get('page')) || 1 }));
      return true;
    }
    let m = /^\/articles\/category\/([a-z-]+)\/?$/.exec(p);
    if (m) {
      if (!CATEGORIES.find(c => c.id === m[1])) { html(res, 404, notFound(ctx(req))); return true; }
      html(res, 200, render.indexPage(ctx(req), state.store, { category: m[1], page: Number(url.searchParams.get('page')) || 1 }));
      return true;
    }
    m = /^\/articles\/([a-z0-9-]{1,90})\/?$/.exec(p);
    if (m) {
      const a = state.store.bySlug(m[1]);
      const key = url.searchParams.get('preview');
      const live = a && a.status === 'published' && a.published_at && a.published_at <= Date.now();
      const preview = a && !live && key && key === previewKey(state.cfg, a.id);
      if (!a || (!live && !preview)) { html(res, 404, notFound(ctx(req))); return true; }
      if (live && !preview) state.store.view(a.id);
      html(res, 200, render.articlePage(ctx(req), state.store, a, { preview, casinoName: state.casinoName }));
      return true;
    }
    if (p === '/api/articles' && req.method === 'GET') {
      const lim = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 3));
      const r = state.store.published({ casino: url.searchParams.get('casino') || '', category: url.searchParams.get('category') || '', limit: lim });
      send(res, 200, { articles: r.rows.map(publicRow), total: r.total });
      return true;
    }
    if (!p.startsWith('/api/studio/')) return false;
    if (!state.cfg.adminToken) throw fail(403, 'Set ADMIN_TOKEN on the server to use the Studio');
    if (!tokenOk(state.cfg, req)) throw fail(401, 'Wrong admin token');
    if (p === '/api/studio/meta' && req.method === 'GET') {
      send(res, 200, { categories: CATEGORIES, casinos: state.casinos(), base: ctx(req).base });
      return true;
    }
    if (p === '/api/studio/articles' && req.method === 'GET') {
      send(res, 200, { articles: state.store.all().map(a => Object.assign(a, { url: '/articles/' + a.slug, previewUrl: '/articles/' + a.slug + '?preview=' + previewKey(state.cfg, a.id), live: a.status === 'published' && a.published_at && a.published_at <= Date.now() })) });
      return true;
    }
    if (p === '/api/studio/articles' && req.method === 'POST') {
      const j = await readBody(req, 400000, true);
      if (!j.title) throw fail(400, 'Add a title');
      const data = validate(state, Object.assign({ category: 'news', status: 'draft' }, j), 0);
      send(res, 200, { article: adminRow(state, state.store.save(0, data)) });
      return true;
    }
    m = /^\/api\/studio\/articles\/(\d+)$/.exec(p);
    if (m) {
      const id = Number(m[1]);
      if (!state.store.get(id)) throw fail(404, 'That article no longer exists');
      if (req.method === 'GET') { send(res, 200, { article: adminRow(state, state.store.get(id)) }); return true; }
      if (req.method === 'POST') {
        const j = await readBody(req, 400000, true);
        send(res, 200, { article: adminRow(state, state.store.save(id, validate(state, j, id))) });
        return true;
      }
      if (req.method === 'DELETE') { state.store.remove(id); send(res, 200, { ok: true }); return true; }
    }
    if (p === '/api/studio/upload' && req.method === 'POST') {
      const buf = await readBody(req, MAX_UPLOAD, false);
      const ext = sniff(buf);
      if (!ext) throw fail(415, 'Upload a PNG, JPG, WebP or GIF image');
      const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
      fs.mkdirSync(state.uploadDir, { recursive: true });
      const file = path.join(state.uploadDir, name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      state.store.addUpload({ file: name, mime: IMG[ext], size: buf.length });
      send(res, 200, { url: '/uploads/' + name, size: buf.length });
      return true;
    }
    if (p === '/api/studio/uploads' && req.method === 'GET') {
      send(res, 200, { uploads: state.store.uploads().map(u => ({ url: '/uploads/' + u.file, size: u.size, created: u.created })) });
      return true;
    }
    if (p.startsWith('/api/studio/articles') || p === '/api/studio/upload') throw fail(405, 'Method not allowed');
    return false;
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' });
    if (!e.status) state.log('Articles error: ' + (e.stack || e.message));
    return true;
  }
}

function notFound(c) {
  const { page } = require('./layout');
  return page({ title: 'Page not found · Streax', desc: '', night: c.night, user: c.user, noindex: true, current: '/articles',
    body: '<div class="wrap" style="padding:80px 20px;text-align:center"><span class="eyebrow">404</span><h1 class="serif" style="font-size:52px;margin:10px 0">This page is not here</h1><p style="color:var(--sub);max-width:460px;margin:0 auto 22px">It may have moved or not be published yet.</p><a class="btn primary" href="/articles">Browse articles</a></div>' });
}

module.exports = { handle, previewKey, sniff };
