'use strict';
// Trust layer: player complaints with on-chain proof, payout time reports, editorial casino reviews and the Streax Score.

const path = require('path');
const { Limiter } = require('../accounts/http');

function start(env, log, deps = {}) {
  if (env.COMPLAINTS === 'off') { log('Complaints and scores: off (COMPLAINTS=off)'); return null; }
  const { TrustStore, available } = require('./store');
  if (!available) { log('Complaints and scores: off. They need Node.js 22.5 or newer (built-in SQLite).'); return null; }
  const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = new TrustStore(env.TRUST_DB || path.join(dataDir, 'trust.db'));
  const list = require('../accounts/casinos.json');
  const names = {};
  list.forEach(c => { names[c.slug] = c.name; });
  const onchain = deps.onchain || null;
  if (onchain) {
    try { onchain.store.db.exec('CREATE INDEX IF NOT EXISTS cps_cp ON cps (cp, dir)'); } catch (e) { /* older database: lookups are slower */ }
    try { Object.assign(names, onchain.store.casinoNames()); list.forEach(c => { names[c.slug] = c.name; }); } catch (e) { /* keep the list */ }
  }
  const state = {
    cfg: { adminToken: env.ADMIN_TOKEN || '' }, store, log, onchain, accounts: deps.accounts || null, content: deps.content || null,
    limiter: (deps.accounts && deps.accounts.limiter) || new Limiter(),
    casinos: () => list.map(c => ({ slug: c.slug, name: c.name, domain: c.domain })),
    casinoName: s => names[s] || s,
    knownCasino: s => Object.prototype.hasOwnProperty.call(names, s)
  };
  const sweep = () => { try { const n = store.sweep(); if (n) log('Complaints: ' + n + ' closed after their deadline'); } catch (e) { log('Complaints sweep: ' + e.message); } };
  sweep();
  setInterval(sweep, 30 * 60000).unref();
  const pending = store.pendingReviewCount();
  log('Complaints and scores: on' + (pending ? ', ' + pending + ' complaint(s) waiting for your check in the Studio' : ''));
  return state;
}

module.exports = { start };
