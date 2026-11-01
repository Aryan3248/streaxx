// Sports odds from The Odds API (ODDS_API_KEY) and prediction markets from
// Polymarket's public API. Responses are cached in the store so a free plan
// (500 requests a month) lasts: odds refresh every ODDS_CACHE_MIN minutes (180).
import { store, update } from './store.mjs';
import { fail } from './http.mjs';

const ODDS = 'https://api.the-odds-api.com/v4';
const POLY = 'https://gamma-api.polymarket.com';
const db = () => store('odds');
const cacheMin = () => Math.max(15, Number(process.env.ODDS_CACHE_MIN || 180));
export const oddsReady = () => !!process.env.ODDS_API_KEY;

// The leagues offered on the page (The Odds API sport keys).
export const FEATURED = [
  ['soccer_epl', 'Premier League'], ['soccer_uefa_champs_league', 'Champions League'], ['soccer_spain_la_liga', 'La Liga'],
  ['basketball_nba', 'NBA'], ['americanfootball_nfl', 'NFL'], ['icehockey_nhl', 'NHL'], ['mma_mixed_martial_arts', 'MMA'], ['soccer_italy_serie_a', 'Serie A']
];

async function cached(key, minutes, load) {
  const hit = await db().get(key);
  if (hit && hit.at > Date.now() - minutes * 60000) return hit.data;
  try {
    const data = await load();
    await db().set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data; // serve the last good copy if the feed is down
    throw e;
  }
}

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (r.status === 401) fail(502, 'The odds feed rejected the API key');
  if (r.status === 429) fail(502, 'The odds feed quota is used up for this month');
  if (!r.ok) fail(502, 'The odds feed did not answer (' + r.status + ')');
  return r.json();
}

// One league: every match with each book's decimal prices, the best price per outcome and the margin.
export async function league(sport) {
  if (!FEATURED.some((f) => f[0] === sport)) fail(400, 'Unknown league');
  if (!oddsReady()) return { ready: false, sport, events: [] };
  const raw = await cached('ev:' + sport, cacheMin(), () => getJson(ODDS + '/sports/' + sport + '/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=' + encodeURIComponent(process.env.ODDS_API_KEY)));
  const events = (raw || []).map(shape).filter((e) => e.books.length);
  await rememberBooks(sport, events);
  return { ready: true, sport, name: FEATURED.find((f) => f[0] === sport)[1], events, cachedMinutes: cacheMin() };
}

function shape(ev) {
  const outcomes = [];
  const books = (ev.bookmakers || []).map((bk) => {
    const m = (bk.markets || []).find((x) => x.key === 'h2h');
    if (!m) return null;
    const prices = {};
    m.outcomes.forEach((o) => { prices[o.name] = o.price; if (!outcomes.includes(o.name)) outcomes.push(o.name); });
    return { key: bk.key, name: bk.title, prices, margin: margin(Object.values(prices)) };
  }).filter(Boolean);
  // home, draw, away order when there is a draw
  outcomes.sort((a, b) => rank(a, ev) - rank(b, ev));
  const best = {};
  outcomes.forEach((o) => { books.forEach((b) => { const p = b.prices[o]; if (p && (!best[o] || p > best[o].price)) best[o] = { price: p, book: b.name }; }); });
  return { id: ev.id, home: ev.home_team, away: ev.away_team, start: ev.commence_time, outcomes, books: books.sort((a, b) => a.margin - b.margin), best, bestMargin: margin(outcomes.map((o) => best[o] && best[o].price)) };
}
const rank = (o, ev) => (o === ev.home_team ? 0 : o === 'Draw' ? 1 : 2);
function margin(prices) { const p = prices.filter((x) => x > 1); return p.length ? (p.reduce((s, x) => s + 1 / x, 0) - 1) * 100 : null; }

// Keep each book's average margin per league so the ranking covers more than one page view.
async function rememberBooks(sport, events) {
  const per = {};
  events.forEach((e) => e.books.forEach((b) => { if (b.margin == null) return; const x = (per[b.name] = per[b.name] || { sum: 0, n: 0 }); x.sum += b.margin; x.n++; }));
  await update(db(), 'books', (all) => { all[sport] = { at: Date.now(), per }; return all; }, {});
}

// Sportsbook ranking: average margin across every league seen recently (lower is better for players).
export async function bookRanking() {
  const all = (await db().get('books')) || {};
  const tot = {};
  Object.values(all).forEach((x) => { if (x.at < Date.now() - 7 * 86400000) return; Object.entries(x.per).forEach(([name, v]) => { const t = (tot[name] = tot[name] || { sum: 0, n: 0, leagues: 0 }); t.sum += v.sum; t.n += v.n; t.leagues++; }); });
  const rows = Object.entries(tot).map(([name, t]) => ({ name, margin: t.sum / t.n, markets: t.n, leagues: t.leagues })).filter((r) => r.markets >= 3).sort((a, b) => a.margin - b.margin);
  return { ready: oddsReady(), rows };
}

// Paste a slip: lines like "Arsenal 2.10" or "Lakers @ 1.85". Matches each pick against cached leagues.
export async function checkSlip(text) {
  if (!oddsReady()) return { ready: false, picks: [] };
  const lines = String(text || '').split(/\n|;/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) fail(400, 'Paste at least one pick, for example: Arsenal 2.10', { field: 'slip' });
  const leagues = [];
  for (const [key] of FEATURED) { const hit = await db().get('ev:' + key); if (hit) leagues.push(...(hit.data || []).map(shape)); }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const picks = lines.map((line) => {
    const m = /^(.*?)(?:\s*@\s*|\s+)(\d+(?:\.\d+)?)\s*$/.exec(line);
    const name = norm(m ? m[1] : line), yours = m ? Number(m[2]) : null;
    if (!name) return { line, found: false };
    let hit = null;
    for (const ev of leagues) {
      const o = ev.outcomes.find((x) => { const n = norm(x); return n === name || n.includes(name) || name.includes(n); });
      if (o && ev.best[o]) { hit = { ev, o }; break; }
    }
    if (!hit) return { line, found: false };
    const best = hit.ev.best[hit.o];
    return { line, found: true, pick: hit.o, match: hit.ev.home + ' v ' + hit.ev.away, start: hit.ev.start, yours, best: best.price, bestBook: best.book, books: hit.ev.books.length,
      better: yours != null ? best.price > yours + 1e-9 : null, gainPct: yours ? (best.price / yours - 1) * 100 : null };
  });
  const found = picks.filter((p) => p.found);
  const accaYours = found.every((p) => p.yours) && found.length ? found.reduce((s, p) => s * p.yours, 1) : null;
  const accaBest = found.length ? found.reduce((s, p) => s * p.best, 1) : null;
  return { ready: true, picks, accaYours, accaBest, note: found.length < picks.length ? 'Only leagues opened on this page in the last few hours can be matched.' : '' };
}

// Prediction markets: the most traded sports markets on Polymarket.
export async function predictions() {
  const raw = await cached('poly', 10, () => getJson(POLY + '/events?tag_slug=sports&active=true&closed=false&order=volume24hr&ascending=false&limit=24'));
  const parse = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (e) { return []; } };
  const events = (raw || []).map((e) => {
    const markets = (e.markets || []).filter((m) => m.active && !m.closed).slice(0, 6).map((m) => {
      const names = parse(m.outcomes), prices = parse(m.outcomePrices).map(Number);
      return { question: m.question || m.groupItemTitle || e.title, outcomes: names.map((n, i) => ({ name: n, prob: prices[i] != null ? prices[i] * 100 : null })), volume: Number(m.volume || 0) };
    }).filter((m) => m.outcomes.length);
    return { title: e.title, slug: e.slug, url: 'https://polymarket.com/event/' + e.slug, ends: e.endDate || null, volume24h: Number(e.volume24hr || 0), volume: Number(e.volume || 0), image: e.image || '', markets };
  }).filter((e) => e.markets.length);
  return { events };
}
