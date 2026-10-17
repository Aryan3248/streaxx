'use strict';
// Accounts database (SQLite built into Node.js 22.5+). Passwords are scrypt hashes; session and email tokens
// are stored only as SHA-256 hashes, so a copy of the database cannot be used to log in.

const fs = require('fs');
const path = require('path');
const { sha256, token, refCode } = require('./secure');

let DatabaseSync = null;
try {
  const prev = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : prev.call(process, w, ...a));
  ({ DatabaseSync } = require('node:sqlite'));
  process.emitWarning = prev;
} catch (e) { DatabaseSync = null; }

const DAY = 86400000;
const SESSION_MS = 30 * DAY;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT, pass TEXT, google_sub TEXT UNIQUE, avatar TEXT,
  verified INTEGER DEFAULT 0, ref_code TEXT NOT NULL UNIQUE, referred_by INTEGER, ref_credited INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
  adult INTEGER DEFAULT 0, marketing INTEGER DEFAULT 0, created INTEGER, last_login INTEGER, signup_ip TEXT,
  alert_min INTEGER DEFAULT 50000, alert_email INTEGER DEFAULT 1, alert_tg INTEGER DEFAULT 1, tg_chat TEXT, tg_name TEXT);
CREATE INDEX IF NOT EXISTS users_ref ON users (referred_by);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER, expires INTEGER, ua TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, expires INTEGER);
CREATE TABLE IF NOT EXISTS watchlist (user_id INTEGER NOT NULL, slug TEXT NOT NULL, created INTEGER, PRIMARY KEY (user_id, slug));
CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER, reason TEXT, ts INTEGER, UNIQUE (user_id, reason));
CREATE TABLE IF NOT EXISTS codes (id INTEGER PRIMARY KEY AUTOINCREMENT, casino TEXT, title TEXT, code TEXT, url TEXT, terms TEXT,
  level TEXT DEFAULT 'member', expires INTEGER, active INTEGER DEFAULT 1, created INTEGER);
CREATE TABLE IF NOT EXISTS reveals (user_id INTEGER NOT NULL, code_id INTEGER NOT NULL, ts INTEGER, PRIMARY KEY (user_id, code_id));
CREATE TABLE IF NOT EXISTS alerts_sent (user_id INTEGER NOT NULL, k TEXT NOT NULL, ts INTEGER, PRIMARY KEY (user_id, k));
`;

const EDITABLE = ['name', 'pass', 'google_sub', 'avatar', 'verified', 'ref_credited', 'last_login', 'alert_min', 'alert_email', 'alert_tg', 'tg_chat', 'tg_name', 'marketing', 'adult'];

class AccountStore {
  constructor(file) {
    if (!DatabaseSync) throw new Error('Accounts need Node.js 22.5 or newer (built-in SQLite).');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
    this.db.exec(SCHEMA);
    this.q = {};
  }
  prep(sql) { return this.q[sql] || (this.q[sql] = this.db.prepare(sql)); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // users
  createUser(u) {
    for (let i = 0; i < 6; i++) {
      const code = refCode();
      try {
        const r = this.prep(`INSERT INTO users (email, name, pass, google_sub, avatar, verified, ref_code, referred_by, adult, marketing, created, last_login, signup_ip)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(u.email, u.name || '', u.pass || null, u.googleSub || null, u.avatar || null, u.verified ? 1 : 0, code,
          u.referredBy || null, u.adult ? 1 : 0, u.marketing ? 1 : 0, Date.now(), Date.now(), u.ip || null);
        return Number(r.lastInsertRowid);
      } catch (e) {
        if (/ref_code/.test(e.message)) continue;
        throw e;
      }
    }
    throw new Error('Could not create a referral code');
  }
  user(id) { return this.prep('SELECT * FROM users WHERE id = ?').get(id) || null; }
  userByEmail(email) { return this.prep('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase()) || null; }
  userByGoogle(sub) { return this.prep('SELECT * FROM users WHERE google_sub = ?').get(String(sub)) || null; }
  userByRef(code) { return this.prep('SELECT * FROM users WHERE ref_code = ?').get(String(code || '').toUpperCase()) || null; }
  userByTelegram(chat) { return this.prep('SELECT * FROM users WHERE tg_chat = ?').get(String(chat)) || null; }
  update(id, fields) {
    const keys = Object.keys(fields).filter(k => EDITABLE.includes(k));
    if (!keys.length) return;
    this.prep('UPDATE users SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ?').run(...keys.map(k => fields[k]), id);
  }
  deleteUser(id) {
    this.tx(() => {
      ['sessions', 'tokens', 'watchlist', 'points_log', 'reveals', 'alerts_sent'].forEach(t => this.prep('DELETE FROM ' + t + ' WHERE user_id = ?').run(id));
      this.prep('UPDATE users SET referred_by = NULL WHERE referred_by = ?').run(id);
      this.prep('DELETE FROM users WHERE id = ?').run(id);
    });
  }

  // sessions: the browser holds the token, the database only its hash
  createSession(userId, ua) {
    const raw = token(32);
    this.prep('INSERT INTO sessions (token, user_id, created, expires, ua) VALUES (?,?,?,?,?)').run(sha256(raw), userId, Date.now(), Date.now() + SESSION_MS, String(ua || '').slice(0, 200));
    return raw;
  }
  sessionUser(raw) {
    if (!raw || raw.length < 20) return null;
    const h = sha256(raw);
    const s = this.prep('SELECT * FROM sessions WHERE token = ?').get(h);
    if (!s) return null;
    if (s.expires < Date.now()) { this.prep('DELETE FROM sessions WHERE token = ?').run(h); return null; }
    if (s.expires - Date.now() < SESSION_MS - DAY) this.prep('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SESSION_MS, h);
    return this.user(s.user_id);
  }
  deleteSession(raw) { if (raw) this.prep('DELETE FROM sessions WHERE token = ?').run(sha256(raw)); }
  deleteOtherSessions(userId, keepRaw) { this.prep('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, sha256(keepRaw || '')); }

  // one-time tokens: email confirmation, password reset, Telegram link codes
  createToken(userId, kind, ttlMs) {
    const raw = kind === 'tg' ? token(15) : token(32);
    this.prep('DELETE FROM tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
    this.prep('INSERT INTO tokens (token, user_id, kind, expires) VALUES (?,?,?,?)').run(sha256(raw), userId, kind, Date.now() + ttlMs);
    return raw;
  }
  useToken(raw, kind) {
    if (!raw) return null;
    const h = sha256(raw);
    const t = this.prep('SELECT * FROM tokens WHERE token = ? AND kind = ?').get(h, kind);
    if (!t) return null;
    this.prep('DELETE FROM tokens WHERE token = ?').run(h);
    return t.expires >= Date.now() ? t.user_id : null;
  }

  // points: each reason is paid once per account
  award(userId, reason, pts) {
    return this.tx(() => {
      const r = this.prep('INSERT OR IGNORE INTO points_log (user_id, delta, reason, ts) VALUES (?,?,?,?)').run(userId, pts, reason, Date.now());
      if (!r.changes) return false;
      this.prep('UPDATE users SET points = points + ? WHERE id = ?').run(pts, userId);
      return true;
    });
  }
  pointsLog(userId, n = 20) { return this.prep('SELECT delta, reason, ts FROM points_log WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId, n); }
  referralsSince(userId, ts) { return this.prep("SELECT COUNT(*) AS n FROM points_log WHERE user_id = ? AND reason LIKE 'referral:%' AND ts >= ?").get(userId, ts).n; }
  referralStats(userId) {
    const r = this.prep('SELECT COUNT(*) AS joined, SUM(ref_credited) AS credited FROM users WHERE referred_by = ?').get(userId);
    const p = this.prep("SELECT COALESCE(SUM(delta), 0) AS pts FROM points_log WHERE user_id = ? AND reason LIKE 'referral:%'").get(userId);
    return { joined: r.joined || 0, credited: r.credited || 0, points: p.pts || 0 };
  }

  // watchlist
  watchlist(userId) { return this.prep('SELECT slug FROM watchlist WHERE user_id = ? ORDER BY created').all(userId).map(r => r.slug); }
  setWatch(userId, slug, on) {
    if (on) this.prep('INSERT OR IGNORE INTO watchlist (user_id, slug, created) VALUES (?,?,?)').run(userId, slug, Date.now());
    else this.prep('DELETE FROM watchlist WHERE user_id = ? AND slug = ?').run(userId, slug);
  }
  // Everyone who wants alerts for a casino, with their settings.
  watchers() {
    const m = new Map();
    this.prep(`SELECT w.slug, u.id, u.email, u.name, u.verified, u.alert_min, u.alert_email, u.alert_tg, u.tg_chat FROM watchlist w JOIN users u ON u.id = w.user_id
      WHERE (u.alert_email = 1 AND u.verified = 1) OR (u.alert_tg = 1 AND u.tg_chat IS NOT NULL)`).all()
      .forEach(r => { if (!m.has(r.slug)) m.set(r.slug, []); m.get(r.slug).push(r); });
    return m;
  }
  alertOnce(userId, key) { return this.prep('INSERT OR IGNORE INTO alerts_sent (user_id, k, ts) VALUES (?,?,?)').run(userId, key, Date.now()).changes > 0; }

  // member bonus codes
  codes(activeOnly) {
    return this.prep('SELECT * FROM codes' + (activeOnly ? ' WHERE active = 1 AND (expires IS NULL OR expires > ?)' : ' WHERE ? > 0') + ' ORDER BY id DESC').all(Date.now());
  }
  code(id) { return this.prep('SELECT * FROM codes WHERE id = ?').get(id) || null; }
  addCode(c) {
    return Number(this.prep('INSERT INTO codes (casino, title, code, url, terms, level, expires, active, created) VALUES (?,?,?,?,?,?,?,1,?)')
      .run(c.casino, c.title, c.code, c.url || '', c.terms || '', c.level || 'member', c.expires || null, Date.now()).lastInsertRowid);
  }
  setCodeActive(id, on) { return this.prep('UPDATE codes SET active = ? WHERE id = ?').run(on ? 1 : 0, id).changes; }
  deleteCode(id) { this.prep('DELETE FROM reveals WHERE code_id = ?').run(id); return this.prep('DELETE FROM codes WHERE id = ?').run(id).changes; }
  reveal(userId, codeId) { this.prep('INSERT OR IGNORE INTO reveals (user_id, code_id, ts) VALUES (?,?,?)').run(userId, codeId, Date.now()); }
  revealed(userId) { return new Set(this.prep('SELECT code_id FROM reveals WHERE user_id = ?').all(userId).map(r => r.code_id)); }
  revealCounts() { const m = {}; this.prep('SELECT code_id, COUNT(*) AS n FROM reveals GROUP BY code_id').all().forEach(r => { m[r.code_id] = r.n; }); return m; }

  stats() {
    const one = (sql, ...a) => this.prep(sql).get(...a).n;
    const week = Date.now() - 7 * DAY;
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      signups7d: one('SELECT COUNT(*) AS n FROM users WHERE created >= ?', week),
      verified: one('SELECT COUNT(*) AS n FROM users WHERE verified = 1'),
      google: one('SELECT COUNT(*) AS n FROM users WHERE google_sub IS NOT NULL'),
      referred: one('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL'),
      telegram: one('SELECT COUNT(*) AS n FROM users WHERE tg_chat IS NOT NULL'),
      watching: one('SELECT COUNT(DISTINCT user_id) AS n FROM watchlist'),
      reveals: one('SELECT COUNT(*) AS n FROM reveals')
    };
  }
  prune() {
    const now = Date.now();
    this.prep('DELETE FROM sessions WHERE expires < ?').run(now);
    this.prep('DELETE FROM tokens WHERE expires < ?').run(now);
    this.prep('DELETE FROM alerts_sent WHERE ts < ?').run(now - 14 * DAY);
  }
}

module.exports = { AccountStore, available: !!DatabaseSync };
