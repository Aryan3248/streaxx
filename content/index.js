'use strict';
// Articles: written in the Studio (/studio.html), published as real HTML pages under /articles for readers and search engines.

const path = require('path');

function start(env, log) {
  if (env.ARTICLES === 'off') { log('Articles: off (ARTICLES=off)'); return null; }
  const { ContentStore, available } = require('./store');
  if (!available) { log('Articles: off. They need Node.js 22.5 or newer (built-in SQLite).'); return null; }
  const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = new ContentStore(env.CONTENT_DB || path.join(dataDir, 'content.db'));
  const list = require('../accounts/casinos.json');
  const casinos = () => list.map(c => ({ slug: c.slug, name: c.name, domain: c.domain }));
  const byslug = {};
  list.forEach(c => { byslug[c.slug] = c.name; });
  const cfg = { adminToken: env.ADMIN_TOKEN || '' };
  if (env.SEED_ARTICLES !== 'off') { try { require('./seed').seed(store, log); } catch (e) { log('Articles: starter articles not added: ' + e.message); } }
  log('Articles: on, ' + store.all().length + ' in the database. Write them at /studio.html' + (cfg.adminToken ? '' : ' (set ADMIN_TOKEN first)'));
  return { cfg, store, log, casinos, casinoName: s => byslug[s] || s, uploadDir: env.UPLOAD_DIR || path.join(dataDir, 'uploads') };
}

module.exports = { start };
