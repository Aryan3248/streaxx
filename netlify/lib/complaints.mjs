// Player complaints, payout-speed reports and the trust data built from them.
import { store, update } from './store.mjs';
import { fail } from './http.mjs';
import { casinoBySlug, CHAIN_NAMES, explorerTx, getRegistry, norm } from './data.mjs';
import { requireUser, currentUser, publicName, updateUser, addPoints, PTS, content } from './accounts.mjs';
import { lookupTx } from './chain.mjs';
import { depositAddressIndex, reserves } from './onchain.mjs';

const D = 86400000;
const db = () => store('complaints');
const CATS = { withdrawal: 'Withdrawal delayed or refused', deposit: 'Deposit not credited', kyc: 'KYC or verification', account: 'Account closed or funds held', bonus: 'Bonus or promotion terms', fairness: 'Game fairness or RTP', rg: 'Self-exclusion or limits ignored', support: 'Support not answering', other: 'Something else' };
const STATUS_NAME = { review: 'Being checked', waiting: 'Waiting for the casino', proposed: 'Casino says it is fixed', resolved: 'Resolved', unresolved: 'Unresolved', rejected: 'Rejected' };
const PUBLIC = new Set(['waiting', 'proposed', 'resolved', 'unresolved']);
const PAGE = 10;

const summary = (c) => ({ ref: c.ref, uid: c.uid, casino: c.casino, casinoName: c.casinoName, category: c.category, categoryName: c.categoryName, title: c.title, excerpt: c.body.slice(0, 160) + (c.body.length > 160 ? '...' : ''), amount: c.amount, status: c.status, updated: c.updated, created: c.created, closed: !!c.closed, tx: c.tx ? { check: { status: c.tx.check.status } } : null });
const view = (c, u) => { const { uid, ...rest } = c; return { ...rest, statusName: STATUS_NAME[c.status], mine: !!(u && u.id === uid) }; };
const clean = (s, max) => String(s || '').replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, max);

async function save(c) {
  await db().set('c/' + c.ref, c);
  await update(db(), 'index', (ix) => { ix.items[c.ref] = summary(c); return ix; }, { seq: 1000, items: {} });
}
async function load(ref) { return /^SX-\d+$/.test(ref) ? db().get('c/' + ref) : null; }

// Close complaints whose deadline passed. Returns the (possibly updated) complaint.
function settle(c, now = Date.now()) {
  if (c.closed || !c.deadline || c.deadline > now) return false;
  if (c.status === 'waiting' && !c.casinoReplied) {
    Object.assign(c, { status: 'unresolved', closed: true, closedAt: now, updated: now, outcome: 'The casino did not reply within 7 days.' });
    c.events.push({ ts: now, who: 'streax', name: 'Streax', kind: 'status', body: 'Closed as unresolved: the casino did not reply in time.' });
    return true;
  }
  if (c.status === 'proposed') {
    Object.assign(c, { status: 'resolved', closed: true, closedAt: now, updated: now, outcome: 'The casino reported a fix and the player did not dispute it within 14 days.' });
    c.events.push({ ts: now, who: 'streax', name: 'Streax', kind: 'status', body: 'Closed as resolved: no answer from the player within 14 days.' });
    return true;
  }
  return false;
}
export async function settleAll() {
  const ix = (await db().get('index')) || { items: {} };
  const now = Date.now();
  for (const s of Object.values(ix.items)) {
    if (s.closed || !(s.status === 'waiting' || s.status === 'proposed')) continue;
    const c = await load(s.ref);
    if (c && settle(c, now)) await save(c);
  }
}

async function checkTx(chain, hash, slug, mode) {
  const out = { chain, chainName: CHAIN_NAMES[chain] || chain, hash, url: explorerTx(chain, hash), check: { status: 'pending', note: 'Streax checks it by hand.' } };
  let tx = null;
  try { tx = await lookupTx(chain, hash); } catch { return { out, tx: null }; }
  if (!tx) return { out, tx: null };
  const reg = await getRegistry();
  const owner = new Map();
  reg.forEach((c) => c.wallets.forEach((w) => { if (w.chain === chain) owner.set(norm(chain, w.address), c.slug); }));
  const deps = mode === 'complaint' ? await depositAddressIndex() : new Map();
  let mine = false, other = '';
  tx.transfers.forEach((t) => {
    const sides = mode === 'payout' ? [t.from] : [t.from, t.to];
    sides.forEach((a) => {
      const s = owner.get(norm(chain, a)) || deps.get(chain + ':' + norm(chain, a));
      if (s === slug) mine = true; else if (s) other = s;
    });
  });
  const when = new Date(tx.ts).toUTCString().slice(5, 22) + ' UTC';
  if (mine) out.check = { status: 'matched', note: (mode === 'payout' ? 'Coins left a ' : 'Coins moved through a ') + (casinoBySlug(slug) || { name: slug }).name + ' wallet on ' + when + '.' };
  else if (other) out.check = { status: 'other', note: 'The transaction belongs to ' + (casinoBySlug(other) || { name: other }).name + '.' };
  else out.check = { status: 'pending', note: 'Not matched to a tracked wallet yet. Streax checks it by hand.' };
  return { out, tx };
}

export const complaintRoutes = {
  async 'GET /api/complaints'(req) {
    const q = new URL(req.url).searchParams;
    const u = await currentUser(req);
    const ix = (await db().get('index')) || { items: {} };
    const all = Object.values(ix.items);
    const casino = q.get('casino') || '', status = q.get('status') || '';
    const pub = all.filter((c) => PUBLIC.has(c.status) || c.status === 'rejected').filter((c) => !casino || c.casino === casino);
    const counts = { total: 0, resolved: 0, unresolved: 0, rejected: 0, open: 0, amountResolved: 0 };
    pub.forEach((c) => {
      if (c.status === 'rejected') { counts.rejected++; return; }
      counts.total++;
      if (c.status === 'resolved') { counts.resolved++; counts.amountResolved += c.amount || 0; } else if (c.status === 'unresolved') counts.unresolved++; else counts.open++;
    });
    let rows = pub.filter((c) => !status || (status === 'open' ? c.status === 'waiting' || c.status === 'proposed' : c.status === status));
    rows.sort((a, b) => b.updated - a.updated);
    const per = Math.min(50, Math.max(1, parseInt(q.get('per') || String(PAGE), 10) || PAGE));
    const pages = Math.max(1, Math.ceil(rows.length / per)), page = Math.min(pages, Math.max(1, parseInt(q.get('page') || '1', 10) || 1));
    rows = rows.slice((page - 1) * per, page * per).map(({ uid, ...c }) => ({ ...c, mine: !!(u && u.id === uid) }));
    return { complaints: rows, total: pub.length, page, pages, counts };
  },
  async 'GET /api/complaints/mine'(req) {
    const u = await requireUser(req);
    const ix = (await db().get('index')) || { items: {} };
    const pays = ((await db().get('payouts')) || { items: [] }).items.filter((p) => p.uid === u.id);
    return {
      complaints: Object.values(ix.items).filter((c) => c.uid === u.id).sort((a, b) => b.updated - a.updated).map(({ uid, ...c }) => c),
      payouts: pays.sort((a, b) => b.created - a.created).map((p) => ({ id: p.id, casino: p.casino, casinoName: p.casinoName, status: p.status, minutes: p.minutes, created: p.created }))
    };
  },
  async 'GET /api/complaints/:ref'(req, ctx) {
    const c = await load(ctx.params.ref);
    const u = await currentUser(req);
    if (!c || (c.status === 'review' && !(u && u.id === c.uid))) fail(404, 'Not found');
    if (settle(c)) await save(c);
    return { complaint: view(c, u) };
  },
  async 'POST /api/complaints'(req, ctx, b) {
    const u = await requireUser(req);
    const cas = casinoBySlug(String(b.casino || ''));
    if (!cas) fail(400, 'Choose the casino.', { field: 'casino' });
    if (!CATS[b.category]) fail(400, 'Pick what went wrong.', { field: 'category' });
    const title = clean(b.title, 120), body = clean(b.body, 6000);
    if (title.length < 8) fail(400, 'Give it a short title of at least 8 characters.', { field: 'title' });
    if (body.length < 60) fail(400, 'Describe what happened in at least 60 characters.', { field: 'body' });
    if (b.agree !== true) fail(400, 'Tick the box to confirm the complaint is accurate.', { field: 'agree' });
    const amount = b.amount === '' || b.amount == null ? null : Number(String(b.amount).replace(/[$,\s]/g, ''));
    if (amount != null && !(amount >= 0 && amount < 1e9)) fail(400, 'Enter the amount as a number.', { field: 'amount' });
    const ix = (await db().get('index')) || { items: {} };
    const open = Object.values(ix.items).filter((c) => c.uid === u.id && !c.closed && c.status !== 'rejected');
    if (open.some((c) => c.casino === cas.slug)) fail(400, 'You already have an open complaint about ' + cas.name + '. Add new details to it instead.');
    if (open.length >= 5) fail(400, 'You have 5 open complaints. Wait for one to close first.');
    const chain = CHAIN_NAMES[b.chain] ? b.chain : 'ethereum';
    const hash = clean(b.tx, 100);
    let tx = null;
    if (hash) {
      if (!(/^(0x)?[0-9a-fA-F]{64}$/.test(hash) || /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(hash))) fail(400, 'That does not look like a transaction hash.', { field: 'tx' });
      tx = (await checkTx(chain, hash, cas.slug, 'complaint')).out;
    }
    const now = Date.now();
    const next = await update(db(), 'index', (x) => { x.seq = (x.seq || 1000) + 1; return x; }, { seq: 1000, items: {} });
    const c = {
      ref: 'SX-' + next.seq, uid: u.id, player: publicName(u), casino: cas.slug, casinoName: cas.name, category: b.category, categoryName: CATS[b.category], title, body, amount,
      tx, status: 'review', created: now, updated: now, deadline: null, closed: false, closedAt: null, outcome: '', casinoReplied: false,
      events: [{ ts: now, who: 'player', name: publicName(u), kind: 'status', body: 'Complaint filed. Streax checks every complaint before it is sent to the casino, usually within 2 working days.' }]
    };
    await save(c);
    return { complaint: view(c, u) };
  },
  async 'POST /api/complaints/:ref/reply'(req, ctx, b) {
    const u = await requireUser(req);
    const c = await load(ctx.params.ref);
    if (!c || c.uid !== u.id) fail(404, 'Not found');
    if (c.closed) fail(400, 'This complaint is closed.');
    const text = clean(b.body, 3000);
    if (text.length < 2) fail(400, 'Write your update first');
    c.events.push({ ts: Date.now(), who: 'player', name: c.player, kind: 'message', body: text });
    c.updated = Date.now();
    await save(c);
    return { complaint: view(c, u) };
  },
  async 'POST /api/complaints/:ref/confirm'(req, ctx, b) {
    const u = await requireUser(req);
    const c = await load(ctx.params.ref);
    if (!c || c.uid !== u.id) fail(404, 'Not found');
    if (c.status !== 'proposed') fail(400, 'There is no fix to confirm right now.');
    const now = Date.now();
    if (b.resolved === true) {
      Object.assign(c, { status: 'resolved', closed: true, closedAt: now, updated: now, outcome: c.outcome || 'The player confirmed the casino fixed it.' });
      c.events.push({ ts: now, who: 'player', name: c.player, kind: 'status', body: 'Confirmed: the casino fixed it.' });
    } else {
      Object.assign(c, { status: 'waiting', deadline: now + 7 * D, updated: now, casinoReplied: false });
      c.events.push({ ts: now, who: 'player', name: c.player, kind: 'status', body: 'Not fixed yet.' + (clean(b.body, 3000) ? ' ' + clean(b.body, 3000) : '') });
    }
    await save(c);
    return { complaint: view(c, u) };
  },
  async 'POST /api/payouts'(req, ctx, b) {
    const u = await requireUser(req);
    const cas = casinoBySlug(String(b.casino || ''));
    if (!cas) fail(400, 'Choose the casino.', { field: 'casino' });
    const chain = CHAIN_NAMES[b.chain] ? b.chain : 'ethereum';
    const hash = clean(b.tx, 100);
    if (!hash) fail(400, 'Paste the transaction hash of the payout.', { field: 'tx' });
    const reqAt = Number(b.requestedAt);
    if (!(reqAt > 0) || reqAt > Date.now() + 60000) fail(400, 'Enter when you asked for the withdrawal.', { field: 'requestedAt' });
    const all = ((await db().get('payouts')) || { items: [] }).items;
    if (all.some((p) => p.hash.toLowerCase() === hash.toLowerCase())) fail(400, 'This transaction was already reported.', { field: 'tx' });
    const { out, tx } = await checkTx(chain, hash, cas.slug, 'payout');
    const got = Number(b.receivedAt) > 0 ? Number(b.receivedAt) : tx ? tx.ts : Date.now();
    if (got < reqAt) fail(400, 'The payout time is before the request time.', { field: 'receivedAt' });
    const minutes = Math.max(1, Math.round((got - reqAt) / 60000));
    const matched = out.check.status === 'matched';
    const amount = b.amount === '' || b.amount == null ? null : Number(String(b.amount).replace(/[$,\s]/g, '')) || null;
    const rep = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid: u.id, casino: cas.slug, casinoName: cas.name, chain, chainName: CHAIN_NAMES[chain], hash, url: out.url, requestedAt: reqAt, receivedAt: got, minutes, amount, status: matched ? 'approved' : 'pending', note: out.check.note, created: Date.now() };
    await update(db(), 'payouts', (x) => { x.items.push(rep); return x; }, { items: [] });
    if (matched) await updateUser(u.id, (x) => { addPoints(x, null, PTS.payout, 'Verified payout report'); });
    return { report: { matched, minutes, status: rep.status } };
  }
};

// ------------------------------------------------------------------ trust
function payoutStats(list) {
  if (!list.length) return { count: 0 };
  const m = list.map((p) => p.minutes).sort((a, b) => a - b);
  const median = m.length % 2 ? m[(m.length - 1) / 2] : (m[m.length / 2 - 1] + m[m.length / 2]) / 2;
  return { count: m.length, median, fastest: m[0], slowest: m[m.length - 1], recent: list.slice().sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 5).map((p) => ({ url: p.url, amount: p.amount, chainName: p.chainName, minutes: p.minutes })) };
}
export async function trustData() {
  const ix = (await db().get('index')) || { items: {} };
  const pays = ((await db().get('payouts')) || { items: [] }).items.filter((p) => p.status === 'approved' && p.receivedAt > Date.now() - 90 * D);
  const reviews = (await content().get('reviews')) || {};
  const complaints = {}, payouts = {};
  Object.values(ix.items).forEach((c) => {
    if (!PUBLIC.has(c.status)) return;
    const x = (complaints[c.casino] = complaints[c.casino] || { total: 0, resolved: 0, unresolved: 0, open: 0, recent: [] });
    x.total++;
    if (c.status === 'resolved') x.resolved++; else if (c.status === 'unresolved') x.unresolved++; else x.open++;
    x.recent.push(c);
  });
  Object.values(complaints).forEach((x) => { x.recent = x.recent.sort((a, b) => b.updated - a.updated).slice(0, 5).map((c) => ({ ref: c.ref, title: c.title, status: c.status })); });
  const by = {};
  pays.forEach((p) => (by[p.casino] = by[p.casino] || []).push(p));
  Object.entries(by).forEach(([s, l]) => { payouts[s] = payoutStats(l); });
  return { reviews, complaints, payouts };
}

export const trustRoutes = {
  async 'GET /api/trust/summary'() {
    const t = await trustData();
    const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, recent: undefined }]));
    return { reviews: t.reviews, complaints: strip(t.complaints), payouts: Object.fromEntries(Object.entries(t.payouts).map(([k, v]) => [k, { median: v.median, count: v.count }])) };
  },
  async 'GET /api/trust/casino/:slug'(req, ctx) {
    const slug = ctx.params.slug;
    if (!casinoBySlug(slug)) fail(404, 'Unknown casino');
    const t = await trustData();
    const arts = ((await content().get('articles')) || []).filter((a) => !a.casino || a.casino === slug);
    return { review: t.reviews[slug] || null, complaints: t.complaints[slug] || { total: 0, resolved: 0, unresolved: 0, open: 0, recent: [] }, payouts: t.payouts[slug] || { count: 0 }, reserves: await reserves(slug), articles: arts };
  }
};

// ------------------------------------------------------------------ admin
export async function adminQueue() {
  const ix = (await db().get('index')) || { items: {} };
  const pays = ((await db().get('payouts')) || { items: [] }).items;
  return {
    complaints: Object.values(ix.items).sort((a, b) => b.updated - a.updated).map(({ uid, ...c }) => c),
    payouts: pays.filter((p) => p.status === 'pending').map(({ uid, ...p }) => p)
  };
}
export async function adminComplaint(ref) { const c = await load(ref); if (!c) fail(404, 'Not found'); const { uid, ...rest } = c; return { complaint: rest }; }

// action: approve | reject | casino (reply) | propose | resolved | unresolved | note
export async function adminComplaintAction(ref, b) {
  const c = await load(ref);
  if (!c) fail(404, 'Not found');
  const now = Date.now(), text = clean(b.body, 3000);
  const ev = (who, name, body, kind = 'status') => c.events.push({ ts: now, who, name, kind, body });
  switch (b.action) {
    case 'approve':
      if (c.status !== 'review') fail(400, 'Only complaints being checked can be approved');
      Object.assign(c, { status: 'waiting', deadline: now + 7 * D });
      ev('streax', 'Streax', text || 'Checked by Streax and sent to ' + c.casinoName + '. The casino has 7 days to reply.');
      break;
    case 'reject':
      Object.assign(c, { status: 'rejected', closed: true, closedAt: now, outcome: text || 'Rejected by Streax.' });
      ev('streax', 'Streax', 'Rejected: ' + (text || 'it does not meet the complaint rules.'));
      break;
    case 'casino':
    case 'propose':
      if (c.closed) fail(400, 'This complaint is closed');
      if (!text) fail(400, 'Write the casino reply');
      c.casinoReplied = true;
      ev('casino', clean(b.name, 120) || c.casinoName, text, 'message');
      if (b.action === 'propose') { c.status = 'proposed'; c.deadline = now + 14 * D; }
      break;
    case 'resolved':
    case 'unresolved':
      Object.assign(c, { status: b.action, closed: true, closedAt: now, outcome: text });
      ev('streax', 'Streax', 'Closed as ' + b.action + (text ? ': ' + text : '.'));
      break;
    case 'note':
      if (!text) fail(400, 'Write the note');
      ev('streax', 'Streax', text, 'message');
      break;
    case 'tx':
      if (!c.tx) fail(400, 'No transaction on this complaint');
      c.tx.check = { status: ['matched', 'other', 'pending'].includes(b.status) ? b.status : 'pending', note: text || c.tx.check.note };
      break;
    default: fail(400, 'Unknown action');
  }
  c.updated = now;
  await save(c);
  const { uid, ...rest } = c;
  return { complaint: rest };
}

export async function adminPayout(id, status) {
  if (!['approved', 'rejected'].includes(status)) fail(400, 'Status must be approved or rejected');
  let rep = null;
  await update(db(), 'payouts', (x) => { rep = x.items.find((p) => p.id === id); if (!rep) fail(404, 'Not found'); rep.status = status; return x; }, { items: [] });
  if (status === 'approved') await updateUser(rep.uid, (x) => { addPoints(x, 'payout:' + id, PTS.payout, 'Verified payout report'); }).catch(() => {});
  return { ok: true };
}
