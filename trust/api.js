'use strict';
// Routes for complaints, payout reports, casino reviews, the casino reply page and My wallet check.

const crypto = require('crypto');
const { readJson, sameOrigin, clientIp } = require('../accounts/http');
const { CATEGORIES, STATUSES, FIRST_REPLY_DAYS } = require('./store');
const walletcheck = require('./walletcheck');
const score = require('./score');
const { txUrl, CHAINS } = require('../onchain/assets');
const { page, esc } = require('../content/layout');

const DAY = 86400000;
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const TX_RE = {
  ethereum: /^0x[0-9a-fA-F]{64}$/, bsc: /^0x[0-9a-fA-F]{64}$/, polygon: /^0x[0-9a-fA-F]{64}$/,
  tron: /^[0-9a-fA-F]{64}$/, bitcoin: /^[0-9a-fA-F]{64}$/, solana: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/
};
const CHAIN_LIST = ['ethereum', 'tron', 'solana', 'bsc', 'polygon', 'bitcoin'];

function tokenOk(cfg, req) {
  const a = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const b = Buffer.from(String(cfg.adminToken || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function displayName(u) {
  const n = String(u.name || '').trim().split(/\s+/).filter(Boolean);
  if (n.length >= 2) return n[0] + ' ' + n[n.length - 1][0].toUpperCase() + '.';
  if (n.length === 1) return n[0];
  return 'Player ' + String(u.id).padStart(4, '0');
}

// Look a transaction up in the on-chain monitor (it keeps every move of $1,000 or more at tracked casino wallets).
function txLookup(state, chain, tx) {
  if (!state.onchain || !chain || !tx) return null;
  const hash = chain === 'tron' || chain === 'bitcoin' ? tx.replace(/^0x/, '').toLowerCase() : chain === 'solana' ? tx : tx.toLowerCase();
  try {
    const rows = state.onchain.store.db.prepare('SELECT * FROM transfers WHERE chain = ? AND (tx = ? OR lower(tx) = ?)').all(chain, hash, hash.toLowerCase());
    return rows.length ? rows : [];
  } catch (e) { return null; }
}
function txCheck(state, chain, tx, casino) {
  if (!tx) return null;
  const rows = txLookup(state, chain, tx);
  const url = txUrl(chain, tx);
  if (rows == null) return { status: 'unchecked', url, note: 'The on-chain monitor is off, so Streax checks this transaction by hand.' };
  const mine = rows.filter(r => r.casino === casino);
  if (mine.length) {
    const r = mine[0];
    return { status: 'matched', url, dir: r.dir, usd: r.usd, ts: r.ts, note: (r.dir === 'in' ? 'Coins arrived at a ' : 'Coins left a ') + state.casinoName(casino) + ' wallet on ' + new Date(r.ts).toUTCString().slice(5, 22) + ' UTC.' };
  }
  if (rows.length) return { status: 'other', url, note: 'This transaction touched a wallet of ' + state.casinoName(rows[0].casino) + ', not ' + state.casinoName(casino) + '.' };
  return { status: 'not_found', url, note: 'Not in the monitor yet. It records moves of $1,000 or more at tracked casino wallets, so Streax checks smaller ones by hand.' };
}

function pubEvent(e) { return { ts: e.ts, who: e.who, name: e.who === 'casino' ? (e.name || 'Casino') : e.name, kind: e.kind, body: e.body, status: e.status }; }
function pubComplaint(state, c, opts = {}) {
  const tc = c.tx_check ? (() => { try { return JSON.parse(c.tx_check); } catch (e) { return null; } })() : null;
  const out = {
    ref: c.ref, casino: c.casino, casinoName: state.casinoName(c.casino), category: c.category, categoryName: (CATEGORIES.find(x => x.id === c.category) || {}).name || c.category,
    title: c.title, amount: c.amount, currency: c.currency || 'USD', status: c.status, statusName: STATUSES[c.status].name, closed: STATUSES[c.status].closed,
    created: c.created, updated: c.updated, deadline: c.deadline, closedAt: c.closed_at, outcome: c.outcome || '', player: c.user_name, casinoReplied: !!c.casino_replied,
    tx: c.tx ? { chain: c.chain, chainName: (CHAINS[c.chain] || {}).name || c.chain, hash: c.tx, url: txUrl(c.chain, c.tx), check: tc } : null
  };
  if (opts.full) { out.body = c.body; out.events = state.store.events(c.id, false).map(pubEvent); }
  else out.excerpt = c.body.length > 220 ? c.body.slice(0, 217).replace(/\s+\S*$/, '') + '...' : c.body;
  if (opts.viewer) out.mine = c.user_id === opts.viewer.id;
  return out;
}

async function notify(state, c, subject, line) {
  const acc = state.accounts;
  if (!acc || !acc.cfg.resendKey) return;
  const u = acc.store.user(c.user_id);
  if (!u || !u.verified) return;
  const mailer = require('../accounts/mailer');
  const link = (acc.cfg.publicUrl || '') + '/Complaints.dc.html?id=' + c.ref;
  const html = mailer.layout(subject, '<p style="line-height:1.6">' + mailer.esc(line) + '</p><p style="line-height:1.6;color:#55617F">Complaint ' + mailer.esc(c.ref) + ' about ' + mailer.esc(state.casinoName(c.casino)) + ': ' + mailer.esc(c.title) + '</p>' + mailer.button(link, 'Open your complaint'), 'You get this email because you filed a complaint on Streax.');
  try { await mailer.send(acc.cfg, u.email, subject, html, line + '\n\n' + link); } catch (e) { state.log('Complaint email: ' + e.message); }
}

function viewerOf(state, req) {
  if (!state.accounts) return null;
  try { return require('../accounts/api').userFromReq(state.accounts, req); } catch (e) { return null; }
}
function needMember(state, req) {
  if (!state.accounts) throw fail(503, 'Accounts are off on this server');
  if (!sameOrigin(req)) throw fail(403, 'Blocked: this request came from another site');
  const u = viewerOf(state, req);
  if (!u) throw fail(401, 'Log in first');
  return u;
}
function limit(state, key, max, ms) {
  if (!state.limiter.hit(key, max, ms)) throw fail(429, 'Too many tries. Wait a few minutes and try again.');
}

// Reserves for the casino page: today's hot wallet total and a 30-day daily series, when the monitor tracks the casino.
function reserves(state, slug) {
  if (!state.onchain) return { tracked: false };
  const st = state.onchain.store;
  const tracked = st.wallets().some(w => w.casino === slug);
  if (!tracked) return { tracked: false };
  const cur = st.db.prepare(`SELECT SUM(b.usd) AS usd, MAX(b.ts) AS ts FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address WHERE w.active = 1 AND w.role != 'funder' AND w.casino = ?`).get(slug);
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const series = st.db.prepare('SELECT day, SUM(usd) AS usd FROM balance_days WHERE casino = ? AND day >= ? GROUP BY day ORDER BY day').all(slug, since);
  let drawdown7d = null;
  const last7 = series.slice(-8);
  if (last7.length >= 2) { const peak = Math.max(...last7.map(r => r.usd || 0)); const now = last7[last7.length - 1].usd || 0; drawdown7d = peak > 0 ? Math.max(0, (peak - now) / peak) : null; }
  return { tracked: true, total: cur && cur.usd || 0, updated: cur && cur.ts || null, series, drawdown7d };
}

function publicReview(r) {
  if (!r) return null;
  return { licence: r.licence || {}, fairness: r.fairness || {}, compliance: r.compliance || {}, rg: r.rg || {}, support: r.support || {}, security: r.security || {}, payments: r.payments || {}, ratings: r.ratings || [], summary: r.summary || '', updated: r.updated };
}

function cleanReview(j) {
  const yn = v => (v === 'yes' || v === 'no' ? v : 'unknown');
  const pick = (obj, keys) => { const o = {}; keys.forEach(k => { o[k] = yn(obj && obj[k]); }); return o; };
  const C = score.CHECKS;
  const keys = list => list.map(x => x[0]);
  const lic = j.licence || {};
  const sup = j.support || {};
  const pay = j.payments || {};
  const url = u => { const s = clean(u, 300); return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; };
  return {
    licence: { status: ['licensed', 'unlicensed', 'unknown'].includes(lic.status) ? lic.status : 'unknown', regulator: clean(lic.regulator, 80), number: clean(lic.number, 60), url: url(lic.url), verified: !!lic.verified, operator: clean(lic.operator, 100) },
    fairness: pick(j.fairness, keys(C.fairness)), compliance: pick(j.compliance, keys(C.compliance)), rg: pick(j.rg, keys(C.rg)), security: pick(j.security, keys(C.security)),
    support: { live24: yn(sup.live24), responseMins: sup.responseMins === '' || sup.responseMins == null || !isFinite(sup.responseMins) ? null : Math.max(0, Math.min(10080, Number(sup.responseMins))), languages: clean(sup.languages, 120), channels: clean(sup.channels, 120) },
    payments: { minWithdrawal: clean(pay.minWithdrawal, 80), fees: clean(pay.fees, 120), limits: clean(pay.limits, 120), coins: clean(pay.coins, 160), kycThreshold: clean(pay.kycThreshold, 120) },
    ratings: (Array.isArray(j.ratings) ? j.ratings : []).slice(0, 6).map(r => ({ source: clean(r.source, 40), score: Number(r.score) || 0, outOf: Number(r.outOf) || 5, count: Math.max(0, Math.round(Number(r.count) || 0)), url: url(r.url), checked: Number(r.checked) || Date.now() })).filter(r => r.source),
    summary: clean(j.summary, 600)
  };
}

function replyPage(state, ctx, c, token, msg) {
  const events = state.store.events(c.id, false);
  const closed = STATUSES[c.status].closed;
  const thread = events.map(e => '<li class="ev ev-' + e.who + '"><div class="evh"><b>' + esc(e.who === 'player' ? c.user_name : e.who === 'casino' ? (e.name || 'Casino') : 'Streax') + '</b><span>' + new Date(e.ts).toUTCString().slice(5, 22) + ' UTC</span></div>' + (e.body ? '<p>' + esc(e.body).replace(/\n/g, '<br>') + '</p>' : '') + '</li>').join('');
  const css = `.rp{max-width:860px;margin:0 auto;padding:34px 20px}.rp h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:44px;line-height:1.05;margin:10px 0 8px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:18px 0}.fact{padding:12px 14px;border-radius:14px;background:var(--soft);border:1px solid var(--line)}.fact span{display:block;font-size:12px;color:var(--muted)}.fact b{font-weight:600}.body{white-space:pre-wrap;line-height:1.7;color:var(--body);padding:18px;border-radius:16px;border:1px solid var(--border);background:var(--card)}.thread{list-style:none;margin:20px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}.ev{padding:14px 16px;border-radius:16px;border:1px solid var(--border);background:var(--card)}.ev-casino{border-color:var(--accentB);background:var(--accentA)}.ev-streax{background:var(--soft)}.evh{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--muted)}.evh b{color:var(--ink)}.ev p{margin:8px 0 0;line-height:1.6;color:var(--body)}form{margin-top:22px;padding:20px;display:flex;flex-direction:column;gap:12px}textarea,input[type=text]{width:100%;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--ink);font:inherit;padding:12px 14px}textarea{min-height:150px;resize:vertical}label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500;color:var(--sub)}.chk{flex-direction:row;align-items:flex-start;gap:10px;font-size:14px;color:var(--body)}.msg{padding:12px 14px;border-radius:12px;background:var(--goodA);color:var(--good);margin-top:14px}.msg.err{background:var(--badA);color:var(--bad)}`;
  const body = '<div class="rp"><span class="eyebrow">Casino reply · ' + esc(c.ref) + '</span><h1>' + esc(c.title) + '</h1>'
    + '<p style="color:var(--sub);margin:0">A player filed this complaint about ' + esc(state.casinoName(c.casino)) + ' on Streax. Your reply is published on the complaint page. Please do not share the player\'s personal data here.</p>'
    + (msg ? '<div class="msg' + (msg.err ? ' err' : '') + '" role="status">' + esc(msg.text) + '</div>' : '')
    + '<div class="facts"><div class="fact"><span>Status</span><b>' + esc(STATUSES[c.status].name) + '</b></div><div class="fact"><span>Category</span><b>' + esc((CATEGORIES.find(x => x.id === c.category) || {}).name || '') + '</b></div>'
    + (c.amount ? '<div class="fact"><span>Amount</span><b>$' + Number(c.amount).toLocaleString('en-US') + '</b></div>' : '')
    + (c.deadline && !closed ? '<div class="fact"><span>Reply by</span><b>' + new Date(c.deadline).toUTCString().slice(5, 16) + '</b></div>' : '')
    + (c.tx ? '<div class="fact"><span>Transaction</span><b><a href="' + esc(txUrl(c.chain, c.tx)) + '" target="_blank" rel="noopener" style="color:var(--accentInk)">' + esc(c.tx.slice(0, 10)) + '...</a></b></div>' : '') + '</div>'
    + '<div class="body">' + esc(c.body) + '</div><ol class="thread">' + thread + '</ol>'
    + (closed ? '<div class="card" style="padding:18px;margin-top:18px">This complaint is closed as <b>' + esc(STATUSES[c.status].name.toLowerCase()) + '</b>. ' + esc(c.outcome || '') + '</div>'
      : '<form class="card" method="post" action="/reply/' + esc(token) + '"><label>Your name and role<input type="text" name="name" maxlength="60" required placeholder="For example: Alex, Support lead"></label><label>Reply to the player<textarea name="body" maxlength="4000" required placeholder="What happened, and what you are doing about it"></textarea></label><label class="chk"><input type="checkbox" name="propose" value="1" style="margin-top:4px;width:18px;height:18px"><span>We have fixed this. Ask the player to confirm, and close it as resolved if they agree or do not answer within 14 days.</span></label><button class="btn primary" type="submit" style="align-self:flex-start">Post reply</button></form>')
    + '</div>';
  return page({ title: 'Reply to complaint ' + c.ref + ' · Streax', desc: '', night: ctx.night, user: null, noindex: true, extraCss: css, body });
}

function readForm(req, max = 12000) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', c => { s += c; if (s.length > max) { reject(fail(413, 'Too long')); req.destroy(); } });
    req.on('end', () => { const p = new URLSearchParams(s); const o = {}; for (const [k, v] of p) o[k] = v; resolve(o); });
    req.on('error', reject);
  });
}

async function handle(state, req, res, url, ctx) {
  const p = url.pathname;
  const ours = p.startsWith('/api/complaints') || p.startsWith('/api/payouts') || p.startsWith('/api/trust/') || p === '/api/wallet-check' || p.startsWith('/reply/') || p.startsWith('/api/studio/complaints') || p.startsWith('/api/studio/payouts') || p.startsWith('/api/studio/reviews') || p === '/api/studio/trust';
  if (!ours) return false;
  if (!state) { send(res, 503, { error: 'Complaints and scores need Node.js 22.5 or newer on the server' }); return true; }
  try {
    let m;
    // ---------- casino reply page (secret link, no account) ----------
    if ((m = /^\/reply\/([A-Za-z0-9_-]{20,64})$/.exec(p))) {
      const c = state.store.byReplyToken(m[1]);
      const pc = ctx(req);
      if (!c) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(page({ title: 'Link not valid · Streax', night: pc.night, noindex: true, body: '<div class="wrap" style="padding:80px 20px;text-align:center"><h1 class="serif" style="font-size:44px">This reply link is not valid</h1><p style="color:var(--sub)">It may have been replaced by a newer link. Ask Streax for the current one.</p></div>' })); return true; }
      let msg = null;
      if (req.method === 'POST') {
        if (!sameOrigin(req)) throw fail(403, 'Blocked');
        limit(state, 'reply:' + clientIp(req), 20, 3600000);
        const f = await readForm(req);
        const body = clean(f.body, 4000), name = clean(f.name, 60);
        if (STATUSES[c.status].closed) msg = { err: true, text: 'This complaint is already closed.' };
        else if (c.status === 'review') msg = { err: true, text: 'Streax is still checking this complaint.' };
        else if (body.length < 10 || !name) msg = { err: true, text: 'Add your name and a reply of at least a few words.' };
        else {
          state.store.event(c.id, 'casino', name + ', ' + state.casinoName(c.casino), 'message', body);
          state.store.casinoReplied(c.id);
          if (f.propose === '1') {
            state.store.setStatus(c.id, 'proposed');
            state.store.event(c.id, 'streax', 'Streax', 'status', state.casinoName(c.casino) + ' says this is fixed. The player has 14 days to confirm or dispute it.', 'proposed');
            notify(state, c, state.casinoName(c.casino) + ' says your complaint is fixed', 'The casino says it has fixed the issue. Please confirm or dispute it within 14 days.');
          } else notify(state, c, state.casinoName(c.casino) + ' replied to your complaint', 'The casino replied. Read it and answer on Streax.');
          res.writeHead(303, { location: '/reply/' + m[1] + '?posted=1', 'cache-control': 'no-store' });
          res.end();
          return true;
        }
      } else if (url.searchParams.get('posted')) msg = { text: 'Reply posted. It is now on the public complaint page.' };
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin' });
      res.end(replyPage(state, pc, state.store.complaint(c.id), m[1], msg));
      return true;
    }

    // ---------- public ----------
    if (p === '/api/trust/meta' && req.method === 'GET') {
      send(res, 200, { categories: CATEGORIES, statuses: Object.entries(STATUSES).map(([id, s]) => ({ id, name: s.name, closed: s.closed })), chains: CHAIN_LIST.map(c => ({ id: c, name: CHAINS[c].name })), firstReplyDays: FIRST_REPLY_DAYS, scoreCats: score.CATS, checks: score.CHECKS });
      return true;
    }
    if ((m = /^\/api\/trust\/casino\/([a-z0-9-]{1,40})$/.exec(p)) && req.method === 'GET') {
      const slug = m[1];
      const counts = state.store.counts(slug);
      const recent = state.store.list({ publicOnly: true, casino: slug, limit: 4 }).rows.map(c => pubComplaint(state, c));
      const pay = state.store.payoutStats(slug);
      const payRecent = state.store.payouts({ casino: slug, status: 'approved', limit: 6 }).map(r => ({ amount: r.amount, minutes: r.minutes, ts: r.received_at || r.created, chain: r.chain, chainName: (CHAINS[r.chain] || {}).name || r.chain, url: txUrl(r.chain, r.tx), matched: !!r.matched }));
      let articles = [];
      if (state.content) { try { articles = state.content.store.published({ casino: slug, limit: 3 }).rows.map(a => ({ slug: a.slug, title: a.title, dek: a.dek || '', url: '/articles/' + a.slug, published: a.published_at, cover: a.cover || '' })); } catch (e) { articles = []; } }
      send(res, 200, { casino: slug, review: publicReview(state.store.review(slug)), complaints: Object.assign(counts, { recent }), payouts: Object.assign(pay, { recent: payRecent }), reserves: reserves(state, slug), articles });
      return true;
    }
    if (p === '/api/trust/summary' && req.method === 'GET') {
      const reviews = {};
      Object.entries(state.store.reviews()).forEach(([k, r]) => { reviews[k] = publicReview(r); });
      send(res, 200, { reviews, complaints: state.store.countsByCasino(), payouts: state.store.payoutStatsAll() });
      return true;
    }
    if (p === '/api/complaints' && req.method === 'GET') {
      const viewer = viewerOf(state, req);
      const pg = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const status = url.searchParams.get('status') || '';
      const open = status === 'open';
      const r = state.store.list({ publicOnly: true, casino: url.searchParams.get('casino') || '', status: open ? '' : (STATUSES[status] ? status : ''), open, limit: 12, offset: (pg - 1) * 12 });
      send(res, 200, { complaints: r.rows.map(c => pubComplaint(state, c, { viewer })), total: r.total, page: pg, pages: Math.max(1, Math.ceil(r.total / 12)), counts: state.store.counts(url.searchParams.get('casino') || '') });
      return true;
    }
    if (p === '/api/complaints/mine' && req.method === 'GET') {
      const u = viewerOf(state, req);
      if (!u) { send(res, 200, { complaints: [], payouts: [] }); return true; }
      send(res, 200, { complaints: state.store.list({ userId: u.id, limit: 50 }).rows.map(c => pubComplaint(state, c, { viewer: u })),
        payouts: state.store.payouts({ userId: u.id, limit: 50 }).map(r => ({ id: r.id, casino: r.casino, casinoName: state.casinoName(r.casino), amount: r.amount, minutes: r.minutes, status: r.status, created: r.created, url: txUrl(r.chain, r.tx), note: r.note })) });
      return true;
    }
    if ((m = /^\/api\/complaints\/(SX-\d{4,8})$/i.exec(p)) && req.method === 'GET') {
      const c = state.store.byRef(m[1]);
      const viewer = viewerOf(state, req);
      if (!c || (c.status === 'review' && (!viewer || viewer.id !== c.user_id))) throw fail(404, 'No complaint with that number');
      send(res, 200, { complaint: pubComplaint(state, c, { full: true, viewer }) });
      return true;
    }
    if (p === '/api/complaints' && req.method === 'POST') {
      const u = needMember(state, req);
      if (state.accounts.cfg.resendKey && !u.verified) throw fail(403, 'Confirm your email first. We send updates about your complaint there.');
      limit(state, 'cmp:' + u.id, 6, DAY);
      if (state.store.createdSince(u.id, Date.now() - DAY) >= 3) throw fail(429, 'You can file 3 complaints a day. Add details to an open one instead.');
      const j = await readJson(req, 40000);
      const casino = clean(j.casino, 40);
      if (!state.knownCasino(casino)) throw fail(400, 'Pick the casino', { field: 'casino' });
      if (!CATEGORIES.find(c => c.id === j.category)) throw fail(400, 'Pick what went wrong');
      const title = clean(j.title, 120).replace(/\s+/g, ' ');
      const body = clean(j.body, 6000);
      if (title.length < 8) throw fail(400, 'Give the complaint a short title of at least 8 characters', { field: 'title' });
      if (body.length < 60) throw fail(400, 'Describe what happened in at least 60 characters: dates, amounts and what support told you.', { field: 'body' });
      let amount = null;
      if (j.amount !== '' && j.amount != null) { amount = Number(j.amount); if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw fail(400, 'Enter the amount in US dollars', { field: 'amount' }); }
      let chain = '', tx = '';
      if (j.tx) {
        chain = String(j.chain || '');
        tx = clean(j.tx, 120);
        if (!TX_RE[chain]) throw fail(400, 'Pick the network of the transaction', { field: 'chain' });
        if (!TX_RE[chain].test(tx)) throw fail(400, 'That does not look like a ' + CHAINS[chain].name + ' transaction hash', { field: 'tx' });
      }
      if (!j.agree) throw fail(400, 'Confirm that the complaint is accurate and can be published', { field: 'agree' });
      const c = state.store.createComplaint({ userId: u.id, userName: displayName(u), casino, category: j.category, title, body, amount, chain, tx, txCheck: txCheck(state, chain, tx, casino) });
      send(res, 200, { complaint: pubComplaint(state, c, { full: true, viewer: u }) });
      return true;
    }
    if ((m = /^\/api\/complaints\/(SX-\d{4,8})\/(reply|confirm)$/i.exec(p)) && req.method === 'POST') {
      const u = needMember(state, req);
      const c = state.store.byRef(m[1]);
      if (!c || c.user_id !== u.id) throw fail(404, 'No complaint with that number on your account');
      if (STATUSES[c.status].closed) throw fail(400, 'This complaint is closed');
      limit(state, 'cmpr:' + u.id, 30, 3600000);
      const j = await readJson(req, 12000);
      if (m[2].toLowerCase() === 'reply') {
        const body = clean(j.body, 4000);
        if (body.length < 2) throw fail(400, 'Write a reply first');
        state.store.event(c.id, 'player', c.user_name, 'message', body);
      } else {
        if (c.status !== 'proposed') throw fail(400, 'There is no fix to confirm yet');
        if (j.resolved) {
          state.store.setStatus(c.id, 'resolved', { outcome: 'The player confirmed the casino fixed the issue.' });
          state.store.event(c.id, 'player', c.user_name, 'status', 'Confirmed the issue is fixed. Thank you for using Streax.', 'resolved');
        } else {
          const why = clean(j.body, 2000);
          state.store.setStatus(c.id, 'waiting');
          state.store.event(c.id, 'player', c.user_name, 'status', 'Disputed the fix' + (why ? ': ' + why : '.'), 'waiting');
        }
      }
      send(res, 200, { complaint: pubComplaint(state, state.store.complaint(c.id), { full: true, viewer: u }) });
      return true;
    }
    if (p === '/api/payouts' && req.method === 'POST') {
      const u = needMember(state, req);
      limit(state, 'pay:' + u.id, 20, DAY);
      if (state.store.payoutsSince(u.id, Date.now() - DAY) >= 10) throw fail(429, 'You can report 10 payouts a day');
      const j = await readJson(req, 8000);
      const casino = clean(j.casino, 40);
      if (!state.knownCasino(casino)) throw fail(400, 'Pick the casino', { field: 'casino' });
      const chain = String(j.chain || '');
      const tx = clean(j.tx, 120);
      if (!TX_RE[chain]) throw fail(400, 'Pick the network the payout arrived on', { field: 'chain' });
      if (!TX_RE[chain].test(tx)) throw fail(400, 'That does not look like a ' + CHAINS[chain].name + ' transaction hash', { field: 'tx' });
      const requestedAt = Number(j.requestedAt);
      if (!Number.isFinite(requestedAt) || requestedAt > Date.now() + 60000 || requestedAt < Date.now() - 120 * DAY) throw fail(400, 'Enter when you asked for the withdrawal (within the last 120 days)', { field: 'requestedAt' });
      const norm = chain === 'tron' || chain === 'bitcoin' ? tx.replace(/^0x/, '').toLowerCase() : chain === 'solana' ? tx : tx.toLowerCase();
      if (state.store.payoutByTx(chain, norm)) throw fail(409, 'This payout was already reported', { field: 'tx' });
      let receivedAt = j.receivedAt ? Number(j.receivedAt) : null;
      const rows = txLookup(state, chain, norm) || [];
      const hit = rows.find(r => r.casino === casino && r.dir === 'out');
      let status = 'pending', note = 'Waiting for a Streax check.';
      if (hit) { receivedAt = hit.ts; note = 'Matched on-chain: coins left a ' + state.casinoName(casino) + ' wallet.'; }
      if (!receivedAt || !Number.isFinite(receivedAt)) throw fail(400, 'Enter when the coins arrived', { field: 'receivedAt' });
      if (receivedAt < requestedAt) throw fail(400, 'The coins cannot arrive before you asked for them. Check both times.', { field: 'receivedAt' });
      const minutes = (receivedAt - requestedAt) / 60000;
      if (hit && minutes < 60 * 24 * 30) status = 'approved';
      const amount = j.amount === '' || j.amount == null ? (hit ? Math.round(hit.usd) : null) : Number(j.amount);
      const r = state.store.addPayout({ userId: u.id, casino, amount: Number.isFinite(amount) ? amount : null, chain, tx: norm, requestedAt, receivedAt, minutes, status, note, matched: !!hit });
      if (status === 'approved' && state.accounts) state.accounts.store.award(u.id, 'payout:' + r.id, 25);
      send(res, 200, { report: { id: r.id, status: r.status, minutes: r.minutes, matched: !!hit, note } });
      return true;
    }
    if (p === '/api/wallet-check' && req.method === 'GET') {
      const u = viewerOf(state, req);
      limit(state, 'wc:' + (u ? 'u' + u.id : clientIp(req)), u ? 20 : 8, 600000);
      const r = await walletcheck.check(state.onchain, url.searchParams.get('address') || '', { full: !!u });
      r.member = !!u;
      send(res, 200, r);
      return true;
    }

    // ---------- Studio (ADMIN_TOKEN) ----------
    if (p.startsWith('/api/studio/')) {
      if (!state.cfg.adminToken) throw fail(403, 'Set ADMIN_TOKEN on the server to use the Studio');
      if (!tokenOk(state.cfg, req)) throw fail(401, 'Wrong admin token');
      if (p === '/api/studio/trust' && req.method === 'GET') {
        send(res, 200, { pending: state.store.pendingReviewCount(), payoutsPending: state.store.payouts({ status: 'pending', limit: 500 }).length, casinos: state.casinos(), categories: CATEGORIES, statuses: STATUSES, checks: score.CHECKS, cats: score.CATS, chains: CHAIN_LIST.map(c => ({ id: c, name: CHAINS[c].name })) });
        return true;
      }
      if (p === '/api/studio/complaints' && req.method === 'GET') {
        const st = url.searchParams.get('status') || '';
        const r = state.store.list({ status: st === 'open' ? '' : st, open: st === 'open', casino: url.searchParams.get('casino') || '', limit: 200 });
        send(res, 200, { complaints: r.rows.map(c => Object.assign(pubComplaint(state, c), { id: c.id, hasLink: !!c.reply_hash })), total: r.total });
        return true;
      }
      if ((m = /^\/api\/studio\/complaints\/(\d+)$/.exec(p))) {
        const c = state.store.complaint(m[1]);
        if (!c) throw fail(404, 'No such complaint');
        const studioView = x => {
          const u = state.accounts ? state.accounts.store.user(x.user_id) : null;
          return Object.assign(pubComplaint(state, x, { full: true }), { id: x.id, hasLink: !!x.reply_hash, events: state.store.events(x.id, true).map(e => Object.assign(pubEvent(e), { private: !!e.private })), player: { name: x.user_name, email: u ? u.email : '', verified: u ? !!u.verified : false, joined: u ? u.created : null } });
        };
        if (req.method === 'GET') { send(res, 200, { complaint: studioView(c) }); return true; }
        if (req.method === 'POST') {
          const j = await readJson(req, 40000);
          const a = j.action;
          let link = null;
          const note = clean(j.body, 4000);
          if (a === 'edit') state.store.edit(c.id, { title: clean(j.title, 120) || c.title, body: clean(j.text, 6000) || c.body, category: CATEGORIES.find(x => x.id === j.category) ? j.category : c.category });
          else if (a === 'approve') {
            if (c.status !== 'review') throw fail(400, 'Only complaints being checked can be sent to the casino');
            state.store.setStatus(c.id, 'waiting');
            link = state.store.newReplyToken(c.id);
            state.store.event(c.id, 'streax', 'Streax', 'status', 'Checked by Streax and sent to ' + state.casinoName(c.casino) + '. The casino has ' + FIRST_REPLY_DAYS + ' days to reply.' + (note ? ' ' + note : ''), 'waiting');
            notify(state, c, 'Your complaint was sent to ' + state.casinoName(c.casino), 'Streax checked your complaint and sent it to the casino. It has ' + FIRST_REPLY_DAYS + ' days to reply, and the complaint is now public.');
          } else if (a === 'link') {
            if (STATUSES[c.status].closed || c.status === 'review') throw fail(400, 'A casino link is only for open complaints');
            link = state.store.newReplyToken(c.id);
          } else if (a === 'request') {
            if (!note) throw fail(400, 'Write what the player should add');
            state.store.event(c.id, 'streax', 'Streax', 'message', note);
            notify(state, c, 'Streax needs more details for your complaint', note);
          } else if (a === 'message') {
            if (!note) throw fail(400, 'Write a message first');
            state.store.event(c.id, 'streax', 'Streax', 'message', note, '', !!j.private);
          } else if (['resolved', 'unresolved', 'rejected'].includes(a)) {
            if (!note) throw fail(400, 'Add a short reason. It is published with the outcome.');
            state.store.setStatus(c.id, a, { outcome: note });
            state.store.event(c.id, 'streax', 'Streax', 'status', 'Closed as ' + STATUSES[a].name.toLowerCase() + ': ' + note, a);
            notify(state, c, 'Your complaint is closed: ' + STATUSES[a].name.toLowerCase(), note);
          } else if (a === 'reopen') {
            state.store.setStatus(c.id, 'waiting');
            state.store.event(c.id, 'streax', 'Streax', 'status', 'Reopened by Streax.' + (note ? ' ' + note : ''), 'waiting');
          } else throw fail(400, 'Unknown action');
          const fresh = state.store.complaint(c.id);
          send(res, 200, { complaint: studioView(fresh), replyLink: link ? '/reply/' + link : null });
          return true;
        }
      }
      if (p === '/api/studio/payouts' && req.method === 'GET') {
        const st = url.searchParams.get('status') || 'pending';
        send(res, 200, { payouts: state.store.payouts({ status: st === 'all' ? '' : st, limit: 300 }).map(r => Object.assign({}, r, { casinoName: state.casinoName(r.casino), url: txUrl(r.chain, r.tx), chainName: (CHAINS[r.chain] || {}).name || r.chain })) });
        return true;
      }
      if ((m = /^\/api\/studio\/payouts\/(\d+)$/.exec(p)) && req.method === 'POST') {
        const r = state.store.payout(m[1]);
        if (!r) throw fail(404, 'No such report');
        const j = await readJson(req, 4000);
        if (!['approved', 'rejected', 'pending'].includes(j.status)) throw fail(400, 'Unknown status');
        state.store.setPayout(r.id, { status: j.status, note: clean(j.note, 300) || (j.status === 'approved' ? 'Checked by Streax.' : j.status === 'rejected' ? 'Could not be verified.' : r.note) });
        if (j.status === 'approved' && state.accounts) state.accounts.store.award(r.user_id, 'payout:' + r.id, 25);
        send(res, 200, { ok: true });
        return true;
      }
      if (p === '/api/studio/reviews' && req.method === 'GET') {
        const all = state.store.reviews();
        const counts = state.store.countsByCasino();
        send(res, 200, { casinos: state.casinos().map(c => ({ slug: c.slug, name: c.name, domain: c.domain, reviewed: !!all[c.slug], updated: all[c.slug] ? all[c.slug].updated : null, complaints: counts[c.slug] || null })) });
        return true;
      }
      if ((m = /^\/api\/studio\/reviews\/([a-z0-9-]{1,40})$/.exec(p))) {
        if (!state.knownCasino(m[1])) throw fail(404, 'Unknown casino');
        if (req.method === 'GET') { send(res, 200, { casino: m[1], name: state.casinoName(m[1]), review: state.store.review(m[1]) }); return true; }
        if (req.method === 'POST') {
          const j = await readJson(req, 40000);
          const saved = state.store.saveReview(m[1], cleanReview(j.review || {}), clean(j.reviewer, 60));
          send(res, 200, { review: saved });
          return true;
        }
      }
      throw fail(404, 'Not found');
    }
    throw fail(404, 'Not found');
  } catch (e) {
    send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Something went wrong' }, e.field ? { field: e.field } : {}));
    if (!e.status) state.log('Complaints error: ' + (e.stack || e.message));
    return true;
  }
}

module.exports = { handle, cleanReview, displayName, txCheck };
