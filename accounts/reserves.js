'use strict';
// Reserve drop warnings: after each on-chain run, compare every tracked casino's hot wallet total with its highest
// daily total in the last 7 days. A fall of 40% or more is sent to members who watch that casino, at most once a day
// per casino. A fall can also be a price move or a planned transfer to cold storage, and the message says so.

const mailer = require('./mailer');
const { money } = require('./alerts');

const DROP = 0.4; // same threshold the Streax Score uses for its reserves penalty
const MIN_PEAK = 50000; // ignore casinos whose tracked wallets hold too little for a fall to mean anything
const DAY = 86400000;

// Reads the on-chain store and returns casinos whose reserves fell sharply: [{ casino, now, peak, drop }]
function findDrops(onchainStore, now = Date.now()) {
  const db = onchainStore.db;
  const cur = db.prepare(`SELECT w.casino AS casino, SUM(b.usd) AS usd FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address
    WHERE w.active = 1 AND w.role != 'funder' GROUP BY w.casino`).all();
  const since = new Date(now - 7 * DAY).toISOString().slice(0, 10);
  const peaks = {};
  db.prepare('SELECT casino, day, SUM(usd) AS usd FROM balance_days WHERE day >= ? GROUP BY casino, day').all(since)
    .forEach(r => { peaks[r.casino] = Math.max(peaks[r.casino] || 0, r.usd || 0); });
  const out = [];
  cur.forEach(r => {
    const peak = peaks[r.casino] || 0, nowUsd = r.usd || 0;
    if (peak < MIN_PEAK) return;
    const drop = (peak - nowUsd) / peak;
    if (drop >= DROP) out.push({ casino: r.casino, now: nowUsd, peak, drop });
  });
  return out;
}

function message(base, name, d) {
  const pct = Math.round(d.drop * 100);
  const head = name + ' reserves down ' + pct + '%';
  const body = 'Hot wallets Streax tracks for ' + name + ' hold ' + money(d.now) + ', down from ' + money(d.peak) + ' at their 7-day high. ' +
    'Withdrawals can slow down when hot wallets run low. This can also be a price move or a planned transfer to cold storage.';
  return { head, body, url: base + '/Casino.dc.html?c=' + encodeURIComponent(d.casino) };
}

class ReserveWatch {
  constructor(cfg, store, tg, log, casinoNames) {
    this.cfg = cfg; this.store = store; this.tg = tg; this.log = log || (() => {}); this.casinoNames = casinoNames || (() => ({}));
  }
  async check(onchainStore, now = Date.now()) {
    let drops;
    try { drops = findDrops(onchainStore, now); } catch (e) { this.log('Reserve check: ' + e.message); return { drops: 0, sent: 0 }; }
    if (!drops.length) return { drops: 0, sent: 0 };
    const watch = this.store.watchers();
    const names = this.casinoNames();
    const base = this.cfg.publicUrl || 'http://localhost:' + (this.cfg.port || 3000);
    const day = new Date(now).toISOString().slice(0, 10);
    let sent = 0;
    for (const d of drops) {
      const m = message(base, names[d.casino] || d.casino, d);
      for (const w of watch.get(d.casino) || []) {
        if (!this.store.alertOnce(w.id, 'reserve|' + d.casino + '|' + day)) continue;
        if (w.alert_tg && w.tg_chat && this.tg && this.tg.ready) {
          this.tg.send(w.tg_chat, '<b>' + mailer.esc(m.head) + '</b>\n' + mailer.esc(m.body) + '\n<a href="' + mailer.esc(m.url) + '">Open the casino page</a>', true);
          sent++;
        }
        if (w.alert_email && w.verified && this.cfg.resendKey) {
          const html = mailer.layout(m.head, '<p style="line-height:1.6">' + mailer.esc(m.body) + '</p>' + mailer.button(m.url, 'Open the casino page'),
            'You get this email because ' + mailer.esc(names[d.casino] || d.casino) + ' is on your watchlist. Change alerts on <a href="' + mailer.esc(base + '/Account.dc.html') + '">your account page</a>.');
          try { await mailer.send(this.cfg, w.email, m.head, html, m.head + '. ' + m.body + ' ' + m.url); sent++; } catch (e) { this.log('Reserve email: ' + e.message); }
        }
      }
    }
    this.log('Reserve check: ' + drops.length + ' casino(s) down 40% or more, ' + sent + ' warning(s) sent');
    return { drops: drops.length, sent };
  }
}

module.exports = { ReserveWatch, findDrops, DROP, MIN_PEAK };
