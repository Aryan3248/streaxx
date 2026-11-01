// Streax API: one function serving /api/*, /auth/* and /r/* (invite links).
import { json, redirect, csv, body as readBody, HttpError, fail, clientIp } from '../lib/http.mjs';
import { authRoutes, accountRoutes, telegramWebhook, currentUser } from '../lib/accounts.mjs';
import { complaintRoutes, trustRoutes } from '../lib/complaints.mjs';
import { adminRoutes, checkAdmin } from '../lib/admin.mjs';
import { communityRoutes, communityAdminRoutes } from '../lib/community.mjs';
import { googleStart, googleCallback } from '../lib/google.mjs';
import { real } from '../lib/real.mjs';
import { walletCheck } from '../lib/walletcheck.mjs';
import * as onchain from '../lib/onchain.mjs';
import * as markets from '../lib/markets.mjs';
import * as odds from '../lib/odds.mjs';
import * as health from '../lib/health.mjs';

const memberOrLogin = async (req) => {
  const u = await currentUser(req);
  if (!u) return redirect('/Login.dc.html?next=' + encodeURIComponent('/Account.dc.html'));
  return null;
};
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

const dataRoutes = {
  'GET /api/real': () => real(),
  'GET /api/wallet-check': (req, ctx) => walletCheck(req, ctx),
  'POST /api/telegram/webhook': (req) => telegramWebhook(req),
  async 'GET /api/onchain/overview'(req) {
    const win = new URL(req.url).searchParams.get('window') || '24h';
    if (win !== '24h' && !(await currentUser(req))) fail(401, 'Log in to see 7-day and 30-day history');
    return onchain.overview(win);
  },
  'GET /api/onchain/whales': (req) => { const q = new URL(req.url).searchParams; return onchain.whaleList(num(q.get('limit'), 60, 1, 200), num(q.get('min'), 50000, 10000, 1e12)); },
  'GET /api/onchain/tokens': () => onchain.tokens(),
  'GET /api/onchain/top': (req) => { const q = new URL(req.url).searchParams; return onchain.topWhales(num(q.get('days'), 7, 1, 90), ['in', 'out'].includes(q.get('dir')) ? q.get('dir') : '', 10); },
  'GET /api/onchain/trend': () => onchain.trend(),
  'GET /api/live/casinos': () => onchain.liveCasinos(),
  'GET /api/health': () => health.healthAll(),
  'GET /api/payout-check': (req) => { const q = new URL(req.url).searchParams; return health.payoutCheck(q.get('c') || '', q.get('amount')); },
  'GET /api/brief': () => health.brief(),
  'GET /api/casino/:slug/profile': (req, ctx) => onchain.profile(ctx.params.slug),
  'GET /api/markets': (req) => { const q = new URL(req.url).searchParams; return markets.breakdown(q.get('window') || '7d', q.get('kind') === 'unboxing' ? 'unboxing' : 'casino'); },
  'GET /api/markets/providers': (req) => markets.providers(new URL(req.url).searchParams.get('window') || '30d'),
  'GET /api/odds/leagues': () => ({ ready: odds.oddsReady(), leagues: odds.FEATURED.map(([key, name]) => ({ key, name })) }),
  'GET /api/odds/league/:sport': (req, ctx) => odds.league(ctx.params.sport),
  'GET /api/odds/books': () => odds.bookRanking(),
  'POST /api/odds/slip': (req, ctx, b) => odds.checkSlip(b.text),
  'GET /api/odds/predictions': () => odds.predictions().catch((e) => { console.error('predictions', e && e.message); return { events: [], unavailable: true }; }),
  async 'GET /api/onchain/analytics'(req) {
    const days = [7, 30, 90].includes(Number(new URL(req.url).searchParams.get('days'))) ? Number(new URL(req.url).searchParams.get('days')) : 30;
    return onchain.analytics(days);
  },
  async 'GET /api/onchain/casino/:slug'(req, ctx) {
    const days = [7, 30, 90].includes(Number(new URL(req.url).searchParams.get('days'))) ? Number(new URL(req.url).searchParams.get('days')) : 7;
    if (days > 7 && !(await currentUser(req))) fail(401, 'Log in to see 30-day and 90-day history');
    const d = await onchain.casinoDetail(ctx.params.slug, days);
    if (!d) fail(404, 'No tracked wallets for this casino yet');
    return d;
  },
  async 'GET /api/onchain/export/flows.csv'(req) {
    const r = await memberOrLogin(req); if (r) return { response: r };
    const win = new URL(req.url).searchParams.get('window') || '24h';
    return { response: csv('streax-flows-' + win + '.csv', await onchain.flowsCsvRows(win)) };
  },
  async 'GET /api/onchain/export/whales.csv'(req) {
    const r = await memberOrLogin(req); if (r) return { response: r };
    const q = new URL(req.url).searchParams, days = num(q.get('days'), 30, 1, 90), min = num(q.get('min'), 10000, 10000, 1e12);
    return { response: csv('streax-whales-' + days + 'd.csv', await onchain.whalesCsvRows(days, min)) };
  },
  async 'GET /api/onchain/export/casino/:file'(req, ctx) {
    const r = await memberOrLogin(req); if (r) return { response: r };
    const slug = ctx.params.file.replace(/\.csv$/, ''), days = [7, 30, 90].includes(Number(new URL(req.url).searchParams.get('days'))) ? Number(new URL(req.url).searchParams.get('days')) : 90;
    const rows = await onchain.casinoCsvRows(slug, days);
    if (!rows) fail(404, 'No tracked wallets for this casino yet');
    return { response: csv('streax-' + slug + '-' + days + 'd.csv', rows) };
  },
  'GET /auth/google': (req) => googleStart(req),
  'GET /auth/google/callback': (req) => googleCallback(req),
  'GET /r/:code': (req, ctx) => ({ redirect: '/Signup.dc.html?ref=' + encodeURIComponent(ctx.params.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)) })
};

const ROUTES = [];
function add(table, admin = false) {
  Object.entries(table).forEach(([k, fn]) => {
    const [method, pattern] = k.split(' ');
    const names = [];
    const re = new RegExp('^' + pattern.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (m, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
    ROUTES.push({ method, re, names, fn, admin, literal: !names.length });
  });
}
add(authRoutes); add(accountRoutes); add(complaintRoutes); add(trustRoutes); add(dataRoutes); add(communityRoutes); add(adminRoutes, true); add(communityAdminRoutes, true);
// literal paths win over patterns (e.g. /api/complaints/mine before /api/complaints/:ref)
ROUTES.sort((a, b) => b.literal - a.literal);

export default async function handler(req, context) {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    let pathHit = false;
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (!m) continue;
      pathHit = true;
      if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      if (r.admin) checkAdmin(req);
      if (req.method === 'POST' || req.method === 'PUT') {
        const ct = req.headers.get('content-type') || '';
        if (path !== '/api/telegram/webhook' && !ct.includes('application/json')) fail(415, 'Send JSON');
        // same-site check for browser form posts
        const origin = req.headers.get('origin');
        if (origin && !r.admin && path !== '/api/telegram/webhook' && new URL(origin).host !== url.host) fail(403, 'Cross-site request blocked');
      }
      const b = req.method === 'POST' || req.method === 'PUT' ? (path === '/api/telegram/webhook' ? null : await readBody(req)) : null;
      const ctx = { ip: clientIp(req, context), params };
      const out = await r.fn(req, ctx, b || {});
      return toResponse(out);
    }
    return json({ error: pathHit ? 'Method not allowed' : 'Not found' }, pathHit ? 405 : 404);
  } catch (e) {
    if (e instanceof HttpError) {
      if (path.startsWith('/auth/')) return redirect('/Login.dc.html?err=failed');
      return json({ error: e.message, field: e.field, code: e.code }, e.status);
    }
    console.error(req.method, path, e);
    if (path.startsWith('/auth/')) return redirect('/Login.dc.html?err=failed');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

function toResponse(out) {
  if (out instanceof Response) return out;
  if (out && out.response) return out.response;
  const cookies = out && (out.cookies || (out.cookie ? [out.cookie] : null));
  let res;
  if (out && out.redirect) res = redirect(out.redirect);
  else if (out && (out.body !== undefined && (out.cookie || out.cookies))) res = json(out.body);
  else res = json(out == null ? { ok: true } : out);
  if (cookies) cookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
}

export const config = { path: ['/api/*', '/auth/*', '/r/*'] };
