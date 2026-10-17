'use strict';
// Cursor and paging behaviour of the Tron, Solana and Bitcoin adapters against a fake network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../onchain/db');
const { config } = require('../onchain');
const { tron } = require('../onchain/chains/tron');
const { solana } = require('../onchain/chains/solana');
const { bitcoin } = require('../onchain/chains/btc');

const json = obj => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
const ctx = () => ({ cfg: Object.assign(config({}), { trongridKey: 'k', solanaRpc: 'https://rpc.example.com' }), store: new Store(':memory:'), log: () => {} });

test('Tron: pages with fingerprint, then resumes from the newest timestamp', async () => {
  const W = 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const seen = [];
  const T1 = Date.now() - 60000, T2 = Date.now() - 30000;
  const row = (id, ts, from, to, v) => ({ transaction_id: id, token_info: { address: USDT, decimals: 6, symbol: 'USDT' }, block_timestamp: ts, from, to, type: 'Transfer', value: v });
  global.fetch = (url, init) => {
    const u = new URL(url);
    seen.push(u.pathname + '?' + u.searchParams.get('min_timestamp') + '|' + (u.searchParams.get('fingerprint') || ''));
    assert.equal(init.headers['TRON-PRO-API-KEY'], 'k');
    if (u.pathname.endsWith('/trc20')) {
      if (!u.searchParams.get('fingerprint')) return json({ data: [row('t1', T1, 'TA', W, '5000000')], meta: { fingerprint: 'FP' } });
      return json({ data: [row('t2', T2, W, 'TB', '7000000')], meta: {} });
    }
    return json({ data: [], meta: {} });
  };
  const c = ctx();
  const r = await tron.transfers(c, { address: W, chain: 'tron' });
  assert.equal(r.list.length, 2);
  assert.deepEqual(r.list.map(t => [t.dir, t.amount]), [['in', 5], ['out', 7]]);
  assert.equal(c.store.cursor('tron:' + W + ':trc20'), String(T2));
  seen.length = 0;
  await tron.transfers(c, { address: W, chain: 'tron' });
  assert.ok(seen[0].includes('?' + T2 + '|'), seen[0]);
});

test('Solana: newest-first signatures are processed oldest-first with a capped batch and a cursor', async () => {
  const W = 'HotWa11et1111111111111111111111111111111111';
  const sigs = [5, 4, 3, 2, 1].map(n => ({ signature: 's' + n, blockTime: Math.floor(Date.now() / 1000) - 100 + n, err: null }));
  let until = null;
  global.fetch = (url, init) => {
    const b = JSON.parse(init.body);
    if (Array.isArray(b)) {
      return json(b.map(c => ({ id: c.id, result: { blockTime: 1, meta: { err: null, fee: 0, preBalances: [0, 5e9], postBalances: [1e9, 4e9], preTokenBalances: [], postTokenBalances: [] },
        transaction: { message: { accountKeys: [{ pubkey: W }, { pubkey: 'U' }] } } } })));
    }
    if (b.method === 'getSignaturesForAddress') { until = b.params[1].until || null; return json({ result: until ? [] : sigs }); }
    return json({ result: null });
  };
  const c = ctx();
  c.cfg.maxSolanaTxPerWallet = 3;
  const r1 = await solana.transfers(c, { address: W, chain: 'solana' });
  assert.equal(r1.list.length, 3);
  assert.equal(r1.more, true);
  assert.equal(c.store.cursor('sol:' + W), 's3');
  assert.equal(r1.list[0].amount, 1);
  assert.equal(r1.list[0].dir, 'in');
});

test('Bitcoin: stops at already-processed history and stores the newest block time', async () => {
  const W = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
  const now = Math.floor(Date.now() / 1000);
  global.fetch = url => {
    if (url.endsWith('/txs')) return json([
      { txid: 'u1', status: { confirmed: false }, vin: [], vout: [{ scriptpubkey_address: W, value: 1 }] },
      { txid: 'c1', status: { confirmed: true, block_time: now - 60 }, vin: [{ prevout: { scriptpubkey_address: 'bc1qa', value: 300000000 } }], vout: [{ scriptpubkey_address: W, value: 250000000 }] }
    ]);
    return json([]);
  };
  const c = ctx();
  const r = await bitcoin.transfers(c, { address: W, chain: 'bitcoin' });
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].amount, 2.5);
  assert.equal(c.store.cursor('btc:' + W), String((now - 60) * 1000));
});
