// Key-value storage. Netlify Blobs in production; a folder on disk when
// STREAX_LOCAL_STORE is set (local testing without the Netlify CLI).
import { getStore } from '@netlify/blobs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const LOCAL = process.env.STREAX_LOCAL_STORE || '';

function localStore(name) {
  const dir = path.join(LOCAL, name);
  const file = (key) => path.join(dir, encodeURIComponent(key) + '.json');
  const tag = (txt) => crypto.createHash('sha1').update(txt).digest('hex');
  const read = async (key) => { try { return await fs.readFile(file(key), 'utf8'); } catch { return null; } };
  return {
    async get(key) { const t = await read(key); return t == null ? null : JSON.parse(t); },
    async getMeta(key) { const t = await read(key); return t == null ? null : { data: JSON.parse(t), etag: tag(t) }; },
    async set(key, value, opts = {}) {
      await fs.mkdir(dir, { recursive: true });
      const cur = await read(key);
      if (opts.onlyIfNew && cur != null) return { modified: false };
      if (opts.onlyIfMatch && (cur == null || tag(cur) !== opts.onlyIfMatch)) return { modified: false };
      const txt = JSON.stringify(value);
      const tmp = file(key) + '.' + process.pid + '.' + Date.now() + '.tmp';
      await fs.writeFile(tmp, txt);
      await fs.rename(tmp, file(key));
      return { modified: true };
    },
    async del(key) { try { await fs.unlink(file(key)); } catch {} },
    async list(prefix = '') {
      let names = [];
      try { names = await fs.readdir(dir); } catch { return []; }
      return names.filter((n) => n.endsWith('.json')).map((n) => decodeURIComponent(n.slice(0, -5))).filter((k) => k.startsWith(prefix));
    }
  };
}

function blobStore(name) {
  const s = getStore({ name, consistency: 'strong' });
  return {
    get: (key) => s.get(key, { type: 'json' }),
    async getMeta(key) { const r = await s.getWithMetadata(key, { type: 'json' }); return r ? { data: r.data, etag: r.etag } : null; },
    set: (key, value, opts = {}) => s.setJSON(key, value, opts),
    del: (key) => s.delete(key),
    async list(prefix = '') { const r = await s.list({ prefix }); return r.blobs.map((b) => b.key); }
  };
}

const cache = {};
export function store(name) {
  if (!cache[name]) cache[name] = LOCAL ? localStore(name) : blobStore(name);
  return cache[name];
}

// Read-modify-write with optimistic locking. fn gets the current value (or
// init) and returns the new value, or undefined to leave it unchanged.
export async function update(st, key, fn, init = null) {
  for (let i = 0; i < 8; i++) {
    const cur = await st.getMeta(key);
    const base = cur ? cur.data : (typeof init === 'function' ? init() : structuredClone(init));
    const next = await fn(base);
    if (next === undefined) return base;
    const r = await st.set(key, next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (r && r.modified === false) { await new Promise((res) => setTimeout(res, 40 + Math.random() * 120)); continue; }
    return next;
  }
  throw new Error('Busy, please try again');
}
