'use strict';
// HTTP routes for sign-up, login, Google sign-in, the account page, member bonus codes and the admin tools.

const { parseCookies, cookie, send, redirect, readJson, sameOrigin, clientIp, baseUrl, safeNext } = require('./http');
const { hashPassword, verifyPassword, dummyVerify, token } = require('./secure');
const perks = require('./perks');
const mailer = require('./mailer');
const google = require('./google');

const SESSION_COOKIE = 'sx_sess';
const OAUTH_COOKIE = 'sx_oauth';
const DAY = 86400000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanEmail = s => String(s || '').trim().toLowerCase();
const initials = n => (String(n || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || 'S').toUpperCase();
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

function sessionToken(req) { return parseCookies(req.headers.cookie)[SESSION_COOKIE] || ''; }

function userFromReq(state, req) {
  if (req.__sxUser !== undefined) return req.__sxUser;
  let u = null;
  try { u = state.store.sessionUser(sessionToken(req)); } catch (e) { u = null; }
  req.__sxUser = u;
  return u;
}

function startSession(state, req, res, user) {
  const raw = state.store.createSession(user.id, req.headers['user-agent']);
  state.store.update(user.id, { last_login: Date.now() });
  return cookie(req, SESSION_COOKIE, raw, { maxAge: 30 * DAY / 1000 });
}

function summary(state, u) {
  if (!u) return null;
  const lv = perks.levelFor(u.points);
  return { name: u.name || u.email.split('@')[0], email: u.email, initials: initials(u.name || u.email), points: u.points, level: lv.name, levelId: lv.id,
    verified: !!u.verified, watchlist: state.store.watchlist(u.id) };
}

// A friend's referral points are paid once the new account is confirmed, at most 20 a day per referrer.
function creditReferral(state, u) {
  if (!u || !u.referred_by || u.ref_credited || !u.verified) return false;
  const referrer = state.store.user(u.referred_by);
  if (!referrer) return false;
  if (state.store.referralsSince(referrer.id, Date.now() - DAY) >= perks.REFERRALS_PER_DAY) return false;
  state.store.award(referrer.id, 'referral:' + u.id, perks.POINTS.referral.pts);
  state.store.update(u.id, { ref_credited: 1 });
  return true;
}
function creditPending(state, referrerId) {
  state.store.db.prepare('SELECT * FROM users WHERE referred_by = ? AND verified = 1 AND ref_credited = 0').all(referrerId).forEach(u => creditReferral(state, u));
}

function markVerified(state, u) {
  if (!u.verified) state.store.update(u.id, { verified: 1 });
  state.store.award(u.id, 'verify', perks.POINTS.verify.pts);
  creditReferral(state, state.store.user(u.id));
}

async function sendVerify(state, req, u) {
  if (!state.cfg.resendKey) return false;
  const link = baseUrl(state.cfg, req) + '/auth/verify?token=' + state.store.createToken(u.id, 'verify', 3 * DAY);
  const m = mailer.templates.verify(baseUrl(state.cfg, req), u.name, link);
  await mailer.send(state.cfg, u.email, m.subject, m.html, m.text);
  return true;
}

// New account, from the sign-up form or from Google.
function createAccount(state, req, f) {
  let referredBy = null;
  if (f.ref) {
    const r = state.store.userByRef(f.ref);
    if (r && r.email !== f.email) referredBy = r.id;
  }
  const id = state.store.createUser({ email: f.email, name: f.name, pass: f.pass, googleSub: f.googleSub, avatar: f.avatar, verified: f.verified,
    adult: true, marketing: !!f.marketing, referredBy, ip: clientIp(req) });
  state.store.award(id, 'signup', perks.POINTS.signup.pts);
  if (referredBy) state.store.award(id, 'friend', perks.POINTS.friend.pts);
  const u = state.store.user(id);
  if (u.verified) markVerified(state, u);
  return state.store.user(id);
}

function accountPayload(state, u, req) {
  creditPending(state, u.id);
  u = state.store.user(u.id);
  const lv = perks.levelFor(u.points), nx = perks.nextLevel(u.points);
  const casinos = state.casinos;
  const bySlug = new Map(casinos.map(c => [c.slug, c]));
  const revealed = state.store.revealed(u.id);
  const tracked = state.trackedCasinos ? state.trackedCasinos() : [];
  const watch = state.store.watchlist(u.id);
  return {
    user: { name: u.name, email: u.email, initials: initials(u.name || u.email), verified: !!u.verified, google: !!u.google_sub, password: !!u.pass,
      avatar: u.avatar || '', created: u.created, marketing: !!u.marketing },
    points: u.points,
    level: { id: lv.id, name: lv.name, min: lv.min, watch: lv.watch, alertMin: lv.alertMin },
    next: nx ? { id: nx.id, name: nx.name, min: nx.min, need: nx.min - u.points } : null,
    levels: perks.LEVELS.map(l => ({ id: l.id, name: l.name, min: l.min, perks: l.perks, reached: u.points >= l.min })),
    history: state.store.pointsLog(u.id, 20).map(p => ({ delta: p.delta, label: perks.reasonLabel(p.reason), ts: p.ts })),
    ways: [
      { label: 'Confirm your email', pts: perks.POINTS.verify.pts, done: !!u.verified },
      { label: 'Connect Telegram alerts', pts: perks.POINTS.telegram.pts, done: !!state.store.prep("SELECT 1 FROM points_log WHERE user_id = ? AND reason = 'telegram'").get(u.id) },
      { label: 'Watch 3 casinos', pts: perks.POINTS.watch3.pts, done: !!state.store.prep("SELECT 1 FROM points_log WHERE user_id = ? AND reason = 'watch3'").get(u.id) },
      { label: 'Each friend who joins', pts: perks.POINTS.referral.pts, done: false, repeat: true }
    ],
    referral: Object.assign({ code: u.ref_code, url: baseUrl(state.cfg, req) + '/r/' + u.ref_code, each: perks.POINTS.referral.pts, friendGets: perks.POINTS.friend.pts },
      state.store.referralStats(u.id)),
    watchlist: watch.map(s => ({ slug: s, name: (bySlug.get(s) || {}).name || s, domain: (bySlug.get(s) || {}).domain || '', tracked: tracked.includes(s) })),
    watchLimit: lv.watch,
    alerts: {
      min: u.alert_min, email: !!u.alert_email, telegram: !!u.alert_tg,
      options: perks.ALERT_OPTIONS.map(v => ({ v, label: perks.money(v) + '+', locked: v < lv.alertMin, needs: (perks.LEVELS.find(l => l.alertMin <= v) || {}).name })),
      emailReady: !!state.cfg.resendKey, emailVerified: !!u.verified,
      tgReady: !!(state.tg && state.tg.ready), tgLinked: !!u.tg_chat, tgName: u.tg_name || ''
    },
    codes: state.store.codes(true).map(c => {
      const locked = perks.levelRank(lv.id) < perks.levelRank(c.level);
      const casino = bySlug.get(c.casino);
      const show = revealed.has(c.id) && !locked;
      return { id: c.id, casino: c.casino, casinoName: casino ? casino.name : c.casino, domain: casino ? casino.domain : '', title: c.title, terms: c.terms, url: c.url,
        level: (perks.LEVELS.find(l => l.id === c.level) || perks.LEVELS[0]).name, locked, revealed: show, code: show ? c.code : '', expires: c.expires };
    }),
    tracked
  };
}

function needUser(state, req) {
  const u = userFromReq(state, req);
  if (!u) throw fail(401, 'Log in first', { code: 'login_required' });
  return u;
}

async function handle(state, req, res, url) {
  const p = url.pathname;
  const isAuthRoute = p.startsWith('/api/auth/') || p.startsWith('/api/account') || p === '/api/codes' || p.startsWith('/api/admin/') || p.startsWith('/auth/');
  if (!isAuthRoute) return false;
  if (!state) {
    if (p.startsWith('/auth/')) redirect(res, '/Login.dc.html?err=off');
    else send(res, p === '/api/auth/me' ? 200 : 503, p === '/api/auth/me' ? { user: null, enabled: false } : { error: 'Accounts are off on this server. They need Node.js 22.5 or newer.' });
    return true;
  }
  const { store, cfg, limiter } = state;
  const ip = clientIp(req);
  try {
    if (req.method === 'POST' && !sameOrigin(req)) throw fail(403, 'Blocked: request came from another site');

    // ---------- public ----------
    if (p === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, { enabled: true, user: summary(state, userFromReq(state, req)), google: !!(cfg.googleClientId && cfg.googleClientSecret), email: !!cfg.resendKey }), true;
    }
    if (p === '/api/auth/signup' && req.method === 'POST') {
      if (!limiter.hit('signup:' + ip, 5, 3600000)) throw fail(429, 'Too many sign-ups from this network. Try again in an hour.');
      const b = await readJson(req);
      const email = cleanEmail(b.email), name = cleanName(b.name), pw = String(b.password || '');
      if (!EMAIL_RE.test(email) || email.length > 254) throw fail(400, 'Enter a valid email address.', { field: 'email' });
      if (pw.length < 8) throw fail(400, 'Use at least 8 characters for your password.', { field: 'password' });
      if (pw.length > 200) throw fail(400, 'That password is too long.', { field: 'password' });
      if (b.adult !== true) throw fail(400, 'Confirm you are 18 or older to create an account.', { field: 'adult' });
      if (store.userByEmail(email)) throw fail(409, 'An account with this email already exists. Log in instead.', { field: 'email' });
      const u = createAccount(state, req, { email, name: name || email.split('@')[0], pass: await hashPassword(pw), verified: !cfg.resendKey, marketing: b.marketing === true, ref: String(b.ref || '').trim() });
      let mailed = false;
      if (!u.verified) { try { mailed = await sendVerify(state, req, u); } catch (e) { state.log('Verify email: ' + e.message); } }
      const c = startSession(state, req, res, u);
      return send(res, 201, { ok: true, user: summary(state, store.user(u.id)), verifySent: mailed }, { 'set-cookie': c }), true;
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = await readJson(req);
      const email = cleanEmail(b.email), pw = String(b.password || '');
      if (!limiter.hit('login:' + ip, 20, 15 * 60000) || !limiter.hit('login:' + email, 8, 15 * 60000)) throw fail(429, 'Too many attempts. Wait 15 minutes and try again.');
      const u = store.userByEmail(email);
      if (!u || !u.pass) {
        await dummyVerify(pw);
        throw fail(401, u && u.google_sub ? 'This account uses Google. Press Continue with Google.' : 'Email or password is not right.');
      }
      if (!(await verifyPassword(pw, u.pass))) throw fail(401, 'Email or password is not right.');
      return send(res, 200, { ok: true, user: summary(state, u) }, { 'set-cookie': startSession(state, req, res, u) }), true;
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      store.deleteSession(sessionToken(req));
      return send(res, 200, { ok: true }, { 'set-cookie': cookie(req, SESSION_COOKIE, '', { maxAge: 0 }) }), true;
    }
    if (p === '/api/auth/forgot' && req.method === 'POST') {
      const b = await readJson(req);
      const email = cleanEmail(b.email);
      if (!cfg.resendKey) throw fail(503, 'Password reset by email is not set up on this server yet. Contact support.');
      if (!limiter.hit('forgot:' + ip, 10, 3600000) || !limiter.hit('forgot:' + email, 3, 3600000)) throw fail(429, 'Too many reset requests. Try again in an hour.');
      const u = EMAIL_RE.test(email) ? store.userByEmail(email) : null;
      if (u) {
        const link = baseUrl(cfg, req) + '/Login.dc.html?reset=' + store.createToken(u.id, 'reset', 30 * 60000);
        const m = mailer.templates.reset(baseUrl(cfg, req), u.name, link);
        try { await mailer.send(cfg, u.email, m.subject, m.html, m.text); } catch (e) { state.log('Reset email: ' + e.message); }
      }
      return send(res, 200, { ok: true }), true;
    }
    if (p === '/api/auth/reset' && req.method === 'POST') {
      const b = await readJson(req);
      const pw = String(b.password || '');
      if (pw.length < 8 || pw.length > 200) throw fail(400, 'Use at least 8 characters for your password.', { field: 'password' });
      const userId = store.useToken(String(b.token || ''), 'reset');
      if (!userId) throw fail(400, 'This reset link has expired. Ask for a new one.');
      const u = store.user(userId);
      store.update(u.id, { pass: await hashPassword(pw) });
      markVerified(state, u); // the reset link proved they own the inbox
      store.deleteOtherSessions(u.id, '');
      return send(res, 200, { ok: true, user: summary(state, store.user(u.id)) }, { 'set-cookie': startSession(state, req, res, u) }), true;
    }
    if (p === '/auth/verify' && req.method === 'GET') {
      const userId = store.useToken(url.searchParams.get('token') || '', 'verify');
      if (!userId) return redirect(res, '/Account.dc.html?verify=expired'), true;
      markVerified(state, store.user(userId));
      return redirect(res, '/Account.dc.html?verify=ok'), true;
    }
    if (p === '/api/codes' && req.method === 'GET') {
      const bySlug = new Map(state.casinos.map(c => [c.slug, c]));
      return send(res, 200, { codes: store.codes(true).map(c => ({ casino: (bySlug.get(c.casino) || {}).name || c.casino, domain: (bySlug.get(c.casino) || {}).domain || '', title: c.title,
        level: (perks.LEVELS.find(l => l.id === c.level) || perks.LEVELS[0]).name })) }), true;
    }

    // ---------- Google ----------
    if (p === '/auth/google' && req.method === 'GET') {
      const mode = url.searchParams.get('mode') === 'signup' ? 'signup' : 'login';
      if (!cfg.googleClientId || !cfg.googleClientSecret) return redirect(res, (mode === 'signup' ? '/Signup.dc.html' : '/Login.dc.html') + '?err=google_off'), true;
      if (!limiter.hit('google:' + ip, 30, 3600000)) return redirect(res, '/Login.dc.html?err=busy'), true;
      const st = token(18), nonce = token(18);
      const adult = url.searchParams.get('adult') === '1' ? '1' : '0';
      const ref = String(url.searchParams.get('ref') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
      const mk = url.searchParams.get('marketing') === '1' ? '1' : '0';
      const next = safeNext(url.searchParams.get('next'), '');
      const val = Buffer.from(JSON.stringify({ st, nonce, mode, adult, ref, mk, next })).toString('base64url');
      return redirect(res, google.authUrl(cfg, baseUrl(cfg, req) + '/auth/google/callback', st, nonce), { 'set-cookie': cookie(req, OAUTH_COOKIE, val, { maxAge: 600, path: '/auth' }) }), true;
    }
    if (p === '/auth/google/callback' && req.method === 'GET') {
      const clear = cookie(req, OAUTH_COOKIE, '', { maxAge: 0, path: '/auth' });
      let o = {};
      try { o = JSON.parse(Buffer.from(String(parseCookies(req.headers.cookie)[OAUTH_COOKIE] || ''), 'base64url').toString('utf8')) || {}; } catch (e) { o = {}; }
      const { st, nonce, mode, adult, ref, mk } = o;
      const back = (mode === 'signup' ? '/Signup.dc.html' : '/Login.dc.html');
      if (url.searchParams.get('error')) return redirect(res, back + '?err=google_cancel', { 'set-cookie': clear }), true;
      if (!st || st !== url.searchParams.get('state')) return redirect(res, back + '?err=google_state', { 'set-cookie': clear }), true;
      let g;
      try { g = await google.exchange(cfg, url.searchParams.get('code') || '', baseUrl(cfg, req) + '/auth/google/callback', nonce); }
      catch (e) { state.log(e.message); return redirect(res, back + '?err=google_failed', { 'set-cookie': clear }), true; }
      let u = store.userByGoogle(g.sub);
      if (!u && g.verified) {
        u = store.userByEmail(g.email);
        if (u) { store.update(u.id, { google_sub: g.sub, avatar: u.avatar || g.picture }); markVerified(state, u); u = store.user(u.id); }
      }
      let welcome = false;
      if (!u) {
        if (adult !== '1') return redirect(res, '/Signup.dc.html?err=google_confirm', { 'set-cookie': clear }), true;
        if (!g.verified) return redirect(res, '/Signup.dc.html?err=google_unverified', { 'set-cookie': clear }), true;
        u = createAccount(state, req, { email: g.email, name: cleanName(g.name) || g.email.split('@')[0], googleSub: g.sub, avatar: g.picture, verified: true, marketing: mk === '1', ref });
        welcome = true;
      }
      const next = safeNext(o.next, '');
      const dest = welcome ? '/Account.dc.html?welcome=1' : (next || '/Account.dc.html');
      return redirect(res, dest, { 'set-cookie': [clear, startSession(state, req, res, u)] }), true;
    }

    // ---------- account (logged in) ----------
    if (p === '/api/account' && req.method === 'GET') return send(res, 200, accountPayload(state, needUser(state, req), req)), true;
    if (p.startsWith('/api/account/') && req.method === 'POST') {
      const u = needUser(state, req);
      const b = await readJson(req);
      const lv = perks.levelFor(u.points);
      const action = p.slice('/api/account/'.length);
      if (action === 'profile') {
        const name = cleanName(b.name);
        if (!name) throw fail(400, 'Enter your name.', { field: 'name' });
        store.update(u.id, { name, marketing: b.marketing === true ? 1 : b.marketing === false ? 0 : u.marketing });
      } else if (action === 'password') {
        const pw = String(b.password || '');
        if (pw.length < 8 || pw.length > 200) throw fail(400, 'Use at least 8 characters for your new password.', { field: 'password' });
        if (u.pass && !(await verifyPassword(String(b.current || ''), u.pass))) throw fail(400, 'Your current password is not right.', { field: 'current' });
        store.update(u.id, { pass: await hashPassword(pw) });
        store.deleteOtherSessions(u.id, sessionToken(req));
      } else if (action === 'watch') {
        const slug = String(b.slug || '');
        if (!state.casinos.some(c => c.slug === slug)) throw fail(400, 'Unknown casino');
        if (b.on) {
          const list = store.watchlist(u.id);
          if (!list.includes(slug) && list.length >= lv.watch) throw fail(400, 'Your ' + lv.name + ' watchlist holds ' + lv.watch + ' casinos. Earn points to reach the next level.', { code: 'watch_limit' });
          store.setWatch(u.id, slug, true);
          if (store.watchlist(u.id).length >= 3) store.award(u.id, 'watch3', perks.POINTS.watch3.pts);
        } else store.setWatch(u.id, slug, false);
      } else if (action === 'alerts') {
        const fields = {};
        if (b.min != null) {
          const v = Number(b.min);
          if (!perks.ALERT_OPTIONS.includes(v)) throw fail(400, 'Pick one of the listed alert sizes.');
          if (v < lv.alertMin) throw fail(400, 'Alerts from ' + perks.money(v) + ' unlock at ' + (perks.LEVELS.find(l => l.alertMin <= v) || {}).name + '.', { code: 'level' });
          fields.alert_min = v;
        }
        if (typeof b.email === 'boolean') fields.alert_email = b.email ? 1 : 0;
        if (typeof b.telegram === 'boolean') fields.alert_tg = b.telegram ? 1 : 0;
        store.update(u.id, fields);
      } else if (action === 'telegram') {
        if (!state.tg || !state.tg.ready) throw fail(503, 'Telegram alerts are not set up on this server yet.');
        if (!limiter.hit('tg:' + u.id, 10, 3600000)) throw fail(429, 'Too many tries. Wait a little and try again.');
        let link;
        try { link = await state.tg.linkUrl(u.id); } catch (e) { throw fail(502, 'Could not reach Telegram: ' + e.message); }
        return send(res, 200, { ok: true, url: link }), true;
      } else if (action === 'telegram-off') {
        store.update(u.id, { tg_chat: null, tg_name: null });
      } else if (action === 'reveal') {
        if (!limiter.hit('reveal:' + u.id, 60, 3600000)) throw fail(429, 'Too many reveals. Try again later.');
        const c = store.code(Number(b.id));
        if (!c || !c.active || (c.expires && c.expires < Date.now())) throw fail(404, 'This code is no longer available.');
        if (perks.levelRank(lv.id) < perks.levelRank(c.level)) throw fail(403, 'This code unlocks at ' + (perks.LEVELS.find(l => l.id === c.level) || {}).name + '.', { code: 'level' });
        store.reveal(u.id, c.id);
        return send(res, 200, { ok: true, code: c.code, url: c.url }), true;
      } else if (action === 'resend') {
        if (u.verified) return send(res, 200, { ok: true, already: true }), true;
        if (!limiter.hit('verify:' + u.id, 3, 3600000)) throw fail(429, 'We already sent a few. Check your spam folder.');
        let sent = false;
        try { sent = await sendVerify(state, req, u); } catch (e) { throw fail(502, 'Could not send the email: ' + e.message); }
        if (!sent) throw fail(503, 'Email is not set up on this server yet.');
      } else if (action === 'logout-all') {
        store.deleteOtherSessions(u.id, sessionToken(req));
      } else if (action === 'delete') {
        if (b.confirm !== 'DELETE') throw fail(400, 'Type DELETE to confirm.', { field: 'confirm' });
        if (u.pass && !(await verifyPassword(String(b.password || ''), u.pass))) throw fail(400, 'Your password is not right.', { field: 'password' });
        store.deleteUser(u.id);
        return send(res, 200, { ok: true }, { 'set-cookie': cookie(req, SESSION_COOKIE, '', { maxAge: 0 }) }), true;
      } else throw fail(404, 'Not found');
      return send(res, 200, Object.assign({ ok: true }, accountPayload(state, store.user(u.id), req))), true;
    }

    // ---------- admin (ADMIN_TOKEN) ----------
    if (p.startsWith('/api/admin/')) {
      if (!cfg.adminToken) throw fail(403, 'Set ADMIN_TOKEN on the server to use admin tools');
      if (req.headers['x-admin-token'] !== cfg.adminToken) throw fail(401, 'Wrong admin token');
      if (p === '/api/admin/accounts' && req.method === 'GET') {
        const counts = store.revealCounts();
        return send(res, 200, { stats: store.stats(), casinos: state.casinos, codes: store.codes(false).map(c => Object.assign({}, c, { reveals: counts[c.id] || 0 })) }), true;
      }
      if (p === '/api/admin/codes' && req.method === 'POST') {
        const b = await readJson(req);
        const c = { casino: String(b.casino || ''), title: cleanName(b.title).slice(0, 80), code: String(b.code || '').trim().slice(0, 60), url: String(b.url || '').trim().slice(0, 500),
          terms: String(b.terms || '').replace(/[<>]/g, '').trim().slice(0, 300), level: ['member', 'silver', 'gold'].includes(b.level) ? b.level : 'member',
          expires: b.expires ? Date.parse(b.expires) || null : null };
        if (!state.casinos.some(x => x.slug === c.casino)) throw fail(400, 'Pick a casino');
        if (!c.title || !c.code) throw fail(400, 'Title and code are required');
        if (c.url && !/^https:\/\//i.test(c.url)) throw fail(400, 'The link must start with https://');
        return send(res, 201, { ok: true, id: store.addCode(c) }), true;
      }
      if (p === '/api/admin/members.csv' && req.method === 'GET') {
        const cell = v => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const rows = [['name', 'email', 'joined_utc', 'email_confirmed', 'google', 'news_opt_in', 'points', 'level', 'friends_referred', 'telegram_connected', 'watchlist']];
        store.db.prepare('SELECT u.*, (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) AS refs, (SELECT GROUP_CONCAT(slug, \' \') FROM watchlist w WHERE w.user_id = u.id) AS watch FROM users u ORDER BY u.created DESC').all()
          .forEach(u => rows.push([u.name, u.email, new Date(u.created).toISOString(), u.verified ? 'yes' : 'no', u.google_sub ? 'yes' : 'no', u.marketing ? 'yes' : 'no', u.points, perks.levelFor(u.points).name, u.refs, u.tg_chat ? 'yes' : 'no', u.watch || '']));
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="streax-members-' + new Date().toISOString().slice(0, 10) + '.csv"', 'cache-control': 'no-store' });
        res.end('\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n');
        return true;
      }
      const m = /^\/api\/admin\/codes\/(\d+)$/.exec(p);
      if (m && req.method === 'POST') { const b = await readJson(req); return send(res, 200, { ok: store.setCodeActive(Number(m[1]), !!b.active) > 0 }), true; }
      if (m && req.method === 'DELETE') return send(res, 200, { ok: store.deleteCode(Number(m[1])) > 0 }), true;
    }
    throw fail(404, 'Not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) state.log('Accounts error: ' + (e.stack || e.message));
    if (p.startsWith('/auth/')) return redirect(res, '/Login.dc.html?err=failed'), true;
    send(res, status, { error: status >= 500 && status !== 503 && status !== 502 ? 'Something went wrong. Try again.' : e.message, field: e.field, code: e.code });
  }
  return true;
}

module.exports = { handle, userFromReq, summary, accountPayload, SESSION_COOKIE };
