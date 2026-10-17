'use strict';
// Solana through any JSON-RPC endpoint. Set SOLANA_RPC_URL to a Helius URL (free plan) for reliable limits;
// the public endpoint works for light use. Transfers are read from balance changes inside each transaction.

const { getJSON, units } = require('../util');
const { CHAINS, token } = require('../assets');

const conf = CHAINS.solana;
const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

function rpcUrl(cfg) { return cfg.solanaRpc || PUBLIC_RPC; }
async function rpc(cfg, method, params) {
  const j = await getJSON(rpcUrl(cfg), { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), gap: cfg.solanaRpc ? 120 : 700, timeout: 25000 });
  if (j.error) throw new Error('Solana RPC: ' + (j.error.message || 'error'));
  return j.result;
}
async function rpcBatch(cfg, calls) {
  const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params })));
  const j = await getJSON(rpcUrl(cfg), { method: 'POST', body, gap: cfg.solanaRpc ? 250 : 1500, timeout: 40000 });
  if (!Array.isArray(j)) throw new Error('Solana RPC: batch not supported, set SOLANA_RPC_URL');
  const byId = new Map(j.map(r => [r.id, r]));
  return calls.map((c, i) => { const r = byId.get(i); return r && !r.error ? r.result : null; });
}

const keyOf = k => (typeof k === 'string' ? k : k && k.pubkey);

// Turn one jsonParsed transaction into transfers for `wallet`: SOL from lamport changes, tokens from token balance changes.
function parseTx(wallet, sig, tx) {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const ts = (tx.blockTime || 0) * 1000;
  const keys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys || []).map(keyOf);
  const out = [];
  const i = keys.indexOf(wallet);
  if (i >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
    let delta = (tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0);
    if (i === 0) delta += tx.meta.fee || 0;
    if (Math.abs(delta) >= 1000) {
      let cp = '', best = 0;
      keys.forEach((k, j) => {
        if (j === i) return;
        const d = (tx.meta.postBalances[j] || 0) - (tx.meta.preBalances[j] || 0);
        if (Math.sign(d) === -Math.sign(delta) && Math.abs(d) > best) { best = Math.abs(d); cp = k; }
      });
      out.push({ chain: 'solana', tx: sig, idx: 'n', ts, wallet, dir: delta > 0 ? 'in' : 'out', cp, asset: 'SOL', token: '', amount: units(Math.abs(delta), conf.native.decimals) });
    }
  }
  const sum = (arr) => {
    const m = new Map();
    (arr || []).forEach(b => {
      const k = b.owner + '|' + b.mint;
      const amt = b.uiTokenAmount ? units(b.uiTokenAmount.amount, b.uiTokenAmount.decimals) : 0;
      m.set(k, (m.get(k) || 0) + amt);
    });
    return m;
  };
  const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
  const mints = new Set();
  [...pre.keys(), ...post.keys()].forEach(k => { if (k.startsWith(wallet + '|')) mints.add(k.split('|')[1]); });
  mints.forEach(mint => {
    const t = token('solana', mint);
    if (!t) return;
    const delta = (post.get(wallet + '|' + mint) || 0) - (pre.get(wallet + '|' + mint) || 0);
    if (Math.abs(delta) < 1e-6) return;
    let cp = '', best = 0;
    new Set([...pre.keys(), ...post.keys()]).forEach(k => {
      const [owner, m] = k.split('|');
      if (m !== mint || owner === wallet) return;
      const d = (post.get(k) || 0) - (pre.get(k) || 0);
      if (Math.sign(d) === -Math.sign(delta) && Math.abs(d) > best) { best = Math.abs(d); cp = owner; }
    });
    out.push({ chain: 'solana', tx: sig, idx: 't:' + mint, ts, wallet, dir: delta > 0 ? 'in' : 'out', cp, asset: t.sym, token: mint, amount: Math.abs(delta) });
  });
  return out;
}

async function newSignatures(ctx, w) {
  const { cfg, store } = ctx;
  const ckey = 'sol:' + w.address;
  const until = store.cursor(ckey);
  const floor = Math.floor((Date.now() - cfg.backfillHours * 3600000) / 1000);
  const sigs = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const opts = { limit: 1000, commitment: 'confirmed' };
    if (until) opts.until = until;
    if (before) opts.before = before;
    const page = await rpc(cfg, 'getSignaturesForAddress', [w.address, opts]);
    if (!page || !page.length) break;
    let stop = false;
    for (const s of page) {
      if (!until && s.blockTime && s.blockTime < floor) { stop = true; break; }
      sigs.push(s);
    }
    if (stop || page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  return sigs.filter(s => !s.err).reverse(); // oldest first
}

async function transfers(ctx, w) {
  const { cfg, store } = ctx;
  const sigs = await newSignatures(ctx, w);
  const cap = cfg.maxSolanaTxPerWallet;
  const take = sigs.slice(0, cap);
  const list = [];
  for (let i = 0; i < take.length; i += 50) {
    const chunk = take.slice(i, i + 50);
    const res = await rpcBatch(cfg, chunk.map(s => ({ method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] })));
    chunk.forEach((s, k) => list.push(...parseTx(w.address, s.signature, res[k])));
  }
  if (take.length) store.setCursor('sol:' + w.address, take[take.length - 1].signature);
  return { list, more: sigs.length > cap };
}

async function balances(ctx, wallets) {
  const out = [];
  for (const w of wallets) {
    const b = await rpc(ctx.cfg, 'getBalance', [w.address, { commitment: 'confirmed' }]);
    out.push({ chain: 'solana', address: w.address, asset: 'SOL', amount: units(b && b.value || 0, 9) });
    for (const [mint, t] of Object.entries(conf.tokens)) {
      const r = await rpc(ctx.cfg, 'getTokenAccountsByOwner', [w.address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      let amt = 0;
      (r && r.value || []).forEach(a => {
        const ta = a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info && a.account.data.parsed.info.tokenAmount;
        if (ta) amt += units(ta.amount, ta.decimals);
      });
      out.push({ chain: 'solana', address: w.address, asset: t.sym, amount: amt });
    }
  }
  return out;
}

async function outgoing(ctx, address) {
  const sigs = (await rpc(ctx.cfg, 'getSignaturesForAddress', [address, { limit: 40 }])) || [];
  const ok = sigs.filter(s => !s.err);
  const res = ok.length ? await rpcBatch(ctx.cfg, ok.map(s => ({ method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }))) : [];
  const list = [];
  ok.forEach((s, i) => list.push(...parseTx(address, s.signature, res[i]).filter(t => t.dir === 'out')));
  return list;
}

module.exports = { solana: { chain: 'solana', transfers, balances, outgoing, flowsEnabled: () => true }, parseTx };
