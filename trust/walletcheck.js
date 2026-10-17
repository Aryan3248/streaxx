'use strict';
// My wallet check: reads a player's recent transfers and matches them against casino wallets the monitor tracks.
// A deposit counts when coins went to a casino wallet directly, or to an address that later forwarded coins into one
// (casino deposit addresses, learned from the last 35 days of sweeps). A withdrawal counts when coins came from a casino wallet.
// Nothing is stored: the address is only used for this one lookup.

const { getJSON, validAddress, norm } = require('../onchain/util');
const { CHAINS, txUrl } = require('../onchain/assets');
const evm = require('../onchain/chains/evm');
const tron = require('../onchain/chains/tron');
const prices = require('../onchain/prices');

const EVM = ['ethereum', 'polygon', 'bsc'];

function chainsFor(address) {
  const a = String(address || '').trim();
  if (validAddress('ethereum', a)) return { family: 'evm', chains: EVM };
  if (validAddress('tron', a)) return { family: 'tron', chains: ['tron'] };
  if (validAddress('solana', a)) return { family: 'solana', chains: [] };
  if (validAddress('bitcoin', a)) return { family: 'bitcoin', chains: [] };
  return { family: null, chains: [] };
}

async function evmTransfers(cfg, chain, address) {
  const id = CHAINS[chain].etherscanId;
  const base = { module: 'account', address, startblock: '0', endblock: '99999999', page: '1', offset: '1000', sort: 'desc' };
  const [txs, toks] = await Promise.all([
    evm.etherscan(cfg, id, Object.assign({ action: 'txlist' }, base)),
    evm.etherscan(cfg, id, Object.assign({ action: 'tokentx' }, base))
  ]);
  const list = evm.normalize(chain, address, 'txlist', txs || []).concat(evm.normalize(chain, address, 'tokentx', toks || []));
  return { list, scanned: (txs || []).length + (toks || []).length, capped: (txs || []).length >= 1000 || (toks || []).length >= 1000 };
}

async function tronTransfers(cfg, address) {
  const headers = cfg.trongridKey ? { 'TRON-PRO-API-KEY': cfg.trongridKey } : {};
  const opts = { headers, gap: cfg.trongridKey ? 120 : 1100, timeout: 20000 };
  const a = encodeURIComponent(address);
  const [t, n] = await Promise.all([
    getJSON('https://api.trongrid.io/v1/accounts/' + a + '/transactions/trc20?only_confirmed=true&limit=200&order_by=block_timestamp,desc', opts),
    getJSON('https://api.trongrid.io/v1/accounts/' + a + '/transactions?only_confirmed=true&limit=200&order_by=block_timestamp,desc', opts)
  ]);
  const tr = Array.isArray(t.data) ? t.data : [], nr = Array.isArray(n.data) ? n.data : [];
  return { list: tron.normalizeTrc20(address, tr).concat(tron.normalizeTrx(address, nr)), scanned: tr.length + nr.length, capped: tr.length >= 200 || nr.length >= 200 };
}

// onchain: the on-chain monitor state. Returns a summary per casino plus the matched transfers.
async function check(onchain, address, opts = {}) {
  const a = String(address || '').trim();
  const kind = chainsFor(a);
  if (!kind.family) throw Object.assign(new Error('That does not look like a wallet address. Paste an Ethereum-style (0x...) or Tron (T...) address.'), { status: 400 });
  if (!kind.chains.length) throw Object.assign(new Error((kind.family === 'solana' ? 'Solana' : 'Bitcoin') + ' wallet checks are coming soon. Ethereum, BNB Chain, Polygon and Tron work today.'), { status: 400 });
  if (!onchain) throw Object.assign(new Error('Wallet checks need the on-chain monitor, which is off on this server.'), { status: 503 });
  const cfg = onchain.cfg;
  const names = onchain.store.casinoNames();
  const owner = new Map();
  onchain.store.wallets().forEach(w => { if (w.role !== 'funder') owner.set(w.chain + '|' + w.address, w.casino); });
  try { await prices.refresh(); } catch (e) { /* values may be missing for non-stablecoins */ }

  const chainsOut = [];
  let all = [];
  for (const chain of kind.chains) {
    const row = { chain, name: CHAINS[chain].name, ok: false, scanned: 0, capped: false, error: '' };
    try {
      if (CHAINS[chain].etherscanId && !cfg.etherscanKey) throw new Error('needs ETHERSCAN_API_KEY on the server');
      const r = chain === 'tron' ? await tronTransfers(cfg, a) : await evmTransfers(cfg, chain, a);
      row.ok = true; row.scanned = r.scanned; row.capped = r.capped;
      if (r.list.length) row.oldest = Math.min(...r.list.map(t => t.ts));
      all = all.concat(r.list);
    } catch (e) {
      row.error = /NOTOK|Free API access is not supported|paid/i.test(e.message) ? 'not available on the free Etherscan plan' : e.message.replace(/^Etherscan: /, '');
    }
    chainsOut.push(row);
  }

  // Outgoing counterparties that are known casino deposit addresses (they forwarded coins into a casino wallet).
  const outs = [...new Set(all.filter(t => t.dir === 'out' && t.cp).map(t => norm(t.chain, t.cp)))];
  const sweep = new Map();
  for (let i = 0; i < outs.length; i += 400) {
    const part = outs.slice(i, i + 400);
    onchain.store.db.prepare("SELECT DISTINCT casino, cp FROM cps WHERE dir = 'in' AND cp IN (" + part.map(() => '?').join(',') + ')').all(...part)
      .forEach(r => { if (!sweep.has(r.cp)) sweep.set(r.cp, r.casino); });
  }

  const matched = [];
  all.forEach(t => {
    const cp = norm(t.chain, t.cp);
    let casino = owner.get(t.chain + '|' + cp) || null, via = 'casino wallet';
    if (!casino && t.dir === 'out' && sweep.has(cp)) { casino = sweep.get(cp); via = 'casino deposit address'; }
    if (!casino) return;
    const usd = prices.usd(t.chain, t.asset, t.amount, t.token);
    matched.push({ chain: t.chain, chainName: CHAINS[t.chain].name, tx: t.tx, ts: t.ts, kind: t.dir === 'out' ? 'deposit' : 'withdrawal', casino, casinoName: names[casino] || casino,
      asset: t.asset, amount: t.amount, usd: Number.isFinite(usd) ? usd : null, via, explorer: txUrl(t.chain, t.tx) });
  });
  matched.sort((x, y) => y.ts - x.ts);

  const per = {};
  matched.forEach(m => {
    const c = per[m.casino] || (per[m.casino] = { slug: m.casino, name: m.casinoName, deposits: 0, depositsN: 0, withdrawals: 0, withdrawalsN: 0, unpriced: 0, first: m.ts, last: m.ts });
    if (m.usd == null) c.unpriced += 1;
    if (m.kind === 'deposit') { c.deposits += m.usd || 0; c.depositsN += 1; } else { c.withdrawals += m.usd || 0; c.withdrawalsN += 1; }
    c.first = Math.min(c.first, m.ts); c.last = Math.max(c.last, m.ts);
  });
  const casinos = Object.values(per).map(c => Object.assign(c, { net: c.withdrawals - c.deposits })).sort((x, y) => (y.deposits + y.withdrawals) - (x.deposits + x.withdrawals));
  const totals = casinos.reduce((s, c) => ({ deposits: s.deposits + c.deposits, withdrawals: s.withdrawals + c.withdrawals }), { deposits: 0, withdrawals: 0 });
  totals.net = totals.withdrawals - totals.deposits;
  const tracked = new Set(onchain.store.wallets().map(w => w.casino)).size;
  return {
    address: a, family: kind.family, chains: chainsOut, casinos, totals, transfers: opts.full ? matched.slice(0, 500) : matched.slice(0, 5), transferCount: matched.length,
    scanned: all.length, tracked, checkedAt: Date.now()
  };
}

module.exports = { check, chainsFor };
