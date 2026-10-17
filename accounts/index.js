'use strict';
// Accounts: sign-up and login (email + password, Google), member perks, referral points and personal whale alerts.

const path = require('path');
const { Limiter } = require('./http');
const { TgBot } = require('./tgbot');
const { PersonalAlerts } = require('./alerts');
const { ReserveWatch } = require('./reserves');

function config(env) {
  return {
    port: Number(env.PORT) || 3000,
    publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    resendKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || 'Streax <onboarding@resend.dev>',
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramBotUsername: (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    adminToken: env.ADMIN_TOKEN || '',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data')
  };
}

// onchain: the on-chain monitor state (or null). Members get personal alerts from its indexer.
function start(env, log, onchain) {
  if (env.ACCOUNTS === 'off') { log('Accounts: off (ACCOUNTS=off)'); return null; }
  const { AccountStore, available } = require('./store');
  if (!available) { log('Accounts: off. They need Node.js 22.5 or newer (built-in SQLite).'); return null; }
  const cfg = config(env);
  const store = new AccountStore(env.ACCOUNTS_DB || path.join(cfg.dataDir, 'accounts.db'));
  const casinos = require('./casinos.json');
  const tg = new TgBot(cfg, store, log);
  const state = { cfg, store, limiter: new Limiter(), tg, casinos, log, trackedCasinos: () => [] };
  if (onchain) {
    state.trackedCasinos = () => { try { return [...new Set(onchain.store.wallets().map(w => w.casino))]; } catch (e) { return []; } };
    const alerts = new PersonalAlerts(cfg, store, tg, log, () => onchain.store.casinoNames());
    const hooks = onchain.indexer.hooks;
    hooks.runStart.push(() => alerts.begin());
    hooks.transfer.push(t => alerts.onTransfer(t));
    hooks.runEnd.push(() => alerts.flush());
    state.alerts = alerts;
    const reserves = new ReserveWatch(cfg, store, tg, log, () => onchain.store.casinoNames());
    hooks.runEnd.push(() => reserves.check(onchain.store));
    state.reserves = reserves;
  }
  if (env.ACCOUNTS_TELEGRAM !== 'off') tg.start();
  setInterval(() => { try { store.prune(); } catch (e) { /* next time */ } }, 6 * 3600000).unref();
  const missing = [];
  if (!cfg.googleClientId || !cfg.googleClientSecret) missing.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google sign-in)');
  if (!cfg.resendKey) missing.push('RESEND_API_KEY (confirm emails, password reset, email alerts)');
  log('Accounts: on, database ' + path.join(cfg.dataDir, 'accounts.db') + (cfg.publicUrl ? ', site ' + cfg.publicUrl : ''));
  if (missing.length) log('Accounts: not set yet: ' + missing.join('; '));
  return state;
}

module.exports = { start, config };
