'use strict';
// Casino token analytics: supply and burns (on-chain), holders (Ethplorer free key), DEX liquidity and trades (DexScreener),
// and how much of the token the casino's own tracked wallets hold.

const { getJSON, hexUnits, dayOf } = require('./util');
const evm = require('./chains/evm');

const DEAD = ['0x000000000000000000000000000000000000dEaD', '0x0000000000000000000000000000000000000000'];

async function dex(address) {
  const j = await getJSON('https://api.dexscreener.com/latest/dex/tokens/' + address, { gap: 300 });
  const pairs = (Array.isArray(j) ? j : j && j.pairs) || [];
  const mine = pairs.filter(p => p && p.baseToken && String(p.baseToken.address).toLowerCase() === address.toLowerCase());
  const list = mine.length ? mine : pairs;
  if (!list.length) return null;
  const best = list.reduce((a, b) => ((b.liquidity && b.liquidity.usd) || 0) > ((a.liquidity && a.liquidity.usd) || 0) ? b : a);
  const sum = (f) => list.reduce((s, p) => s + (f(p) || 0), 0);
  return {
    price: Number(best.priceUsd) || null,
    ch24: best.priceChange && Number(best.priceChange.h24),
    liquidity: sum(p => p.liquidity && p.liquidity.usd),
    vol24: sum(p => p.volume && p.volume.h24),
    buys24: sum(p => p.txns && p.txns.h24 && p.txns.h24.buys),
    sells24: sum(p => p.txns && p.txns.h24 && p.txns.h24.sells),
    pairs: list.length,
    dex: best.dexId || '',
    url: best.url || ''
  };
}

async function holders(address) {
  const j = await getJSON('https://api.ethplorer.io/getTokenInfo/' + address + '?apiKey=freekey', { gap: 1200 });
  return Number.isFinite(Number(j.holdersCount)) ? Number(j.holdersCount) : null;
}

async function refresh(ctx, list) {
  const { store, log } = ctx;
  const day = dayOf(Date.now());
  const live = {};
  for (const t of list) {
    const row = { day, sym: t.sym };
    const info = { sym: t.sym };
    if (t.chain === 'ethereum') {
      try {
        const r = await evm.ethereum.erc20(ctx, t.address, DEAD);
        row.supply = r[0] ? hexUnits(r[0], 18) : null;
        row.dead = (r[1] ? hexUnits(r[1], 18) : 0) + (r[2] ? hexUnits(r[2], 18) : 0);
        store.source('Ethereum RPC', true);
      } catch (e) { store.source('Ethereum RPC', false, e); log('Token supply ' + t.sym + ': ' + e.message); }
      try { row.holders = await holders(t.address); store.source('Ethplorer', true); } catch (e) { store.source('Ethplorer', false, e); }
    }
    try {
      const d = await dex(t.address);
      if (d) { Object.assign(row, { price: d.price, liquidity: d.liquidity, vol24: d.vol24, buys24: d.buys24, sells24: d.sells24 }); Object.assign(info, d); }
      store.source('DexScreener', true);
    } catch (e) { store.source('DexScreener', false, e); }
    store.setTokenDay(row);
    live[t.sym] = info;
  }
  return live;
}

module.exports = { refresh, dex };
