// Member accounts: users, sessions, points, watchlist, alerts, codes.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { store, update } from './store.mjs';
import { fail, cookies, setCookie, siteUrl } from './http.mjs';
import { casinoBySlug, getRegistry } from './data.mjs';
import { mailReady, tgReady, sendMail } from './notify.mjs';

const scrypt = promisify(crypto.scrypt);
const users = () => store('users');
const sessions = () => store('sessions');
const tokens = () => store('tokens');
export const content = () => store('content');

const SESSION_COOKIE = 'sx_sess';
const SESSION_DAYS = 30;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');

export const LEVELS = [
  { id: 'member', name: 'Member', min: 0, watch: 10, alertMin: 50000, perks: ['Watchlist of 10 casinos', 'Whale alerts from $50K', 'Full 7, 30 and 90-day history', 'CSV downloads', 'Member bonus codes'] },
  { id: 'silver', name: 'Silver', min: 500, watch: 25, alertMin: 25000, perks: ['Watchlist of 25 casinos', 'Whale alerts from $25K', 'Silver bonus codes'] },
  { id: 'gold', name: 'Gold', min: 1500, watch: 100, alertMin: 10000, perks: ['Watchlist of 100 casinos', 'Whale alerts from $10K', 'Gold bonus codes'] }
];
const ALERT_OPTIONS = [[10000, '$10K+'], [25000, '$25K+'], [50000, '$50K+'], [100000, '$100K+'], [250000, '$250K+'], [1000000, '$1M+']];
const PTS = { join: 100, invited: 100, verify: 50, telegram: 50, watch3: 50, friend: 250, payout: 25 };

export const points = (u) => (u.history || []).reduce((s, h) => s + h.delta, 0);
export function levelOf(p) { let l = LEVELS[0]; LEVELS.forEach((x) => { if (p >= x.min) l = x; }); return l; }
const levelRank = (name) => Math.max(0, LEVELS.findIndex((l) => l.name === name || l.id === name));
export function initials(name, email) {
  const src = (name || '').trim() || (email || '').split('@')[0];
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0] || '')[1] || '')).toUpperCase();
}
export const publicName = (u) => { const p = (u.name || u.email.split('@')[0]).trim().split(/\s+/); return p[0] + (p.length > 1 ? ' ' + p[p.length - 1][0] + '.' : ''); };

export function addPoints(u, key, delta, label) {
  u.history = u.history || [];
  u.done = u.done || {};
  if (key) { if (u.done[key]) return false; u.done[key] = Date.now(); }
  u.history.push({ delta, label, ts: Date.now() });
  return true;
}

// ---------- passwords ----------
async function hashPw(pw) { const salt = rand(16); const h = await scrypt(pw, salt, 64); return 'scrypt$' + salt + '$' + h.toString('base64url'); }
async function checkPw(pw, stored) {
  if (!stored || !pw) return false;
  const [, salt, h] = stored.split('$');
  const got = await scrypt(pw, salt, 64);
  const want = Buffer.from(h, 'base64url');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
function checkNewPw(pw) { if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Use at least 8 characters for your password.', { field: 'password' }); if (pw.length > 200) fail(400, 'That password is too long.', { field: 'password' }); }
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
function checkEmail(e) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 200) fail(400, 'Enter a valid email address.', { field: 'email' }); }
const cleanName = (n, email) => (String(n || '').replace(/[<>]/g, '').trim().slice(0, 60) || email.split('@')[0].slice(0, 60));

// ---------- rate limits ----------
export async function limit(key, max, windowSec) {
  const now = Date.now();
  const r = await update(store('ratelimit'), key, (cur) => {
    const hits = (cur.hits || []).filter((t) => now - t < windowSec * 1000);
    hits.push(now);
    return { hits };
  }, { hits: [] });
  if (r.hits.length > max) fail(429, 'Too many tries. Wait a few minutes and try again.', { code: 'busy' });
}

// ---------- users ----------
export const getUser = (id) => users().get('u/' + id);
export const saveUser = (u) => users().set('u/' + u.id, u);
export async function updateUser(id, fn) {
  return update(users(), 'u/' + id, (u) => { if (!u) fail(401, 'Please log in again'); const r = fn(u); return r === undefined ? u : r; });
}
export async function userByEmail(email) { const m = await users().get('email/' + cleanEmail(email)); return m ? getUser(m.id) : null; }

async function newRefCode(id) {
  for (let i = 0; i < 10; i++) {
    const code = Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    const r = await users().set('ref/' + code, { id }, { onlyIfNew: true });
    if (r.modified !== false) return code;
  }
  throw new Error('Could not create an invite code');
}

export async function createUser({ name, email, password, marketing, ref, google, avatar, verified }) {
  const id = rand(12);
  const claim = await users().set('email/' + email, { id }, { onlyIfNew: true });
  if (claim.modified === false) fail(409, 'An account already uses this email. Log in instead.', { field: 'email' });
  const u = {
    id, email, name: cleanName(name, email), pw: password ? await hashPw(password) : null, google: google || null, avatar: avatar || '',
    verified: !!verified, marketing: !!marketing, created: Date.now(), history: [], done: {}, watchlist: [],
    alerts: { min: LEVELS[0].alertMin, email: false, telegram: false }, tg: null, refCode: await newRefCode(id),
    referredBy: null, referrals: { joined: 0, credited: 0, points: 0 }, revealed: [], sessVer: 1, adult: true
  };
  addPoints(u, 'join', PTS.join, 'Joined Streax');
  const code = String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (code) {
    const owner = await users().get('ref/' + code);
    if (owner) { u.referredBy = owner.id; addPoints(u, 'invited', PTS.invited, 'Invite bonus'); }
  }
  if (u.verified) addPoints(u, 'verify', PTS.verify, 'Confirmed email');
  await saveUser(u);
  if (google) await users().set('google/' + google, { id });
  if (u.referredBy) {
    await updateUser(u.referredBy, (o) => { o.referrals.joined++; }).catch(() => {});
    if (u.verified) await creditReferrer(u);
  }
  return u;
}

async function creditReferrer(u) {
  if (!u.referredBy || (u.done && u.done.refCredited)) return;
  await updateUser(u.id, (x) => { x.done = x.done || {}; x.done.refCredited = Date.now(); }).catch(() => {});
  await updateUser(u.referredBy, (o) => { o.referrals.credited++; o.referrals.points += PTS.friend; addPoints(o, null, PTS.friend, 'Friend joined'); }).catch(() => {});
}

async function deleteUser(u) {
  await users().del('u/' + u.id);
  await users().del('email/' + u.email);
  await users().del('ref/' + u.refCode);
  if (u.google) await users().del('google/' + u.google);
}

// ---------- sessions ----------
export async function startSession(u) {
  const t = rand(32);
  await sessions().set('s/' + sha(t), { uid: u.id, ver: u.sessVer, exp: Date.now() + SESSION_DAYS * 86400000 });
  return setCookie(SESSION_COOKIE, t, { maxAge: SESSION_DAYS * 86400 });
}
export const clearCookie = () => setCookie(SESSION_COOKIE, '', { maxAge: 0 });

export async function currentUser(req) {
  const t = cookies(req)[SESSION_COOKIE];
  if (!t) return null;
  const s = await sessions().get('s/' + sha(t));
  if (!s || s.exp < Date.now()) return null;
  const u = await getUser(s.uid);
  if (!u || u.sessVer !== s.ver) return null;
  return u;
}
export async function requireUser(req) { const u = await currentUser(req); if (!u) fail(401, 'Please log in first'); return u; }
async function endSession(req) { const t = cookies(req)[SESSION_COOKIE]; if (t) await sessions().del('s/' + sha(t)); }

// ---------- payloads ----------
export function me(u) {
  const p = points(u), l = levelOf(p);
  return { name: u.name, email: u.email, initials: initials(u.name, u.email), points: p, level: l.name, levelId: l.id, verified: !!u.verified, avatar: u.avatar || '', watchlist: u.watchlist.slice() };
}

export async function trackedSlugs() {
  const reg = await getRegistry();
  return reg.filter((c) => c.wallets.length).map((c) => c.slug).sort();
}

export async function accountPayload(req, u) {
  const p = points(u), lv = levelOf(p), li = LEVELS.indexOf(lv), nx = LEVELS[li + 1] || null;
  const tracked = await trackedSlugs();
  const codes = (await content().get('codes')) || [];
  const ways = [
    { label: 'Confirm your email', pts: PTS.verify, done: !!u.done.verify },
    { label: 'Connect Telegram alerts', pts: PTS.telegram, done: !!u.done.telegram },
    { label: 'Watch 3 casinos', pts: PTS.watch3, done: !!u.done.watch3 },
    { label: 'Each friend who joins', pts: PTS.friend, done: false, repeat: true }
  ];
  return {
    user: { name: u.name, email: u.email, initials: initials(u.name, u.email), verified: !!u.verified, google: !!u.google, password: !!u.pw, avatar: u.avatar || '', created: u.created, marketing: !!u.marketing },
    points: p,
    level: { id: lv.id, name: lv.name, min: lv.min, watch: lv.watch, alertMin: lv.alertMin },
    next: nx ? { id: nx.id, name: nx.name, min: nx.min, need: nx.min - p } : null,
    levels: LEVELS.map((l) => ({ id: l.id, name: l.name, min: l.min, perks: l.perks, reached: p >= l.min })),
    history: u.history.slice().reverse().slice(0, 30),
    ways,
    referral: { code: u.refCode, url: siteUrl(req) + '/r/' + u.refCode, each: PTS.friend, friendGets: PTS.invited, joined: u.referrals.joined, credited: u.referrals.credited, points: u.referrals.points },
    watchlist: u.watchlist.map((s) => { const c = casinoBySlug(s) || { name: s, domain: '' }; return { slug: s, name: c.name, domain: c.domain, tracked: tracked.includes(s) }; }),
    watchLimit: lv.watch,
    alerts: {
      min: u.alerts.min, email: !!u.alerts.email, telegram: !!u.alerts.telegram,
      options: ALERT_OPTIONS.map(([v, label]) => ({ v, label, locked: v < lv.alertMin, needs: (LEVELS.find((l) => l.alertMin <= v) || LEVELS[2]).name })),
      emailReady: mailReady(), emailVerified: !!u.verified, tgReady: tgReady(), tgLinked: !!u.tg, tgName: u.tg ? u.tg.name || '' : ''
    },
    codes: codes.filter((c) => c.active !== false).map((c) => {
      const locked = levelRank(c.level || 'Member') > LEVELS.indexOf(lv), revealed = !locked && u.revealed.includes(c.id);
      return { id: c.id, casino: c.casino || '', casinoName: c.casinoName || (casinoBySlug(c.casino) || {}).name || '', domain: c.domain || (casinoBySlug(c.casino) || {}).domain || '', title: c.title, terms: c.terms || '', url: revealed ? c.url || '' : '', level: c.level || 'Member', locked, revealed, code: revealed ? c.code : '' };
    }),
    tracked
  };
}

// ---------- email links ----------
async function sendVerify(req, u) {
  const t = rand(24);
  await tokens().set('verify/' + sha(t), { uid: u.id, email: u.email, exp: Date.now() + 3 * 86400000 });
  const link = siteUrl(req) + '/api/auth/verify?token=' + t;
  await sendMail(u.email, 'Confirm your Streax email', 'Hi ' + u.name + ',\n\nConfirm your email to turn on email alerts and get 50 points:\n' + link + '\n\nThe link works for 3 days. If you did not create a Streax account, ignore this email.');
}

// ---------- route handlers ----------
export const authRoutes = {
  async 'GET /api/auth/me'(req) {
    const u = await currentUser(req);
    return { enabled: true, user: u ? me(u) : null, google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), mail: mailReady(), telegram: tgReady() };
  },
  async 'POST /api/auth/signup'(req, ctx, b) {
    const email = cleanEmail(b.email);
    checkEmail(email); checkNewPw(b.password);
    if (b.adult !== true) fail(400, 'Confirm you are 18 or older to create an account.', { field: 'adult' });
    await limit('signup:' + ctx.ip, 10, 3600);
    const u = await createUser({ name: b.name, email, password: b.password, marketing: b.marketing, ref: b.ref });
    if (mailReady()) await sendVerify(req, u).catch(() => {});
    return { body: { user: me(u) }, cookie: await startSession(u) };
  },
  async 'POST /api/auth/login'(req, ctx, b) {
    const email = cleanEmail(b.email);
    checkEmail(email);
    await limit('login:' + ctx.ip, 20, 900);
    await limit('login:' + email, 10, 900);
    const u = await userByEmail(email);
    if (u && !u.pw && u.google) fail(400, 'This account signs in with Google. Use Continue with Google, then set a password on your account page.', { field: 'password' });
    if (!u || !(await checkPw(String(b.password || ''), u.pw))) fail(401, 'That email and password do not match.', { field: 'password' });
    return { body: { user: me(u) }, cookie: await startSession(u) };
  },
  async 'POST /api/auth/logout'(req) {
    await endSession(req);
    return { body: { ok: true }, cookie: clearCookie() };
  },
  async 'POST /api/auth/forgot'(req, ctx, b) {
    const email = cleanEmail(b.email);
    checkEmail(email);
    if (!mailReady()) fail(503, 'Password reset emails are not set up on this server yet.');
    await limit('forgot:' + ctx.ip, 5, 900);
    const u = await userByEmail(email);
    if (u) {
      const t = rand(24);
      await tokens().set('reset/' + sha(t), { uid: u.id, exp: Date.now() + 30 * 60000 });
      await sendMail(u.email, 'Reset your Streax password', 'Hi ' + u.name + ',\n\nChoose a new password here:\n' + siteUrl(req) + '/Login.dc.html?reset=' + t + '\n\nThe link works for 30 minutes. If you did not ask for this, ignore this email.').catch(() => {});
    }
    return { ok: true };
  },
  async 'POST /api/auth/reset'(req, ctx, b) {
    checkNewPw(b.password);
    const key = 'reset/' + sha(String(b.token || ''));
    const t = b.token ? await tokens().get(key) : null;
    if (!t || t.exp < Date.now()) fail(400, 'This reset link has expired. Ask for a new one.');
    await tokens().del(key);
    const pw = await hashPw(b.password);
    const u = await updateUser(t.uid, (x) => { x.pw = pw; x.sessVer++; });
    return { body: { user: me(u) }, cookie: await startSession(u) };
  },
  async 'GET /api/auth/verify'(req) {
    const t = new URL(req.url).searchParams.get('token') || '';
    const key = 'verify/' + sha(t);
    const rec = t ? await tokens().get(key) : null;
    if (!rec || rec.exp < Date.now()) return { redirect: '/Account.dc.html?verify=expired' };
    await tokens().del(key);
    const u = await updateUser(rec.uid, (x) => { if (x.email !== rec.email) return; x.verified = true; addPoints(x, 'verify', PTS.verify, 'Confirmed email'); }).catch(() => null);
    if (u && u.verified) await creditReferrer(u);
    return { redirect: '/Account.dc.html?verify=ok' };
  }
};

const acct = async (req, id, fn) => { const u = await updateUser(id, fn); return accountPayload(req, u); };

export const accountRoutes = {
  async 'GET /api/account'(req) { const u = await requireUser(req); return accountPayload(req, u); },
  async 'POST /api/account/watch'(req, ctx, b) {
    const u = await requireUser(req);
    const slug = String(b.slug || '');
    if (!casinoBySlug(slug)) fail(400, 'Unknown casino');
    return acct(req, u.id, (x) => {
      const has = x.watchlist.includes(slug);
      if (b.on && !has) {
        const lv = levelOf(points(x));
        if (x.watchlist.length >= lv.watch) fail(400, 'Your watchlist is full (' + lv.watch + ' casinos). Earn points to reach the next level for more.');
        x.watchlist.push(slug);
        if (x.watchlist.length >= 3) addPoints(x, 'watch3', PTS.watch3, 'Watched 3 casinos');
      } else if (!b.on && has) x.watchlist = x.watchlist.filter((s) => s !== slug);
    });
  },
  async 'POST /api/account/alerts'(req, ctx, b) {
    const u = await requireUser(req);
    return acct(req, u.id, (x) => {
      if (b.min != null) {
        const v = Number(b.min), lv = levelOf(points(x));
        if (!ALERT_OPTIONS.some((o) => o[0] === v)) fail(400, 'Pick one of the listed amounts');
        if (v < lv.alertMin) fail(403, 'That alert size unlocks at a higher level');
        x.alerts.min = v;
      }
      if (b.email != null) {
        if (b.email && !mailReady()) fail(400, 'Email alerts are not available yet');
        if (b.email && !x.verified) fail(400, 'Confirm your email first');
        x.alerts.email = !!b.email;
      }
      if (b.telegram != null) {
        if (b.telegram && !x.tg) fail(400, 'Connect Telegram first');
        x.alerts.telegram = !!b.telegram;
      }
    });
  },
  async 'POST /api/account/profile'(req, ctx, b) {
    const u = await requireUser(req);
    const name = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
    if (!name) fail(400, 'Enter a name');
    return acct(req, u.id, (x) => { x.name = name; x.marketing = !!b.marketing; });
  },
  async 'POST /api/account/password'(req, ctx, b) {
    const u = await requireUser(req);
    checkNewPw(b.password);
    if (u.pw && !(await checkPw(String(b.current || ''), u.pw))) fail(400, 'Your current password is not right.');
    const pw = await hashPw(b.password);
    const nu = await updateUser(u.id, (x) => { x.pw = pw; x.sessVer++; });
    return { body: await accountPayload(req, nu), cookie: await startSession(nu) };
  },
  async 'POST /api/account/logout-all'(req) {
    const u = await requireUser(req);
    const nu = await updateUser(u.id, (x) => { x.sessVer++; });
    return { body: await accountPayload(req, nu), cookie: await startSession(nu) };
  },
  async 'POST /api/account/delete'(req, ctx, b) {
    const u = await requireUser(req);
    if (String(b.confirm || '') !== 'DELETE') fail(400, 'Type DELETE to confirm.');
    if (u.pw && !(await checkPw(String(b.password || ''), u.pw))) fail(400, 'Your password is not right.');
    await deleteUser(u);
    return { body: { ok: true }, cookie: clearCookie() };
  },
  async 'POST /api/account/resend'(req, ctx) {
    const u = await requireUser(req);
    if (u.verified) fail(400, 'Your email is already confirmed.');
    if (!mailReady()) fail(503, 'Email is not set up on this server yet.');
    await limit('resend:' + u.id, 3, 3600);
    await sendVerify(req, u);
    return accountPayload(req, u);
  },
  async 'POST /api/account/reveal'(req, ctx, b) {
    const u = await requireUser(req);
    const codes = (await content().get('codes')) || [];
    const c = codes.find((x) => String(x.id) === String(b.id) && x.active !== false);
    if (!c) fail(404, 'That offer has ended');
    if (levelRank(c.level || 'Member') > LEVELS.indexOf(levelOf(points(u)))) fail(403, 'This code unlocks at ' + c.level);
    if (!u.revealed.includes(c.id)) {
      await updateUser(u.id, (x) => { if (!x.revealed.includes(c.id)) x.revealed.push(c.id); });
      await update(content(), 'codeClaims', (m) => { m[c.id] = (m[c.id] || 0) + 1; return m; }, {});
    }
    return { code: c.code, url: c.url || '' };
  },
  async 'POST /api/account/telegram'(req) {
    const u = await requireUser(req);
    if (!tgReady()) fail(400, 'Telegram alerts are not available yet');
    const t = rand(18);
    await tokens().set('tg/' + t, { uid: u.id, exp: Date.now() + 15 * 60000 });
    return { url: 'https://t.me/' + process.env.TELEGRAM_BOT_NAME + '?start=' + t };
  },
  async 'POST /api/account/telegram-off'(req) {
    const u = await requireUser(req);
    return acct(req, u.id, (x) => { x.tg = null; x.alerts.telegram = false; });
  },
  // Public code feed. Codes stay hidden until a member reveals them.
  async 'GET /api/codes'(req) {
    const u = await currentUser(req);
    const codes = (await content().get('codes')) || [];
    const claims = (await content().get('codeClaims')) || {};
    const lvi = u ? LEVELS.indexOf(levelOf(points(u))) : -1;
    return {
      member: !!u,
      codes: codes.filter((c) => c.active !== false).map((c) => {
        const cas = casinoBySlug(c.casino) || {};
        const revealed = !!(u && u.revealed.includes(c.id));
        return {
          id: c.id, casino: c.casino || '', casinoName: c.casinoName || cas.name || '', domain: c.domain || cas.domain || '', title: c.title, terms: c.terms || '', level: c.level || 'Member',
          value: c.value != null ? Number(c.value) : null, wager: c.wager != null ? Number(c.wager) : null, exclusive: !!c.exclusive, created: c.created || null, claims: claims[c.id] || 0,
          locked: u ? levelRank(c.level || 'Member') > lvi : null, revealed, code: revealed ? c.code : '', url: revealed ? c.url || '' : ''
        };
      }).sort((a, b) => (b.created || 0) - (a.created || 0))
    };
  },
  // Monthly points ranking. Names are shortened ("Sam C.") so members stay private.
  async 'GET /api/leaderboard'(req) {
    const past = new URL(req.url).searchParams.get('period') === 'past';
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (past ? 1 : 0), 1), end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (past ? 0 : 1), 1);
    const key = 'leaderboard:' + start;
    const cache = store('cache');
    const hit = await cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60000) return hit;
    const keys = await users().list('u/');
    const rows = [];
    for (const k of keys) {
      const u = await users().get(k);
      if (!u || u.hideFromBoard) continue;
      const month = (u.history || []).filter((h) => h.ts >= start && h.ts < end).reduce((s, h) => s + h.delta, 0);
      if (month <= 0) continue;
      const p = points(u);
      rows.push({ name: publicName(u), points: month, total: p, level: levelOf(p).name });
    }
    rows.sort((a, b) => b.points - a.points || b.total - a.total);
    const out = { at: Date.now(), start, end, label: new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), members: rows.length, rows: rows.slice(0, 25) };
    await cache.set(key, out);
    return out;
  }
};

// Telegram bot webhook: "/start <token>" links a chat to an account.
export async function telegramWebhook(req) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) fail(403, 'Forbidden');
  const upd = await req.json().catch(() => ({}));
  const msg = upd.message;
  if (!msg || !msg.text || !msg.chat) return { ok: true };
  const { tgSend } = await import('./notify.mjs');
  const m = msg.text.match(/^\/start\s+([A-Za-z0-9_-]+)/);
  if (!m) { await tgSend(msg.chat.id, 'Open your Streax account page and press Connect to link this chat.'); return { ok: true }; }
  const key = 'tg/' + m[1];
  const t = await tokens().get(key);
  if (!t || t.exp < Date.now()) { await tgSend(msg.chat.id, 'That link has expired. Press Connect on your Streax account page again.'); return { ok: true }; }
  await tokens().del(key);
  const name = msg.from && (msg.from.username ? '@' + msg.from.username : msg.from.first_name) || '';
  await updateUser(t.uid, (x) => { x.tg = { chatId: msg.chat.id, name }; x.alerts.telegram = true; addPoints(x, 'telegram', PTS.telegram, 'Connected Telegram'); });
  await tgSend(msg.chat.id, 'Connected. Whale alerts for your Streax watchlist will arrive here.');
  return { ok: true };
}

export { hashPw, checkPw, cleanEmail, rand, sha, PTS };
