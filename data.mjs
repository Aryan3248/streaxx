// Static site data (taken from the published pages) plus the wallet registry,
// which admins can extend with the wallet tool.
import site from './data/site.mjs';
import baseRegistry from './data/registry.mjs';
import { store } from './store.mjs';

export const SITE = site;

const bySlug = {};
site.idx.forEach((c) => { bySlug[c[1]] = { slug: c[1], name: c[0], domain: c[4] || '' }; });
export const casinoBySlug = (slug) => bySlug[slug] || null;
export const KINDS = ['casino', 'unboxing'];

// Sites admins add themselves (unboxing sites, casinos missing from the published list).
export async function customSites() {
  const list = (await store('onchain').get('sites')) || [];
  list.forEach((x) => { bySlug[x.slug] = { slug: x.slug, name: x.name, domain: x.domain || '', kind: x.kind }; });
  return list;
}
export const kindOf = (slug) => (bySlug[slug] && bySlug[slug].kind) || 'casino';
export const casinoName = (slug) => (bySlug[slug] ? bySlug[slug].name : slug);

export const CHAIN_NAMES = { ethereum: 'Ethereum', tron: 'Tron', solana: 'Solana', bsc: 'BNB Chain', polygon: 'Polygon', bitcoin: 'Bitcoin' };

export function explorerTx(chain, hash) {
  return {
    ethereum: 'https://etherscan.io/tx/', polygon: 'https://polygonscan.com/tx/', bsc: 'https://bscscan.com/tx/',
    tron: 'https://tronscan.org/#/transaction/', solana: 'https://solscan.io/tx/', bitcoin: 'https://mempool.space/tx/'
  }[chain] + hash;
}
export function explorerAddr(chain, addr) {
  return {
    ethereum: 'https://etherscan.io/address/', polygon: 'https://polygonscan.com/address/', bsc: 'https://bscscan.com/address/',
    tron: 'https://tronscan.org/#/address/', solana: 'https://solscan.io/account/', bitcoin: 'https://mempool.space/address/'
  }[chain] + addr;
}

// Registry: [{ slug, name, wallets: [{ chain, chainName, address, label, role, source, url }] }]
export async function getRegistry() {
  const extra = (await store('onchain').get('extraWallets')) || [];
  const sites = await customSites();
  const reg = baseRegistry.map((c) => ({ ...c, kind: 'casino', wallets: c.wallets.slice() }));
  sites.forEach((x) => { if (!reg.some((c) => c.slug === x.slug)) reg.push({ slug: x.slug, name: x.name, kind: x.kind, wallets: [] }); });
  extra.forEach((w) => {
    let c = reg.find((x) => x.slug === w.slug);
    if (!c) { c = { slug: w.slug, name: casinoName(w.slug), kind: kindOf(w.slug), wallets: [] }; reg.push(c); }
    if (!c.wallets.some((x) => x.chain === w.chain && x.address.toLowerCase() === w.address.toLowerCase())) c.wallets.push(w);
  });
  return reg;
}

// address (lowercase) -> { slug, wallet }
export function walletIndex(reg) {
  const m = new Map();
  reg.forEach((c) => c.wallets.forEach((w) => m.set(w.chain + ':' + norm(w.chain, w.address), { slug: c.slug, wallet: w })));
  return m;
}
export const norm = (chain, a) => (chain === 'ethereum' || chain === 'polygon' || chain === 'bsc' ? String(a).toLowerCase() : String(a));
