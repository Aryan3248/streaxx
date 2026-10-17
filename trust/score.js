'use strict';
// The Streax Score: nine weighted categories, each scored 0 to 10. Categories without enough evidence are left
// out (never guessed), and the score is scaled over the categories that are rated. Shared by the server and pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StreaxScore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var CATS = [
    { id: 'activity', name: 'On-chain activity', w: 15, src: 'On-chain', what: 'Deposit volume and how many wallets deposit.' },
    { id: 'reserves', name: 'Reserves', w: 15, src: 'On-chain', what: 'Hot wallet money compared with a day of deposits.' },
    { id: 'payouts', name: 'Payout speed', w: 15, src: 'Players', what: 'Median time from withdrawal request to coins arriving, from verified player reports.' },
    { id: 'complaints', name: 'Complaint record', w: 15, src: 'Players', what: 'Share of closed complaints the casino resolved.' },
    { id: 'fairness', name: 'Fairness and RTP', w: 10, src: 'Review', what: 'Provably fair games, a verifier, client seeds and published RTP.' },
    { id: 'licence', name: 'Licence and compliance', w: 10, src: 'Review', what: 'A licence we could check, KYC timing, geo-blocking and AML policy.' },
    { id: 'rg', name: 'Responsible gambling', w: 8, src: 'Review', what: 'Self-exclusion, limits, cool-off and help links.' },
    { id: 'support', name: 'Support', w: 7, src: 'Review', what: '24/7 live help and how fast a human answers.' },
    { id: 'security', name: 'Account security', w: 5, src: 'Review', what: 'Two-factor login and withdrawal confirmation.' }
  ];
  var CHECKS = {
    fairness: [['provablyFair', 'Provably fair house games'], ['verifier', 'Built-in result verifier'], ['clientSeed', 'Players can set their own client seed'], ['rtpPublished', 'RTP published for every game'], ['maxRtp', 'Commits to the highest RTP version of slots']],
    compliance: [['kycBeforeDeposit', 'KYC asked before the first deposit, not after a win'], ['geoBlock', 'Blocks restricted countries'], ['restrictedList', 'Publishes its restricted countries'], ['amlPolicy', 'Publishes an AML policy']],
    rg: [['selfExclusion', 'Self-exclusion from the account page'], ['limits', 'Deposit and loss limits'], ['coolOff', 'Cool-off periods'], ['rgLinks', 'Links to gambling help services'], ['realityCheck', 'Reality checks or session reminders']],
    support: [['live24', '24/7 live chat with a person']],
    security: [['twoFA', 'Two-factor login'], ['withdrawalConfirm', 'Withdrawals need a second confirmation'], ['loginAlerts', 'New login or device alerts']]
  };
  function clamp(v) { return Math.max(0, Math.min(10, v)); }
  function lerp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }
  function checks(obj, list) {
    var yes = 0, known = 0;
    list.forEach(function (c) { var v = obj && obj[c[0]]; if (v === 'yes') { yes++; known++; } else if (v === 'no') known++; });
    return { yes: yes, known: known, total: list.length };
  }
  function grade(total) {
    if (total == null) return { label: 'Not rated', tone: 'muted' };
    if (total >= 85) return { label: 'Excellent', tone: 'good' };
    if (total >= 70) return { label: 'Good', tone: 'good' };
    if (total >= 55) return { label: 'Fair', tone: 'accent' };
    if (total >= 40) return { label: 'Weak', tone: 'warn' };
    return { label: 'Poor', tone: 'bad' };
  }

  // input: { onchain: {vol01, reach01, cover, drawdown7d}, review: {...}, complaints: {resolved, unresolved}, payouts: {median, count} }
  function compute(input) {
    input = input || {};
    var oc = input.onchain || {}, rv = input.review || {}, cp = input.complaints || {}, po = input.payouts || {};
    var out = {};
    if (oc.vol01 != null && oc.reach01 != null) out.activity = { v: clamp(10 * (0.57 * oc.vol01 + 0.43 * oc.reach01)), note: oc.note || '' };
    if (oc.cover != null && isFinite(oc.cover)) {
      var r = lerp(oc.cover, [[0, 0], [0.25, 2], [1, 5], [2, 7], [5, 10]]);
      if (oc.drawdown7d != null && oc.drawdown7d > 0.4) r -= Math.min(4, (oc.drawdown7d - 0.4) * 10);
      out.reserves = { v: clamp(r), note: oc.cover.toFixed(1) + 'x a day of deposits' };
    }
    if (po.count >= 3 && po.median != null) out.payouts = { v: clamp(lerp(po.median, [[10, 10], [30, 9], [60, 8], [180, 6], [720, 4], [1440, 2], [2880, 0]])), note: 'Median ' + fmtMin(po.median) + ' over ' + po.count + ' reports' };
    var closed = (cp.resolved || 0) + (cp.unresolved || 0);
    if (closed >= 3) out.complaints = { v: clamp(10 * (cp.resolved || 0) / closed), note: (cp.resolved || 0) + ' of ' + closed + ' closed complaints resolved' };
    var f = checks(rv.fairness, CHECKS.fairness);
    if (f.known >= 3) out.fairness = { v: 10 * f.yes / f.known, note: f.yes + ' of ' + f.known + ' checks passed' };
    var lic = rv.licence || {}, comp = checks(rv.compliance, CHECKS.compliance), lv = null;
    if (lic.status === 'licensed') lv = lic.verified ? 10 : 7; else if (lic.status === 'unlicensed') lv = 0;
    if (lv != null || comp.known >= 2) {
      var parts = [], ws = [];
      if (lv != null) { parts.push(lv); ws.push(0.6); }
      if (comp.known >= 2) { parts.push(10 * comp.yes / comp.known); ws.push(0.4); }
      var s = 0, t = 0;
      parts.forEach(function (p, i) { s += p * ws[i]; t += ws[i]; });
      out.licence = { v: s / t, note: lic.status === 'licensed' ? (lic.verified ? 'Licence checked with the regulator' : 'Licence claimed, not yet checked') : lic.status === 'unlicensed' ? 'No licence found' : comp.yes + ' of ' + comp.known + ' compliance checks passed' };
    }
    var g = checks(rv.rg, CHECKS.rg);
    if (g.known >= 3) out.rg = { v: 10 * g.yes / g.known, note: g.yes + ' of ' + g.known + ' tools available' };
    var sp = rv.support || {}, sparts = [];
    if (sp.live24 === 'yes') sparts.push(10); else if (sp.live24 === 'no') sparts.push(3);
    if (sp.responseMins != null && sp.responseMins !== '' && isFinite(sp.responseMins)) sparts.push(lerp(Number(sp.responseMins), [[2, 10], [5, 9], [15, 7], [60, 5], [240, 3], [1440, 0]]));
    if (sparts.length) out.support = { v: sparts.reduce(function (a, b) { return a + b; }, 0) / sparts.length, note: sp.responseMins ? 'First reply in about ' + fmtMin(Number(sp.responseMins)) : (sp.live24 === 'yes' ? '24/7 live chat' : 'No 24/7 live chat') };
    var sc = checks(rv.security, CHECKS.security);
    if (sc.known >= 2) out.security = { v: 10 * sc.yes / sc.known, note: sc.yes + ' of ' + sc.known + ' protections' };

    var sum = 0, wsum = 0;
    var cats = CATS.map(function (c) {
      var x = out[c.id];
      if (x) { sum += x.v * c.w; wsum += c.w; }
      return { id: c.id, name: c.name, w: c.w, src: c.src, what: c.what, rated: !!x, v: x ? Math.round(x.v * 10) / 10 : null, note: x ? x.note : '' };
    });
    var total = wsum ? Math.round(sum / wsum * 10) : null;
    var coverage = wsum / 100;
    var shown = wsum >= 25 ? total : null;
    // Under half the weight rated, a high number would overstate what we know: label it as early, not "Excellent".
    var g = shown != null && coverage < 0.5 ? { label: 'Early score', tone: 'muted' } : grade(shown);
    return { total: shown, coverage: coverage, provisional: coverage < 0.8, rated: cats.filter(function (c) { return c.rated; }).length, cats: cats, grade: g };
  }
  function fmtMin(m) {
    if (m < 1) return 'under a minute';
    if (m < 90) return Math.round(m) + ' min';
    if (m < 48 * 60) return (Math.round(m / 6) / 10) + ' h';
    return Math.round(m / 1440) + ' days';
  }
  return { CATS: CATS, CHECKS: CHECKS, compute: compute, grade: grade, fmtMin: fmtMin };
}));
