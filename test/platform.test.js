'use strict';
// Tests for articles, complaints, the Streax Score and reserve warnings. The HTTP tests start the real server
// on a free port with a throwaway data folder and no network indexing.
// Run: node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const md = require('../content/markdown');
const score = require('../trust/score');
const { Store } = require('../onchain/db');
const { AccountStore } = require('../accounts/store');
const { ReserveWatch, findDrops } = require('../accounts/reserves');

test('markdown never passes raw HTML or unsafe links', () => {
  const r = md.render('# Title\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.com) ![x](data:image/png;base64,AA)\n\n**bold** and `code`');
  assert.ok(!/<script/i.test(r.html), 'script tag escaped');
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(!/javascript:/i.test(r.html.replace(/&[a-z]+;/g, '')) || !/href="javascript/i.test(r.html), 'no javascript: href');
  assert.ok(!/href="javascript/i.test(r.html));
  assert.ok(r.html.includes('href="https://example.com"'));
  assert.ok(!/src="data:/i.test(r.html), 'data: images dropped');
  assert.ok(r.html.includes('<strong>bold</strong>'));
});

test('Streax Score scales over rated categories and labels thin evidence', () => {
  const thin = score.compute({ onchain: { vol01: 1, reach01: 1, cover: 6 } });
  assert.equal(thin.total, 100);
  assert.equal(thin.grade.label, 'Early score', 'two on-chain categories alone are never called Excellent');
  assert.ok(thin.provisional);
  const yes = o => Object.fromEntries(Object.keys(o).map(k => [k, 'yes']));
  const allChecks = id => yes(Object.fromEntries(score.CHECKS[id].map(c => [c[0], 1])));
  const full = score.compute({
    onchain: { vol01: 0.8, reach01: 0.8, cover: 3 },
    payouts: { count: 5, median: 20 }, complaints: { resolved: 9, unresolved: 1 },
    review: { fairness: allChecks('fairness'), compliance: allChecks('compliance'), rg: allChecks('rg'), security: allChecks('security'), licence: { status: 'licensed', verified: true }, support: { live24: 'yes', responseMins: 3 } }
  });
  assert.equal(full.rated, 9);
  assert.equal(full.provisional, false);
  assert.ok(full.total >= 85, 'strong evidence scores high: ' + full.total);
  assert.equal(full.grade.label, 'Excellent');
  const none = score.compute({});
  assert.equal(none.total, null);
  assert.equal(none.grade.label, 'Not rated');
});

test('reserve warnings go to watchers once a day when hot wallets fall 40% or more', async () => {
  const oc = new Store(':memory:');
  const ac = new AccountStore(':memory:');
  oc.setCasinoName('stake', 'Stake.com');
  oc.addWallet({ chain: 'ethereum', address: '0x' + '1'.repeat(40), casino: 'stake', role: 'hot' });
  oc.addWallet({ chain: 'ethereum', address: '0x' + '2'.repeat(40), casino: 'roobet', role: 'hot' });
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const ins = oc.db.prepare('INSERT INTO balance_days (day, casino, chain, usd) VALUES (?,?,?,?)');
  ins.run(day(3), 'stake', 'ethereum', 10e6); ins.run(day(1), 'stake', 'ethereum', 9e6);
  ins.run(day(3), 'roobet', 'ethereum', 5e6);
  oc.setBalance('ethereum', '0x' + '1'.repeat(40), 'USDT', 5e6, 5e6); // stake: 10M -> 5M, a 50% fall
  oc.setBalance('ethereum', '0x' + '2'.repeat(40), 'USDT', 4e6, 4e6); // roobet: 5M -> 4M, only 20%
  const drops = findDrops(oc);
  assert.deepEqual(drops.map(d => d.casino), ['stake']);
  assert.equal(Math.round(drops[0].drop * 100), 50);

  const id = ac.createUser({ email: 'w@example.com', name: 'Wes', verified: true, adult: true });
  ac.update(id, { tg_chat: '777', alert_tg: 1 });
  ac.setWatch(id, 'stake', true);
  const other = ac.createUser({ email: 'o@example.com', name: 'Oli', verified: true, adult: true });
  ac.update(other, { tg_chat: '888', alert_tg: 1 });
  ac.setWatch(other, 'roobet', true);
  const sent = [];
  const tg = { ready: true, send: (chat, text) => sent.push({ chat, text }) };
  const rw = new ReserveWatch({ publicUrl: 'https://streax.example' }, ac, tg, () => {}, () => oc.casinoNames());
  let r = await rw.check(oc);
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, '777');
  assert.match(sent[0].text, /Stake\.com reserves down 50%/);
  assert.match(sent[0].text, /cold storage/);
  assert.match(sent[0].text, /Casino\.dc\.html\?c=stake/);
  r = await rw.check(oc);
  assert.equal(r.sent, 0, 'no repeat on the same day');
});

// ---------- HTTP: real server ----------

function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function startServer() {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streax-test-'));
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, ADMIN_TOKEN: 'test-admin-token', NO_OPEN: '1', ONCHAIN_INDEX: 'off', ACCOUNTS_TELEGRAM: 'off', RESEND_API_KEY: '', PUBLIC_URL: '' });
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok && /Complaints and scores: on/.test(log)) break; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  const jar = {};
  const call = async (method, p, body, opt = {}) => {
    const headers = Object.assign({}, opt.headers || {});
    const who = opt.as || 'a';
    if (jar[who]) headers.cookie = jar[who];
    let payload;
    if (body !== undefined && !opt.form) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (opt.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    const r = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    sc.forEach(c => { const kv = c.split(';')[0]; if (/^sx_sess=/.test(kv)) jar[who] = kv; });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: r.status, text, json, headers: r.headers };
  };
  return { base, call, log: () => log, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('articles: Studio needs the admin token, published articles get SEO pages, drafts stay hidden', async () => {
  const s = await startServer();
  try {
    const admin = { headers: { 'x-admin-token': 'test-admin-token' } };
    let r = await s.call('GET', '/articles');
    assert.equal(r.status, 200);
    assert.match(r.text, /How the Streax Score works/, 'starter articles are seeded');

    r = await s.call('POST', '/api/studio/articles', { title: 'Nope' });
    assert.equal(r.status, 401);
    r = await s.call('POST', '/api/studio/articles', { title: 'Nope' }, { headers: { 'x-admin-token': 'wrong-admin-token' } });
    assert.equal(r.status, 401);

    r = await s.call('POST', '/api/studio/articles', { title: 'Stake hot wallets in October', dek: 'What the monitor saw this month.', body: '## Summary\n\nReserves stayed above **$150M** all month. <img src=x onerror=alert(1)>', category: 'reports', seo_desc: 'Stake hot wallet balances for October, read from the Streax monitor.', casinos: ['stakecom', 'not-a-casino'] }, admin);
    assert.equal(r.status, 200, r.text);
    const a = r.json.article;
    assert.equal(a.status, 'draft');
    assert.equal(a.casinos, 'stakecom');
    r = await s.call('GET', '/articles/' + a.slug);
    assert.equal(r.status, 404, 'drafts are not public');
    r = await s.call('GET', a.previewUrl);
    assert.equal(r.status, 200, 'the preview link shows a draft');
    assert.match(r.text, /noindex/);

    r = await s.call('POST', '/api/studio/articles/' + a.id, { status: 'published' }, admin);
    assert.equal(r.status, 200);
    r = await s.call('GET', '/articles/' + a.slug);
    assert.equal(r.status, 200);
    assert.match(r.text, /<title>[^<]*Stake hot wallets in October/);
    assert.match(r.text, /<meta name="description" content="Stake hot wallet balances for October/);
    assert.match(r.text, /<link rel="canonical" href="[^"]*\/articles\/stake-hot-wallets-in-october"/);
    assert.match(r.text, /application\/ld\+json/);
    assert.match(r.text, /og:title/);
    assert.ok(!/<img src=x onerror/i.test(r.text), 'raw HTML in the body is escaped');

    r = await s.call('GET', '/sitemap.xml');
    assert.match(r.text, /\/articles\/stake-hot-wallets-in-october/);
    r = await s.call('GET', '/rss.xml');
    assert.match(r.text, /Stake hot wallets in October/);
    r = await s.call('GET', '/robots.txt');
    assert.match(r.text, /Sitemap: /);
  } finally { s.stop(); }
});

test('complaints: member files, Streax approves, casino replies by link, outcome counts for the casino', async () => {
  const s = await startServer();
  try {
    const admin = { headers: { 'x-admin-token': 'test-admin-token' } };
    let r = await s.call('POST', '/api/complaints', { casino: 'stake' });
    assert.equal(r.status, 401, 'members only');
    r = await s.call('POST', '/api/auth/signup', { name: 'Pia Player', email: 'pia@example.com', password: 'longenough1', adult: true });
    assert.ok(r.status === 200 || r.status === 201, r.text);

    r = await s.call('POST', '/api/complaints', { casino: 'stakecom', category: 'withdrawal', title: 'Short', body: 'x', agree: true });
    assert.equal(r.status, 400);
    r = await s.call('POST', '/api/complaints', { casino: 'stakecom', category: 'withdrawal', title: 'Withdrawal stuck for a week', body: 'I asked for a 900 USDT withdrawal on Tron on 2 October. Support says it is being checked, with no date given.', amount: 900, chain: 'tron', tx: 'not-a-hash', agree: true });
    assert.equal(r.status, 400, 'bad transaction hash is refused');
    r = await s.call('POST', '/api/complaints', { casino: 'stakecom', category: 'withdrawal', title: 'Withdrawal stuck for a week', body: 'I asked for a 900 USDT withdrawal on Tron on 2 October. Support says it is being checked, with no date given.', amount: 900, agree: true });
    assert.equal(r.status, 200, r.text);
    const ref = r.json.complaint.ref;
    assert.match(ref, /^SX-\d+/);

    r = await s.call('GET', '/api/complaints');
    assert.equal(r.json.total, 0, 'not public until Streax checks it');

    r = await s.call('GET', '/api/studio/complaints?status=review', undefined, admin);
    const c = r.json.complaints.find(x => x.ref === ref);
    assert.ok(c);
    r = await s.call('POST', '/api/studio/complaints/' + c.id, { action: 'approve' }, admin);
    assert.equal(r.status, 200, r.text);
    const link = r.json.replyLink;
    assert.match(link, /^\/reply\//);

    r = await s.call('GET', '/api/complaints');
    assert.equal(r.json.total, 1, 'public once approved');

    r = await s.call('GET', link);
    assert.equal(r.status, 200);
    assert.match(r.text, /Withdrawal stuck for a week/);
    r = await s.call('POST', link, { name: 'Sam, Support lead', body: 'We found the stuck payout and sent it again today.', propose: '1' }, { form: true, as: 'casino' });
    assert.equal(r.status, 303);

    r = await s.call('POST', '/api/complaints/' + ref + '/confirm', { resolved: true });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.complaint.status, 'resolved');

    r = await s.call('GET', '/api/trust/summary');
    assert.equal(r.json.complaints.stakecom.resolved, 1);
  } finally { s.stop(); }
});

test('new pages are served and link to each other', async () => {
  const s = await startServer();
  try {
    for (const p of ['/Complaints.dc.html', '/WalletCheck.dc.html', '/BonusCalc.dc.html', '/night/Complaints.dc.html', '/studio.html']) {
      const r = await s.call('GET', p);
      assert.equal(r.status, 200, p);
    }
    const home = (await s.call('GET', '/Home.dc.html')).text;
    ['Complaints.dc.html', 'WalletCheck.dc.html', 'BonusCalc.dc.html', '/articles'].forEach(h => assert.ok(home.includes('href="' + h + '"'), 'home links to ' + h));
    const r = await s.call('GET', '/api/wallet-check?address=nope');
    assert.equal(r.status, 400);
  } finally { s.stop(); }
});
