'use strict';
// Storage for the on-chain monitor. Uses the SQLite engine built into Node.js 22 (no install step).
// Flows are kept as hourly totals, so the database stays small even for wallets with thousands of transfers a day.

const fs = require('fs');
const path = require('path');
const { norm, hourOf, dayOf } = require('./util');

let DatabaseSync;
try {
  const prev = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : prev.call(process, w, ...a));
  ({ DatabaseSync } = require('node:sqlite'));
  process.emitWarning = prev;
} catch (e) {
  DatabaseSync = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL, casino TEXT NOT NULL, label TEXT, role TEXT DEFAULT 'wallet',
  source TEXT, added INTEGER, active INTEGER DEFAULT 1, PRIMARY KEY (chain, address));
CREATE TABLE IF NOT EXISTS casinos (slug TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT, updated INTEGER);
CREATE TABLE IF NOT EXISTS seen (k TEXT PRIMARY KEY, ts INTEGER);
CREATE TABLE IF NOT EXISTS flows (
  hour INTEGER, casino TEXT, chain TEXT, asset TEXT, dir TEXT, internal INTEGER,
  n INTEGER, amount REAL, usd REAL, PRIMARY KEY (hour, casino, chain, asset, dir, internal));
CREATE TABLE IF NOT EXISTS cps (day TEXT, casino TEXT, dir TEXT, cp TEXT, PRIMARY KEY (day, casino, dir, cp));
CREATE TABLE IF NOT EXISTS transfers (
  chain TEXT, tx TEXT, idx TEXT, wallet TEXT, ts INTEGER, casino TEXT, dir TEXT, cp TEXT, asset TEXT,
  amount REAL, usd REAL, internal INTEGER, alerted INTEGER DEFAULT 0, PRIMARY KEY (chain, tx, idx, wallet));
CREATE INDEX IF NOT EXISTS transfers_ts ON transfers (ts);
CREATE INDEX IF NOT EXISTS transfers_casino ON transfers (casino, ts);
CREATE TABLE IF NOT EXISTS balances (
  chain TEXT, address TEXT, asset TEXT, amount REAL, usd REAL, ts INTEGER, PRIMARY KEY (chain, address, asset));
CREATE TABLE IF NOT EXISTS balance_days (day TEXT, casino TEXT, chain TEXT, usd REAL, PRIMARY KEY (day, casino, chain));
CREATE TABLE IF NOT EXISTS token_days (
  day TEXT, sym TEXT, supply REAL, dead REAL, holders INTEGER, price REAL, liquidity REAL, vol24 REAL,
  buys24 INTEGER, sells24 INTEGER, PRIMARY KEY (day, sym));
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started INTEGER, finished INTEGER, ok INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS source_state (source TEXT PRIMARY KEY, ok INTEGER, last_ok INTEGER, last_error TEXT, error_at INTEGER, calls INTEGER DEFAULT 0);
`;

class Store {
  constructor(file) {
    if (!DatabaseSync) throw new Error('The on-chain monitor needs Node.js 22.5 or newer (built-in SQLite).');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.q = {};
  }
  prep(sql) { return this.q[sql] || (this.q[sql] = this.db.prepare(sql)); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // Wallet registry: the JSON seed is merged in on every start; wallets added from the admin tool live only here.
  seed(registry) {
    const ins = this.prep(`INSERT INTO wallets (chain, address, casino, label, role, source, added, active) VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(chain, address) DO UPDATE SET label = excluded.label, role = excluded.role, source = excluded.source`);
    const name = this.prep('INSERT INTO casinos (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name');
    const mirror = this.prep(`INSERT OR IGNORE INTO wallets (chain, address, casino, label, role, source, added, active) VALUES (?,?,?,?,?,?,?,1)`);
    let n = 0;
    this.tx(() => {
      Object.entries(registry.casinos || {}).forEach(([slug, c]) => {
        name.run(slug, c.name || slug);
        (c.wallets || []).forEach(w => {
          const a = norm(w.chain, w.address);
          ins.run(w.chain, a, slug, w.label || '', w.role || 'wallet', w.source || 'registry', Date.now());
          n++;
          // EVM wallets often reuse one address on BNB Chain and Polygon. Balances there are read for free over RPC.
          if (w.chain === 'ethereum' && w.role !== 'funder') {
            ['bsc', 'polygon'].forEach(ch => mirror.run(ch, a, slug, (w.label || '') + ' (same address)', w.role || 'wallet', 'mirror', Date.now()));
          }
        });
      });
    });
    return n;
  }
  setCasinoName(slug, name) { this.prep('INSERT INTO casinos (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name').run(slug, name); }
  casinoNames() { const m = {}; this.prep('SELECT slug, name FROM casinos').all().forEach(r => { m[r.slug] = r.name; }); return m; }
  addWallet(w) {
    this.prep(`INSERT INTO wallets (chain, address, casino, label, role, source, added, active) VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(chain, address) DO UPDATE SET casino = excluded.casino, label = excluded.label, role = excluded.role, source = excluded.source, active = 1`)
      .run(w.chain, norm(w.chain, w.address), w.casino, w.label || '', w.role || 'wallet', w.source || 'admin', Date.now());
  }
  removeWallet(chain, address) {
    return this.prep('UPDATE wallets SET active = 0 WHERE chain = ? AND address = ?').run(chain, norm(chain, address)).changes;
  }
  wallets(activeOnly = true) {
    return this.prep('SELECT * FROM wallets' + (activeOnly ? ' WHERE active = 1' : '') + ' ORDER BY casino, chain, role, label').all();
  }

  cursor(key) { const r = this.prep('SELECT value FROM cursors WHERE key = ?').get(key); return r ? r.value : null; }
  setCursor(key, value) {
    this.prep('INSERT INTO cursors (key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated')
      .run(key, String(value), Date.now());
  }

  // Record normalized transfers. Returns the new ones (not seen before) so callers can alert on them.
  record(list, opts = {}) {
    const storeMin = opts.storeMinUsd != null ? opts.storeMinUsd : 1000;
    const seenQ = this.prep('INSERT OR IGNORE INTO seen (k, ts) VALUES (?, ?)');
    const flowQ = this.prep(`INSERT INTO flows (hour, casino, chain, asset, dir, internal, n, amount, usd) VALUES (?,?,?,?,?,?,1,?,?)
      ON CONFLICT(hour, casino, chain, asset, dir, internal) DO UPDATE SET n = n + 1, amount = amount + excluded.amount, usd = usd + excluded.usd`);
    const cpQ = this.prep('INSERT OR IGNORE INTO cps (day, casino, dir, cp) VALUES (?,?,?,?)');
    const trQ = this.prep(`INSERT OR IGNORE INTO transfers (chain, tx, idx, wallet, ts, casino, dir, cp, asset, amount, usd, internal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const fresh = [];
    this.tx(() => {
      list.forEach(t => {
        const k = t.chain + '|' + t.tx + '|' + t.idx + '|' + t.wallet;
        if (seenQ.run(k, t.ts).changes === 0) return;
        fresh.push(t);
        const usd = Number.isFinite(t.usd) ? t.usd : 0;
        flowQ.run(hourOf(t.ts), t.casino, t.chain, t.asset, t.dir, t.internal ? 1 : 0, t.amount, usd);
        if (!t.internal && t.cp) cpQ.run(dayOf(t.ts), t.casino, t.dir, t.cp);
        if (!t.internal && usd >= storeMin) trQ.run(t.chain, t.tx, t.idx, t.wallet, t.ts, t.casino, t.dir, t.cp || '', t.asset, t.amount, usd, 0);
      });
    });
    return fresh;
  }
  markAlerted(t) { this.prep('UPDATE transfers SET alerted = 1 WHERE chain = ? AND tx = ? AND idx = ? AND wallet = ?').run(t.chain, t.tx, t.idx, t.wallet); }

  setBalance(chain, address, asset, amount, usd) {
    this.prep(`INSERT INTO balances (chain, address, asset, amount, usd, ts) VALUES (?,?,?,?,?,?)
      ON CONFLICT(chain, address, asset) DO UPDATE SET amount = excluded.amount, usd = excluded.usd, ts = excluded.ts`)
      .run(chain, norm(chain, address), asset, amount, usd, Date.now());
  }
  // One row per casino and chain per day, from the latest balances.
  rollBalanceDay() {
    const day = dayOf(Date.now());
    const rows = this.prep(`SELECT w.casino, b.chain, SUM(b.usd) AS usd FROM balances b JOIN wallets w ON w.chain = b.chain AND w.address = b.address
      WHERE w.active = 1 AND w.role != 'funder' GROUP BY w.casino, b.chain`).all();
    const q = this.prep('INSERT INTO balance_days (day, casino, chain, usd) VALUES (?,?,?,?) ON CONFLICT(day, casino, chain) DO UPDATE SET usd = excluded.usd');
    this.tx(() => rows.forEach(r => q.run(day, r.casino, r.chain, r.usd || 0)));
  }
  setTokenDay(row) {
    this.prep(`INSERT INTO token_days (day, sym, supply, dead, holders, price, liquidity, vol24, buys24, sells24) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(day, sym) DO UPDATE SET supply = COALESCE(excluded.supply, supply), dead = COALESCE(excluded.dead, dead), holders = COALESCE(excluded.holders, holders),
      price = COALESCE(excluded.price, price), liquidity = COALESCE(excluded.liquidity, liquidity), vol24 = COALESCE(excluded.vol24, vol24),
      buys24 = COALESCE(excluded.buys24, buys24), sells24 = COALESCE(excluded.sells24, sells24)`)
      .run(row.day, row.sym, row.supply ?? null, row.dead ?? null, row.holders ?? null, row.price ?? null, row.liquidity ?? null, row.vol24 ?? null, row.buys24 ?? null, row.sells24 ?? null);
  }

  source(name, ok, err) {
    if (ok) this.prep(`INSERT INTO source_state (source, ok, last_ok, calls) VALUES (?,1,?,1) ON CONFLICT(source) DO UPDATE SET ok = 1, last_ok = excluded.last_ok, calls = calls + 1`).run(name, Date.now());
    else this.prep(`INSERT INTO source_state (source, ok, last_error, error_at, calls) VALUES (?,0,?,?,1) ON CONFLICT(source) DO UPDATE SET ok = 0, last_error = excluded.last_error, error_at = excluded.error_at, calls = calls + 1`)
      .run(name, String(err && err.message || err).slice(0, 300), Date.now());
  }
  sources() { return this.prep('SELECT * FROM source_state ORDER BY source').all(); }
  runStart() { return Number(this.prep('INSERT INTO runs (started, ok) VALUES (?, 0)').run(Date.now()).lastInsertRowid); }
  runEnd(id, ok, note) { this.prep('UPDATE runs SET finished = ?, ok = ?, note = ? WHERE id = ?').run(Date.now(), ok ? 1 : 0, note || '', id); }
  lastRuns(n = 5) { return this.prep('SELECT * FROM runs WHERE finished IS NOT NULL ORDER BY id DESC LIMIT ?').all(n); }

  prune() {
    const now = Date.now();
    this.prep('DELETE FROM seen WHERE ts < ?').run(now - 4 * 86400000);
    this.prep('DELETE FROM flows WHERE hour < ?').run(now - 120 * 86400000);
    this.prep('DELETE FROM cps WHERE day < ?').run(dayOf(now - 35 * 86400000));
    this.prep('DELETE FROM transfers WHERE ts < ?').run(now - 35 * 86400000);
    this.prep('DELETE FROM runs WHERE id < (SELECT MAX(id) - 500 FROM runs)').run();
  }
}

module.exports = { Store, available: !!DatabaseSync };
