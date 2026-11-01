// Market Breakdown: every tracked site ranked over a window (1D to 1Y), with
// deposits, withdrawals, biggest single deposit, fairness signals and ratings.
// Also game providers, ranked by the deposit volume of the casinos that carry them.
import { store } from './store.mjs';
import { SITE, casinoBySlug, customSites } from './data.mjs';
import { analytics } from './onchain.mjs';
import { trustData } from './complaints.mjs';

const D = 86400000;
export const WINDOWS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

export async function breakdown(win, kind) {
  const days = WINDOWS[win] || 7;
  const [A, whales, trust, comm] = await Promise.all([analytics(days), store('onchain').get('whales'), trustData().catch(() => ({ reviews: {}, complaints: {}, payouts: {} })), store('community').get('reviews')]);
  const stars = {};
  ((comm || {}).items || []).forEach((r) => { if (r.hidden) return; const x = (stars[r.casino] = stars[r.casino] || { n: 0, sum: 0 }); x.n++; x.sum += r.stars; });
  const since = Date.now() - days * D;
  const big = {};
  (whales || []).forEach((w) => { if (w.dir === 'in' && w.ts >= since && (!big[w.slug] || w.usd > big[w.slug].usd)) big[w.slug] = { usd: w.usd, asset: w.asset, chainName: w.chainName, txUrl: w.txUrl, ts: w.ts }; });
  const signals = (slug) => {
    const c = (trust.complaints || {})[slug] || {}, p = (trust.payouts || {})[slug] || {}, r = stars[slug];
    return {
      complaints: { total: c.total || 0, resolved: c.resolved || 0, open: c.open || 0 },
      payoutMedianMin: p.median != null ? p.median : null, payoutReports: p.count || 0,
      rating: r ? r.sum / r.n : null, ratingCount: r ? r.n : 0
    };
  };
  const rows = A.casinos.filter((c) => (c.kind || 'casino') === kind).map((c) => ({
    slug: c.slug, name: c.name, domain: c.domain, tracked: true,
    dep: c.depTotal, wd: c.wdTotal, deposits: c.txInTotal, withdrawals: c.txOutTotal, depositors: c.depositors || 0,
    prevDep: c.prevDep, change: c.prevDep > 0 ? (c.depTotal - c.prevDep) / c.prevDep * 100 : null,
    spark: c.dep, biggest: big[c.slug] || null, payoutRatio: c.depTotal > 0 ? c.wdTotal / c.depTotal : null, balance: c.balance || 0,
    ...signals(c.slug)
  })).sort((a, b) => b.dep - a.dep);
  // Casinos without tracked wallets: listed after the tracked ones with the published snapshot figure, never as $0.
  const have = new Set(rows.map((r) => r.slug));
  let untracked = [];
  if (kind === 'casino') {
    untracked = SITE.idx.filter((x) => !have.has(x[1])).map((x) => ({ slug: x[1], name: x[0], domain: x[4] || '', tracked: false, snapshot24h: x[2], ...signals(x[1]) }));
  } else {
    untracked = (await customSites()).filter((x) => x.kind === kind && !have.has(x.slug)).map((x) => ({ slug: x.slug, name: x.name, domain: x.domain || '', tracked: false, snapshot24h: null, ...signals(x.slug) }));
  }
  const total = rows.reduce((s, r) => s + r.dep, 0);
  return { window: win in WINDOWS ? win : '7d', days, kind, dates: A.dates, total, rows, untracked, updatedAt: A.updatedAt || Date.now(), historyDays: historyDays(A) };
}
// how many days of daily history exist (so the page can say "1Y fills in over time")
function historyDays(A) { let n = 0; A.casinos.forEach((c) => { const first = c.dep.findIndex((v) => v > 0); if (first >= 0) n = Math.max(n, c.dep.length - first); }); return n; }

export async function providers(win) {
  const list = (await store('onchain').get('providers')) || [];
  const days = WINDOWS[win] || 30;
  const A = await analytics(days);
  const dep = {}; A.casinos.forEach((c) => { dep[c.slug] = c.depTotal; });
  const market = A.casinos.reduce((s, c) => s + c.depTotal, 0) || 1;
  const rows = list.map((p) => {
    const carried = (p.casinos || []).map((slug) => ({ slug, name: (casinoBySlug(slug) || {}).name || slug, dep: dep[slug] || 0, tracked: slug in dep }));
    const reach = carried.reduce((s, c) => s + c.dep, 0);
    return { slug: p.slug, name: p.name, domain: p.domain || '', rtp: p.rtp || '', source: p.source || '', casinos: carried.sort((a, b) => b.dep - a.dep), casinoCount: carried.length, trackedCount: carried.filter((c) => c.tracked).length, reach, share: reach / market * 100 };
  }).sort((a, b) => b.reach - a.reach || b.casinoCount - a.casinoCount);
  return { window: win in WINDOWS ? win : '30d', rows };
}
