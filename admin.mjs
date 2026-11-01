// Admin API (Authorization: Bearer ADMIN_TOKEN): complaint moderation, payout
// reports, member codes, casino reviews, articles and the wallet registry.
import crypto from 'node:crypto';
import { fail, siteUrl } from './http.mjs';
import { store, update } from './store.mjs';
import { content } from './accounts.mjs';
import { adminQueue, adminComplaint, adminComplaintAction, adminPayout } from './complaints.mjs';
import { getRegistry, casinoBySlug, CHAIN_NAMES, explorerAddr, norm, SITE, customSites, KINDS } from './data.mjs';
import { etherscan, etherscanKey, tronTransfers } from './chain.mjs';
import { mailReady, tgReady, tgSetWebhook } from './notify.mjs';
import { status as monitorStatus } from './onchain.mjs';

export function checkAdmin(req) {
  const want = process.env.ADMIN_TOKEN || '';
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (want.length < 16) fail(503, 'Set ADMIN_TOKEN (16+ characters) in the Netlify environment to use the admin tools.');
  const a = crypto.createHash('sha256').update(got).digest(), b = crypto.createHash('sha256').update(want).digest();
  if (!crypto.timingSafeEqual(a, b)) fail(401, 'Wrong admin token');
}

const list = (key, fallback) => ({
  [`GET /api/admin/${key}`]: async () => ({ [key]: (await content().get(key)) || fallback }),
  [`PUT /api/admin/${key}`]: async (req, ctx, b) => {
    const v = b[key];
    if (Array.isArray(fallback) ? !Array.isArray(v) : !(v && typeof v === 'object' && !Array.isArray(v))) fail(400, 'Send { "' + key + '": ' + (Array.isArray(fallback) ? '[...]' : '{...}') + ' }');
    if (key === 'codes') {
      // stamp new codes with their drop time so the code feed can sort and show "dropped"
      const old = (await content().get('codes')) || [];
      v.forEach((c) => { if (!c.created) { const prev = old.find((o) => String(o.id) === String(c.id)); c.created = prev && prev.created ? prev.created : Date.now(); } });
    }
    await content().set(key, v);
    return { [key]: v };
  }
});

export const adminRoutes = {
  async 'GET /api/admin/status'(req) {
    return {
      monitor: await monitorStatus(),
      ready: { etherscan: !!etherscanKey(), email: mailReady(), telegram: tgReady(), google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), odds: !!process.env.ODDS_API_KEY },
      site: siteUrl(req),
      casinos: SITE.idx.map((c) => ({ slug: c[1], name: c[0] })).concat((await customSites()).map((x) => ({ slug: x.slug, name: x.name + (x.kind === 'unboxing' ? ' (unboxing)' : '') })))
    };
  },
  async 'GET /api/admin/settings'() { return { settings: (await content().get('settings')) || { liveOnly: false } }; },
  async 'PUT /api/admin/settings'(req, ctx, b) {
    const s = { ...((await content().get('settings')) || {}) };
    if (b.liveOnly != null) s.liveOnly = !!b.liveOnly;
    await content().set('settings', s);
    return { settings: s };
  },
  'GET /api/admin/queue': () => adminQueue(),
  'GET /api/admin/complaints/:ref': (req, ctx) => adminComplaint(ctx.params.ref),
  'POST /api/admin/complaints/:ref': (req, ctx, b) => adminComplaintAction(ctx.params.ref, b),
  'POST /api/admin/payouts/:id': (req, ctx, b) => adminPayout(ctx.params.id, b.status),
  ...list('codes', []),
  ...list('reviews', {}),
  ...list('articles', []),
  async 'GET /api/admin/wallets'() { return { registry: await getRegistry(), extra: (await store('onchain').get('extraWallets')) || [] }; },
  async 'POST /api/admin/wallets'(req, ctx, b) {
    const slug = String(b.slug || ''), chain = String(b.chain || '');
    await customSites();
    if (!casinoBySlug(slug)) fail(400, 'Unknown casino slug');
    if (!['ethereum', 'tron'].includes(chain)) fail(400, 'The monitor reads Ethereum and Tron wallets');
    const address = String(b.address || '').trim();
    if (chain === 'ethereum' ? !/^0x[0-9a-fA-F]{40}$/.test(address) : !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) fail(400, 'That address is not valid for ' + CHAIN_NAMES[chain]);
    const role = ['hot', 'wallet', 'cold', 'funder'].includes(b.role) ? b.role : 'wallet';
    const w = { slug, chain, chainName: CHAIN_NAMES[chain], address, label: String(b.label || casinoBySlug(slug).name).slice(0, 80), role, source: String(b.source || 'Deposit trace').slice(0, 120), url: explorerAddr(chain, address) };
    await update(store('onchain'), 'extraWallets', (l) => { if (l.some((x) => x.chain === chain && norm(chain, x.address) === norm(chain, address))) fail(400, 'That wallet is already added'); l.push(w); return l; }, []);
    return { ok: true, wallet: w };
  },
  // Sites admins add: unboxing sites, or casinos missing from the published list.
  async 'GET /api/admin/sites'() { return { sites: (await store('onchain').get('sites')) || [], providers: (await store('onchain').get('providers')) || [] }; },
  async 'POST /api/admin/sites'(req, ctx, b) {
    const name = String(b.name || '').trim().slice(0, 60), kind = KINDS.includes(b.kind) ? b.kind : 'unboxing';
    if (!name) fail(400, 'Give the site a name', { field: 'name' });
    const slug = String(b.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);
    const domain = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 80);
    if (casinoBySlug(slug) && !(await customSites()).some((x) => x.slug === slug)) fail(400, 'A casino with that name already exists');
    await update(store('onchain'), 'sites', (l) => { const i = l.findIndex((x) => x.slug === slug); const v = { slug, name, domain, kind }; if (i >= 0) l[i] = v; else l.push(v); return l; }, []);
    await customSites();
    return { ok: true, site: { slug, name, domain, kind } };
  },
  async 'POST /api/admin/sites/remove'(req, ctx, b) {
    await update(store('onchain'), 'sites', (l) => l.filter((x) => x.slug !== b.slug), []);
    await update(store('onchain'), 'extraWallets', (l) => l.filter((x) => x.slug !== b.slug), []);
    return { ok: true };
  },
  // Game providers and the casinos that carry them.
  async 'POST /api/admin/providers'(req, ctx, b) {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) fail(400, 'Give the provider a name', { field: 'name' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);
    await customSites();
    const casinos = [...new Set((Array.isArray(b.casinos) ? b.casinos : String(b.casinos || '').split(',')).map((x) => String(x).trim()).filter((x) => casinoBySlug(x)))];
    const v = { slug, name, domain: String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 80), casinos, rtp: String(b.rtp || '').slice(0, 40), source: String(b.source || '').slice(0, 160) };
    await update(store('onchain'), 'providers', (l) => { const i = l.findIndex((x) => x.slug === slug); if (i >= 0) l[i] = v; else l.push(v); return l; }, []);
    return { ok: true, provider: v };
  },
  async 'POST /api/admin/providers/remove'(req, ctx, b) {
    await update(store('onchain'), 'providers', (l) => l.filter((x) => x.slug !== b.slug), []);
    return { ok: true };
  },
  async 'POST /api/admin/wallets/remove'(req, ctx, b) {
    await update(store('onchain'), 'extraWallets', (l) => l.filter((x) => !(x.chain === b.chain && norm(b.chain, x.address) === norm(b.chain, String(b.address || '')))), []);
    return { ok: true };
  },
  // Where did coins sent to this (deposit) address go? Suggests the casino wallet.
  async 'GET /api/admin/trace'(req) {
    const q = new URL(req.url).searchParams, chain = q.get('chain') || 'ethereum', address = String(q.get('address') || '').trim();
    const reg = await getRegistry();
    const owner = new Map();
    reg.forEach((c) => c.wallets.forEach((w) => owner.set(w.chain + ':' + norm(w.chain, w.address), c.slug)));
    let outs = [];
    if (chain === 'tron') {
      const r = await tronTransfers(address, Date.now() - 30 * 86400000, 2);
      outs = r.items.filter((t) => t.from === address);
    } else {
      const p = { module: 'account', address: address.toLowerCase(), startblock: '0', endblock: '999999999', page: '1', offset: '200', sort: 'desc' };
      const [a, t] = await Promise.all([etherscan(chain, { ...p, action: 'txlist' }), etherscan(chain, { ...p, action: 'tokentx' })]);
      outs = a.concat(t).filter((r) => r.from.toLowerCase() === address.toLowerCase()).map((r) => ({ to: r.to.toLowerCase(), asset: r.tokenSymbol || 'ETH', ts: Number(r.timeStamp) * 1000, hash: r.hash }));
    }
    const by = {};
    outs.forEach((t) => { const x = (by[t.to] = by[t.to] || { address: t.to, count: 0, last: 0, assets: new Set(), knownAs: owner.get(chain + ':' + norm(chain, t.to)) || null }); x.count++; x.last = Math.max(x.last, t.ts); x.assets.add(t.asset); });
    return { chain, address, destinations: Object.values(by).map((x) => ({ ...x, assets: [...x.assets], url: explorerAddr(chain, x.address) })).sort((a, b) => b.count - a.count) };
  },
  async 'POST /api/admin/run-monitor'(req) {
    // Render/own server, or Netlify paid with background functions
    if (process.env.STREAX_SERVER === '1' || process.env.STREAX_BACKGROUND === '1') {
      const r = await fetch(siteUrl(req) + '/.netlify/functions/monitor-background', { method: 'POST', headers: { 'x-streax-key': process.env.ADMIN_TOKEN } });
      return { started: r.status === 202 || r.ok, status: r.status };
    }
    // Netlify free plan: read a short slice right here (the 10-minute schedule does the rest)
    const { slice } = await import('../functions/monitor-tick.mjs');
    return { ...(await slice(6000)), status: 200 };
  },
  async 'POST /api/admin/telegram-webhook'(req) {
    if (!tgReady()) fail(400, 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_NAME first');
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) fail(400, 'Set TELEGRAM_WEBHOOK_SECRET first');
    return tgSetWebhook(siteUrl(req) + '/api/telegram/webhook');
  }
};
