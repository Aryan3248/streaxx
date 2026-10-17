'use strict';
// Personal Telegram alerts. A member presses "Connect Telegram", opens t.me/<bot>?start=<code>, and the bot
// links that chat to the account. Uses the same TELEGRAM_BOT_TOKEN as the channel alerts.

const POINTS = require('./perks').POINTS;

class TgBot {
  constructor(cfg, store, log) {
    this.cfg = cfg;
    this.store = store;
    this.log = log || (() => {});
    this.username = cfg.telegramBotUsername || '';
    this.offset = 0;
    this.stopped = false;
    this.queue = [];
    this.busy = false;
  }
  get ready() { return !!this.cfg.telegramToken; }

  async call(method, body, timeoutMs = 15000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.telegram.org/bot' + this.cfg.telegramToken + '/' + method, {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const j = await res.json().catch(() => ({}));
      if (!j.ok) throw Object.assign(new Error('Telegram ' + method + ': ' + (j.description || res.status)), { code: j.error_code || res.status });
      return j.result;
    } finally { clearTimeout(timer); }
  }

  async botName() {
    if (this.username) return this.username;
    const me = await this.call('getMe');
    this.username = me.username;
    return this.username;
  }

  async linkUrl(userId) {
    const code = this.store.createToken(userId, 'tg', 30 * 60000);
    return 'https://t.me/' + (await this.botName()) + '?start=' + code;
  }

  handle(msg) {
    if (!msg || !msg.chat || msg.chat.type !== 'private' || typeof msg.text !== 'string') return null;
    const chat = String(msg.chat.id);
    const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{10,64})\s*$/.exec(msg.text.trim());
    if (m) {
      const userId = this.store.useToken(m[1], 'tg');
      if (!userId) return { chat, text: 'This link has expired. Open your Streax account page and press Connect Telegram again.' };
      const other = this.store.userByTelegram(chat);
      if (other && other.id !== userId) this.store.update(other.id, { tg_chat: null, tg_name: null });
      const name = [msg.from && msg.from.first_name, msg.from && msg.from.username ? '@' + msg.from.username : ''].filter(Boolean).join(' ').slice(0, 60);
      this.store.update(userId, { tg_chat: chat, tg_name: name, alert_tg: 1 });
      this.store.award(userId, 'telegram', POINTS.telegram.pts);
      return { chat, text: 'Connected to Streax. Whale alerts for the casinos on your watchlist will arrive here. Send /stop to turn them off.' };
    }
    if (/^\/stop\b/.test(msg.text.trim())) {
      const u = this.store.userByTelegram(chat);
      if (u) this.store.update(u.id, { tg_chat: null, tg_name: null });
      return { chat, text: 'Telegram alerts are off. Connect again any time from your Streax account page.' };
    }
    if (/^\/start\b/.test(msg.text.trim())) return { chat, text: 'Open your Streax account page and press Connect Telegram to get your own whale alerts here.' };
    return null;
  }

  async poll() {
    while (!this.stopped) {
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, 35000);
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          const reply = this.handle(u.message);
          if (reply) this.send(reply.chat, reply.text);
        }
      } catch (e) {
        if (this.stopped) break;
        // 409: a webhook is set or another copy of the server is polling. Wait longer before trying again.
        this.log('Telegram bot: ' + e.message);
        await new Promise(r => setTimeout(r, e.code === 409 ? 60000 : 5000));
      }
    }
  }
  start() { if (this.ready && !this.started) { this.started = true; this.poll(); } }
  stop() { this.stopped = true; }

  send(chat, text, html) {
    if (!this.ready || this.queue.length > 200) return;
    this.queue.push({ chat_id: chat, text, parse_mode: html ? 'HTML' : undefined, disable_web_page_preview: true });
    this.pump();
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const m = this.queue.shift();
        try { await this.call('sendMessage', m); } catch (e) {
          // 403: the member blocked the bot, so stop sending there.
          if (e.code === 403) { const u = this.store.userByTelegram(m.chat_id); if (u) this.store.update(u.id, { tg_chat: null, tg_name: null }); }
          else this.log('Telegram send: ' + e.message);
        }
        await new Promise(r => setTimeout(r, 60));
      }
    } finally { this.busy = false; }
  }
}

module.exports = { TgBot };
