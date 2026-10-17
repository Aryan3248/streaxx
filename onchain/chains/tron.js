'use strict';
// Tron through TronGrid. A free TronGrid API key (TRONGRID_API_KEY) raises the rate limit; it also works without one, slowly.

const { getJSON, units, tronHexToBase58 } = require('../util');
const { CHAINS, token } = require('../assets');

const API = 'https://api.trongrid.io';
const conf = CHAINS.tron;
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function get(cfg, path) {
  const headers = cfg.trongridKey ? { 'TRON-PRO-API-KEY': cfg.trongridKey } : {};
  return getJSON(API + path, { headers, gap: cfg.trongridKey ? 120 : 1100, timeout: 20000 });
}

function normalizeTrc20(wallet, rows) {
  const out = [];
  const dup = new Map();
  for (const r of rows) {
    if (r.type && r.type !== 'Transfer') continue;
    const contract = r.token_info && r.token_info.address;
    const t = token('tron', contract);
    if (!t) continue;
    if (r.from === r.to) continue;
    const dir = r.to === wallet ? 'in' : r.from === wallet ? 'out' : null;
    if (!dir) continue;
    const decimals = r.token_info.decimals != null ? Number(r.token_info.decimals) : t.decimals;
    const amount = units(r.value, decimals);
    if (!(amount > 0)) continue;
    const base = 't:' + contract + ':' + r.from + ':' + r.to + ':' + r.value;
    const k = r.transaction_id + '|' + base;
    const c = dup.get(k) || 0;
    dup.set(k, c + 1);
    out.push({ chain: 'tron', tx: r.transaction_id, idx: base + '#' + c, ts: Number(r.block_timestamp), wallet, dir, cp: dir === 'in' ? r.from : r.to, asset: t.sym, token: contract, amount });
  }
  return out;
}

function normalizeTrx(wallet, rows) {
  const out = [];
  for (const r of rows) {
    const c = r.raw_data && r.raw_data.contract && r.raw_data.contract[0];
    if (!c || c.type !== 'TransferContract') continue;
    if (r.ret && r.ret[0] && r.ret[0].contractRet && r.ret[0].contractRet !== 'SUCCESS') continue;
    const v = c.parameter && c.parameter.value || {};
    const from = tronHexToBase58(v.owner_address), to = tronHexToBase58(v.to_address);
    if (from === to) continue;
    const dir = to === wallet ? 'in' : from === wallet ? 'out' : null;
    if (!dir) continue;
    const amount = units(v.amount, conf.native.decimals);
    if (!(amount > 0)) continue;
    out.push({ chain: 'tron', tx: r.txID, idx: 'n', ts: Number(r.block_timestamp), wallet, dir, cp: dir === 'in' ? from : to, asset: 'TRX', token: '', amount });
  }
  return out;
}

async function pages(ctx, w, kind, firstPath, normalizeFn) {
  const { cfg, store } = ctx;
  const ckey = 'tron:' + w.address + ':' + kind;
  const since = Number(store.cursor(ckey)) || (Date.now() - cfg.backfillHours * 3600000);
  let path = firstPath + '&min_timestamp=' + since;
  const list = [];
  let maxTs = since, more = false;
  for (let i = 0; i < cfg.maxPagesPerWallet; i++) {
    const j = await get(cfg, path);
    const rows = Array.isArray(j.data) ? j.data : [];
    list.push(...normalizeFn(w.address, rows));
    rows.forEach(r => { if (Number(r.block_timestamp) > maxTs) maxTs = Number(r.block_timestamp); });
    const fp = j.meta && j.meta.fingerprint;
    if (!fp || rows.length === 0) { more = false; break; }
    path = firstPath + '&min_timestamp=' + since + '&fingerprint=' + encodeURIComponent(fp);
    more = true;
  }
  // Keep the cursor on the newest timestamp seen; the next run asks again from there and skips what it already recorded.
  store.setCursor(ckey, String(maxTs));
  return { list, more };
}

async function transfers(ctx, w) {
  const a = encodeURIComponent(w.address);
  const t = await pages(ctx, w, 'trc20', '/v1/accounts/' + a + '/transactions/trc20?only_confirmed=true&limit=200&order_by=block_timestamp,asc&contract_address=' + USDT, normalizeTrc20);
  const n = await pages(ctx, w, 'trx', '/v1/accounts/' + a + '/transactions?only_confirmed=true&limit=200&order_by=block_timestamp,asc', normalizeTrx);
  return { list: t.list.concat(n.list), more: t.more || n.more };
}

async function balances(ctx, wallets) {
  const out = [];
  for (const w of wallets) {
    const j = await get(ctx.cfg, '/v1/accounts/' + encodeURIComponent(w.address));
    const d = Array.isArray(j.data) && j.data[0];
    if (!d) { out.push({ chain: 'tron', address: w.address, asset: 'TRX', amount: 0 }); continue; }
    out.push({ chain: 'tron', address: w.address, asset: 'TRX', amount: units(d.balance || 0, 6) });
    const bag = {};
    (d.trc20 || []).forEach(o => Object.assign(bag, o));
    Object.entries(conf.tokens).forEach(([contract, t]) => out.push({ chain: 'tron', address: w.address, asset: t.sym, amount: units(bag[contract] || '0', t.decimals) }));
  }
  return out;
}

async function outgoing(ctx, address) {
  const j = await get(ctx.cfg, '/v1/accounts/' + encodeURIComponent(address) + '/transactions/trc20?only_confirmed=true&only_from=true&limit=200');
  const rows = Array.isArray(j.data) ? j.data : [];
  return normalizeTrc20(address, rows).filter(t => t.dir === 'out');
}

module.exports = { tron: { chain: 'tron', transfers, balances, outgoing, flowsEnabled: () => true }, normalizeTrc20, normalizeTrx };
