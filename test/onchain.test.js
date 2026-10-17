'use strict';
// Offline tests for the on-chain monitor. A fake network answers in the documented formats of Etherscan V2, public RPC
// nodes, TronGrid, Solana RPC, mempool.space, DefiLlama, DexScreener, Ethplorer and Telegram.
// Run: node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { Store } = require('../onchain/db');
const { Indexer } = require('../onchain/indexer');
const api = require('../onchain/api');
const util = require('../onchain/util');
const { normalizeTrc20, normalizeTrx } = require('../onchain/chains/tron');
const solana = require('../onchain/chains/solana');
const btc = require('../onchain/chains/btc');
const evm = require('../onchain/chains/evm');
const telegram = require('../onchain/telegram');
const { config } = require('../onchain');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'onchain', 'registry.json'), 'utf8'));
const STAKE = '0x974CaA59e49682CdA0AD2bbe82983419A2ECC400'.toLowerCase();
const STAKE2 = '0xDebfBE80C8aebA98A32968278463ccB639C6C4e3'.toLowerCase();
const ROOBET = '0xC94eBB328aC25b95DB0E0AA968371885Fa516215'.toLowerCase();
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const RLB = '0x046eee2cc3188071c02bfc1745a6b17c656e3f3d';
const DEP_A = '0x' + 'a'.repeat(40), DEP_B = '0x' + 'b'.repeat(40), USER = '0x' + 'c'.repeat(40), DEP_X = '0x' + 'd'.repeat(40);
const NOW = Math.floor(Date.now() / 1000);
const wei = n => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
const hex = big => '0x' + BigInt(big).toString(16);

const sent = [];
const calls = [];
function fakeFetch(url, init = {}) {
  const u = new URL(url);
  calls.push(u.host + u.pathname);
  const body = init.body ? JSON.parse(init.body) : null;
  const json = obj => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
  if (u.host === 'coins.llama.fi') {
    return json({ coins: {
      'coingecko:ethereum': { price: 2400 }, 'coingecko:bitcoin': { price: 80000 }, 'coingecko:rollbit-coin': { price: 0.07 }, 'coingecko:shuffle-2': { price: 0.5 },
      'solana:So11111111111111111111111111111111111111112': { price: 100 }, 'tron:TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR': { price: 0.3 },
      'bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': { price: 700 }, 'coingecko:polygon-ecosystem-token': { price: 0.2 } } });
  }
  if (u.host === 'api.etherscan.io') {
    const q = u.searchParams;
    assert.equal(q.get('apikey'), 'TESTKEY');
    if (q.get('action') === 'getblocknobytime') return json({ status: '1', message: 'OK', result: '21000000' });
    const a = (q.get('address') || '').toLowerCase();
    const act = q.get('action');
    const none = json({ status: '0', message: 'No transactions found', result: [] });
    if (q.get('chainid') !== '1') return none;
    if (a === STAKE && act === 'txlist' && q.get('startblock') === '21000000') {
      return json({ status: '1', message: 'OK', result: [
        { blockNumber: '21000001', timeStamp: String(NOW - 60), hash: '0xd1', from: DEP_A, to: STAKE, value: wei(10), isError: '0' },
        { blockNumber: '21000002', timeStamp: String(NOW - 50), hash: '0xw1', from: STAKE, to: USER, value: wei(30), isError: '0' },
        { blockNumber: '21000003', timeStamp: String(NOW - 40), hash: '0xi1', from: STAKE2, to: STAKE, value: wei(5), isError: '0' },
        { blockNumber: '21000004', timeStamp: String(NOW - 30), hash: '0xf1', from: STAKE, to: USER, value: wei(99), isError: '1' }
      ] });
    }
    if (a === STAKE && act === 'tokentx' && q.get('startblock') === '21000000') {
      return json({ status: '1', message: 'OK', result: [
        { blockNumber: '21000005', timeStamp: String(NOW - 20), hash: '0xd2', from: DEP_B, to: STAKE, value: '60000000000', contractAddress: USDT, tokenSymbol: 'USDT', tokenDecimal: '6' },
        { blockNumber: '21000006', timeStamp: String(NOW - 15), hash: '0xs1', from: DEP_B, to: STAKE, value: '9999000000', contractAddress: '0x' + '9'.repeat(40), tokenSymbol: 'USDT', tokenDecimal: '6' },
        { blockNumber: '21000007', timeStamp: String(NOW - 10), hash: '0xw2', from: STAKE, to: USER, value: '1200000000', contractAddress: USDC, tokenSymbol: 'USDC', tokenDecimal: '6' }
      ] });
    }
    if (a === ROOBET && act === 'txlist' && q.get('startblock') === '21000000') {
      return json({ status: '1', message: 'OK', result: [{ blockNumber: '21000008', timeStamp: String(NOW - 5), hash: '0xr1', from: DEP_A, to: ROOBET, value: wei(2), isError: '0' }] });
    }
    if (a === DEP_X && q.get('sort') === 'desc') {
      if (act === 'txlist') return json({ status: '1', message: 'OK', result: [
        { blockNumber: '5', timeStamp: String(NOW - 500), hash: '0xs2', from: DEP_X, to: ROOBET, value: wei(1), isError: '0' },
        { blockNumber: '4', timeStamp: String(NOW - 900), hash: '0xs3', from: DEP_X, to: ROOBET, value: wei(3), isError: '0' }] });
      return json({ status: '1', message: 'OK', result: [{ blockNumber: '6', timeStamp: String(NOW - 300), hash: '0xs4', from: DEP_X, to: ROOBET, value: '500000000', contractAddress: USDT, tokenDecimal: '6' }] });
    }
    return none;
  }
  if (/publicnode\.com$/.test(u.host) || u.host === 'eth.llamarpc.com') {
    const eth = u.host.startsWith('ethereum');
    const res = body.map(c => {
      if (c.method === 'eth_getBalance') return { id: c.id, result: eth && c.params[0].toLowerCase() === STAKE ? hex(100n * 10n ** 18n) : '0x0' };
      const to = c.params[0].to.toLowerCase(), data = c.params[0].data;
      if (data === '0x18160ddd') return { id: c.id, result: hex(1000000000n * 10n ** 18n) };
      const holder = '0x' + data.slice(-40);
      if (eth && to === USDT && holder === STAKE) return { id: c.id, result: hex(1000000n * 10n ** 6n) };
      if (eth && to === RLB && holder === '0x000000000000000000000000000000000000dead') return { id: c.id, result: hex(100000000n * 10n ** 18n) };
      return { id: c.id, result: '0x0' };
    });
    return json(res);
  }
  if (u.host === 'api.dexscreener.com') {
    return json({ pairs: [{ chainId: 'ethereum', dexId: 'uniswap', url: 'https://dexscreener.com/ethereum/x', baseToken: { address: u.pathname.split('/').pop() }, priceUsd: '0.07',
      liquidity: { usd: 1000000 }, volume: { h24: 200000 }, txns: { h24: { buys: 120, sells: 90 } }, priceChange: { h24: -2.1 } }] });
  }
  if (u.host === 'api.ethplorer.io') return json({ holdersCount: 12345 });
  if (u.host === 'api.telegram.org') { sent.push(body); return json({ ok: true }); }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

function makeState() {
  global.fetch = fakeFetch;
  const cfg = Object.assign(config({}), { etherscanKey: 'TESTKEY', telegramToken: 'T', telegramChat: '1', adminToken: 'secret', etherscanGap: 1, internalTx: true });
  const store = new Store(':memory:');
  store.seed(registry);
  const indexer = new Indexer(store, cfg, registry, () => {});
  indexer.startedAt = Date.now() - 3600000;
  return { cfg, store, indexer, registry, log: () => {} };
}

test('registry: every Ethereum address passes the format check and is unique', () => {
  const seen = new Set();
  Object.values(registry.casinos).forEach(c => c.wallets.forEach(w => {
    assert.ok(util.validAddress(w.chain, w.address), w.address);
    assert.ok(!seen.has(w.address.toLowerCase()));
    seen.add(w.address.toLowerCase());
  }));
  assert.ok(seen.size >= 50);
});

test('units and Tron address helpers', () => {
  assert.equal(util.units('60000000000', 6), 60000);
  assert.equal(util.units('1000000000000000000', 18), 1);
  assert.equal(util.units('5', 8), 5e-8);
  assert.equal(util.tronHexToBase58('41a614f803b6fd780986a42c78ec9c7f77e6ded13c'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.ok(util.isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));
  assert.ok(!util.isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6x'));
});

test('indexer: deposits, withdrawals, internal moves, spam tokens, balances, whales and tokens', async () => {
  const state = makeState();
  sent.length = 0;
  const run = await state.indexer.runOnce();
  assert.equal(run.errors.length, 0, run.errors.join(' | '));
  await new Promise(r => setTimeout(r, 2600)); // Telegram queue

  const ov = api.overview(state, '24h');
  const stake = ov.casinos.find(c => c.slug === 'stakecom');
  assert.equal(stake.inflow, 10 * 2400 + 60000, 'deposit ETH + USDT, internal and spam excluded');
  assert.equal(stake.outflow, 30 * 2400 + 1200, 'withdrawals, failed tx excluded');
  assert.equal(stake.net, stake.inflow - stake.outflow);
  assert.equal(stake.txIn, 2);
  assert.equal(stake.txOut, 2);
  assert.equal(stake.depositors, 2);
  assert.equal(stake.balance, 100 * 2400 + 1000000);
  const roobet = ov.casinos.find(c => c.slug === 'roobet');
  assert.equal(roobet.inflow, 4800);
  assert.equal(ov.totals.inflow, stake.inflow + roobet.inflow);
  assert.ok(ov.hourly.length >= 48);

  const wh = api.whales(state, new URLSearchParams());
  assert.deepEqual(wh.items.map(i => i.usd).sort((a, b) => a - b), [60000, 72000]);
  assert.equal(wh.items.find(i => i.usd === 72000).dir, 'out');
  assert.equal(sent.length, 2, 'two Telegram alerts');
  assert.match(sent[0].text, /Stake\.com/);

  const cd = api.casinoDetail(state, 'stakecom', 30);
  assert.equal(cd.internalMoved, 5 * 2400);
  assert.equal(cd.inflow, stake.inflow);
  assert.ok(cd.wallets[0].usd >= 1240000);
  assert.ok(cd.assets.find(a => a.asset === 'USDT').inflow === 60000);
  assert.equal(api.casinoDetail(state, 'nope', 30), null);

  const tk = api.tokenStats(state);
  const rlb = tk.find(t => t.sym === 'RLB');
  assert.equal(rlb.supply, 1e9);
  assert.equal(rlb.circulating, 9e8);
  assert.equal(rlb.holders, 12345);
  assert.equal(rlb.liquidity, 1000000);
  assert.equal(rlb.buys24, 120);

  // Second run: nothing new, totals unchanged.
  await state.indexer.runOnce();
  const ov2 = api.overview(state, '24h');
  assert.equal(ov2.casinos.find(c => c.slug === 'stakecom').inflow, stake.inflow);
  assert.equal(sent.length, 2);
});

test('discovery finds the sweep destination and recognises a known casino wallet', async () => {
  const state = makeState();
  const d = await api.discover(state, 'ethereum', DEP_X);
  assert.equal(d.candidates[0].address.toLowerCase(), ROOBET);
  assert.equal(d.candidates[0].count, 3);
  assert.equal(d.candidates[0].knownCasino, 'roobet');
  await assert.rejects(api.discover(state, 'ethereum', '0x123'), /valid/);
});

test('admin API: token required, wallets can be added and removed', async () => {
  const state = makeState();
  const http = require('http');
  const srv = http.createServer((req, res) => api.handle(state, req, res, new URL(req.url, 'http://x')));
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const call = (method, p, body, token) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ port, path: p, method, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, token ? { 'x-admin-token': token } : {}) }, res => {
      let s = ''; res.on('data', c => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s || '{}') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
  try {
    assert.equal((await call('POST', '/api/onchain/admin/wallets', { chain: 'tron', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', casino: 'stakecom' })).status, 401);
    assert.equal((await call('POST', '/api/onchain/admin/wallets', { chain: 'tron', address: 'Tbad', casino: 'stakecom' }, 'secret')).status, 400);
    const ok = await call('POST', '/api/onchain/admin/wallets', { chain: 'tron', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', casino: 'newcasino', name: 'New Casino', role: 'hot', label: 'Test' }, 'secret');
    assert.equal(ok.status, 200);
    const cov = await call('GET', '/api/onchain/coverage');
    assert.ok(cov.body.casinos.find(c => c.slug === 'newcasino' && c.name === 'New Casino'));
    const del = await call('DELETE', '/api/onchain/admin/wallets', { chain: 'tron', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, 'secret');
    assert.equal(del.body.ok, true, JSON.stringify(del));
    assert.equal((await call('GET', '/api/onchain/casino/newcasino')).status, 404);
    assert.equal((await call('GET', '/api/onchain/status')).body.keys.etherscan, true);
  } finally { srv.close(); }
});

test('Tron parsing: USDT transfers by contract, TRX from hex addresses', () => {
  const W = 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR';
  const trc = normalizeTrc20(W, [
    { transaction_id: 'a1', token_info: { symbol: 'USDT', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, name: 'Tether USD' }, block_timestamp: 1700000000000, from: 'TXYZ', to: W, type: 'Transfer', value: '2500000000' },
    { transaction_id: 'a2', token_info: { symbol: 'USDT', address: 'TFakeUsdtContractxxxxxxxxxxxxxxxxx', decimals: 6 }, block_timestamp: 1700000000000, from: 'TXYZ', to: W, type: 'Transfer', value: '1' },
    { transaction_id: 'a3', token_info: { symbol: 'USDT', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 }, block_timestamp: 1700000001000, from: W, to: 'TABC', type: 'Approval', value: '5' }
  ]);
  assert.equal(trc.length, 1);
  assert.equal(trc[0].amount, 2500);
  assert.equal(trc[0].dir, 'in');
  const raw = util.b58decode(W).subarray(0, 21).toString('hex');
  const trx = normalizeTrx(W, [{ txID: 'b1', block_timestamp: 1700000002000, ret: [{ contractRet: 'SUCCESS' }],
    raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 123000000, owner_address: raw, to_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c' } } }] } }]);
  assert.equal(trx.length, 1);
  assert.equal(trx[0].dir, 'out');
  assert.equal(trx[0].amount, 123);
  assert.equal(trx[0].cp, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
});

test('Solana parsing: SOL and USDC deltas, fee excluded, counterparty found', () => {
  const W = 'HotWa11et1111111111111111111111111111111111', U = 'User11111111111111111111111111111111111111';
  const tx = {
    blockTime: 1700000000, meta: { err: null, fee: 5000, preBalances: [10e9, 1e9], postBalances: [10e9 - 2e9 - 5000, 3e9],
      preTokenBalances: [{ accountIndex: 2, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner: W, uiTokenAmount: { amount: '900000000', decimals: 6 } },
        { accountIndex: 3, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner: U, uiTokenAmount: { amount: '0', decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 2, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner: W, uiTokenAmount: { amount: '400000000', decimals: 6 } },
        { accountIndex: 3, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner: U, uiTokenAmount: { amount: '500000000', decimals: 6 } }] },
    transaction: { message: { accountKeys: [{ pubkey: W, signer: true }, { pubkey: U }, { pubkey: 'TokA' }, { pubkey: 'TokB' }] } }
  };
  const out = solana.parseTx(W, 'sig1', tx);
  const sol = out.find(t => t.asset === 'SOL'), usdc = out.find(t => t.asset === 'USDC');
  assert.equal(sol.dir, 'out'); assert.equal(sol.amount, 2); assert.equal(sol.cp, U);
  assert.equal(usdc.dir, 'out'); assert.equal(usdc.amount, 500); assert.equal(usdc.cp, U);
  assert.deepEqual(solana.parseTx(W, 'sig2', Object.assign({}, tx, { meta: Object.assign({}, tx.meta, { err: { InstructionError: [] } }) })), []);
});

test('Bitcoin parsing: net change per transaction', () => {
  const W = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
  const tx = { txid: 't1', status: { confirmed: true, block_time: 1700000000 },
    vin: [{ prevout: { scriptpubkey_address: W, value: 150000000 } }],
    vout: [{ scriptpubkey_address: 'bc1quser', value: 100000000 }, { scriptpubkey_address: W, value: 49990000 }] };
  const out = btc.parseTx(W, tx);
  assert.equal(out.length, 1);
  assert.equal(out[0].dir, 'out');
  assert.equal(out[0].amount, 1.0001);
  assert.equal(out[0].cp, 'bc1quser');
  assert.deepEqual(btc.parseTx(W, Object.assign({}, tx, { status: { confirmed: false } })), []);
});

test('Etherscan normalize: duplicate token transfers in one tx stay distinct', () => {
  const rows = [
    { blockNumber: '1', timeStamp: '1', hash: '0xh', from: DEP_A, to: STAKE, value: '1000000', contractAddress: USDT },
    { blockNumber: '1', timeStamp: '1', hash: '0xh', from: DEP_A, to: STAKE, value: '1000000', contractAddress: USDT }];
  const n = evm.normalize('ethereum', STAKE, 'tokentx', rows);
  assert.equal(n.length, 2);
  assert.notEqual(n[0].idx, n[1].idx);
});

test('Telegram message format', () => {
  const m = telegram.format({ dir: 'out', usd: 1250000, amount: 1250000, asset: 'USDT', chain: 'ethereum', cp: USER, tx: '0xabc' }, 'Stake.com');
  assert.match(m, /Withdrawal from Stake\.com/);
  assert.match(m, /\$1\.25M/);
  assert.match(m, /etherscan\.io\/tx\/0xabc/);
});

test('members only: longer history and CSV downloads need a login when accounts are on', async () => {
  const state = makeState();
  await state.indexer.runOnce();
  const http = require('http');
  let member = null;
  state.viewer = () => member;
  const srv = http.createServer((req, res) => api.handle(state, req, res, new URL(req.url, 'http://x')));
  await new Promise(r => srv.listen(0, r));
  const get = p => new Promise(r => http.get({ port: srv.address().port, path: p }, res => { let s = ''; res.on('data', c => { s += c; }); res.on('end', () => r({ status: res.statusCode, body: s, type: res.headers['content-type'], disp: res.headers['content-disposition'] })); }));
  try {
    assert.equal((await get('/api/onchain/overview?window=24h')).status, 200);
    const locked = await get('/api/onchain/overview?window=7d');
    assert.equal(locked.status, 401);
    assert.equal(JSON.parse(locked.body).code, 'login_required');
    assert.equal((await get('/api/onchain/casino/stakecom?days=7')).status, 200);
    assert.equal((await get('/api/onchain/casino/stakecom?days=30')).status, 401);
    assert.equal((await get('/api/onchain/export/flows.csv?window=30d')).status, 401);
    member = { id: 1 };
    assert.equal((await get('/api/onchain/overview?window=30d')).status, 200);
    const flows = await get('/api/onchain/export/flows.csv?window=24h');
    assert.equal(flows.status, 200);
    assert.match(flows.type, /text\/csv/);
    assert.match(flows.disp, /attachment; filename="streax-flows-24h-/);
    const lines = flows.body.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'casino,slug,window,deposits_usd,withdrawals_usd,net_flow_usd,transfers_in,transfers_out,depositing_addresses,tracked_balance_usd,chains');
    assert.ok(lines.some(l => l.startsWith('Stake.com,stakecom,24h,84000,73200,10800,')), lines.join('\n'));
    const whales = await get('/api/onchain/export/whales.csv?days=1&min=50000');
    assert.match(whales.body, /withdrawal,ETH,30,72000/);
    const daily = await get('/api/onchain/export/casino/stakecom.csv?days=7');
    assert.match(daily.body.split('\r\n')[0], /^﻿date,casino,deposits_usd/);
    assert.equal((await get('/api/onchain/export/casino/nope.csv')).status, 404);
    assert.equal(api.csv([['=SUM(A1)', 'a,b', -5, 'x"y']]), "'=SUM(A1),\"a,b\",-5,\"x\"\"y\"\r\n");
  } finally { srv.close(); }
});
