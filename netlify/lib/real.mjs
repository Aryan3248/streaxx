// /api/real: live market prices, casino token prices, Kick streamers and the
// two labeled Ethereum wallets. Cached for a few minutes.
import { store } from './store.mjs';
import { SITE } from './data.mjs';
import { getJson } from './http.mjs';
import { ethBalances, prices } from './chain.mjs';

const TTL = 5 * 60000;
const MARKET_ID = { BTC: 'coingecko:bitcoin', ETH: 'coingecko:ethereum', SOL: 'coingecko:solana', BNB: 'coingecko:binancecoin', TRX: 'coingecko:tron' };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function market() {
  const ids = SITE.market.map((s) => MARKET_ID[s]).filter(Boolean).join(',');
  const [cur, pct] = await Promise.all([getJson('https://coins.llama.fi/prices/current/' + ids), getJson('https://coins.llama.fi/percentage/' + ids + '?period=24h')]);
  return SITE.market.filter((s) => cur.coins[MARKET_ID[s]]).map((s) => ({ sym: s, price: round(cur.coins[MARKET_ID[s]].price, 4), ch: round((pct.coins || {})[MARKET_ID[s]] || 0) }));
}

async function tokens() {
  const ids = SITE.tokens.map((t) => 'coingecko:' + t.id).join(',');
  const start = Math.floor(Date.now() / 1000) - 30 * 86400;
  const [cur, p24, p7, chart] = await Promise.all([
    getJson('https://coins.llama.fi/prices/current/' + ids),
    getJson('https://coins.llama.fi/percentage/' + ids + '?period=24h'),
    getJson('https://coins.llama.fi/percentage/' + ids + '?period=7d'),
    getJson('https://coins.llama.fi/chart/' + ids + '?start=' + start + '&span=30&period=1d', { timeout: 20000 }).catch(() => ({ coins: {} }))
  ]);
  let cg = [];
  try { cg = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + SITE.tokens.map((t) => t.id).join(',')); } catch {}
  return SITE.tokens.map((t) => {
    const id = 'coingecko:' + t.id, c = cur.coins[id];
    if (!c) return null;
    const row = { sym: t.sym, price: c.price, ch24: round((p24.coins || {})[id] || 0), ch7: round((p7.coins || {})[id] || 0) };
    const pts = ((chart.coins || {})[id] || {}).prices || [];
    if (pts.length >= 2) { row.h = pts.map((p) => p.price); row.ts = pts.map((p) => p.timestamp * 1000); row.h[row.h.length - 1] = c.price; }
    const m = cg.find((x) => x.id === t.id);
    if (m) { if (m.market_cap) row.mcap = m.market_cap; if (m.total_volume != null) row.vol = m.total_volume; }
    return row;
  }).filter(Boolean);
}

// Creators are tuples: [name, slug, followers, verified, live, viewers, title, liveSince, categories, platform, url]
const fmtDay = (s) => (s ? new Date(String(s).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const CASINO_CATEGORIES = ['Slots & Casino', 'Slots', 'Virtual Casino'];

// App access tokens (client credentials), kept in memory until they expire.
const appTokens = {};
async function appToken(name, url, body) {
  const t = appTokens[name];
  if (t && t.exp > Date.now() + 60000) return t.value;
  const j = await getJson(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), timeout: 10000 });
  appTokens[name] = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// Kick: the official API (https://docs.kick.com) when KICK_CLIENT_ID/SECRET are set.
async function kickOfficial(prev) {
  const token = await appToken('kick', 'https://id.kick.com/oauth/token', { grant_type: 'client_credentials', client_id: process.env.KICK_CLIENT_ID, client_secret: process.env.KICK_CLIENT_SECRET });
  const h = { headers: { authorization: 'Bearer ' + token }, timeout: 10000 };
  const out = new Map();
  // the tracked channels
  const qs = SITE.creators.map((c) => 'slug=' + encodeURIComponent(c[1])).join('&');
  const ch = await getJson('https://api.kick.com/public/v1/channels?' + qs, h);
  (ch.data || []).forEach((d) => {
    const base = prev.get('kick:' + d.slug) || SITE.creators.find((c) => c[1] === d.slug) || [d.slug, d.slug, 0, false, false, 0, '', '', []];
    const s = d.stream || {};
    out.set('kick:' + d.slug, [base[0], d.slug, base[2], base[3], !!s.is_live, s.is_live ? s.viewer_count || 0 : 0, d.stream_title || base[6], s.is_live ? fmtDay(s.start_time) : base[7], d.category && d.category.name ? [d.category.name] : base[8], 'kick', 'https://kick.com/' + d.slug, base[11] || '']);
  });
  // casino streamers who are live right now, tracked or not
  try {
    const cats = await getJson('https://api.kick.com/public/v1/categories?q=' + encodeURIComponent('Slots'), h);
    const cat = (cats.data || []).find((c) => CASINO_CATEGORIES.includes(c.name));
    if (cat) {
      const ls = await getJson('https://api.kick.com/public/v1/livestreams?category_id=' + cat.id + '&limit=25&sort=viewer_count', h);
      (ls.data || []).forEach((d) => {
        const key = 'kick:' + d.slug;
        if (out.has(key) || !d.slug) return;
        const base = prev.get(key);
        out.set(key, [base ? base[0] : d.slug, d.slug, base ? base[2] : 0, base ? base[3] : false, true, d.viewer_count || 0, d.stream_title || '', fmtDay(d.started_at), [cat.name], 'kick', 'https://kick.com/' + d.slug, d.profile_picture || (base && base[11]) || '']);
      });
    }
  } catch {}
  return out;
}

// Kick without keys: the public website endpoint, which Kick may block from servers.
async function kickUnofficial(prev) {
  const out = new Map();
  await Promise.all(SITE.creators.map(async (c) => {
    try {
      const j = await getJson('https://kick.com/api/v2/channels/' + c[1], { timeout: 8000 });
      const ls = j.livestream;
      const cats = ls && ls.categories && ls.categories.length ? ls.categories.map((x) => x.name) : (j.recent_categories || []).map((x) => x.name).slice(0, 4);
      out.set('kick:' + c[1], [c[0], c[1], j.followers_count != null ? Number(j.followers_count) || 0 : Number(c[2]) || 0, !!j.verified, !!(ls && ls.is_live), ls ? Number(ls.viewer_count) || 0 : 0, ls ? ls.session_title || '' : c[6], ls ? fmtDay(ls.created_at) : c[7], cats.length ? cats : c[8], 'kick', 'https://kick.com/' + c[1], (j.user && j.user.profile_pic) || '']);
    } catch {}
  }));
  // every live channel in Kick's Slots & Casino category (up to 12 pages by viewers)
  for (let page = 1; page <= 12; page++) {
    try {
      const j = await getJson('https://kick.com/stream/livestreams/en?limit=24&subcategory=slots-casino&sort=desc&page=' + page, { timeout: 8000 });
      const list = j.data || [];
      list.forEach((d) => {
        const ch = d.channel || {}, slug = ch.slug, key = 'kick:' + slug;
        if (!slug || out.has(key)) return;
        const base = prev.get(key);
        out.set(key, [(ch.user && ch.user.username) || slug, slug, base ? Number(base[2]) || 0 : 0, base ? base[3] : false, true, Number(d.viewer_count) || 0, d.session_title || '', fmtDay(d.start_time), ['Slots & Casino'], 'kick', 'https://kick.com/' + slug, (ch.user && ch.user.profilepic) || (base && base[11]) || '']);
      });
      if (list.length < 24) break;
    } catch { break; }
  }
  return out;
}

// Twitch: live streams in the casino categories (needs TWITCH_CLIENT_ID/SECRET).
async function twitch(prev) {
  const id = process.env.TWITCH_CLIENT_ID;
  const token = await appToken('twitch', 'https://id.twitch.tv/oauth2/token', { grant_type: 'client_credentials', client_id: id, client_secret: process.env.TWITCH_CLIENT_SECRET });
  const h = { headers: { 'client-id': id, authorization: 'Bearer ' + token }, timeout: 10000 };
  const games = await getJson('https://api.twitch.tv/helix/games?' + CASINO_CATEGORIES.map((n) => 'name=' + encodeURIComponent(n)).join('&'), h);
  const ids = (games.data || []).map((g) => g.id);
  const out = new Map();
  if (!ids.length) return out;
  const st = await getJson('https://api.twitch.tv/helix/streams?first=30&' + ids.map((g) => 'game_id=' + g).join('&'), h);
  const streams = st.data || [];
  // follower totals for the top streams (app tokens get the total count)
  await Promise.all(streams.slice(0, 15).map(async (s) => {
    try { const f = await getJson('https://api.twitch.tv/helix/channels/followers?first=1&broadcaster_id=' + s.user_id, h); s.followers = f.total; } catch {}
  }));
  streams.forEach((s) => {
    const key = 'twitch:' + s.user_login, base = prev.get(key);
    out.set(key, [s.user_name || s.user_login, s.user_login, s.followers != null ? Number(s.followers) || 0 : base ? Number(base[2]) || 0 : 0, false, true, s.viewer_count || 0, s.title || '', fmtDay(s.started_at), [s.game_name || 'Slots'], 'twitch', 'https://twitch.tv/' + s.user_login]);
  });
  // tracked Twitch channels that went offline keep their last known row, marked offline
  prev.forEach((c, key) => { if (key.startsWith('twitch:') && !out.has(key) && c[2] > 0) out.set(key, [c[0], c[1], c[2], c[3], false, 0, c[6], c[7], c[8], 'twitch', c[10], c[11] || '']); });
  return out;
}

async function creators(previous) {
  const prev = new Map((previous || []).map((c) => [(c[9] || 'kick') + ':' + c[1], c]));
  let kick = new Map();
  if (process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET) {
    try { kick = await kickOfficial(prev); } catch (e) { console.error('kick api', e.message); }
  }
  if (!kick.size) kick = await kickUnofficial(prev);
  let tw = new Map();
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
    try { tw = await twitch(prev); } catch (e) { console.error('twitch api', e.message); }
  }
  // follower and viewer counts sometimes arrive as text; keep them numbers
  return [...kick.values(), ...tw.values()].map((c) => { c[2] = Number(c[2]) || 0; c[5] = Number(c[5]) || 0; return c; });
}

async function wallets() {
  const px = await prices();
  const bal = await ethBalances(SITE.ethWallets.map((w) => w.addr));
  return SITE.ethWallets.map((w) => { const e = (bal[w.addr] || []).find((a) => a.asset === 'ETH'); const n = e ? e.amount : 0; return { casino: w.casino, ethNum: n, ethUsdNum: px.ETH ? n * px.ETH : null }; });
}

export async function real() {
  const st = store('cache');
  const hit = await st.get('real');
  if (hit && Date.now() - hit.meta.updatedAt < TTL) return hit;
  const parts = await Promise.allSettled([market(), tokens(), creators(hit && hit.creators), wallets()]);
  const val = (i) => (parts[i].status === 'fulfilled' ? parts[i].value : null);
  const out = { market: val(0) || (hit && hit.market) || [], tokens: val(1) || (hit && hit.tokens) || [], creators: val(2) && val(2).length ? val(2) : (hit && hit.creators) || [], wallets: val(3) || (hit && hit.wallets) || [], meta: { updatedAt: Date.now() } };
  if (out.market.length || out.tokens.length) await st.set('real', out);
  return out;
}
