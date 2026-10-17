'use strict';
// Password hashing (scrypt, built into Node.js) and random tokens.

const crypto = require('crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['s1', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 's1') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A fixed hash so a login for an unknown email takes as long as one for a real account.
let DUMMY = null;
async function dummyVerify(password) {
  if (!DUMMY) DUMMY = await hashPassword('streax-timing-equaliser');
  await verifyPassword(password, DUMMY);
  return false;
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

// Referral codes: 8 characters without look-alikes (no 0, O, 1, I, L).
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function refCode() {
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}

module.exports = { hashPassword, verifyPassword, dummyVerify, token, sha256, refCode };
