'use strict';
// JSON API for the On-chain pages, plus admin routes (add wallets, discover a casino's wallet from a deposit address).

const { validAddress, norm, dayOf } = require('./util');
const { CHAINS, txUrl, addrUrl } = require('./assets');
const prices = require('./prices');
const { ADAPTERS } = require('./indexer');

const WINDOWS = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
const cache = new Map();
function cached(key, ms, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ms) return c.val;
  const val = fn();
  cache.set(key, { at: Date.now(), val });
  return val;
}
function clearCache() { cache.clear(); }

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e5) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

function status(state) {
  const { store, cfg, indexer } = state;
  const runs = store.lastRuns(1);
  return {
    enabled: true,
    keys: { etherscan: !!cfg.etherscanKey, etherscanPaid: !!cfg.etherscanPaid, trongrid: !!cfg.trongridKey, solanaRpc: !!cfg.solanaRpc, telegram: !!(cfg.telegramToken && cfg.telegramChat), admin: !!cfg.adminToken },
    pollMinutes: cfg.pollMinutes, whaleUsd: cfg.whaleUsd,
    running: indexer.running,
    lastRun: runs[0] ? { at: runs[0].finished || runs[0].started, ok: !!runs[0].ok, note: runs[0].note } : null,
    sources: store.sources().map(s => ({ name: s.source, ok: !!s.ok, lastOk: s.last_ok, lastError: s.ok ? null : s.last_error, errorAt: s.error_at }))
  };
}

function overview(state, win) {
  const { store, cfg } = state;
  const hours = WINDOWS[win] || 24;
  const since = Date.now() - hours * 3600000;
  const db = store.db;
  const names = store.casinoNames();
  const rows = {};
  const row = slug => rows[slug] || (rows[slug] = { slug, name: names[slug] || slug, inflow: 0, outflow: 0, txIn: 0, txOut: 0, balance: 0, chains: {}, wallets: 0, depositors: 0, withdrawers: 0, lastTx: null });
  db.prepare('SELECT casino, chain, dir, SUM(usd) AS usd, SUM(n) AS n FROM flows WHERE hour >= ? AND internal = 0 GROUP BY casino, chain, dir').all(Math.floor(since / 3600000) * 3600000)
    .forEach(r => {
      const o = row(r.casino);
      const c = o.chains[r.chain] || (o.chains[r.chain] = { inflow: 0, outflow: 0, balance: 0 });
      if (r.dir === 'in') { o.inflow += r.usd || 0; o.txIn += r.n || 0; c.inflow += r.usd || 0; } else { o.outflow += r.usd || 0; o.txOut += r.n || 0; c.outflow += r.usd || 0; }
    });
  db.prepare(`SELECT w.casino, b.chain, SUM(b.usd) AS usd FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address
    WHERE w.active = 1 AND w.role != 'funder' GROUP BY w.casino, b.chain`).all()
    .forEach(r => { const o = row(r.casino); o.balance += r.usd || 0; const c = o.chains[r.chain] || (o.chains[r.chain] = { inflow: 0, outflow: 0, balance: 0 }); c.balance += r.usd || 0; });
  db.prepare("SELECT casino, COUNT(*) AS n FROM wallets WHERE active = 1 AND role != 'funder' AND source != 'mirror' GROUP BY casino").all().forEach(r => { row(r.casino).wallets = r.n; });
  db.prepare('SELECT casino, dir, COUNT(DISTINCT cp) AS n FROM cps WHERE day >= ? GROUP BY casino, dir').all(dayOf(since))
    .forEach(r => { if (r.dir === 'in') row(r.casino).depositors = r.n; else row(r.casino).withdrawers = r.n; });
  db.prepare('SELECT casino, MAX(hour) AS h FROM flows WHERE internal = 0 GROUP BY casino').all().forEach(r => { row(r.casino).lastTx = r.h; });

  const list = Object.values(rows).map(o => Object.assign(o, {
    net: o.inflow - o.outflow,
    chains: Object.entries(o.chains).map(([chain, c]) => ({ chain, name: CHAINS[chain] ? CHAINS[chain].name : chain, inflow: c.inflow, outflow: c.outflow, balance: c.balance }))
      .filter(c => c.inflow || c.outflow || c.balance > 1).sort((a, b) => (b.inflow + b.balance) - (a.inflow + a.balance))
  })).sort((a, b) => b.inflow - a.inflow || b.balance - a.balance);

  const hourly = {};
  const h0 = Math.floor((Date.now() - 48 * 3600000) / 3600000) * 3600000;
  db.prepare('SELECT hour, dir, SUM(usd) AS usd FROM flows WHERE hour >= ? AND internal = 0 GROUP BY hour, dir').all(h0)
    .forEach(r => { const o = hourly[r.hour] || (hourly[r.hour] = { t: r.hour, inflow: 0, outflow: 0 }); o[r.dir === 'in' ? 'inflow' : 'outflow'] = r.usd || 0; });
  const series = [];
  for (let t = h0; t <= Date.now(); t += 3600000) series.push(hourly[t] || { t, inflow: 0, outflow: 0 });

  const totals = list.reduce((s, o) => ({ inflow: s.inflow + o.inflow, outflow: s.outflow + o.outflow, balance: s.balance + o.balance, txIn: s.txIn + o.txIn, txOut: s.txOut + o.txOut }),
    { inflow: 0, outflow: 0, balance: 0, txIn: 0, txOut: 0 });
  totals.net = totals.inflow - totals.outflow;
  totals.casinos = list.filter(o => o.wallets > 0).length;
  totals.wallets = list.reduce((s, o) => s + o.wallets, 0);
  totals.whales24h = db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE ts >= ? AND usd >= ?').get(Date.now() - 86400000, cfg.whaleUsd).n;
  return { window: win in WINDOWS ? win : '24h', updatedAt: Date.now(), totals, casinos: list, hourly: series, status: status(state) };
}

function whales(state, q) {
  const { store, cfg } = state;
  const min = Math.max(1000, Number(q.get('min')) || cfg.whaleUsd);
  const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
  const casino = q.get('casino');
  const names = store.casinoNames();
  const args = [min];
  let sql = 'SELECT * FROM transfers WHERE usd >= ?';
  if (casino) { sql += ' AND casino = ?'; args.push(casino); }
  sql += ' ORDER BY ts DESC LIMIT ?';
  args.push(limit);
  return {
    min, updatedAt: Date.now(),
    items: store.db.prepare(sql).all(...args).map(t => ({
      ts: t.ts, casino: t.casino, name: names[t.casino] || t.casino, chain: t.chain, chainName: CHAINS[t.chain] ? CHAINS[t.chain].name : t.chain,
      dir: t.dir, asset: t.asset, amount: t.amount, usd: t.usd, cp: t.cp, tx: t.tx, txUrl: txUrl(t.chain, t.tx), cpUrl: t.cp ? addrUrl(t.chain, t.cp) : ''
    }))
  };
}

function casinoDetail(state, slug, days) {
  const { store } = state;
  const db = store.db;
  const names = store.casinoNames();
  const since = Date.now() - days * 86400000;
  const wallets = db.prepare('SELECT * FROM wallets WHERE casino = ? AND active = 1 ORDER BY role, chain, label').all(slug);
  if (!wallets.length) return null;
  const bal = db.prepare(`SELECT b.* FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address WHERE w.casino = ? AND w.active = 1`).all(slug);
  const byWallet = {};
  bal.forEach(b => { (byWallet[b.chain + '|' + b.address] = byWallet[b.chain + '|' + b.address] || []).push(b); });
  const walletRows = wallets.map(w => {
    const bs = byWallet[w.chain + '|' + w.address] || [];
    const usd = bs.reduce((s, b) => s + (b.usd || 0), 0);
    return { chain: w.chain, chainName: CHAINS[w.chain] ? CHAINS[w.chain].name : w.chain, address: w.address, label: w.label, role: w.role, source: w.source,
      url: addrUrl(w.chain, w.address), usd, assets: bs.filter(b => b.amount > 0).map(b => ({ asset: b.asset, amount: b.amount, usd: b.usd })).sort((a, b) => b.usd - a.usd),
      updated: bs.length ? Math.max(...bs.map(b => b.ts)) : null };
  }).filter(w => w.source !== 'mirror' || w.usd >= 1);

  const daily = {};
  db.prepare('SELECT (hour / 86400000) * 86400000 AS d, dir, SUM(usd) AS usd, SUM(n) AS n FROM flows WHERE casino = ? AND internal = 0 AND hour >= ? GROUP BY d, dir').all(slug, since)
    .forEach(r => { const o = daily[r.d] || (daily[r.d] = { t: r.d, inflow: 0, outflow: 0, txIn: 0, txOut: 0 }); if (r.dir === 'in') { o.inflow = r.usd; o.txIn = r.n; } else { o.outflow = r.usd; o.txOut = r.n; } });
  const series = [];
  const d0 = Math.floor(since / 86400000) * 86400000;
  for (let t = d0; t <= Date.now(); t += 86400000) series.push(daily[t] || { t, inflow: 0, outflow: 0, txIn: 0, txOut: 0 });

  const assets = {};
  db.prepare('SELECT chain, asset, dir, SUM(usd) AS usd, SUM(amount) AS amount FROM flows WHERE casino = ? AND internal = 0 AND hour >= ? GROUP BY chain, asset, dir').all(slug, since)
    .forEach(r => { const k = r.chain + '|' + r.asset; const o = assets[k] || (assets[k] = { chain: r.chain, chainName: CHAINS[r.chain] ? CHAINS[r.chain].name : r.chain, asset: r.asset, inflow: 0, outflow: 0 }); o[r.dir === 'in' ? 'inflow' : 'outflow'] = r.usd || 0; });
  const internal = db.prepare('SELECT SUM(usd) AS usd FROM flows WHERE casino = ? AND internal = 1 AND hour >= ? AND dir = ?').get(slug, since, 'in');
  const balHist = db.prepare('SELECT day, SUM(usd) AS usd FROM balance_days WHERE casino = ? GROUP BY day ORDER BY day DESC LIMIT 90').all(slug).reverse();
  const large = whales(state, new URLSearchParams({ casino: slug, min: '10000', limit: '40' })).items;
  const deps = db.prepare('SELECT dir, COUNT(DISTINCT cp) AS n FROM cps WHERE casino = ? AND day >= ? GROUP BY dir').all(slug, dayOf(since));
  return {
    slug, name: names[slug] || slug, days, updatedAt: Date.now(),
    balance: walletRows.reduce((s, w) => s + w.usd, 0),
    inflow: series.reduce((s, d) => s + d.inflow, 0), outflow: series.reduce((s, d) => s + d.outflow, 0),
    depositors: (deps.find(d => d.dir === 'in') || {}).n || 0, withdrawers: (deps.find(d => d.dir === 'out') || {}).n || 0,
    internalMoved: internal && internal.usd || 0,
    wallets: walletRows.sort((a, b) => b.usd - a.usd), daily: series, assets: Object.values(assets).sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow)),
    balanceHistory: balHist, large
  };
}

function tokenStats(state) {
  const { store, indexer, registry } = state;
  const db = store.db;
  const today = dayOf(Date.now());
  const ago = n => dayOf(Date.now() - n * 86400000);
  return (registry.tokens || []).map(t => {
    const rows = db.prepare('SELECT * FROM token_days WHERE sym = ? ORDER BY day DESC LIMIT 40').all(t.sym);
    const at = d => rows.find(r => r.day <= d) || null;
    const now = rows[0] || {};
    const d7 = at(ago(7)), d30 = at(ago(30));
    const circ = r => (r && r.supply != null ? r.supply - (r.dead || 0) : null);
    const treasury = db.prepare(`SELECT SUM(b.amount) AS amount, SUM(b.usd) AS usd FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address
      WHERE w.casino = ? AND w.active = 1 AND b.asset = ?`).get(t.casino, t.sym);
    const live = indexer.tokenLive[t.sym] || {};
    return {
      sym: t.sym, casino: t.casino, name: store.casinoNames()[t.casino] || t.casino, chain: t.chain, address: t.address, url: addrUrl(t.chain, t.address),
      price: live.price || now.price || null, ch24: live.ch24 != null ? live.ch24 : null, liquidity: now.liquidity, vol24: now.vol24, buys24: now.buys24, sells24: now.sells24,
      dexUrl: live.url || '', holders: now.holders, holders7d: d7 ? d7.holders : null,
      supply: now.supply, circulating: circ(now), burned7d: d7 && circ(d7) != null && circ(now) != null ? Math.max(0, circ(d7) - circ(now)) : null,
      burned30d: d30 && circ(d30) != null && circ(now) != null ? Math.max(0, circ(d30) - circ(now)) : null,
      treasury: treasury && treasury.amount || 0, treasuryUsd: treasury && treasury.usd || 0,
      history: rows.slice(0, 30).reverse().map(r => ({ day: r.day, price: r.price, holders: r.holders, circulating: circ(r) })),
      since: rows.length ? rows[rows.length - 1].day : today
    };
  });
}

function coverage(state) {
  const names = state.store.casinoNames();
  const out = {};
  state.store.wallets().filter(w => w.source !== 'mirror').forEach(w => {
    const o = out[w.casino] || (out[w.casino] = { slug: w.casino, name: names[w.casino] || w.casino, wallets: [] });
    o.wallets.push({ chain: w.chain, address: w.address, label: w.label, role: w.role, source: w.source, url: addrUrl(w.chain, w.address) });
  });
  return { updatedAt: Date.now(), casinos: Object.values(out).sort((a, b) => b.wallets.length - a.wallets.length) };
}

// Discovery: list where an address sends its funds. For a casino deposit address, the top destination is the casino's collection or hot wallet.
async function discover(state, chain, address) {
  const adapter = ADAPTERS[chain];
  if (!adapter || !adapter.outgoing) throw new Error('unsupported chain');
  if (!validAddress(chain, address)) throw new Error('not a valid ' + chain + ' address');
  await prices.refresh().catch(() => {});
  let list;
  try { list = await adapter.outgoing({ cfg: state.cfg, store: state.store, log: state.log }, address); }
  catch (e) { throw new Error('Could not read ' + (CHAINS[chain] ? CHAINS[chain].name : chain) + ' history: ' + e.message); }
  const owner = new Map(state.store.wallets(false).map(w => [w.chain + '|' + w.address, w.casino]));
  const names = state.store.casinoNames();
  const by = {};
  list.forEach(t => {
    const k = norm(chain, t.cp);
    if (!k) return;
    const o = by[k] || (by[k] = { address: t.cp, count: 0, usd: 0, assets: {}, first: t.ts, last: t.ts });
    o.count += 1;
    o.usd += prices.usd(chain, t.asset, t.amount, t.token) || 0;
    o.assets[t.asset] = (o.assets[t.asset] || 0) + t.amount;
    o.first = Math.min(o.first, t.ts); o.last = Math.max(o.last, t.ts);
  });
  return {
    chain, address, transfersOut: list.length,
    candidates: Object.values(by).sort((a, b) => b.count - a.count || b.usd - a.usd).slice(0, 10).map(o => {
      const known = owner.get(chain + '|' + norm(chain, o.address));
      return Object.assign(o, { url: addrUrl(chain, o.address), knownCasino: known || null, knownName: known ? names[known] || known : null });
    })
  };
}

// CSV downloads (members). Text cells that could start a spreadsheet formula get a leading apostrophe.
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function sendCsv(res, name, rows) {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="' + name + '"', 'cache-control': 'no-store' });
  res.end('\ufeff' + csv(rows));
}
function exportCsv(state, p, q, res) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (p === '/api/onchain/export/flows.csv') {
    const win = WINDOWS[q.get('window')] ? q.get('window') : '30d';
    const ov = overview(state, win);
    const rows = [['casino', 'slug', 'window', 'deposits_usd', 'withdrawals_usd', 'net_flow_usd', 'transfers_in', 'transfers_out', 'depositing_addresses', 'tracked_balance_usd', 'chains']];
    ov.casinos.filter(c => c.wallets > 0).forEach(c => rows.push([c.name, c.slug, win, c.inflow, c.outflow, c.net, c.txIn, c.txOut, c.depositors, c.balance, c.chains.map(x => x.name).join(' ')]));
    return sendCsv(res, 'streax-flows-' + win + '-' + stamp + '.csv', rows);
  }
  if (p === '/api/onchain/export/whales.csv') {
    const days = Math.min(30, Math.max(1, Number(q.get('days')) || 30));
    const min = Math.max(1000, Number(q.get('min')) || 10000);
    const names = state.store.casinoNames();
    const rows = [['time_utc', 'casino', 'chain', 'direction', 'asset', 'amount', 'usd', 'counterparty', 'transaction', 'explorer']];
    state.store.db.prepare('SELECT * FROM transfers WHERE ts >= ? AND usd >= ? ORDER BY ts DESC LIMIT 20000').all(Date.now() - days * 86400000, min)
      .forEach(t => rows.push([new Date(t.ts).toISOString(), names[t.casino] || t.casino, CHAINS[t.chain] ? CHAINS[t.chain].name : t.chain, t.dir === 'in' ? 'deposit' : 'withdrawal',
        t.asset, t.amount, t.usd, t.cp, t.tx, txUrl(t.chain, t.tx)]));
    return sendCsv(res, 'streax-whales-' + days + 'd-' + stamp + '.csv', rows);
  }
  const m = p.match(/^\/api\/onchain\/export\/casino\/([a-z0-9-]+)\.csv$/);
  if (m) {
    const days = Math.min(90, Math.max(7, Number(q.get('days')) || 90));
    const d = casinoDetail(state, m[1], days);
    if (!d) return send(res, 404, { error: 'No tracked wallets for this casino yet' });
    const rows = [['date', 'casino', 'deposits_usd', 'withdrawals_usd', 'net_flow_usd', 'transfers_in', 'transfers_out']];
    d.daily.forEach(x => rows.push([new Date(x.t).toISOString().slice(0, 10), d.name, x.inflow, x.outflow, x.inflow - x.outflow, x.txIn, x.txOut]));
    return sendCsv(res, 'streax-' + m[1] + '-' + days + 'd-' + stamp + '.csv', rows);
  }
  return send(res, 404, { error: 'Not found' });
}

// With accounts on, longer history and downloads are a free member perk. state.viewer(req) returns the logged-in user.
function memberOnly(state, req, res, perk) {
  if (!state.viewer || state.viewer(req)) return false;
  send(res, 401, { error: 'Log in or create a free account to see this.', code: 'login_required', perk });
  return true;
}

async function handle(state, req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/onchain')) return false;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-admin-token', 'access-control-allow-methods': 'GET, POST, DELETE' }); res.end(); return true; }
  if (!state) { send(res, 503, { enabled: false, error: 'On-chain monitor is off. It needs Node.js 22.5 or newer.' }); return true; }
  try {
    if (p === '/api/onchain/status') return send(res, 200, status(state)), true;
    if (p === '/api/onchain/overview') { const w = url.searchParams.get('window') || '24h'; if (w !== '24h' && memberOnly(state, req, res, 'history')) return true; return send(res, 200, cached('ov:' + w, 30000, () => overview(state, w))), true; }
    if (p === '/api/onchain/whales') return send(res, 200, cached('wh:' + url.search, 20000, () => whales(state, url.searchParams))), true;
    if (p === '/api/onchain/tokens') return send(res, 200, cached('tok', 60000, () => ({ updatedAt: Date.now(), tokens: tokenStats(state) }))), true;
    if (p === '/api/onchain/coverage') return send(res, 200, cached('cov', 60000, () => coverage(state))), true;
    const m = p.match(/^\/api\/onchain\/casino\/([a-z0-9-]+)$/);
    if (m) {
      const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days')) || 30));
      if (days > 7 && memberOnly(state, req, res, 'history')) return true;
      const d = cached('c:' + m[1] + ':' + days, 30000, () => casinoDetail(state, m[1], days));
      return d ? send(res, 200, d) : send(res, 404, { error: 'No tracked wallets for this casino yet' }), true;
    }
    if (p.startsWith('/api/onchain/export/')) { if (memberOnly(state, req, res, 'csv')) return true; return exportCsv(state, p, url.searchParams, res), true; }
    // Admin routes need the ADMIN_TOKEN in the x-admin-token header.
    if (p.startsWith('/api/onchain/admin/')) {
      if (!state.cfg.adminToken) return send(res, 403, { error: 'Set ADMIN_TOKEN on the server to use admin tools' }), true;
      if (req.headers['x-admin-token'] !== state.cfg.adminToken) return send(res, 401, { error: 'Wrong admin token' }), true;
      if (p === '/api/onchain/admin/discover' && req.method === 'POST') {
        const b = await readBody(req);
        return send(res, 200, await discover(state, String(b.chain || ''), String(b.address || '').trim())), true;
      }
      if (p === '/api/onchain/admin/wallets' && req.method === 'POST') {
        const b = await readBody(req);
        const chain = String(b.chain || ''), address = String(b.address || '').trim(), casino = String(b.casino || '').trim();
        if (!CHAINS[chain]) return send(res, 400, { error: 'Unknown chain' }), true;
        if (!validAddress(chain, address)) return send(res, 400, { error: 'Not a valid ' + chain + ' address' }), true;
        if (!/^[a-z0-9-]{2,40}$/.test(casino)) return send(res, 400, { error: 'Casino must be a slug like stakecom' }), true;
        const role = ['hot', 'wallet', 'cold', 'funder'].includes(b.role) ? b.role : 'wallet';
        state.store.addWallet({ chain, address, casino, label: String(b.label || '').slice(0, 80), role, source: String(b.source || 'Added by admin').slice(0, 120) });
        if (b.name) state.store.setCasinoName(casino, String(b.name).slice(0, 60));
        clearCache();
        return send(res, 200, { ok: true }), true;
      }
      if (p === '/api/onchain/admin/wallets' && req.method === 'DELETE') {
        const b = await readBody(req);
        const n = state.store.removeWallet(String(b.chain || ''), String(b.address || ''));
        clearCache();
        return send(res, 200, { ok: n > 0 }), true;
      }
      if (p === '/api/onchain/admin/run' && req.method === 'POST') {
        state.indexer.runOnce().catch(() => {});
        return send(res, 202, { ok: true, note: 'Run started' }), true;
      }
      if (p === '/api/onchain/admin/wallets' && req.method === 'GET') return send(res, 200, { wallets: state.store.wallets(false) }), true;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
  return true;
}

module.exports = { handle, csv, exportCsv, overview, whales, casinoDetail, tokenStats, coverage, discover, status, clearCache };
