'use strict';
// Accounts: sign-up, login, sessions, Google sign-in, referrals, perks, codes, alerts and the admin routes.
// Runs offline: Google, Resend and Telegram are faked. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { AccountStore } = require('../accounts/store');
const { Limiter } = require('../accounts/http');
const api = require('../accounts/api');
const { TgBot } = require('../accounts/tgbot');
const { PersonalAlerts } = require('../accounts/alerts');
const { config } = require('../accounts');
const { hashPassword, verifyPassword, sha256 } = require('../accounts/secure');
const casinos = require('../accounts/casinos.json');

const realFetch = global.fetch;

function makeState(env = {}) {
  const cfg = Object.assign(config({}), { adminToken: 'secret', publicUrl: 'https://streax.test' }, env);
  const store = new AccountStore(':memory:');
  return { cfg, store, limiter: new Limiter(), tg: null, casinos, log: () => {}, trackedCasinos: () => ['stakecom', 'roobet'] };
}

async function serve(state) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!(await api.handle(state, req, res, url))) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const jar = {};
  function call(method, path, body, opts = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? '' : JSON.stringify(body);
      const who = opts.as || 'a';
      const headers = Object.assign({ host: '127.0.0.1:' + port }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, opts.headers || {});
      if (jar[who]) headers.cookie = jar[who];
      const req = http.request({ port, path, method, headers }, res => {
        let s = '';
        res.on('data', c => { s += c; });
        res.on('end', () => {
          const sc = res.headers['set-cookie'] || [];
          sc.forEach(c => { const kv = c.split(';')[0]; const [k, v] = kv.split('='); const cur = (jar[who] || '').split('; ').filter(x => x && !x.startsWith(k + '=')); if (v) cur.push(kv); jar[who] = cur.join('; '); });
          let j = null; try { j = JSON.parse(s); } catch (e) { j = s; }
          resolve({ status: res.statusCode, body: j, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  return { call, jar, close: () => srv.close(), port };
}

test('password hashing', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^s1\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('sign up, session, login, logout', async () => {
  const state = makeState();
  const s = await serve(state);
  try {
    assert.equal((await s.call('GET', '/api/auth/me')).body.user, null);
    let r = await s.call('POST', '/api/auth/signup', { email: 'bad', password: 'longenough', adult: true });
    assert.equal(r.status, 400); assert.equal(r.body.field, 'email');
    r = await s.call('POST', '/api/auth/signup', { email: 'a@b.co', password: 'short', adult: true });
    assert.equal(r.body.field, 'password');
    r = await s.call('POST', '/api/auth/signup', { email: 'a@b.co', password: 'longenough' });
    assert.equal(r.body.field, 'adult');
    r = await s.call('POST', '/api/auth/signup', { name: 'Ann <b>', email: 'Ann@Example.com', password: 'longenough1', adult: true });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'ann@example.com');
    assert.equal(r.body.user.name, 'Ann b');
    assert.equal(r.body.user.points, 150, 'sign-up 100 + confirmed 50 (no email service, so confirmed at once)');
    assert.match(r.headers['set-cookie'][0], /sx_sess=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    const raw = decodeURIComponent(s.jar.a.split('sx_sess=')[1]);
    const row = state.store.db.prepare('SELECT token FROM sessions').get();
    assert.equal(row.token, sha256(raw), 'only the hash is stored');
    assert.equal((await s.call('GET', '/api/auth/me')).body.user.email, 'ann@example.com');
    r = await s.call('POST', '/api/auth/signup', { email: 'ann@example.com', password: 'longenough1', adult: true }, { as: 'b' });
    assert.equal(r.status, 409);
    r = await s.call('POST', '/api/auth/logout', {});
    assert.equal((await s.call('GET', '/api/auth/me')).body.user, null);
    r = await s.call('POST', '/api/auth/login', { email: 'ann@example.com', password: 'nope-nope' });
    assert.equal(r.status, 401);
    r = await s.call('POST', '/api/auth/login', { email: 'ANN@example.com', password: 'longenough1' });
    assert.equal(r.status, 200);
    assert.equal((await s.call('GET', '/api/auth/me')).body.user.name, 'Ann b');
  } finally { s.close(); }
});

test('cross-site posts, non-JSON bodies and login floods are refused', async () => {
  const state = makeState();
  const s = await serve(state);
  try {
    let r = await s.call('POST', '/api/auth/signup', { email: 'x@y.co', password: 'longenough', adult: true }, { headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
    r = await new Promise(resolve => {
      const req = http.request({ port: s.port, path: '/api/auth/login', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.end('email=a&password=b');
    });
    assert.equal(r, 415);
    let last;
    for (let i = 0; i < 9; i++) last = await s.call('POST', '/api/auth/login', { email: 'nobody@x.co', password: 'whatever1' });
    assert.equal(last.status, 429);
  } finally { s.close(); }
});

test('referrals: points when the friend is confirmed, capped per day, never for yourself', async () => {
  const state = makeState({ resendKey: 're_test', mailFrom: 'Streax <a@b.co>' });
  const sent = [];
  global.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ id: 'm1' }) }; };
  const s = await serve(state);
  try {
    let r = await s.call('POST', '/api/auth/signup', { name: 'Host', email: 'host@x.co', password: 'longenough', adult: true });
    assert.equal(r.body.user.verified, false);
    assert.equal(r.body.verifySent, true);
    assert.match(sent[0].body.html, /\/auth\/verify\?token=/);
    const host = state.store.userByEmail('host@x.co');
    r = await s.call('POST', '/api/auth/signup', { email: 'friend@x.co', password: 'longenough', adult: true, ref: host.ref_code.toLowerCase() }, { as: 'f' });
    assert.equal(r.body.user.points, 200, 'friend: 100 sign-up + 100 invite bonus');
    assert.equal(state.store.user(host.id).points, 100, 'not paid before the friend confirms');
    const token = sent[1].body.html.match(/token=([A-Za-z0-9_-]+)/)[1];
    r = await s.call('GET', '/auth/verify?token=' + token, undefined, { as: 'f' });
    assert.equal(r.status, 302); assert.equal(r.headers.location, '/Account.dc.html?verify=ok');
    assert.equal(state.store.user(host.id).points, 350, 'host gets 250 once the friend confirms');
    r = await s.call('GET', '/auth/verify?token=' + token, undefined, { as: 'f' });
    assert.equal(r.headers.location, '/Account.dc.html?verify=expired');
    assert.equal(state.store.user(host.id).points, 350, 'paid once');
    // the daily cap
    for (let i = 0; i < 20; i++) state.store.award(host.id, 'referral:fake' + i, 0);
    const late = state.store.createUser({ email: 'late@x.co', referredBy: host.id, verified: true });
    const { accountPayload } = api;
    accountPayload(state, state.store.user(host.id), null);
    assert.equal(state.store.user(late).ref_credited, 0, 'over the daily cap, kept pending');
  } finally { s.close(); global.fetch = realFetch; }
});

test('perks: watchlist limit, one-time points, alert levels, codes by level', async () => {
  const state = makeState();
  const s = await serve(state);
  try {
    await s.call('POST', '/api/auth/signup', { email: 'm@x.co', password: 'longenough', adult: true });
    const slugs = casinos.slice(0, 11).map(c => c.slug);
    let r;
    for (let i = 0; i < 10; i++) r = await s.call('POST', '/api/account/watch', { slug: slugs[i], on: true });
    assert.equal(r.body.watchlist.length, 10);
    assert.equal(r.body.points, 200, '150 + 50 for watching 3, paid once');
    r = await s.call('POST', '/api/account/watch', { slug: slugs[10], on: true });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'watch_limit');
    r = await s.call('POST', '/api/account/watch', { slug: 'not-a-casino', on: true });
    assert.equal(r.status, 400);
    r = await s.call('POST', '/api/account/alerts', { min: 25000 });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'level');
    r = await s.call('POST', '/api/account/alerts', { min: 100000, email: false });
    assert.equal(r.body.alerts.min, 100000); assert.equal(r.body.alerts.email, false);
    // codes
    const H = { headers: { 'x-admin-token': 'secret' } };
    assert.equal((await s.call('POST', '/api/admin/codes', { casino: 'stakecom', title: 'T', code: 'C1' })).status, 401);
    assert.equal((await s.call('POST', '/api/admin/codes', { casino: 'stakecom', title: 'T', code: 'C1', url: 'http://insecure' }, H)).status, 400);
    const a = (await s.call('POST', '/api/admin/codes', { casino: 'stakecom', title: 'Member offer', code: 'MEM1', url: 'https://stake.com/' }, H)).body.id;
    const g = (await s.call('POST', '/api/admin/codes', { casino: 'roobet', title: 'Gold offer', code: 'GOLD1', level: 'gold' }, H)).body.id;
    r = await s.call('GET', '/api/account');
    const byId = Object.fromEntries(r.body.codes.map(c => [c.id, c]));
    assert.equal(byId[a].code, '', 'hidden until revealed');
    assert.equal(byId[g].locked, true);
    assert.equal((await s.call('POST', '/api/account/reveal', { id: g })).status, 403);
    r = await s.call('POST', '/api/account/reveal', { id: a });
    assert.equal(r.body.code, 'MEM1');
    assert.equal((await s.call('GET', '/api/account')).body.codes.find(c => c.id === a).code, 'MEM1');
    await s.call('POST', '/api/admin/codes/' + a, { active: false }, H);
    assert.equal((await s.call('POST', '/api/account/reveal', { id: a })).status, 404);
    const pub = (await s.call('GET', '/api/codes', undefined, { as: 'guest' })).body.codes;
    assert.deepEqual(pub.map(c => c.title), ['Gold offer']);
    assert.ok(!JSON.stringify(pub).includes('GOLD1'), 'public list never shows codes');
    r = await s.call('GET', '/api/admin/members.csv', undefined, H);
    assert.match(r.body, /^﻿name,email,joined_utc/);
    assert.match(r.body, /m@x\.co/);
  } finally { s.close(); }
});

test('password reset needs email; reset tokens work once', async () => {
  const state = makeState();
  const s = await serve(state);
  try {
    await s.call('POST', '/api/auth/signup', { email: 'r@x.co', password: 'longenough', adult: true });
    assert.equal((await s.call('POST', '/api/auth/forgot', { email: 'r@x.co' })).status, 503);
    const u = state.store.userByEmail('r@x.co');
    const t = state.store.createToken(u.id, 'reset', 60000);
    let r = await s.call('POST', '/api/auth/reset', { token: t, password: 'brand-new-pass' }, { as: 'b' });
    assert.equal(r.status, 200);
    assert.equal((await s.call('GET', '/api/auth/me')).body.user, null, 'old sessions are logged out');
    assert.equal((await s.call('POST', '/api/auth/reset', { token: t, password: 'another-pass' }, { as: 'b' })).status, 400);
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'r@x.co', password: 'brand-new-pass' })).status, 200);
  } finally { s.close(); }
});

test('Google sign-in: state check, 18+ confirmation, new account, linking an existing email', async () => {
  const state = makeState({ googleClientId: 'cid.apps.googleusercontent.com', googleClientSecret: 'sec' });
  let payload;
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('client_secret'), 'sec');
    assert.equal(form.get('redirect_uri'), 'https://streax.test/auth/google/callback');
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    return { ok: true, status: 200, json: async () => ({ id_token: b64({ alg: 'RS256' }) + '.' + b64(payload) + '.sig' }) };
  };
  const s = await serve(state);
  try {
    const start = async (q, who) => {
      const r = await s.call('GET', '/auth/google?' + q, undefined, { as: who });
      assert.equal(r.status, 302);
      const loc = new URL(r.headers.location);
      assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(loc.searchParams.get('scope'), 'openid email profile');
      return { state: loc.searchParams.get('state'), nonce: loc.searchParams.get('nonce') };
    };
    let st = await start('mode=login', 'g1');
    payload = { iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com', exp: Math.floor(Date.now() / 1000) + 600, nonce: st.nonce, sub: '111', email: 'Gee@Gmail.com', email_verified: true, name: 'Gee' };
    let r = await s.call('GET', '/auth/google/callback?code=abc&state=wrong', undefined, { as: 'g1' });
    assert.equal(r.headers.location, '/Login.dc.html?err=google_state');
    st = await start('mode=login', 'g1');
    payload.nonce = st.nonce;
    r = await s.call('GET', '/auth/google/callback?code=abc&state=' + st.state, undefined, { as: 'g1' });
    assert.equal(r.headers.location, '/Signup.dc.html?err=google_confirm', 'a new account needs the 18+ box');
    st = await start('mode=signup&adult=1', 'g1');
    payload.nonce = st.nonce;
    r = await s.call('GET', '/auth/google/callback?code=abc&state=' + st.state, undefined, { as: 'g1' });
    assert.equal(r.headers.location, '/Account.dc.html?welcome=1');
    const me = (await s.call('GET', '/api/auth/me', undefined, { as: 'g1' })).body.user;
    assert.equal(me.email, 'gee@gmail.com'); assert.equal(me.verified, true); assert.equal(me.points, 150);
    // wrong audience is refused
    st = await start('mode=login', 'g2');
    payload = Object.assign({}, payload, { nonce: st.nonce, aud: 'someone-else' });
    r = await s.call('GET', '/auth/google/callback?code=abc&state=' + st.state, undefined, { as: 'g2' });
    assert.equal(r.headers.location, '/Login.dc.html?err=google_failed');
    // an email account is linked when Google says the email is verified
    await s.call('POST', '/api/auth/signup', { email: 'link@x.co', password: 'longenough', adult: true }, { as: 'g3' });
    st = await start('mode=login&next=%2FOnchain.dc.html', 'g4');
    payload = Object.assign({}, payload, { nonce: st.nonce, aud: 'cid.apps.googleusercontent.com', sub: '222', email: 'link@x.co' });
    r = await s.call('GET', '/auth/google/callback?code=abc&state=' + st.state, undefined, { as: 'g4' });
    assert.equal(r.headers.location, '/Onchain.dc.html');
    assert.equal(state.store.userByEmail('link@x.co').google_sub, '222');
  } finally { s.close(); global.fetch = realFetch; }
});

test('Telegram linking and personal alerts', async () => {
  const state = makeState({ telegramToken: 'TT', telegramBotUsername: 'streax_bot', resendKey: 're_x', mailFrom: 'S <a@b.co>' });
  const store = state.store;
  const out = [];
  global.fetch = async (url, init) => { out.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, result: {}, id: 'e' }) }; };
  try {
    const tg = new TgBot(state.cfg, store, () => {});
    const id = store.createUser({ email: 'w@x.co', name: 'W', verified: true });
    const url = await tg.linkUrl(id);
    assert.match(url, /^https:\/\/t\.me\/streax_bot\?start=[A-Za-z0-9_-]{20}$/);
    const code = url.split('start=')[1];
    let reply = tg.handle({ chat: { id: 42, type: 'private' }, from: { first_name: 'Wes', username: 'wes' }, text: '/start ' + code });
    assert.match(reply.text, /Connected to Streax/);
    assert.equal(store.user(id).tg_chat, '42');
    assert.equal(store.user(id).points, 50);
    reply = tg.handle({ chat: { id: 43, type: 'private' }, text: '/start ' + code });
    assert.match(reply.text, /expired/);
    store.setWatch(id, 'stakecom', true);
    store.update(id, { alert_min: 50000 });
    const alerts = new PersonalAlerts(state.cfg, store, tg, () => {}, () => ({ stakecom: 'Stake.com' }));
    alerts.begin();
    const t = { chain: 'ethereum', tx: '0xabc', idx: 'n', wallet: '0xw', casino: 'stakecom', dir: 'out', asset: 'USDT', amount: 120000, usd: 120000, internal: false };
    alerts.onTransfer(t);
    alerts.onTransfer(t); // same transfer again is ignored
    alerts.onTransfer(Object.assign({}, t, { tx: '0xsmall', usd: 2000, amount: 2000 }));
    alerts.onTransfer(Object.assign({}, t, { tx: '0xother', casino: 'roobet' }));
    await alerts.flush();
    await new Promise(r => setTimeout(r, 200));
    const tgMsgs = out.filter(o => o.url.includes('/sendMessage'));
    const mails = out.filter(o => o.url === 'https://api.resend.com/emails');
    assert.equal(tgMsgs.length, 1);
    assert.match(tgMsgs[0].body.text, /Stake\.com withdrawal \$120\.0K/);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].body.subject, 'Whale alert: Stake.com $120.0K');
    reply = tg.handle({ chat: { id: 42, type: 'private' }, text: '/stop' });
    assert.equal(store.user(id).tg_chat, null);
  } finally { global.fetch = realFetch; }
});

test('deleting an account removes its data', async () => {
  const state = makeState();
  const s = await serve(state);
  try {
    await s.call('POST', '/api/auth/signup', { email: 'd@x.co', password: 'longenough', adult: true });
    await s.call('POST', '/api/account/watch', { slug: 'stakecom', on: true });
    assert.equal((await s.call('POST', '/api/account/delete', { confirm: 'delete', password: 'longenough' })).status, 400);
    assert.equal((await s.call('POST', '/api/account/delete', { confirm: 'DELETE', password: 'wrong-one' })).status, 400);
    assert.equal((await s.call('POST', '/api/account/delete', { confirm: 'DELETE', password: 'longenough' })).status, 200);
    assert.equal(state.store.userByEmail('d@x.co'), null);
    assert.equal(state.store.db.prepare('SELECT COUNT(*) AS n FROM watchlist').get().n, 0);
    assert.equal(state.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal((await s.call('GET', '/api/account')).status, 401);
  } finally { s.close(); }
});

test('accounts off: the routes answer clearly instead of failing', async () => {
  const srv = http.createServer(async (req, res) => { await api.handle(null, req, res, new URL(req.url, 'http://x')); });
  await new Promise(r => srv.listen(0, r));
  const get = p => new Promise(r => http.get({ port: srv.address().port, path: p }, res => { let s = ''; res.on('data', c => { s += c; }); res.on('end', () => r({ status: res.statusCode, body: s, loc: res.headers.location })); }));
  try {
    const me = await get('/api/auth/me');
    assert.equal(me.status, 200); assert.equal(JSON.parse(me.body).enabled, false);
    assert.equal((await get('/api/account')).status, 503);
    assert.equal((await get('/auth/google')).loc, '/Login.dc.html?err=off');
  } finally { srv.close(); }
});
