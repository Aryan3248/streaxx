// Casino health: one status per tracked casino from reserves, payout ratio and
// complaints; the payout check ("can it pay me?"); the daily brief; and health
// alerts to members who follow a casino. Everything is computed from data the
// monitor and the complaint desk already hold; nothing is estimated.
import { store, update } from './store.mjs';
import { analytics } from './onchain.mjs';
import { trustData } from './complaints.mjs';
import { tgSend, sendMail, mailReady } from './notify.mjs';

const H = 3600000, D = 86400000;
const db = () => store('onchain');
const money = (v) => '$' + (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));

// Balance at or before a time, from the hourly balance history.
const balAt = (hist, t) => { let v = null; for (const x of hist) { if (x.t <= t) v = x.usd; else break; } return v; };

export async function healthAll() {
  const [A, bh, trust] = await Promise.all([analytics(7), db().get('balhist'), trustData().catch(() => ({ complaints: {}, payouts: {} }))]);
  const now = Date.now();
  const out = [];
  for (const c of A.casinos) {
    if (!c.balance && !c.depTotal) continue;
    const hist = ((bh || {})[c.slug] || []).slice().sort((a, b) => a.t - b.t);
    const b24 = balAt(hist, now - 24 * H), b7 = balAt(hist, now - 7 * D);
    const ch24 = b24 ? (c.balance - b24) / b24 * 100 : null;
    const ch7 = b7 ? (c.balance - b7) / b7 * 100 : null;
    const dailyOut = c.wdTotal / 7;
    const coverDays = dailyOut > 0 ? c.balance / dailyOut : null;
    const cmp = (trust.complaints || {})[c.slug] || { total: 0, open: 0, unresolved: 0 };
    const pay = (trust.payouts || {})[c.slug] || {};
    const reasons = [];
    let level = 0; // 0 healthy, 1 watch, 2 warning
    if (ch24 != null && ch24 <= -40) { level = 2; reasons.push('Reserves down ' + Math.abs(ch24).toFixed(0) + '% in 24h'); }
    else if (ch24 != null && ch24 <= -20) { level = Math.max(level, 1); reasons.push('Reserves down ' + Math.abs(ch24).toFixed(0) + '% in 24h'); }
    if (coverDays != null && coverDays < 1) { level = 2; reasons.push('Reserves cover under a day of payouts'); }
    else if (coverDays != null && coverDays < 2) { level = Math.max(level, 1); reasons.push('Reserves cover ' + coverDays.toFixed(1) + ' days of payouts'); }
    if (cmp.open >= 3) { level = Math.max(level, 1); reasons.push(cmp.open + ' open complaints'); }
    if (cmp.unresolved >= 3) { level = Math.max(level, 1); reasons.push(cmp.unresolved + ' unresolved complaints'); }
    if (pay.count >= 3 && pay.median > 60) { level = Math.max(level, 1); reasons.push('Median payout ' + Math.round(pay.median) + ' min'); }
    out.push({ slug: c.slug, name: c.name, domain: c.domain, status: ['healthy', 'watch', 'warning'][level], reasons,
      balance: c.balance, ch24, ch7, coverDays, payoutRatio: c.depTotal ? c.wdTotal / c.depTotal : null, payoutMedianMin: pay.count ? pay.median : null, payoutReports: pay.count || 0,
      complaints: { total: cmp.total || 0, open: cmp.open || 0 } });
  }
  const counts = { healthy: 0, watch: 0, warning: 0 };
  out.forEach((x) => counts[x.status]++);
  return { updatedAt: A.updatedAt, counts, casinos: out.sort((a, b) => ['warning', 'watch', 'healthy'].indexOf(a.status) - ['warning', 'watch', 'healthy'].indexOf(b.status)) };
}

// "Can it pay me?" for an amount at one casino.
export async function payoutCheck(slug, amount) {
  amount = Math.max(1, Number(amount) || 0);
  const all = await healthAll();
  const c = all.casinos.find((x) => x.slug === slug);
  if (!c) return { slug, tracked: false };
  const whales = ((await db().get('whales')) || []).filter((w) => w.slug === slug && w.dir === 'out' && w.ts > Date.now() - 7 * D && w.usd >= amount * 0.8);
  const share = c.balance ? amount / c.balance : 1;
  let score = 100;
  score -= Math.min(60, share * 400);              // share of the hot wallet the withdrawal needs
  if (c.status === 'watch') score -= 15;
  if (c.status === 'warning') score -= 35;
  if (c.payoutMedianMin != null) score -= Math.min(15, Math.max(0, (c.payoutMedianMin - 30) / 10));
  if (whales.length >= 5) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 80 ? 'very likely' : score >= 60 ? 'likely' : score >= 40 ? 'uncertain' : 'unlikely';
  return { slug, name: c.name, domain: c.domain, tracked: true, amount, verdict, score, share, balance: c.balance, status: c.status, reasons: c.reasons,
    paidSimilar7d: whales.length, payoutMedianMin: c.payoutMedianMin, payoutReports: c.payoutReports, openComplaints: c.complaints.open,
    note: 'Based on on-chain hot wallets and verified member payout reports. Not a guarantee: KYC checks and casino rules can still delay large withdrawals.' };
}

// Daily brief: the single most notable on-chain fact of the last 24 hours, then the days before.
export async function brief() {
  const saved = (await db().get('briefs')) || [];
  return { items: saved.slice(0, 14) };
}
export async function writeBrief() {
  const now = Date.now(), day = Math.floor(now / D) * D;
  const saved = (await db().get('briefs')) || [];
  if (saved[0] && saved[0].day === day) return saved[0];
  const [A, whales, H1] = await Promise.all([analytics(30), db().get('whales'), healthAll()]);
  const cands = [];
  const w24 = (whales || []).filter((w) => w.ts > now - 24 * H);
  const bigIn = w24.filter((w) => w.dir === 'in').sort((a, b) => b.usd - a.usd)[0];
  const bigOut = w24.filter((w) => w.dir === 'out').sort((a, b) => b.usd - a.usd)[0];
  if (bigIn) cands.push({ w: bigIn.usd, slug: bigIn.slug, title: 'A ' + money(bigIn.usd) + ' ' + bigIn.asset + ' deposit hit ' + bigIn.name + ' on ' + bigIn.chainName, body: 'The largest single deposit into a tracked casino in the last 24 hours.', txUrl: bigIn.txUrl });
  if (bigOut) cands.push({ w: bigOut.usd * 0.95, slug: bigOut.slug, title: bigOut.name + ' paid out ' + money(bigOut.usd) + ' in one ' + bigOut.asset + ' transfer', body: 'The largest single withdrawal from a tracked casino in the last 24 hours.', txUrl: bigOut.txUrl });
  const warn = H1.casinos.find((c) => c.status === 'warning');
  if (warn) cands.push({ w: 5e8, slug: warn.slug, title: warn.name + ': ' + warn.reasons[0].toLowerCase(), body: 'Streax marks ' + warn.name + ' as a warning today. ' + warn.reasons.join('. ') + '.' });
  const grow = A.casinos.filter((c) => c.prevDep > 1e6 && c.depTotal > 1e6).map((c) => ({ c, p: (c.depTotal - c.prevDep) / c.prevDep * 100 })).sort((a, b) => b.p - a.p)[0];
  if (grow && grow.p > 20) cands.push({ w: grow.c.depTotal * grow.p / 100, slug: grow.c.slug, title: grow.c.name + ' deposits up ' + grow.p.toFixed(0) + '% this month', body: money(grow.c.depTotal) + ' deposited in 30 days against ' + money(grow.c.prevDep) + ' the month before.' });
  if (!cands.length) return null;
  const top = cands.sort((a, b) => b.w - a.w)[0];
  const item = { day, at: now, ...top };
  await update(db(), 'briefs', (l) => { if (l[0] && l[0].day === day) return l; l.unshift(item); return l.slice(0, 60); }, []);
  return item;
}

// Health alerts: tell members who follow a casino when its status gets worse.
export async function sendHealthAlerts() {
  const H1 = await healthAll();
  let changed = [];
  await update(db(), 'healthPrev', (prev) => {
    const rank = (x) => ['healthy', 'watch', 'warning'].indexOf(x || 'healthy');
    changed = H1.casinos.filter((c) => rank(c.status) > rank(prev[c.slug]));
    const next = {}; H1.casinos.forEach((c) => { next[c.slug] = c.status; }); return next;
  }, {});
  if (!changed.length) return 0;
  const users = store('users');
  for (const k of await users.list('u/')) {
    const u = await users.get(k);
    if (!u || !u.watchlist || !u.watchlist.length || !u.alerts || !(u.alerts.telegram || u.alerts.email) || u.alerts.health === false) continue;
    const mine = changed.filter((c) => u.watchlist.includes(c.slug));
    if (!mine.length) continue;
    const text = mine.map((c) => (c.status === 'warning' ? 'Warning' : 'Watch') + ': ' + c.name + '\n' + c.reasons.join('. ')).join('\n\n');
    if (u.alerts.telegram && u.tg) await tgSend(u.tg.chatId, 'Streax health alert\n\n' + text).catch(() => {});
    if (u.alerts.email && u.verified && mailReady()) await sendMail(u.email, 'Streax health alert: ' + mine.map((c) => c.name).join(', '), text + '\n\nChange your alerts on your Streax account page.').catch(() => {});
  }
  return changed.length;
}
