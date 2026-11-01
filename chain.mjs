// Blockchain readers: Etherscan V2 (Ethereum, Polygon, BNB Chain), a public
// Ethereum RPC for balances, TronGrid for Tron, DefiLlama for prices.
import crypto from 'node:crypto';
import { getJson } from './http.mjs';

export const EVM_CHAIN_ID = { ethereum: 1, polygon: 137, bsc: 56 };
export const NATIVE = { ethereum: 'ETH', polygon: 'POL', bsc: 'BNB', tron: 'TRX' };
const DEC_NATIVE = { ethereum: 18, polygon: 18, bsc: 18, tron: 6 };

// Only these assets count. Matched by contract address, never by name.
export const TOKENS = {
  ethereum: {
    '0xdac17f958d2ee523a2206206994597c13d831ec7': ['USDT', 6], '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': ['USDC', 6], '0x6b175474e89094c44da98b954eedeac495271d0f': ['DAI', 18],
    '0x046eee2cc3188071c02bfc1745a6b17c656e3f3d': ['RLB', 18], '0x8881562783028f5c1bcb985d2283d5e170d88888': ['SHFL', 18], '0x419d0d8bdd9af5e606ae2232ed285aff190e711b': ['FUN', 8]
  },
  polygon: { '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': ['USDT', 6], '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': ['USDC', 6], '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': ['USDC', 6] },
  bsc: { '0x55d398326f99059ff775485246999027b3197955': ['USDT', 18], '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': ['USDC', 18] },
  tron: { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: ['USDT', 6] }
};
export const STABLE = new Set(['USDT', 'USDC', 'DAI']);
const LLAMA_ID = { ETH: 'coingecko:ethereum', POL: 'coingecko:polygon-ecosystem-token', BNB: 'coingecko:binancecoin', TRX: 'coingecko:tron', RLB: 'coingecko:rollbit-coin', SHFL: 'coingecko:shuffle-2', FUN: 'coingecko:funfair' };

const units = (raw, dec) => { const s = String(raw || '0'); if (!/^\d+$/.test(s)) return 0; return Number(s) / 10 ** dec; };

// ---------- prices ----------
export async function prices() {
  const out = { USDT: 1, USDC: 1, DAI: 1 };
  try {
    const j = await getJson('https://coins.llama.fi/prices/current/' + Object.values(LLAMA_ID).join(','), { timeout: 12000 });
    Object.entries(LLAMA_ID).forEach(([sym, id]) => { const c = j.coins && j.coins[id]; if (c && c.price) out[sym] = c.price; });
  } catch {}
  return out;
}

// ---------- Etherscan V2 ----------
export const etherscanKey = () => process.env.ETHERSCAN_API_KEY || '';
let lastCall = 0;
async function throttle() {
  // Free Etherscan keys allow 3 calls per second; 350 ms keeps under that. Paid plans can lower it.
  const gap = Number(process.env.ETHERSCAN_MIN_GAP_MS || 350);
  const wait = lastCall + gap - Date.now();
  lastCall = Math.max(Date.now(), lastCall + gap);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
export async function etherscan(chain, params) {
  if (!etherscanKey()) throw new Error('ETHERSCAN_API_KEY is not set');
  const qs = new URLSearchParams({ chainid: String(EVM_CHAIN_ID[chain]), ...params, apikey: etherscanKey() });
  for (let i = 0; i < 4; i++) {
    await throttle();
    const j = await getJson('https://api.etherscan.io/v2/api?' + qs, { timeout: 20000 });
    if (j.status === '1' || (j.jsonrpc && j.result != null)) return j.result;
    const msg = String(j.result || j.message || '');
    if (/no (transactions|records) found/i.test(j.message || '') || (Array.isArray(j.result) && !j.result.length)) return [];
    if (/rate limit/i.test(msg)) { await new Promise((r) => setTimeout(r, 1200 * (i + 1))); continue; }
    throw new Error(/free api access|not supported|upgrade/i.test(msg) ? 'not available on the free Etherscan plan' : msg || 'Etherscan error');
  }
  throw new Error('Etherscan rate limit');
}
export async function latestBlock(chain) { return parseInt(await etherscan(chain, { module: 'proxy', action: 'eth_blockNumber' }), 16); }

// Normalized transfers of allowed assets touching `address`. Each of the three
// Etherscan lists keeps its own cursor { b: block, k: [keys seen at block b] },
// so a run that stops early carries on from the same place next time.
// Returns { items: [{ key, hash, ts, block, from, to, asset, amount }], cursors, capped }
export async function evmTransfers(chain, address, startBlock, maxPages = 8, cursors = {}) {
  const addr = address.toLowerCase(), items = [], seen = new Set(), next = {};
  let capped = false;
  const add = (key, t) => { if (!seen.has(key)) { seen.add(key); items.push(t); } };
  const pull = async (action, map) => {
    const cur = cursors[action] || { b: startBlock, k: [] };
    const skip = new Set(cur.k || []);
    let from = cur.b, out = { b: cur.b, k: (cur.k || []).slice() };
    for (let p = 0; p < maxPages; p++) {
      const rows = await etherscan(chain, { module: 'account', action, address: addr, startblock: String(from), endblock: '999999999', page: '1', offset: '1000', sort: 'asc' });
      rows.forEach((r) => {
        const b = Number(r.blockNumber), key = rowKey(action, r);
        if (b < cur.b) return;
        if (b > out.b) out = { b, k: [] };
        if (b === out.b && !out.k.includes(key)) out.k.push(key);
        if (skip.has(key)) return;
        const t = map(r, key);
        if (t) add(key, t);
      });
      if (rows.length < 1000) break;
      from = Number(rows[rows.length - 1].blockNumber);
      if (p === maxPages - 1) capped = true;
    }
    next[action] = out;
  };
  const rowKey = (action, r) => r.hash + (action === 'txlist' ? ':n' : action === 'txlistinternal' ? ':i:' + (r.traceId || r.from + r.to + r.value) : ':t:' + r.logIndex);
  const nat = NATIVE[chain];
  const base = (r, key) => ({ key, hash: r.hash, ts: Number(r.timeStamp) * 1000, block: Number(r.blockNumber), from: r.from.toLowerCase(), to: (r.to || '').toLowerCase() });
  await pull('txlist', (r, key) => (r.isError === '0' && r.value !== '0' ? { ...base(r, key), asset: nat, amount: units(r.value, 18) } : null));
  await pull('txlistinternal', (r, key) => (r.isError === '0' && r.value !== '0' ? { ...base(r, key), asset: nat, amount: units(r.value, 18) } : null));
  await pull('tokentx', (r, key) => {
    const tk = TOKENS[chain][String(r.contractAddress).toLowerCase()];
    if (!tk || r.value === '0') return null;
    return { ...base(r, key), asset: tk[0], amount: units(r.value, tk[1]) };
  });
  items.sort((a, b) => a.block - b.block);
  return { items, cursors: next, capped };
}

// ---------- Ethereum RPC (balances, no key needed) ----------
const rpcUrl = () => process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
async function rpcBatch(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 40) {
    const chunk = calls.slice(i, i + 40).map((c, k) => ({ jsonrpc: '2.0', id: i + k, method: c[0], params: c[1] }));
    const j = await getJson(rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chunk), timeout: 20000 });
    (Array.isArray(j) ? j : [j]).forEach((r) => { out[r.id] = r.result; });
  }
  return out;
}
// { address: [{ asset, amount }] } for Ethereum addresses
export async function ethBalances(addresses) {
  const toks = Object.entries(TOKENS.ethereum);
  const calls = [];
  addresses.forEach((a) => {
    calls.push(['eth_getBalance', [a, 'latest']]);
    toks.forEach(([c]) => calls.push(['eth_call', [{ to: c, data: '0x70a08231' + a.toLowerCase().replace('0x', '').padStart(64, '0') }, 'latest']]));
  });
  const res = await rpcBatch(calls);
  const out = {};
  let i = 0;
  addresses.forEach((a) => {
    const list = [];
    const eth = res[i++];
    if (eth) list.push({ asset: 'ETH', amount: Number(BigInt(eth)) / 1e18 });
    toks.forEach(([, [sym, dec]]) => { const v = res[i++]; if (v && v !== '0x') { const n = Number(BigInt(v)) / 10 ** dec; if (n > 0) list.push({ asset: sym, amount: n }); } });
    out[a] = list.filter((x) => x.amount > 0);
  });
  return out;
}

// ---------- Tron ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function tronHexToB58(hex) {
  if (!hex) return '';
  const h = hex.startsWith('41') ? hex : '41' + hex.replace(/^0x/, '');
  const bytes = Buffer.from(h, 'hex');
  const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(bytes).digest()).digest().subarray(0, 4);
  let n = BigInt('0x' + Buffer.concat([bytes, chk]).toString('hex')), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  return s;
}
const tronHeaders = () => (process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {});
export async function tronTransfers(address, minTs, maxPages = 5) {
  const items = [];
  let last = minTs, capped = false;
  for (const [contract, [sym, dec]] of Object.entries(TOKENS.tron)) {
    let url = 'https://api.trongrid.io/v1/accounts/' + address + '/transactions/trc20?only_confirmed=true&limit=200&order_by=block_timestamp,asc&contract_address=' + contract + '&min_timestamp=' + (minTs + 1);
    for (let p = 0; p < maxPages && url; p++) {
      const j = await getJson(url, { headers: tronHeaders() });
      (j.data || []).forEach((r) => { items.push({ key: r.transaction_id + ':t:' + r.from + r.to + r.value, hash: r.transaction_id, ts: r.block_timestamp, from: r.from, to: r.to, asset: sym, amount: units(r.value, dec) }); last = Math.max(last, r.block_timestamp); });
      url = j.meta && j.meta.links && j.meta.links.next;
      if (url && p === maxPages - 1) capped = true;
    }
  }
  let url = 'https://api.trongrid.io/v1/accounts/' + address + '/transactions?only_confirmed=true&limit=200&order_by=block_timestamp,asc&min_timestamp=' + (minTs + 1);
  for (let p = 0; p < maxPages && url; p++) {
    const j = await getJson(url, { headers: tronHeaders() });
    (j.data || []).forEach((r) => {
      const c = r.raw_data && r.raw_data.contract && r.raw_data.contract[0];
      if (!c || c.type !== 'TransferContract' || (r.ret && r.ret[0] && r.ret[0].contractRet !== 'SUCCESS')) return;
      const v = c.parameter.value;
      items.push({ key: r.txID + ':n', hash: r.txID, ts: r.block_timestamp, from: tronHexToB58(v.owner_address), to: tronHexToB58(v.to_address), asset: 'TRX', amount: units(v.amount, DEC_NATIVE.tron) });
      last = Math.max(last, r.block_timestamp);
    });
    url = j.meta && j.meta.links && j.meta.links.next;
    if (url && p === maxPages - 1) capped = true;
  }
  items.sort((a, b) => a.ts - b.ts);
  return { items, lastTs: last, capped };
}
export async function tronBalances(address) {
  const j = await getJson('https://api.trongrid.io/v1/accounts/' + address, { headers: tronHeaders() });
  const a = (j.data || [])[0];
  if (!a) return [];
  const list = [{ asset: 'TRX', amount: (a.balance || 0) / 1e6 }];
  (a.trc20 || []).forEach((o) => Object.entries(o).forEach(([c, v]) => { const tk = TOKENS.tron[c]; if (tk) list.push({ asset: tk[0], amount: units(v, tk[1]) }); }));
  return list.filter((x) => x.amount > 0);
}

// ---------- single transaction lookup (complaints and payout reports) ----------
// Returns { ts, transfers: [{ from, to, asset, amount }] } or null.
export async function lookupTx(chain, hash) {
  if (EVM_CHAIN_ID[chain]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !etherscanKey()) return null;
    const tx = await etherscan(chain, { module: 'proxy', action: 'eth_getTransactionByHash', txhash: hash });
    if (!tx || !tx.blockNumber) return null;
    const rc = await etherscan(chain, { module: 'proxy', action: 'eth_getTransactionReceipt', txhash: hash });
    const blk = await etherscan(chain, { module: 'proxy', action: 'eth_getBlockByNumber', tag: tx.blockNumber, boolean: 'false' });
    const transfers = [];
    if (tx.value && BigInt(tx.value) > 0n) transfers.push({ from: tx.from.toLowerCase(), to: (tx.to || '').toLowerCase(), asset: NATIVE[chain], amount: Number(BigInt(tx.value)) / 1e18 });
    const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    ((rc && rc.logs) || []).forEach((l) => {
      const tk = TOKENS[chain][String(l.address).toLowerCase()];
      if (!tk || !l.topics || l.topics[0] !== TOPIC || l.topics.length < 3) return;
      transfers.push({ from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26), asset: tk[0], amount: Number(BigInt(l.data)) / 10 ** tk[1] });
    });
    return { ts: parseInt(blk.timestamp, 16) * 1000, transfers };
  }
  if (chain === 'tron') {
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) return null;
    const j = await getJson('https://api.trongrid.io/wallet/gettransactioninfobyid', { method: 'POST', headers: { 'content-type': 'application/json', ...tronHeaders() }, body: JSON.stringify({ value: hash }) });
    if (!j || !j.id) return null;
    const transfers = [];
    (j.log || []).forEach((l) => {
      const c = tronHexToB58('41' + l.address);
      const tk = TOKENS.tron[c];
      if (!tk || !l.topics || l.topics.length < 3 || !l.topics[0].startsWith('ddf252ad')) return;
      transfers.push({ from: tronHexToB58('41' + l.topics[1].slice(24)), to: tronHexToB58('41' + l.topics[2].slice(24)), asset: tk[0], amount: Number(BigInt('0x' + l.data)) / 10 ** tk[1] });
    });
    return { ts: j.blockTimeStamp, transfers };
  }
  return null;
}
