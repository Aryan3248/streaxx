'use strict';
// Personal whale alerts: the on-chain indexer reports every new transfer, and members who watch that casino
// get it by Telegram (one message each, up to 8 a run) and by email (one digest per run).

const mailer = require('./mailer');
const { CHAINS, txUrl } = require('../onchain/assets');

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function amount(t) {
  const a = t.amount >= 1000 ? Math.round(t.amount).toLocaleString('en-US') : Number(t.amount).toLocaleString('en-US', { maximumFractionDigits: 4 });
  return a + ' ' + t.asset;
}

class PersonalAlerts {
  constructor(cfg, store, tg, log, casinoNames) {
    this.cfg = cfg;
    this.store = store;
    this.tg = tg;
    this.log = log || (() => {});
    this.casinoNames = casinoNames || (() => ({}));
    this.watch = new Map();
    this.pending = new Map();
  }
  begin() {
    try { this.watch = this.store.watchers(); } catch (e) { this.watch = new Map(); this.log('Alerts: ' + e.message); }
  }
  onTransfer(t) {
    const list = this.watch.get(t.casino);
    if (!list || t.internal || !(t.usd > 0)) return;
    const key = t.chain + '|' + t.tx + '|' + t.idx + '|' + t.wallet;
    list.forEach(w => {
      if (t.usd < w.alert_min) return;
      if (!this.store.alertOnce(w.id, key)) return;
      if (!this.pending.has(w.id)) this.pending.set(w.id, { w, items: [] });
      this.pending.get(w.id).items.push(t);
    });
  }
  async flush() {
    const names = this.casinoNames();
    const base = this.cfg.publicUrl || 'http://localhost:' + (this.cfg.port || 3000);
    const jobs = [...this.pending.values()];
    this.pending = new Map();
    let tgSent = 0, mails = 0;
    for (const { w, items } of jobs) {
      items.sort((a, b) => b.usd - a.usd);
      const rows = items.map(t => ({
        casinoName: names[t.casino] || t.casino, dir: t.dir, usdLabel: money(t.usd), amountLabel: amount(t),
        chainName: CHAINS[t.chain] ? CHAINS[t.chain].name : t.chain, url: txUrl(t.chain, t.tx)
      }));
      if (w.alert_tg && w.tg_chat && this.tg && this.tg.ready) {
        rows.slice(0, 8).forEach(r => {
          this.tg.send(w.tg_chat, '<b>' + mailer.esc(r.casinoName + (r.dir === 'in' ? ' deposit ' : ' withdrawal ') + r.usdLabel) + '</b>\n' +
            mailer.esc(r.amountLabel + ' on ' + r.chainName) + '\n<a href="' + mailer.esc(r.url) + '">View transaction</a>', true);
          tgSent++;
        });
        if (rows.length > 8) this.tg.send(w.tg_chat, 'And ' + (rows.length - 8) + ' more whale moves on your watchlist: ' + base + '/Onchain.dc.html');
      }
      if (w.alert_email && w.verified && this.cfg.resendKey) {
        const m = mailer.templates.alerts(base, w.name, rows);
        try { await mailer.send(this.cfg, w.email, m.subject, m.html, m.text); mails++; } catch (e) { this.log('Alert email: ' + e.message); }
      }
    }
    if (tgSent || mails) this.log('Personal alerts: ' + tgSent + ' Telegram messages, ' + mails + ' emails');
  }
}

module.exports = { PersonalAlerts, money };
