'use strict';
// Ethereum-style chains. Transfers come from the Etherscan V2 API (one free key covers Ethereum and Polygon;
// BNB Chain needs a paid Etherscan plan). Balances come from public RPC nodes, so they cost no API calls.

const { getJSON, sleep, units, hexUnits, norm } = require('../util');
const { CHAINS, token } = require('../assets');

const API = 'https://api.etherscan.io/v2/api';
const PAGE = 1000;

class RateLimited extends Error {}

async function etherscan(cfg, chainid, params) {
  if (!cfg.etherscanKey) throw new Error('ETHERSCAN_API_KEY is not set');
  const qs = new URLSearchParams(Object.assign({ chainid: String(chainid) }, params, { apikey: cfg.etherscanKey }));
  for (let attempt = 0; attempt < 4; attempt++) {
    const j = await getJSON(API + '?' + qs, { gap: cfg.etherscanGap != null ? cfg.etherscanGap : 360, timeout: 25000 });
    if (j && j.status === '1') return j.result;
    const msg = String((j && (typeof j.result === 'string' ? j.result : j.message)) || 'Etherscan error');
    if (j && j.message === 'No transactions found') return [];
    if (j && j.status === '0' && Array.isArray(j.result) && j.result.length === 0) return [];
    if (/rate limit/i.test(msg)) { await sleep(1100 * (attempt + 1)); continue; }
    throw new Error('Etherscan: ' + msg);
  }
  throw new RateLimited('Etherscan rate limit');
}

const blockCache = new Map();
async function blockAt(cfg, chainid, ms) {
  const key = chainid + ':' + Math.floor(ms / 600000);
  if (blockCache.has(key)) return blockCache.get(key);
  const r = await etherscan(cfg, chainid, { module: 'block', action: 'getblocknobytime', timestamp: String(Math.floor(ms / 1000)), closest: 'before' });
  const n = Number(r);
  if (!Number.isFinite(n)) throw new Error('Etherscan: no block for timestamp');
  blockCache.set(key, n);
  return n;
}

// Convert Etherscan rows to normalized transfers for one wallet.
function normalize(chain, wallet, action, rows) {
  const me = norm(chain, wallet);
  const native = CHAINS[chain].native;
  const out = [];
  const dup = new Map();
  for (const r of rows) {
    if (r.isError === '1') continue;
    const from = norm(chain, r.from), to = norm(chain, r.to || r.contractAddress);
    if (from === to) continue;
    const dir = to === me ? 'in' : from === me ? 'out' : null;
    if (!dir) continue;
    let asset, contract = '', amount;
    if (action === 'tokentx') {
      const t = token(chain, r.contractAddress);
      if (!t) continue;
      asset = t.sym; contract = norm(chain, r.contractAddress);
      amount = units(r.value, t.decimals);
    } else {
      asset = native.sym;
      amount = units(r.value, native.decimals);
    }
    if (!(amount > 0)) continue;
    let idx;
    if (action === 'txlist') idx = 'n';
    else {
      const base = (action === 'tokentx' ? 't:' + contract : 'i:' + (r.traceId || '')) + ':' + from + ':' + to + ':' + r.value;
      const k = r.hash + '|' + base;
      const c = dup.get(k) || 0;
      dup.set(k, c + 1);
      idx = base + '#' + c;
    }
    out.push({ chain, tx: r.hash, idx, ts: Number(r.timeStamp) * 1000, wallet: me, dir, cp: dir === 'in' ? from : to, asset, token: contract, amount, block: Number(r.blockNumber) });
  }
  return out;
}

function make(chain) {
  const conf = CHAINS[chain];
  const chainid = conf.etherscanId;

  async function transfers(ctx, w) {
    const { cfg, store } = ctx;
    const actions = w.role === 'funder' ? [] : (cfg.internalTx === false ? ['txlist', 'tokentx'] : ['txlist', 'txlistinternal', 'tokentx']);
    const list = [];
    let more = false;
    for (const action of actions) {
      const ckey = 'evm:' + chainid + ':' + w.address + ':' + action;
      let cur = store.cursor(ckey);
      let [block, page] = cur ? cur.split(':').map(Number) : [null, 1];
      if (block === null || !Number.isFinite(block)) block = await blockAt(cfg, chainid, Date.now() - cfg.backfillHours * 3600000);
      page = page || 1;
      for (let call = 0; call < cfg.maxPagesPerWallet; call++) {
        const rows = await etherscan(cfg, chainid, { module: 'account', action, address: w.address, startblock: String(block), endblock: '99999999', page: String(page), offset: String(PAGE), sort: 'asc' });
        list.push(...normalize(chain, w.address, action, rows));
        if (rows.length < PAGE) {
          if (rows.length) block = Number(rows[rows.length - 1].blockNumber);
          page = 1;
          store.setCursor(ckey, block + ':1');
          break;
        }
        const last = Number(rows[rows.length - 1].blockNumber);
        if (last === block) page += 1; else { block = last; page = 1; }
        store.setCursor(ckey, block + ':' + page);
        if (call === cfg.maxPagesPerWallet - 1) more = true;
      }
    }
    return { list, more };
  }

  async function rpcBatch(cfg, calls) {
    const urls = (cfg.rpc && cfg.rpc[chain]) ? [cfg.rpc[chain]] : conf.rpc;
    let lastErr;
    for (const url of urls) {
      try {
        const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params })));
        const res = await getJSON(url, { method: 'POST', body, timeout: 20000, gap: 200 });
        if (!Array.isArray(res)) throw new Error('RPC batch not supported');
        const byId = new Map(res.map(r => [r.id, r]));
        return calls.map((c, i) => { const r = byId.get(i); return r && !r.error ? r.result : null; });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no RPC reachable');
  }

  // Latest balances of native coin and listed tokens for many wallets, through JSON-RPC batches of 60 calls.
  async function balances(ctx, wallets) {
    const tokens = Object.entries(conf.tokens);
    const calls = [];
    wallets.forEach(w => {
      calls.push({ w, asset: conf.native.sym, decimals: conf.native.decimals, method: 'eth_getBalance', params: [w.address, 'latest'] });
      tokens.forEach(([contract, t]) => calls.push({ w, asset: t.sym, decimals: t.decimals, method: 'eth_call',
        params: [{ to: contract, data: '0x70a08231' + w.address.replace(/^0x/, '').toLowerCase().padStart(64, '0') }, 'latest'] }));
    });
    const out = [];
    for (let i = 0; i < calls.length; i += 60) {
      const chunk = calls.slice(i, i + 60);
      const res = await rpcBatch(ctx.cfg, chunk);
      chunk.forEach((c, k) => {
        if (res[k] == null) return;
        out.push({ chain, address: c.w.address, asset: c.asset, amount: hexUnits(res[k], c.decimals) });
      });
    }
    return out;
  }

  // Wallet discovery: where does this address send its funds? Deposit addresses sweep into the casino's collection or hot wallet.
  async function outgoing(ctx, address) {
    const me = norm(chain, address);
    const rows = [];
    for (const action of ['txlist', 'tokentx']) {
      const r = await etherscan(ctx.cfg, chainid, { module: 'account', action, address, startblock: '0', endblock: '99999999', page: '1', offset: '200', sort: 'desc' });
      rows.push(...normalize(chain, address, action, r).filter(t => t.dir === 'out' && t.wallet === me));
    }
    return rows;
  }

  async function erc20(ctx, contract, holder) {
    const calls = [{ method: 'eth_call', params: [{ to: contract, data: '0x18160ddd' }, 'latest'] }];
    (holder || []).forEach(h => calls.push({ method: 'eth_call', params: [{ to: contract, data: '0x70a08231' + h.replace(/^0x/, '').toLowerCase().padStart(64, '0') }, 'latest'] }));
    return rpcBatch(ctx.cfg, calls);
  }

  return { chain, transfers, balances, outgoing, erc20, flowsEnabled: cfg => !!cfg.etherscanKey && (chain !== 'bsc' || cfg.etherscanPaid) };
}

module.exports = { ethereum: make('ethereum'), bsc: make('bsc'), polygon: make('polygon'), normalize, etherscan };
