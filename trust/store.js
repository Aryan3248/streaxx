'use strict';
// Complaints, payout reports and editorial casino reviews (SQLite built into Node.js 22.5+).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync = null;
try {
  const prev = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : prev.call(process, w, ...a));
  ({ DatabaseSync } = require('node:sqlite'));
  process.emitWarning = prev;
} catch (e) { DatabaseSync = null; }

const DAY = 86400000;
const FIRST_REPLY_DAYS = 7;
const FOLLOW_UP_DAYS = 14;

const CATEGORIES = [
  { id: 'withdrawal', name: 'Withdrawal delayed or refused' },
  { id: 'deposit', name: 'Deposit not credited' },
  { id: 'kyc', name: 'KYC or verification' },
  { id: 'account', name: 'Account closed or funds held' },
  { id: 'bonus', name: 'Bonus or promotion terms' },
  { id: 'fairness', name: 'Game fairness or RTP' },
  { id: 'rg', name: 'Self-exclusion or limits ignored' },
  { id: 'support', name: 'Support not answering' },
  { id: 'other', name: 'Something else' }
];

// review: Streax is checking it (only the player sees it). waiting: sent to the casino. proposed: the casino says it is fixed,
// waiting for the player. resolved / unresolved / rejected: closed.
const STATUSES = {
  review: { name: 'Being checked', closed: false, public: false },
  waiting: { name: 'Waiting for the casino', closed: false, public: true },
  proposed: { name: 'Casino says it is fixed', closed: false, public: true },
  resolved: { name: 'Resolved', closed: true, public: true },
  unresolved: { name: 'Unresolved', closed: true, public: true },
  rejected: { name: 'Rejected', closed: true, public: true }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, user_id INTEGER NOT NULL, user_name TEXT, casino TEXT NOT NULL, category TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, amount REAL, currency TEXT, chain TEXT, tx TEXT, tx_check TEXT, status TEXT NOT NULL DEFAULT 'review',
  created INTEGER, updated INTEGER, deadline INTEGER, closed_at INTEGER, outcome TEXT, reply_hash TEXT, casino_replied INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS complaints_casino ON complaints (casino, status);
CREATE INDEX IF NOT EXISTS complaints_user ON complaints (user_id);
CREATE TABLE IF NOT EXISTS complaint_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, complaint_id INTEGER NOT NULL, ts INTEGER, who TEXT, name TEXT, kind TEXT, body TEXT, status TEXT, private INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS events_c ON complaint_events (complaint_id, id);
CREATE TABLE IF NOT EXISTS payout_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, casino TEXT NOT NULL, amount REAL, chain TEXT, tx TEXT,
  requested_at INTEGER, received_at INTEGER, minutes REAL, status TEXT DEFAULT 'pending', note TEXT, matched INTEGER DEFAULT 0, created INTEGER,
  UNIQUE (chain, tx));
CREATE INDEX IF NOT EXISTS payouts_casino ON payout_reports (casino, status, created);
CREATE TABLE IF NOT EXISTS reviews (casino TEXT PRIMARY KEY, data TEXT, updated INTEGER, reviewer TEXT);
`;

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

class TrustStore {
  constructor(file) {
    if (!DatabaseSync) throw new Error('Complaints need Node.js 22.5 or newer (built-in SQLite).');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.q = {};
  }
  prep(sql) { return this.q[sql] || (this.q[sql] = this.db.prepare(sql)); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---------- complaints ----------
  createComplaint(c) {
    const now = Date.now();
    return this.tx(() => {
      const r = this.prep(`INSERT INTO complaints (user_id, user_name, casino, category, title, body, amount, currency, chain, tx, tx_check, status, created, updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'review',?,?)`).run(c.userId, c.userName, c.casino, c.category, c.title, c.body, c.amount ?? null, c.currency || 'USD', c.chain || '', c.tx || '', c.txCheck ? JSON.stringify(c.txCheck) : '', now, now);
      const id = Number(r.lastInsertRowid);
      const ref = 'SX-' + (1000 + id);
      this.prep('UPDATE complaints SET ref = ? WHERE id = ?').run(ref, id);
      this.event(id, 'player', c.userName, 'status', 'Complaint filed. Streax checks every complaint before it is sent to the casino, usually within 2 working days.', 'review');
      return this.complaint(id);
    });
  }
  complaint(id) { return this.prep('SELECT * FROM complaints WHERE id = ?').get(Number(id)) || null; }
  byRef(ref) { return this.prep('SELECT * FROM complaints WHERE ref = ?').get(String(ref).toUpperCase()) || null; }
  byReplyToken(token) { return token ? this.prep('SELECT * FROM complaints WHERE reply_hash = ?').get(sha(token)) || null : null; }
  events(id, includePrivate) {
    return this.prep('SELECT * FROM complaint_events WHERE complaint_id = ?' + (includePrivate ? '' : ' AND private = 0') + ' ORDER BY id').all(Number(id));
  }
  event(id, who, name, kind, body, status, priv) {
    this.prep('INSERT INTO complaint_events (complaint_id, ts, who, name, kind, body, status, private) VALUES (?,?,?,?,?,?,?,?)').run(Number(id), Date.now(), who, name || '', kind, body || '', status || '', priv ? 1 : 0);
    this.prep('UPDATE complaints SET updated = ? WHERE id = ?').run(Date.now(), Number(id));
  }
  setStatus(id, status, extra = {}) {
    const now = Date.now();
    const closed = STATUSES[status].closed;
    let deadline = extra.deadline;
    if (deadline === undefined) deadline = status === 'waiting' ? now + FIRST_REPLY_DAYS * DAY : status === 'proposed' ? now + FOLLOW_UP_DAYS * DAY : null;
    this.prep('UPDATE complaints SET status = ?, updated = ?, deadline = ?, closed_at = ?, outcome = COALESCE(?, outcome) WHERE id = ?')
      .run(status, now, deadline, closed ? now : null, extra.outcome ?? null, Number(id));
  }
  edit(id, fields) {
    const keys = Object.keys(fields).filter(k => ['title', 'body', 'category', 'amount'].includes(k));
    if (!keys.length) return;
    this.db.prepare('UPDATE complaints SET ' + keys.map(k => k + ' = ?').join(', ') + ', updated = ? WHERE id = ?').run(...keys.map(k => fields[k]), Date.now(), Number(id));
  }
  newReplyToken(id) {
    const t = crypto.randomBytes(24).toString('base64url');
    this.prep('UPDATE complaints SET reply_hash = ? WHERE id = ?').run(sha(t), Number(id));
    return t;
  }
  casinoReplied(id) {
    this.prep('UPDATE complaints SET casino_replied = 1, deadline = ? WHERE id = ? AND status = \'waiting\'').run(Date.now() + FOLLOW_UP_DAYS * DAY, Number(id));
  }
  list(opts = {}) {
    const where = [], args = [];
    if (opts.publicOnly) where.push("status != 'review'");
    if (opts.casino) { where.push('casino = ?'); args.push(opts.casino); }
    if (opts.status) { where.push('status = ?'); args.push(opts.status); }
    if (opts.open) where.push("status IN ('review','waiting','proposed')");
    if (opts.userId) { where.push('user_id = ?'); args.push(Number(opts.userId)); }
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(200, Math.max(1, opts.limit || 20)), offset = Math.max(0, opts.offset || 0);
    return {
      rows: this.db.prepare('SELECT * FROM complaints' + w + ' ORDER BY updated DESC LIMIT ? OFFSET ?').all(...args, limit, offset),
      total: this.db.prepare('SELECT COUNT(*) AS n FROM complaints' + w).get(...args).n
    };
  }
  // Counts per status for one casino (or all), public statuses only.
  counts(casino) {
    const rows = casino
      ? this.prep("SELECT status, COUNT(*) AS n, SUM(COALESCE(amount,0)) AS amt FROM complaints WHERE casino = ? AND status != 'review' GROUP BY status").all(casino)
      : this.prep("SELECT status, COUNT(*) AS n, SUM(COALESCE(amount,0)) AS amt FROM complaints WHERE status != 'review' GROUP BY status").all();
    const out = { total: 0, open: 0, resolved: 0, unresolved: 0, rejected: 0, waiting: 0, proposed: 0, amountResolved: 0 };
    rows.forEach(r => { out[r.status] = r.n; if (r.status !== 'rejected') out.total += r.n; if (r.status === 'waiting' || r.status === 'proposed') out.open += r.n; if (r.status === 'resolved') out.amountResolved = r.amt || 0; });
    return out;
  }
  countsByCasino() {
    const m = {};
    this.prep("SELECT casino, status, COUNT(*) AS n FROM complaints WHERE status != 'review' GROUP BY casino, status").all().forEach(r => {
      const c = m[r.casino] || (m[r.casino] = { total: 0, open: 0, resolved: 0, unresolved: 0, rejected: 0 });
      c[r.status] = (c[r.status] || 0) + r.n;
      if (r.status !== 'rejected') c.total += r.n;
      if (r.status === 'waiting' || r.status === 'proposed') c.open += r.n;
    });
    return m;
  }
  pendingReviewCount() { return this.prep("SELECT COUNT(*) AS n FROM complaints WHERE status = 'review'").get().n; }
  createdSince(userId, since) { return this.prep('SELECT COUNT(*) AS n FROM complaints WHERE user_id = ? AND created > ?').get(Number(userId), since).n; }

  // Deadlines: no casino answer in time closes a complaint as unresolved; a casino fix the player never answers closes as resolved.
  sweep() {
    const now = Date.now();
    const late = this.prep("SELECT * FROM complaints WHERE status IN ('waiting','proposed') AND deadline IS NOT NULL AND deadline < ?").all(now);
    late.forEach(c => {
      if (c.status === 'waiting') {
        this.setStatus(c.id, 'unresolved', { outcome: c.casino_replied ? 'The casino stopped replying before the issue was fixed.' : 'The casino did not reply within ' + FIRST_REPLY_DAYS + ' days.' });
        this.event(c.id, 'streax', 'Streax', 'status', c.casino_replied ? 'Closed as unresolved: the casino stopped replying before the issue was fixed.' : 'Closed as unresolved: the casino did not reply within ' + FIRST_REPLY_DAYS + ' days.', 'unresolved');
      } else {
        this.setStatus(c.id, 'resolved', { outcome: 'The casino reported a fix and the player did not dispute it within ' + FOLLOW_UP_DAYS + ' days.' });
        this.event(c.id, 'streax', 'Streax', 'status', 'Closed as resolved: the casino reported a fix and the player did not dispute it within ' + FOLLOW_UP_DAYS + ' days.', 'resolved');
      }
    });
    return late.length;
  }

  // ---------- payout reports ----------
  addPayout(p) {
    const r = this.prep(`INSERT INTO payout_reports (user_id, casino, amount, chain, tx, requested_at, received_at, minutes, status, note, matched, created)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.userId, p.casino, p.amount ?? null, p.chain, p.tx, p.requestedAt, p.receivedAt ?? null, p.minutes ?? null, p.status || 'pending', p.note || '', p.matched ? 1 : 0, Date.now());
    return this.prep('SELECT * FROM payout_reports WHERE id = ?').get(Number(r.lastInsertRowid));
  }
  payoutByTx(chain, tx) { return this.prep('SELECT * FROM payout_reports WHERE chain = ? AND tx = ?').get(chain, tx) || null; }
  payout(id) { return this.prep('SELECT * FROM payout_reports WHERE id = ?').get(Number(id)) || null; }
  setPayout(id, fields) {
    const keys = Object.keys(fields).filter(k => ['status', 'received_at', 'minutes', 'note'].includes(k));
    if (keys.length) this.db.prepare('UPDATE payout_reports SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ?').run(...keys.map(k => fields[k]), Number(id));
  }
  payouts(opts = {}) {
    const where = [], args = [];
    if (opts.casino) { where.push('casino = ?'); args.push(opts.casino); }
    if (opts.status) { where.push('status = ?'); args.push(opts.status); }
    if (opts.userId) { where.push('user_id = ?'); args.push(Number(opts.userId)); }
    if (opts.since) { where.push('created > ?'); args.push(opts.since); }
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    return this.db.prepare('SELECT * FROM payout_reports' + w + ' ORDER BY created DESC LIMIT ?').all(...args, Math.min(500, opts.limit || 50));
  }
  // Median minutes over approved reports from the last 90 days.
  payoutStats(casino) {
    const rows = this.prep("SELECT minutes FROM payout_reports WHERE casino = ? AND status = 'approved' AND minutes IS NOT NULL AND created > ? ORDER BY minutes").all(casino, Date.now() - 90 * DAY);
    const n = rows.length;
    if (!n) return { count: 0, median: null, fastest: null, slowest: null };
    const v = rows.map(r => r.minutes);
    const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    return { count: n, median, fastest: v[0], slowest: v[n - 1] };
  }
  payoutStatsAll() {
    const m = {};
    [...new Set(this.prep("SELECT DISTINCT casino FROM payout_reports WHERE status = 'approved'").all().map(r => r.casino))].forEach(c => { m[c] = this.payoutStats(c); });
    return m;
  }
  payoutsSince(userId, since) { return this.prep('SELECT COUNT(*) AS n FROM payout_reports WHERE user_id = ? AND created > ?').get(Number(userId), since).n; }

  // ---------- reviews ----------
  review(casino) {
    const r = this.prep('SELECT * FROM reviews WHERE casino = ?').get(casino);
    if (!r) return null;
    try { return Object.assign(JSON.parse(r.data), { updated: r.updated, reviewer: r.reviewer }); } catch (e) { return null; }
  }
  reviews() {
    const m = {};
    this.prep('SELECT * FROM reviews').all().forEach(r => { try { m[r.casino] = Object.assign(JSON.parse(r.data), { updated: r.updated, reviewer: r.reviewer }); } catch (e) { /* skip */ } });
    return m;
  }
  saveReview(casino, data, reviewer) {
    this.prep('INSERT INTO reviews (casino, data, updated, reviewer) VALUES (?,?,?,?) ON CONFLICT(casino) DO UPDATE SET data = excluded.data, updated = excluded.updated, reviewer = excluded.reviewer')
      .run(casino, JSON.stringify(data), Date.now(), reviewer || '');
    return this.review(casino);
  }
}

module.exports = { TrustStore, CATEGORIES, STATUSES, FIRST_REPLY_DAYS, FOLLOW_UP_DAYS, available: !!DatabaseSync };
