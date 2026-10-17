'use strict';
// Whale alerts to a Telegram channel or group. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.

const { getJSON, sleep } = require('./util');
const { CHAINS, txUrl } = require('./assets');

const queue = [];
let busy = false;

function money(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
const short = a => (a && a.length > 14 ? a.slice(0, 6) + '...' + a.slice(-4) : a || 'unknown');
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function format(t, casinoName) {
  const kind = t.dir === 'in' ? 'Deposit into' : 'Withdrawal from';
  const amt = t.amount >= 1000 ? Math.round(t.amount).toLocaleString('en-US') : t.amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return '<b>' + esc(kind + ' ' + casinoName) + '</b>\n' +
    esc(money(t.usd) + ' (' + amt + ' ' + t.asset + ') on ' + (CHAINS[t.chain] ? CHAINS[t.chain].name : t.chain)) + '\n' +
    esc((t.dir === 'in' ? 'From ' : 'To ') + short(t.cp)) + '\n' +
    '<a href="' + esc(txUrl(t.chain, t.tx)) + '">View transaction</a>';
}

async function pump(cfg, log) {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const text = queue.shift();
      try {
        await getJSON('https://api.telegram.org/bot' + cfg.telegramToken + '/sendMessage', {
          method: 'POST', retries: 1, gap: 1100,
          body: JSON.stringify({ chat_id: cfg.telegramChat, text, parse_mode: 'HTML', disable_web_page_preview: true })
        });
      } catch (e) { log('Telegram: ' + e.message); }
      await sleep(50);
    }
  } finally { busy = false; }
}

function send(cfg, log, t, casinoName) {
  if (!cfg.telegramToken || !cfg.telegramChat) return false;
  if (queue.length > 50) return false;
  queue.push(format(t, casinoName));
  pump(cfg, log);
  return true;
}

module.exports = { send, format, money };
