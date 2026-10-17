'use strict';
// USD prices for every counted asset, from the DefiLlama coins API (free, no key). Cached for 5 minutes.

const { getJSON } = require('./util');
const { CHAINS, STABLE, priceKeys } = require('./assets');

let cache = { at: 0, map: {} };

async function refresh(force) {
  if (!force && Date.now() - cache.at < 5 * 60 * 1000 && Object.keys(cache.map).length) return cache.map;
  const keys = priceKeys();
  const j = await getJSON('https://coins.llama.fi/prices/current/' + keys.join(','), { gap: 500 });
  const map = {};
  Object.entries(j.coins || {}).forEach(([k, v]) => { if (v && typeof v.price === 'number') map[k] = v.price; });
  if (!Object.keys(map).length) throw new Error('DefiLlama returned no prices');
  cache = { at: Date.now(), map };
  return map;
}

function usd(chain, asset, amount, tokenContract) {
  const c = CHAINS[chain];
  if (!c) return null;
  let key;
  if (asset === c.native.sym && !tokenContract) key = c.native.price;
  else {
    const t = Object.entries(c.tokens).find(([addr, t]) => t.sym === asset && (!tokenContract || addr.toLowerCase() === String(tokenContract).toLowerCase()));
    if (!t) return null;
    key = t[1].price;
  }
  if (key === STABLE) return amount;
  const p = cache.map[key];
  return typeof p === 'number' ? amount * p : null;
}

const get = () => cache.map;

module.exports = { refresh, usd, get };
