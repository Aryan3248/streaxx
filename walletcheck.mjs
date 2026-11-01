// Wallet checker: what a player's wallet sent to and got back from the
// casinos the monitor tracks.
import { fail } from './http.mjs';
import { etherscan, tronTransfers, prices, TOKENS, NATIVE, STABLE } from './chain.mjs';
import { getRegistry, norm, CHAIN_NAMES, explorerTx, casinoName } from './data.mjs';
import { depositAddressIndex } from './onchain.mjs';
import { currentUser, limit } from './accounts.mjs';

const units = (raw, dec) => (/^\d+$/.test(String(raw)) ? Number(raw) / 10 ** dec : 0);

async function evmRecent(chain, addr) {
  const p = { module: 'account', address: addr, startblock: '0', endblock: '999999999', page: '1', offset: '1000', sort: 'desc' };
  const [nat, tok] = await Promise.all([etherscan(chain, { ...p, action: 'txlist' }), etherscan(chain, { ...p, action: 'tokentx' })]);
  const items = [];
  nat.forEach((r) => { if (r.isError === '0' && r.value !== '0') items.push({ hash: r.hash, ts: Number(r.timeStamp) * 1000, from: r.from.toLowerCase(), to: (r.to || '').toLowerCase(), asset: NATIVE[chain], amount: units(r.value, 18) }); });
  tok.forEach((r) => { const tk = TOKENS[chain][String(r.contractAddress).toLowerCase()]; if (tk && r.value !== '0') items.push({ hash: r.hash, ts: Number(r.timeStamp) * 1000, from: r.from.toLowerCase(), to: (r.to || '').toLowerCase(), asset: tk[0], amount: units(r.value, tk[1]) }); });
  return { items, scanned: nat.length + tok.length, capped: nat.length >= 1000 || tok.length >= 1000 };
}

export async function walletCheck(req, ctx) {
  const address = String(new URL(req.url).searchParams.get('address') || '').trim();
  const evm = /^0x[0-9a-fA-F]{40}$/.test(address), tron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (!evm && !tron) fail(400, 'Paste an Ethereum, BNB Chain, Polygon or Tron wallet address.');
  await limit('wc:' + ctx.ip, 10, 600);
  const u = await currentUser(req);
  const reg = await getRegistry();
  const owner = new Map();
  reg.forEach((c) => c.wallets.forEach((w) => owner.set(w.chain + ':' + norm(w.chain, w.address), c.slug)));
  const deps = await depositAddressIndex();
  const px = await prices();
  const me = norm(evm ? 'ethereum' : 'tron', address);
  const chains = evm ? ['ethereum', 'polygon', 'bsc'] : ['tron'];
  const chainOut = [], matched = [];
  let scanned = 0;
  for (const chain of chains) {
    try {
      const r = chain === 'tron' ? await tronTransfers(address, Date.now() - 365 * 86400000, 3).then((x) => ({ items: x.items, scanned: x.items.length, capped: x.capped })) : await evmRecent(chain, me);
      scanned += r.scanned;
      chainOut.push({ name: CHAIN_NAMES[chain], ok: true, scanned: r.scanned, capped: r.capped });
      r.items.forEach((t) => {
        const from = norm(chain, t.from), to = norm(chain, t.to);
        let kind = null, slug = null, via = '';
        if (from === me && owner.get(chain + ':' + to)) { kind = 'deposit'; slug = owner.get(chain + ':' + to); via = 'casino wallet'; }
        else if (from === me && deps.get(chain + ':' + to)) { kind = 'deposit'; slug = deps.get(chain + ':' + to); via = 'casino deposit address'; }
        else if (to === me && owner.get(chain + ':' + from)) { kind = 'withdrawal'; slug = owner.get(chain + ':' + from); via = 'casino wallet'; }
        if (!kind) return;
        const p = STABLE.has(t.asset) ? 1 : px[t.asset];
        matched.push({ kind, casino: slug, casinoName: casinoName(slug), chainName: CHAIN_NAMES[chain], asset: t.asset, amount: t.amount, usd: p ? t.amount * p : null, ts: t.ts, via, explorer: explorerTx(chain, t.hash) });
      });
    } catch (e) { chainOut.push({ name: CHAIN_NAMES[chain], ok: false, error: e.message }); }
  }
  matched.sort((a, b) => b.ts - a.ts);
  const by = {};
  matched.forEach((t) => {
    const c = (by[t.casino] = by[t.casino] || { name: t.casinoName, slug: t.casino, deposits: 0, depositsN: 0, withdrawals: 0, withdrawalsN: 0, first: t.ts, last: t.ts, unpriced: 0 });
    if (t.usd == null) c.unpriced++;
    else if (t.kind === 'deposit') { c.deposits += t.usd; c.depositsN++; } else { c.withdrawals += t.usd; c.withdrawalsN++; }
    c.first = Math.min(c.first, t.ts); c.last = Math.max(c.last, t.ts);
  });
  const casinos = Object.values(by).map((c) => ({ ...c, net: c.withdrawals - c.deposits })).sort((a, b) => b.deposits + b.withdrawals - a.deposits - a.withdrawals);
  const dep = casinos.reduce((s, c) => s + c.deposits, 0), wd = casinos.reduce((s, c) => s + c.withdrawals, 0);
  return {
    address, chains: chainOut, casinos, totals: { deposits: dep, withdrawals: wd, net: wd - dep },
    transfers: u ? matched.slice(0, 500) : matched.slice(0, 10), transferCount: matched.length, scanned, tracked: reg.filter((c) => c.wallets.length).length, member: !!u
  };
}
