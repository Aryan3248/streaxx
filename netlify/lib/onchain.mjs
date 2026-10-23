// On-chain monitor: reads every tracked casino wallet, keeps hourly and daily
// flow totals, depositor sets, whale transfers, balances and token stats.
// run() is called by the background function; the rest serve the API.
import { store, update } from './store.mjs';
import { getRegistry, walletIndex, norm, CHAIN_NAMES, explorerTx, casinoName, casinoBySlug, SITE } from './data.mjs';
import { prices, etherscanKey, latestBlock, evmTransfers, tronTransfers, ethBalances, tronBalances, STABLE, TOKENS } from './chain.mjs';
import { getJson } from './http.mjs';
import { tgSend, sendMail, mailReady } from './notify.mjs';

const H = 3600000, D = 86400000;
const POLL_MINUTES = Number(process.env.MONITOR_MINUTES || 10);
const WHALE_MIN = 10000;
const db = () => store('onchain');
const hourOf = (ts) => Math.floor(ts / H) * H;
const dayOf = (ts) => Math.floor(ts / D) * D;
const wkey = (w) => w.chain + ':' + norm(w.chain, w.address);

// Casino tokens shown on the On-chain page (Ethereum contracts).
const TOKEN_INFO = [
  { sym: 'RLB', name: 'Rollbit', address: '0x046EeE2cc3188071C02BfC1745A6b17c656e3f3d' },
  { sym: 'SHFL', name: 'Shuffle', address: '0x8881562783028F5c1BCB985d2283D5E170D88888' }
];

// ------------------------------------------------------------------ run
export async function run(log = () => {}, opts = {}) {
  const t0 = Date.now();
  // budgetMs: on hosts with short function limits (Netlify free) each run reads
  // as many wallets as fit, then the next run carries on where this one stopped.
  const budget = opts.budgetMs || 0;
  const over = () => budget && Date.now() - t0 > budget;
  const reg = await getRegistry();
  const idx = walletIndex(reg);
  const state = (await db().get('state')) || { startedAt: t0, cursors: {} };
  const px = await prices();
  const errors = [];
  const fresh = [];
  const balancesDue = !state.balancesAt || t0 - state.balancesAt > 55 * 60000;

  if (etherscanKey() && !(budget && balancesDue)) {
    const latest = {};
    const all = reg.flatMap((c) => c.wallets.map((w) => ({ c, w })));
    const start = budget ? (state.next || 0) % Math.max(1, all.length) : 0;
    let done = 0;
    for (; done < all.length && !over(); done++) {
      const { c, w } = all[(start + done) % all.length];
      const k = wkey(w);
      try {
        let got;
        if (w.chain === 'tron') {
          const cur = state.cursors[k] || { ts: t0 - 48 * H };
          got = await tronTransfers(w.address, cur.ts);
          state.cursors[k] = { ts: got.lastTs };
        } else if (w.chain === 'ethereum' || w.chain === 'polygon' || w.chain === 'bsc') {
          if (latest[w.chain] == null) latest[w.chain] = await latestBlock(w.chain);
          const back = { ethereum: 14400, polygon: 86400, bsc: 57600 }[w.chain];
          const cur = state.cursors[k] || {};
          got = await evmTransfers(w.chain, w.address, Math.max(0, latest[w.chain] - back), budget ? 3 : 8, cur);
          state.cursors[k] = got.cursors;
        } else continue;
        got.items.forEach((t) => fresh.push({ ...t, chain: w.chain, slug: c.slug, wallet: norm(w.chain, w.address) }));
        if (got.capped) log('capped ' + k);
      } catch (e) { errors.push(k + ': ' + e.message); }
    }
    if (budget) state.next = (start + done) % Math.max(1, all.length);
  }

  // classify
  const recs = [];
  for (const t of fresh) {
    const from = norm(t.chain, t.from), to = norm(t.chain, t.to);
    if (from === to) continue;
    const dir = to === t.wallet ? 'in' : from === t.wallet ? 'out' : null;
    if (!dir) continue;
    const cp = dir === 'in' ? from : to;
    const cpOwner = idx.get(t.chain + ':' + cp);
    const internal = !!(cpOwner && cpOwner.slug === t.slug);
    const price = STABLE.has(t.asset) ? 1 : px[t.asset];
    recs.push({ key: t.key + ':' + t.slug + ':' + dir, hash: t.hash, ts: t.ts, chain: t.chain, slug: t.slug, dir, cp, internal, asset: t.asset, amount: t.amount, usd: price ? t.amount * price : null });
  }
  // a transfer between two wallets of the same casino shows up from both sides: keep one
  const seen = new Set();
  const uniq = recs.filter((r) => { if (seen.has(r.key)) return false; seen.add(r.key); return true; });
  if (uniq.length) await aggregate(uniq, t0);
  const newWhales = uniq.length ? await addWhales(uniq, t0) : [];

  // balances, tokens: hourly
  if (balancesDue) {
    try { await readBalances(reg, px, t0); state.balancesAt = t0; } catch (e) { errors.push('balances: ' + e.message); if (budget) state.balancesAt = t0 - 45 * 60000; }
    try { await readTokens(reg, t0); } catch (e) { errors.push('tokens: ' + e.message); }
  }

  await precompute(reg, t0, state);
  if (newWhales.length) await sendAlerts(newWhales).catch((e) => errors.push('alerts: ' + e.message));
  try { const { settleAll } = await import('./complaints.mjs'); await settleAll(); } catch (e) { errors.push('complaints: ' + e.message); }

  state.lastRun = { at: Date.now(), ms: Date.now() - t0, transfers: uniq.length, errors: errors.slice(0, 20) };
  // keep the cursor map from growing with removed wallets
  const keys = new Set(reg.flatMap((c) => c.wallets.map(wkey)));
  Object.keys(state.cursors).forEach((k) => { if (!keys.has(k)) delete state.cursors[k]; });
  await db().set('state', state);
  log('run done: ' + uniq.length + ' transfers, ' + errors.length + ' errors, ' + (Date.now() - t0) + ' ms');
  return state.lastRun;
}

async function aggregate(recs, now) {
  const cutH = now - 32 * D, cutD = now - 92 * D;
  await update(db(), 'hourly', (hr) => {
    recs.forEach((r) => {
      if (r.internal || r.usd == null) return;
      const b = ((hr[r.slug] = hr[r.slug] || {})[hourOf(r.ts)] = hr[r.slug][hourOf(r.ts)] || [0, 0, 0, 0]);
      if (r.dir === 'in') { b[0] += r.usd; b[2]++; } else { b[1] += r.usd; b[3]++; }
    });
    Object.values(hr).forEach((m) => Object.keys(m).forEach((h) => { if (Number(h) < cutH) delete m[h]; }));
    return hr;
  }, {});
  await update(db(), 'daily', (dl) => {
    recs.forEach((r) => {
      const day = ((dl[r.slug] = dl[r.slug] || {})[dayOf(r.ts)] = dl[r.slug][dayOf(r.ts)] || { i: 0, o: 0, ti: 0, to: 0, int: 0, a: {} });
      if (r.usd == null) return;
      if (r.internal) { if (r.dir === 'out') day.int += r.usd; return; }
      const ak = r.asset + '|' + r.chain, a = (day.a[ak] = day.a[ak] || [0, 0]);
      if (r.dir === 'in') { day.i += r.usd; day.ti++; a[0] += r.usd; } else { day.o += r.usd; day.to++; a[1] += r.usd; }
    });
    Object.values(dl).forEach((m) => Object.keys(m).forEach((d) => { if (Number(d) < cutD) delete m[d]; }));
    return dl;
  }, {});
  const bySlug = {};
  recs.forEach((r) => { if (!r.internal) (bySlug[r.slug] = bySlug[r.slug] || []).push(r); });
  for (const [slug, list] of Object.entries(bySlug)) {
    await update(db(), 'depmap/' + slug, (m) => {
      list.forEach((r) => { const set = r.dir === 'in' ? m.in : m.out, k = r.chain + ':' + r.cp, v = Math.floor(r.ts / 60000); if (!set[k] || set[k] < v) set[k] = v; });
      const cut = Math.floor(cutD / 60000);
      [m.in, m.out].forEach((set) => Object.keys(set).forEach((k) => { if (set[k] < cut) delete set[k]; }));
      return m;
    }, { in: {}, out: {} });
  }
}

async function addWhales(recs, now) {
  const added = [];
  await update(db(), 'whales', (list) => {
    const have = new Set(list.map((w) => w.key));
    recs.forEach((r) => {
      if (r.internal || r.usd == null || r.usd < WHALE_MIN || have.has(r.key)) return;
      const w = { key: r.key, slug: r.slug, name: casinoName(r.slug), dir: r.dir, usd: r.usd, ts: r.ts, amount: r.amount, asset: r.asset, chain: r.chain, chainName: CHAIN_NAMES[r.chain], cp: r.cp, hash: r.hash, txUrl: explorerTx(r.chain, r.hash) };
      list.push(w); added.push(w); have.add(r.key);
    });
    return list.filter((w) => w.ts > now - 92 * D).sort((a, b) => b.ts - a.ts).slice(0, 20000);
  }, []);
  return added;
}

async function readBalances(reg, px, now) {
  const evm = [], tron = [];
  reg.forEach((c) => c.wallets.forEach((w) => { if (w.chain === 'ethereum') evm.push(w.address); else if (w.chain === 'tron') tron.push(w.address); }));
  const raw = {};
  if (evm.length) { const r = await ethBalances(evm); evm.forEach((a) => { raw['ethereum:' + a.toLowerCase()] = r[a]; }); }
  for (const a of tron) { try { raw['tron:' + a] = await tronBalances(a); } catch {} }
  const bal = {};
  Object.entries(raw).forEach(([k, list]) => {
    const assets = (list || []).map((x) => { const p = STABLE.has(x.asset) ? 1 : px[x.asset]; return { asset: x.asset, amount: x.amount, usd: p ? x.amount * p : null }; }).sort((a, b) => (b.usd || 0) - (a.usd || 0));
    bal[k] = { usd: assets.reduce((s, a) => s + (a.usd || 0), 0), assets, at: now };
  });
  await db().set('balances', bal);
  await update(db(), 'balhist', (h) => {
    const day = dayOf(now);
    reg.forEach((c) => {
      if (!c.wallets.length) return;
      const usd = c.wallets.reduce((s, w) => s + ((bal[wkey(w)] || {}).usd || 0), 0);
      const arr = (h[c.slug] = h[c.slug] || []);
      const last = arr[arr.length - 1];
      if (last && last.t === day) last.usd = usd; else arr.push({ t: day, usd });
      h[c.slug] = arr.filter((x) => x.t > now - 92 * D);
    });
    return h;
  }, {});
}

async function readTokens(reg, now) {
  const bal = (await db().get('balances')) || {};
  const out = [];
  const hist = (await db().get('tokhist')) || {};
  for (const t of TOKEN_INFO) {
    const row = { sym: t.sym, name: t.name, url: 'https://etherscan.io/token/' + t.address };
    try {
      const j = await getJson('https://api.dexscreener.com/latest/dex/tokens/' + t.address);
      const p = (j.pairs || []).filter((x) => x.chainId === 'ethereum').sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))[0];
      if (p) Object.assign(row, { dexUrl: p.url, price: Number(p.priceUsd), ch24: p.priceChange ? p.priceChange.h24 : null, liquidity: p.liquidity ? p.liquidity.usd : null, vol24: p.volume ? p.volume.h24 : null, buys24: p.txns && p.txns.h24 ? p.txns.h24.buys : null, sells24: p.txns && p.txns.h24 ? p.txns.h24.sells : null });
    } catch {}
    try {
      const j = await getJson('https://api.ethplorer.io/getTokenInfo/' + t.address + '?apiKey=' + (process.env.ETHPLORER_API_KEY || 'freekey'));
      row.holders = j.holdersCount != null ? Number(j.holdersCount) : null;
      const supply = j.totalSupply ? Number(j.totalSupply) / 10 ** Number(j.decimals || 18) : null;
      const h = (hist[t.sym] = (hist[t.sym] || []).filter((x) => x.t > now - 40 * D));
      const day = dayOf(now), last = h[h.length - 1];
      if (last && last.t === day) Object.assign(last, { holders: row.holders, supply }); else h.push({ t: day, holders: row.holders, supply });
      const old = h.find((x) => x.t <= day - 7 * D && x.t > day - 8 * D) || null;
      row.holders7d = old ? old.holders : null;
      row.burned7d = old && old.supply != null && supply != null ? Math.max(0, old.supply - supply) : null;
    } catch {}
    let amt = 0;
    reg.forEach((c) => c.wallets.forEach((w) => { const b = bal[wkey(w)]; if (b) b.assets.forEach((a) => { if (a.asset === t.sym) amt += a.amount; }); }));
    row.treasury = amt;
    row.treasuryUsd = row.price ? amt * row.price : null;
    out.push(row);
  }
  await db().set('tokhist', hist);
  await db().set('tokens', { tokens: out, at: now });
}

// ------------------------------------------------------------- precompute
async function precompute(reg, now, state) {
  const [hourly, daily, bal, whales] = await Promise.all(['hourly', 'daily', 'balances', 'whales'].map((k) => db().get(k)));
  const hr = hourly || {}, dl = daily || {}, bl = bal || {}, wh = whales || [];
  const dep = {};
  for (const c of reg) dep[c.slug] = (await db().get('depmap/' + c.slug)) || { in: {}, out: {} };
  const tracked = reg.filter((c) => c.wallets.length);
  const balOf = (c) => c.wallets.reduce((s, w) => s + ((bl[wkey(w)] || {}).usd || 0), 0);
  const countSince = (set, since) => { const m = Math.floor(since / 60000); let n = 0; for (const k in set) if (set[k] >= m) n++; return n; };

  for (const [win, ms] of [['24h', D], ['7d', 7 * D], ['30d', 30 * D]]) {
    const since = now - ms;
    const casinos = tracked.map((c) => {
      let inflow = 0, outflow = 0, txIn = 0, txOut = 0;
      Object.entries(hr[c.slug] || {}).forEach(([h, b]) => { if (Number(h) + H > since) { inflow += b[0]; outflow += b[1]; txIn += b[2]; txOut += b[3]; } });
      const chains = inflow + outflow > 0 ? [...new Set(c.wallets.map((w) => w.chain))].map((x) => ({ id: x, name: CHAIN_NAMES[x] })) : [];
      return { slug: c.slug, name: c.name, wallets: c.wallets.length, depositors: countSince(dep[c.slug].in, since), chains, inflow, outflow, net: inflow - outflow, balance: balOf(c), txIn, txOut };
    });
    const sum = (k) => casinos.reduce((s, c) => s + c[k], 0);
    const hours = [];
    const h0 = hourOf(now) - 47 * H;
    for (let i = 0; i < 48; i++) {
      const t = h0 + i * H;
      let a = 0, b = 0;
      tracked.forEach((c) => { const x = (hr[c.slug] || {})[t]; if (x) { a += x[0]; b += x[1]; } });
      hours.push({ t, inflow: a, outflow: b });
    }
    await db().set('overview/' + win, {
      totals: { inflow: sum('inflow'), outflow: sum('outflow'), net: sum('net'), balance: sum('balance'), txIn: sum('txIn'), txOut: sum('txOut'), wallets: sum('wallets'), casinos: tracked.length, whales24h: wh.filter((w) => w.ts > now - D && w.usd >= 50000).length },
      hourly: hours, casinos
    });
  }

  // 7-day trend for the home page
  const today = dayOf(now);
  const started = state.startedAt || now;
  const daysOfData = Math.floor((now - started) / D) + 1;
  const rows = tracked.map((c) => {
    const d = dl[c.slug] || {};
    const spark = [], prev = [];
    for (let i = 6; i >= 0; i--) spark.push((d[today - i * D] || {}).i || 0);
    for (let i = 13; i >= 7; i--) prev.push((d[today - i * D] || {}).i || 0);
    const vol7 = spark.reduce((a, b) => a + b, 0), p7 = prev.reduce((a, b) => a + b, 0);
    return { slug: c.slug, name: c.name, spark, vol7, change: daysOfData >= 14 && p7 > 0 ? (vol7 - p7) / p7 * 100 : null };
  }).filter((r) => r.vol7 > 0).sort((a, b) => b.vol7 - a.vol7);
  await db().set('trend', { casinos: rows, daysOfData, total: rows.reduce((s, r) => s + r.vol7, 0) });
}

// ----------------------------------------------------------------- alerts
async function sendAlerts(whales) {
  const users = store('users');
  const keys = await users.list('u/');
  const fmt = (n) => '$' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));
  for (const k of keys) {
    const u = await users.get(k);
    if (!u || !u.watchlist || !u.watchlist.length || !(u.alerts.telegram || u.alerts.email)) continue;
    const mine = whales.filter((w) => u.watchlist.includes(w.slug) && w.usd >= u.alerts.min);
    if (!mine.length) continue;
    const lines = mine.slice(0, 20).map((w) => w.name + ': ' + (w.dir === 'in' ? 'deposit' : 'withdrawal') + ' of ' + w.amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + w.asset + ' (' + fmt(w.usd) + ') on ' + w.chainName + '\n' + w.txUrl);
    if (u.alerts.telegram && u.tg) await tgSend(u.tg.chatId, 'Streax whale alert\n\n' + lines.join('\n\n'));
    if (u.alerts.email && u.verified && mailReady()) await sendMail(u.email, 'Streax whale alert: ' + mine.length + ' big move' + (mine.length === 1 ? '' : 's'), lines.join('\n\n') + '\n\nChange your alerts on your Streax account page.').catch(() => {});
  }
}

// ------------------------------------------------------------- read side
export async function status() {
  const st = (await db().get('state')) || {};
  return { lastRun: st.lastRun || null, pollMinutes: POLL_MINUTES, startedAt: st.startedAt || null, keys: { etherscan: !!etherscanKey() } };
}

export async function overview(win) {
  const w = ['24h', '7d', '30d'].includes(win) ? win : '24h';
  const ov = (await db().get('overview/' + w)) || { totals: { inflow: 0, outflow: 0, net: 0, balance: 0, txIn: 0, txOut: 0, wallets: 0, casinos: 0, whales24h: 0 }, hourly: [], casinos: [] };
  if (!ov.totals.wallets) { const reg = await getRegistry(); ov.totals.wallets = reg.reduce((s, c) => s + c.wallets.length, 0); ov.totals.casinos = reg.filter((c) => c.wallets.length).length; }
  return { status: await status(), window: w, ...ov };
}

export async function whaleList(limit, min) {
  const list = (await db().get('whales')) || [];
  return { items: list.filter((w) => w.usd >= min).slice(0, limit).map(({ key, ...w }) => w) };
}

export async function topWhales(days, dir, limit = 10) {
  const since = Date.now() - days * D;
  const list = ((await db().get('whales')) || []).filter((w) => w.ts >= since && (!dir || w.dir === dir));
  return { items: list.sort((a, b) => b.usd - a.usd).slice(0, limit).map(({ key, ...w }) => w) };
}

export async function tokens() { return (await db().get('tokens')) || { tokens: [] }; }
export async function trend() { return (await db().get('trend')) || { casinos: [], daysOfData: 0, total: 0 }; }

export async function casinoDetail(slug, days) {
  const reg = await getRegistry();
  const c = reg.find((x) => x.slug === slug);
  if (!c || !c.wallets.length) return null;
  const now = Date.now(), since = dayOf(now) - (days - 1) * D;
  const [daily, bal, whales, bh, dep] = await Promise.all([db().get('daily'), db().get('balances'), db().get('whales'), db().get('balhist'), db().get('depmap/' + slug)]);
  const dl = (daily || {})[slug] || {}, bl = bal || {}, dm = dep || { in: {}, out: {} };
  const wallets = c.wallets.map((w) => { const b = bl[wkey(w)]; return { ...w, usd: b ? b.usd : null, assets: b ? b.assets : [] }; });
  const dayRows = [], assets = {};
  let inflow = 0, outflow = 0, internalMoved = 0;
  for (let i = 0; i < days; i++) {
    const t = since + i * D, x = dl[t] || { i: 0, o: 0, int: 0, a: {} };
    dayRows.push({ t, inflow: x.i, outflow: x.o, txIn: x.ti || 0, txOut: x.to || 0 });
    inflow += x.i; outflow += x.o; internalMoved += x.int || 0;
    Object.entries(x.a || {}).forEach(([k, v]) => { const a = (assets[k] = assets[k] || { inflow: 0, outflow: 0 }); a.inflow += v[0]; a.outflow += v[1]; });
  }
  const m = Math.floor(since / 60000);
  const cnt = (set) => Object.values(set).filter((v) => v >= m).length;
  return {
    slug, name: c.name, wallets, daily: dayRows,
    assets: Object.entries(assets).map(([k, v]) => { const [asset, chain] = k.split('|'); return { asset, chain, chainName: CHAIN_NAMES[chain], ...v }; }).sort((a, b) => b.inflow + b.outflow - a.inflow - a.outflow),
    balanceHistory: ((bh || {})[slug] || []).filter((x) => x.t >= since),
    large: (whales || []).filter((w) => w.slug === slug && w.ts >= since).slice(0, 25).map(({ key, ...w }) => w),
    balance: wallets.reduce((s, w) => s + (w.usd || 0), 0), inflow, outflow, depositors: cnt(dm.in), withdrawers: cnt(dm.out), internalMoved
  };
}

// For the trust score: current reserves and the 30-day line.
export async function reserves(slug) {
  const reg = await getRegistry();
  const c = reg.find((x) => x.slug === slug);
  if (!c || !c.wallets.length) return { tracked: false };
  const bh = ((await db().get('balhist')) || {})[slug] || [];
  const now = Date.now();
  const series = bh.filter((x) => x.t > now - 30 * D).map((x) => ({ t: x.t, usd: x.usd }));
  if (!series.length) return { tracked: true, updated: null };
  const last7 = series.filter((x) => x.t > now - 7 * D), hi = Math.max(...last7.map((x) => x.usd)), cur = series[series.length - 1].usd;
  const st = (await db().get('state')) || {};
  return { tracked: true, total: cur, series, drawdown7d: hi > 0 ? Math.max(0, (hi - cur) / hi) : 0, updated: st.balancesAt || null };
}

// Exports
export async function flowsCsvRows(win) {
  const ov = await overview(win);
  return [['casino', 'slug', 'window', 'deposits_usd', 'withdrawals_usd', 'net_usd', 'balance_usd', 'depositors', 'transfers_in', 'transfers_out', 'tracked_wallets']]
    .concat(ov.casinos.map((c) => [c.name, c.slug, ov.window, c.inflow.toFixed(2), c.outflow.toFixed(2), c.net.toFixed(2), c.balance.toFixed(2), c.depositors, c.txIn, c.txOut, c.wallets]));
}
export async function whalesCsvRows(days, min) {
  const list = ((await db().get('whales')) || []).filter((w) => w.ts > Date.now() - days * D && w.usd >= min);
  return [['time_utc', 'casino', 'direction', 'asset', 'amount', 'usd', 'chain', 'counterparty', 'tx']]
    .concat(list.map((w) => [new Date(w.ts).toISOString(), w.name, w.dir === 'in' ? 'deposit' : 'withdrawal', w.asset, w.amount, w.usd.toFixed(2), w.chainName, w.cp, w.txUrl]));
}
export async function casinoCsvRows(slug, days) {
  const d = await casinoDetail(slug, days);
  if (!d) return null;
  const bh = {}; d.balanceHistory.forEach((b) => { bh[b.t] = b.usd; });
  return [['date', 'casino', 'deposits_usd', 'withdrawals_usd', 'net_usd', 'transfers_in', 'transfers_out', 'balance_usd']]
    .concat(d.daily.map((x) => [new Date(x.t).toISOString().slice(0, 10), d.name, x.inflow.toFixed(2), x.outflow.toFixed(2), (x.inflow - x.outflow).toFixed(2), x.txIn, x.txOut, bh[x.t] != null ? bh[x.t].toFixed(2) : '']));
}

// Live 24h figures for the tracked casinos, in the same shape as the snapshot
// rows the pages embed, so Rankings, Analytics, Home and Casino can swap them in.
const shortNum = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(2) + 'K' : n.toFixed(2));
const usdS = (n) => '$' + shortNum(n);
const cntS = (n) => (n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
export async function liveCasinos() {
  const st = (await db().get('state')) || {};
  if (!st.lastRun || !etherscanKey()) return { updatedAt: null, casinos: [] };
  const settings = (await store('content').get('settings')) || {};
  const [ov, bal, reg] = await Promise.all([db().get('overview/24h'), db().get('balances'), getRegistry()]);
  if (!ov) return { updatedAt: null, casinos: [] };
  const bl = bal || {};
  const casinos = ov.casinos.map((c) => {
    const r = reg.find((x) => x.slug === c.slug);
    const byChain = {}, byAsset = {};
    (r ? r.wallets : []).forEach((w) => {
      const b = bl[wkey(w)];
      if (!b) return;
      byChain[CHAIN_NAMES[w.chain]] = (byChain[CHAIN_NAMES[w.chain]] || 0) + b.usd;
      b.assets.forEach((a) => { const k = STABLE.has(a.asset) ? 'Stablecoins' : a.asset; const x = (byAsset[k] = byAsset[k] || { amount: 0, usd: 0 }); x.amount += a.amount; x.usd += a.usd || 0; });
    });
    const hot = Object.values(byChain).reduce((s, v) => s + v, 0);
    const chains = hot > 0 ? Object.entries(byChain).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v, v / hot * 100]) : null;
    const assets = Object.entries(byAsset).filter(([, v]) => v.usd > 0).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => [k, shortNum(v.amount), v.usd]);
    return {
      slug: c.slug, dep: c.inflow, depS: usdS(c.inflow), wal: c.depositors, walS: cntS(c.depositors), cnt: c.txIn, cntS: cntS(c.txIn), depCount: c.txIn,
      pay: c.outflow, payS: usdS(c.outflow), payCount: c.txOut, hot, hotS: usdS(hot), net: c.inflow - c.outflow, chains, assets: assets.length ? assets : null,
      avg: c.txIn ? usdS(c.inflow / c.txIn) : 'n/a', wallets: c.wallets
    };
  });
  // liveOnly: the admin switched off the old published snapshot, so pages list tracked casinos only
  return { updatedAt: st.lastRun.at, balancesAt: st.balancesAt || null, liveOnly: !!settings.liveOnly, casinos };
}

// Everything the Analytics page draws: daily series per casino (deposits,
// withdrawals, transfers, balances), breakdowns by chain and token, the biggest
// single moves, record days and changes against the previous window.
export async function analytics(days) {
  const now = Date.now(), today = dayOf(now), since = today - (days - 1) * D, prevSince = since - days * D;
  const [daily, whales, bh, bal, st] = await Promise.all(['daily', 'whales', 'balhist', 'balances', 'state'].map((k) => db().get(k)));
  const reg = await getRegistry();
  const dl = daily || {}, bl = bal || {};
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(since + i * D);
  const chains = {}, assets = {}, records = [];
  const casinos = [];
  for (const c of reg.filter((x) => x.wallets.length)) {
    const d = dl[c.slug] || {}, info = casinoBySlug(c.slug) || {};
    const row = { slug: c.slug, name: c.name, domain: info.domain || '', dep: [], wd: [], txIn: [], txOut: [], bal: [], depTotal: 0, wdTotal: 0, txInTotal: 0, txOutTotal: 0, prevDep: 0, prevWd: 0 };
    const hist = {}; ((bh || {})[c.slug] || []).forEach((x) => { hist[x.t] = x.usd; });
    let lastBal = null;
    dates.forEach((t) => {
      const x = d[t] || {};
      row.dep.push(x.i || 0); row.wd.push(x.o || 0); row.txIn.push(x.ti || 0); row.txOut.push(x.to || 0);
      if (hist[t] != null) lastBal = hist[t];
      row.bal.push(hist[t] != null ? hist[t] : null);
      row.depTotal += x.i || 0; row.wdTotal += x.o || 0; row.txInTotal += x.ti || 0; row.txOutTotal += x.to || 0;
      if (x.i) records.push({ slug: c.slug, name: c.name, domain: row.domain, day: t, dep: x.i, wd: x.o || 0, txIn: x.ti || 0 });
      Object.entries(x.a || {}).forEach(([k, v]) => {
        const [asset, chain] = k.split('|');
        const cn = CHAIN_NAMES[chain] || chain;
        const ch = (chains[cn] = chains[cn] || { name: cn, dep: 0, wd: 0, prevDep: 0 }); ch.dep += v[0]; ch.wd += v[1];
        const as = (assets[asset] = assets[asset] || { name: asset, dep: 0, wd: 0, prevDep: 0 }); as.dep += v[0]; as.wd += v[1];
      });
    });
    for (let t = prevSince; t < since; t += D) {
      const x = d[t] || {}; row.prevDep += x.i || 0; row.prevWd += x.o || 0;
      Object.entries(x.a || {}).forEach(([k, v]) => {
        const [asset, chain] = k.split('|'), cn = CHAIN_NAMES[chain] || chain;
        (chains[cn] = chains[cn] || { name: cn, dep: 0, wd: 0, prevDep: 0 }).prevDep += v[0];
        (assets[asset] = assets[asset] || { name: asset, dep: 0, wd: 0, prevDep: 0 }).prevDep += v[0];
      });
    }
    const dm = (await db().get('depmap/' + c.slug)) || { in: {} };
    const m = Math.floor(since / 60000);
    row.depositors = Object.values(dm.in).filter((v) => v >= m).length;
    row.chainBal = {};
    c.wallets.forEach((w) => { const b = bl[wkey(w)]; if (b) row.chainBal[CHAIN_NAMES[w.chain]] = (row.chainBal[CHAIN_NAMES[w.chain]] || 0) + b.usd; });
    row.balance = Object.values(row.chainBal).reduce((s, v) => s + v, 0);
    casinos.push(row);
  }
  const wl = (whales || []).filter((w) => w.ts >= since).map(({ key, ...w }) => ({ ...w, domain: (casinoBySlug(w.slug) || {}).domain || '' }));
  const sum = (k) => casinos.reduce((s, c) => s + c[k], 0);
  const depSeries = dates.map((_, i) => casinos.reduce((s, c) => s + c.dep[i], 0));
  const txSeries = dates.map((_, i) => casinos.reduce((s, c) => s + c.txIn[i], 0));
  return {
    updatedAt: st && st.lastRun ? st.lastRun.at : null, days, dates,
    kpis: {
      dep: sum('depTotal'), wd: sum('wdTotal'), prevDep: sum('prevDep'), depositors: sum('depositors'), txIn: sum('txInTotal'),
      avg: sum('txInTotal') ? sum('depTotal') / sum('txInTotal') : 0, casinos: casinos.length,
      depSpark: depSeries, txSpark: txSeries, avgSpark: depSeries.map((v, i) => (txSeries[i] ? v / txSeries[i] : 0))
    },
    casinos: casinos.sort((a, b) => b.depTotal - a.depTotal),
    chains: Object.values(chains).sort((a, b) => b.dep - a.dep),
    tokens: Object.values(assets).sort((a, b) => b.dep - a.dep),
    biggest: { in: wl.filter((w) => w.dir === 'in').sort((a, b) => b.usd - a.usd).slice(0, 8), out: wl.filter((w) => w.dir === 'out').sort((a, b) => b.usd - a.usd).slice(0, 8) },
    records: records.sort((a, b) => b.dep - a.dep).slice(0, 8)
  };
}

// Depositor maps for the wallet checker: chain:address -> slug
export async function depositAddressIndex() {
  const reg = await getRegistry();
  const m = new Map();
  for (const c of reg) { const dm = await db().get('depmap/' + c.slug); if (dm) Object.keys(dm.in).forEach((k) => { if (!m.has(k)) m.set(k, c.slug); }); }
  return m;
}

export { TOKENS, SITE };
