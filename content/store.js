'use strict';
// Articles database (SQLite built into Node.js 22.5+). One row per article; images live in DATA_DIR/uploads.

const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  const prev = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : prev.call(process, w, ...a));
  ({ DatabaseSync } = require('node:sqlite'));
  process.emitWarning = prev;
} catch (e) { DatabaseSync = null; }

const CATEGORIES = [
  { id: 'news', name: 'News', blurb: 'What changed this week across crypto casinos.' },
  { id: 'investigations', name: 'Investigations', blurb: 'Deep dives built on on-chain evidence.' },
  { id: 'guides', name: 'Guides', blurb: 'Plain-English help for players: bonuses, fairness, withdrawals.' },
  { id: 'reports', name: 'Reports', blurb: 'Weekly and monthly numbers from the Streax monitor.' }
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, dek TEXT, body TEXT,
  cover TEXT, cover_alt TEXT, category TEXT DEFAULT 'news', tags TEXT, author TEXT, author_role TEXT,
  status TEXT DEFAULT 'draft', featured INTEGER DEFAULT 0, seo_title TEXT, seo_desc TEXT, keyword TEXT, casinos TEXT,
  created INTEGER, updated INTEGER, published_at INTEGER, views INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS articles_pub ON articles (status, published_at);
CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL UNIQUE, mime TEXT, size INTEGER, w INTEGER, h INTEGER, created INTEGER);
`;

const FIELDS = ['slug', 'title', 'dek', 'body', 'cover', 'cover_alt', 'category', 'tags', 'author', 'author_role', 'status', 'featured', 'seo_title', 'seo_desc', 'keyword', 'casinos', 'published_at'];

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

class ContentStore {
  constructor(file) {
    if (!DatabaseSync) throw new Error('Articles need Node.js 22.5 or newer (built-in SQLite).');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.q = {};
  }
  prep(sql) { return this.q[sql] || (this.q[sql] = this.db.prepare(sql)); }

  get(id) { return this.prep('SELECT * FROM articles WHERE id = ?').get(Number(id)) || null; }
  bySlug(slug) { return this.prep('SELECT * FROM articles WHERE slug = ?').get(String(slug)) || null; }
  all() { return this.prep('SELECT id, slug, title, dek, cover, category, tags, author, status, featured, casinos, created, updated, published_at, views, length(body) AS chars FROM articles ORDER BY COALESCE(published_at, updated) DESC').all(); }

  // Published articles, newest first. Scheduled ones (published_at in the future) stay hidden until their time.
  published(opts = {}) {
    const now = Date.now();
    const where = ['status = \'published\'', 'published_at <= ?'];
    const args = [now];
    if (opts.category) { where.push('category = ?'); args.push(opts.category); }
    if (opts.casino) { where.push("(',' || casinos || ',') LIKE ?"); args.push('%,' + opts.casino + ',%'); }
    if (opts.tag) { where.push("(',' || lower(tags) || ',') LIKE ?"); args.push('%,' + String(opts.tag).toLowerCase() + ',%'); }
    if (opts.exclude) { where.push('id != ?'); args.push(Number(opts.exclude)); }
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const offset = Math.max(0, opts.offset || 0);
    const rows = this.db.prepare('SELECT * FROM articles WHERE ' + where.join(' AND ') + ' ORDER BY published_at DESC LIMIT ? OFFSET ?').all(...args, limit, offset);
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM articles WHERE ' + where.join(' AND ')).get(...args).n;
    return { rows, total };
  }
  categoryCounts() {
    const m = {};
    this.prep("SELECT category, COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at <= ? GROUP BY category").all(Date.now()).forEach(r => { m[r.category] = r.n; });
    return m;
  }

  uniqueSlug(base, id) {
    let s = slugify(base) || 'article';
    let n = 2;
    const root = s;
    for (;;) {
      const r = this.bySlug(s);
      if (!r || (id && r.id === Number(id))) return s;
      s = root.slice(0, 74) + '-' + (n++);
    }
  }

  save(id, data) {
    const now = Date.now();
    const row = {};
    FIELDS.forEach(k => { if (data[k] !== undefined) row[k] = data[k]; });
    if (id) {
      const cur = this.get(id);
      if (!cur) return null;
      if (row.status === 'published' && !cur.published_at && !row.published_at) row.published_at = now;
      const keys = Object.keys(row);
      if (keys.length) this.db.prepare('UPDATE articles SET ' + keys.map(k => k + ' = ?').join(', ') + ', updated = ? WHERE id = ?').run(...keys.map(k => row[k]), now, Number(id));
      return this.get(id);
    }
    if (row.status === 'published' && !row.published_at) row.published_at = now;
    const keys = Object.keys(row);
    const r = this.db.prepare('INSERT INTO articles (' + keys.concat(['created', 'updated']).join(', ') + ') VALUES (' + keys.concat(['created', 'updated']).map(() => '?').join(', ') + ')')
      .run(...keys.map(k => row[k]), now, now);
    return this.get(Number(r.lastInsertRowid));
  }
  remove(id) { return this.prep('DELETE FROM articles WHERE id = ?').run(Number(id)).changes; }
  view(id) { this.prep('UPDATE articles SET views = views + 1 WHERE id = ?').run(Number(id)); }

  addUpload(u) {
    this.prep('INSERT OR IGNORE INTO uploads (file, mime, size, w, h, created) VALUES (?,?,?,?,?,?)').run(u.file, u.mime, u.size, u.w || null, u.h || null, Date.now());
    return this.prep('SELECT * FROM uploads WHERE file = ?').get(u.file);
  }
  uploads(limit = 60) { return this.prep('SELECT * FROM uploads ORDER BY id DESC LIMIT ?').all(limit); }
}

module.exports = { ContentStore, CATEGORIES, slugify, available: !!DatabaseSync };
