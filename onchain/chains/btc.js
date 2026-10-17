'use strict';
// Bitcoin through the free mempool.space API (no key).

const { getJSON, units } = require('../util');

const API = 'https://mempool.space/api';
const get = path => getJSON(API + path, { gap: 600, timeout: 20000 });

// Net effect of one transaction on `wallet`, in BTC. Positive means the wallet received coins.
function parseTx(wallet, tx) {
  if (!tx || !tx.status || !tx.status.confirmed) return [];
  let inSats = 0, outSats = 0;
  const others = { from: '', to: '' };
  (tx.vin || []).forEach(v => {
    const a = v.prevout && v.prevout.scriptpubkey_address;
    if (a === wallet) outSats += v.prevout.value || 0;
    else if (a && !others.from) others.from = a;
  });
  (tx.vout || []).forEach(v => {
    if (v.scriptpubkey_address === wallet) inSats += v.value || 0;
    else if (v.scriptpubkey_address && !others.to) others.to = v.scriptpubkey_address;
  });
  const delta = inSats - outSats;
  if (delta === 0) return [];
  return [{ chain: 'bitcoin', tx: tx.txid, idx: 'n', ts: (tx.status.block_time || 0) * 1000, wallet, dir: delta > 0 ? 'in' : 'out',
    cp: delta > 0 ? others.from : others.to, asset: 'BTC', token: '', amount: units(Math.abs(delta), 8) }];
}

async function transfers(ctx, w) {
  const { cfg, store } = ctx;
  const ckey = 'btc:' + w.address;
  const lastTs = Number(store.cursor(ckey)) || (Date.now() - cfg.backfillHours * 3600000);
  const list = [];
  let page = await get('/address/' + w.address + '/txs');
  let newest = lastTs, more = false;
  for (let i = 0; i < cfg.maxPagesPerWallet && page && page.length; i++) {
    let reachedOld = false;
    for (const tx of page) {
      const ts = (tx.status && tx.status.block_time || 0) * 1000;
      if (tx.status && tx.status.confirmed && ts < lastTs) { reachedOld = true; continue; }
      list.push(...parseTx(w.address, tx));
      if (ts > newest) newest = ts;
    }
    const confirmed = page.filter(t => t.status && t.status.confirmed);
    if (reachedOld || confirmed.length < 25) break;
    page = await get('/address/' + w.address + '/txs/chain/' + confirmed[confirmed.length - 1].txid);
    more = i === cfg.maxPagesPerWallet - 1;
  }
  store.setCursor(ckey, String(newest));
  return { list, more };
}

async function balances(ctx, wallets) {
  const out = [];
  for (const w of wallets) {
    const j = await get('/address/' + w.address);
    const c = j.chain_stats || {};
    out.push({ chain: 'bitcoin', address: w.address, asset: 'BTC', amount: units((c.funded_txo_sum || 0) - (c.spent_txo_sum || 0), 8) });
  }
  return out;
}

async function outgoing(ctx, address) {
  const page = await get('/address/' + address + '/txs');
  const list = [];
  (page || []).forEach(tx => list.push(...parseTx(address, tx).filter(t => t.dir === 'out')));
  return list;
}

module.exports = { bitcoin: { chain: 'bitcoin', transfers, balances, outgoing, flowsEnabled: () => true }, parseTx };
