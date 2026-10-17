'use strict';
// Shared helpers for the on-chain monitor: HTTP with timeouts and per-host pacing, unit maths, Tron address encoding.

const crypto = require('crypto');

const UA = 'Streax-onchain/1.0 (+https://streax)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One queue per host so each API stays inside its rate limit.
const lanes = new Map();
function lane(host, gapMs) {
  let l = lanes.get(host);
  if (!l) { l = { next: 0, gap: gapMs }; lanes.set(host, l); }
  if (gapMs) l.gap = gapMs;
  return l;
}
async function paced(host, gapMs) {
  const l = lane(host, gapMs);
  const now = Date.now();
  const at = Math.max(now, l.next);
  l.next = at + l.gap;
  if (at > now) await sleep(at - now);
}

class HttpError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// fetch JSON with a timeout, pacing per host and up to `retries` retries on network errors, 429 and 5xx.
async function getJSON(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeout = 15000, retries = 2, gap = 250 } = opts;
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paced(host, gap);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, signal: ctl.signal,
        headers: Object.assign({ accept: 'application/json', 'user-agent': UA }, body ? { 'content-type': 'application/json' } : {}, headers)
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError('HTTP ' + res.status, res.status);
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new HttpError('HTTP ' + res.status, res.status);
      return await res.json();
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('timeout') : e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('request failed');
}

// Integer string (any size) divided by 10^decimals, as a JS number.
function units(raw, decimals) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : 0; }
  const neg = s.startsWith('-');
  const digits = (neg ? s.slice(1) : s).replace(/^0+/, '') || '0';
  const d = Number(decimals) || 0;
  let n;
  if (d === 0) n = Number(digits);
  else if (digits.length <= d) n = Number('0.' + digits.padStart(d, '0'));
  else n = Number(digits.slice(0, digits.length - d) + '.' + digits.slice(digits.length - d));
  return neg ? -n : n;
}
function hexUnits(hex, decimals) {
  if (!hex || hex === '0x') return 0;
  return units(BigInt(hex).toString(), decimals);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex, 'hex');
  let lead = 0;
  for (const c of s) { if (c === '1') lead++; else break; }
  return Buffer.concat([Buffer.alloc(lead), buf]);
}
const sha256 = b => crypto.createHash('sha256').update(b).digest();
// Tron hex address (41 + 20 bytes) to base58check (T...).
function tronHexToBase58(hex) {
  if (!hex) return '';
  if (hex.startsWith('T')) return hex;
  const h = hex.replace(/^0x/, '');
  const raw = Buffer.from(h.length === 40 ? '41' + h : h, 'hex');
  const check = sha256(sha256(raw)).subarray(0, 4);
  return b58encode(Buffer.concat([raw, check]));
}
function isTronAddress(a) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a || '')) return false;
  try {
    const raw = b58decode(a);
    if (raw.length !== 25) return false;
    return sha256(sha256(raw.subarray(0, 21))).subarray(0, 4).equals(raw.subarray(21));
  } catch (e) { return false; }
}
const isEvmAddress = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const isSolAddress = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '') && !a.startsWith('0x');
const isBtcAddress = a => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a || '');

function validAddress(chain, a) {
  if (chain === 'ethereum' || chain === 'bsc' || chain === 'polygon') return isEvmAddress(a);
  if (chain === 'tron') return isTronAddress(a);
  if (chain === 'solana') return isSolAddress(a);
  if (chain === 'bitcoin') return isBtcAddress(a);
  return false;
}
// Addresses are compared lowercased on EVM chains and exactly elsewhere (base58 is case sensitive).
const norm = (chain, a) => (chain === 'ethereum' || chain === 'bsc' || chain === 'polygon') ? String(a || '').toLowerCase() : String(a || '');

const hourOf = ms => Math.floor(ms / 3600000) * 3600000;
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

module.exports = { sleep, getJSON, HttpError, units, hexUnits, tronHexToBase58, isTronAddress, validAddress, norm, hourOf, dayOf, b58encode, b58decode };
