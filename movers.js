/* Streax Casino movers: trending casino of the period, biggest gainers and
   biggest losers by on-chain deposit volume vs the period before.
   Data from /api/onchain/analytics. Draws into #sx-movers. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', good: '#4ADE80', bad: '#F87171', v: '#8B5CF6', v2: '#A78BFA' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', good: '#16A34A', bad: '#DC2626', v: '#6D28D9', v2: '#7C3AED' };
  var LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var base = NIGHT ? '../' : '';
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
  var MIN = 1e6; // casinos under $1M in the window are left out of gainers and losers
  var days = 30;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else el.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(v) { var a = Math.abs(v); return '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a)); }
  function count(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v || 0)); }
  function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function avatar(c, size) {
    var el = h('span', { class: 'mv-av', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * .34) + 'px' }, [c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()]);
    if (c.domain && LOGOS.indexOf(c.domain) >= 0) { var img = h('img', { src: base + 'assets/logos/casinos/' + c.domain + '.png', alt: '' }); img.onerror = function () { img.remove(); }; el.appendChild(img); }
    return el;
  }

  var css = '' +
    '#sx-movers{margin:18px 0;display:flex;flex-direction:column;gap:14px}' +
    '.mv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}' +
    '.mv-head h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em;color:' + C.ink + '}.mv-head p{margin:3px 0 0;font-size:13.5px;color:' + C.muted + '}' +
    '.mv-seg{display:inline-flex;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.soft + '}' +
    '.mv-seg button{border:0;background:none;font:inherit;font-size:13px;padding:6px 12px;border-radius:7px;color:' + C.muted + ';cursor:pointer;transition:background-color .2s,color .2s}' +
    '.mv-seg button.on{background:' + C.v + ';color:#fff;font-weight:600}' +
    '.mv-grid{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:16px}' +
    '.mv-card{background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:14px;padding:18px;min-width:0;animation:mvIn .55s cubic-bezier(.2,.7,.2,1) both}' +
    '.mv-card:nth-child(2){animation-delay:.07s}.mv-card:nth-child(3){animation-delay:.14s}' +
    '@keyframes mvIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
    '.mv-ct{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:' + C.ink + ';margin-bottom:10px}' +
    '.mv-ct i{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-style:normal;font-size:11px}' +
    '.mv-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid ' + C.line + ';color:inherit;text-decoration:none}.mv-row:first-of-type{border-top:0}' +
    '.mv-row:hover b{text-decoration:underline}' +
    '.mv-rk{width:14px;' + MONO + 'font-size:12px;color:' + C.faint + '}' +
    '.mv-av{position:relative;flex:none;border-radius:9px;overflow:hidden;background:' + C.soft + ';color:' + C.muted + ';font-weight:700;display:grid;place-items:center;box-shadow:0 0 0 1px ' + C.line + '}' +
    '.mv-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.mv-n{flex:1;min-width:0}.mv-n b{display:block;font-weight:600;color:' + C.ink + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mv-n small{' + MONO + 'font-size:11.5px;color:' + C.faint + '}' +
    '.mv-pill{' + MONO + 'font-weight:700;font-size:12.5px;padding:3px 8px;border-radius:7px;white-space:nowrap}' +
    '.mv-up{color:' + C.good + ';background:' + (NIGHT ? 'rgba(74,222,128,.10)' : 'rgba(22,163,74,.09)') + '}.mv-dn{color:' + C.bad + ';background:' + (NIGHT ? 'rgba(248,113,113,.10)' : 'rgba(220,38,38,.08)') + '}' +
    '.mv-foot{font-size:12px;color:' + C.faint + ';margin-top:10px}' +
    '.mv-feat{position:relative;overflow:hidden;background:radial-gradient(90% 120% at 100% 0%,rgba(139,92,246,' + (NIGHT ? '.28' : '.14') + '),transparent 60%),' + C.card + '}' +
    '.mv-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + C.v2 + ';background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.35);padding:4px 10px;border-radius:999px}' +
    '.mv-fh{display:flex;align-items:center;gap:14px;margin:14px 0 2px;text-decoration:none;color:inherit}' +
    '.mv-fh h3{margin:0;font-size:24px;font-weight:700;letter-spacing:-.03em;color:' + C.ink + '}.mv-fh p{margin:2px 0 0;font-size:13px;color:' + C.muted + '}' +
    '.mv-big{display:flex;align-items:baseline;gap:10px;margin:12px 0 4px}.mv-big b{' + MONO + 'font-size:36px;font-weight:700;letter-spacing:-.03em}.mv-big span{font-size:13px;color:' + C.muted + '}' +
    '.mv-stats{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid ' + C.line + ';border-radius:12px;overflow:hidden;margin-top:12px}' +
    '.mv-stats div{padding:10px 12px;border-left:1px solid ' + C.line + ';min-width:0}.mv-stats div:first-child{border-left:0}' +
    '.mv-stats small{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + '}.mv-stats b{display:block;' + MONO + 'font-size:15px;font-weight:600;margin-top:2px;color:' + C.ink + '}' +
    '.mv-why{margin:12px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:13px;color:' + C.muted + '}' +
    '.mv-why li{display:flex;gap:8px}.mv-why li:before{content:"";width:6px;height:6px;border-radius:50%;background:' + C.v + ';margin-top:7px;flex:none}' +
    '.mv-line{display:block;width:100%;height:64px;margin-top:6px}' +
    '.mv-empty{padding:18px 0;color:' + C.muted + ';font-size:13.5px}' +
    '@media (max-width:1100px){.mv-grid{grid-template-columns:1fr 1fr}.mv-feat{grid-column:1/-1}}' +
    '@media (max-width:640px){.mv-grid{grid-template-columns:minmax(0,1fr)}.mv-big b{font-size:30px}.mv-stats b{font-size:13.5px}}' +
    (REDUCED ? '.mv-card{animation:none}' : '');

  function line(vals) {
    var ns = 'http://www.w3.org/2000/svg', n = vals.length, max = Math.max.apply(null, vals.concat([1])), w = 400, hh = 64;
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'mv-line'); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    if (n < 2) return svg;
    var pts = vals.map(function (v, i) { return (i / (n - 1) * w).toFixed(1) + ',' + (hh - 4 - v / max * (hh - 10)).toFixed(1); }).join(' ');
    var gid = 'mvg' + Math.random().toString(36).slice(2, 7);
    svg.innerHTML = '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8B5CF6" stop-opacity=".35"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></linearGradient></defs>' +
      '<polygon fill="url(#' + gid + ')" points="0,' + hh + ' ' + pts + ' ' + w + ',' + hh + '"/><polyline fill="none" stroke="' + C.v2 + '" stroke-width="2.4" vector-effect="non-scaling-stroke" points="' + pts + '"/>';
    return svg;
  }

  function render(D) {
    var host = document.getElementById('sx-movers');
    host.innerHTML = '';
    var all = (D && D.casinos || []).filter(function (c) { return c.depTotal > 0; });
    var total = all.reduce(function (s, c) { return s + c.depTotal; }, 0) || 1;
    var nowRank = all.slice().sort(function (a, b) { return b.depTotal - a.depTotal; }), prevRank = all.slice().sort(function (a, b) { return b.prevDep - a.prevDep; });
    var rk = function (list, c) { return list.indexOf(c) + 1; };
    var rated = all.filter(function (c) { return c.depTotal >= MIN && c.prevDep > 0; }).map(function (c) { return { c: c, p: (c.depTotal - c.prevDep) / c.prevDep * 100 }; });
    var gainers = rated.filter(function (x) { return x.p > 0; }).sort(function (a, b) { return b.p - a.p; }).slice(0, 5);
    var losers = rated.filter(function (x) { return x.p < 0; }).sort(function (a, b) { return a.p - b.p; }).slice(0, 5);
    var label = { 7: 'week', 30: 'month', 90: 'quarter' }[days];

    host.appendChild(h('div', { class: 'mv-head' }, [h('div', {}, [h('h2', { text: 'Casino movers' }), h('p', { text: 'Who grew, who cooled off, and the casino to watch. From on-chain deposits vs the ' + days + ' days before.' })]),
      h('div', { class: 'mv-seg', role: 'group', 'aria-label': 'Period' }, [[7, '7D'], [30, '30D'], [90, '90D']].map(function (o) { return h('button', { type: 'button', class: o[0] === days ? 'on' : '', 'aria-pressed': o[0] === days ? 'true' : 'false', text: o[1], on: { click: function () { days = o[0]; load(); } } }); }))]));
    if (!rated.length) { host.appendChild(h('div', { class: 'mv-card mv-empty', text: 'Movers appear once the on-chain monitor has two full periods of deposits to compare.' })); return; }

    var grid = h('div', { class: 'mv-grid' });
    // trending: strongest growth, weighted by depositors so a tiny casino cannot win on a fluke
    var best = gainers.slice().sort(function (a, b) { return b.p * Math.log10(10 + (b.c.depositors || 0)) - a.p * Math.log10(10 + (a.c.depositors || 0)); })[0];
    if (best) {
      var c = best.c, rNow = rk(nowRank, c), rPrev = rk(prevRank, c);
      var why = [];
      var mostDep = all.slice().sort(function (a, b) { return (b.depositors || 0) - (a.depositors || 0); })[0];
      if (mostDep === c) why.push('More depositors than any other casino this ' + label);
      else why.push(count(c.depositors || 0) + ' depositing wallets this ' + label);
      if (rPrev > rNow) why.push('Climbed from #' + rPrev + ' to #' + rNow + ' by deposit volume');
      var bigs = ((D.biggest || {}).in || []).filter(function (w) { return w.slug === c.slug; });
      if (bigs.length) why.push(bigs.length + ' whale deposit' + (bigs.length > 1 ? 's' : '') + ', the largest ' + money(bigs[0].usd) + (bigs[0].chainName ? ' on ' + bigs[0].chainName : ''));
      why.push('Net flow ' + (c.depTotal - c.wdTotal >= 0 ? '+' : '-') + money(c.depTotal - c.wdTotal) + ' this ' + label);
      grid.appendChild(h('section', { class: 'mv-card mv-feat' }, [
        h('span', { class: 'mv-badge', text: '★ Trending casino of the ' + label }),
        h('a', { class: 'mv-fh', href: base + 'Casino.dc.html?c=' + encodeURIComponent(c.slug) }, [avatar(c, 56), h('div', {}, [h('h3', { text: c.name }), h('p', { text: rPrev === rNow ? 'Holds #' + rNow + ' by deposits' : 'Rank #' + rPrev + ' → #' + rNow + ' by deposits' })])]),
        h('div', { class: 'mv-big' }, [h('b', { style: 'color:' + C.good, text: pct(best.p) }), h('span', { text: 'deposits vs the previous ' + days + ' days' })]),
        line(c.dep || []),
        h('div', { class: 'mv-stats' }, [h('div', {}, [h('small', { text: 'Deposits ' + days + 'D' }), h('b', { text: money(c.depTotal) })]), h('div', {}, [h('small', { text: 'Depositors' }), h('b', { text: count(c.depositors || 0) })]), h('div', {}, [h('small', { text: 'Market share' }), h('b', { text: (c.depTotal / total * 100).toFixed(1) + '%' })])]),
        h('ul', { class: 'mv-why' }, why.slice(0, 3).map(function (t) { return h('li', { text: t }); }))
      ]));
    }
    var list = function (title, icon, cls, rows, foot) {
      return h('section', { class: 'mv-card' }, [h('div', { class: 'mv-ct' }, [h('i', { class: cls, text: icon }), title]),
        rows.length ? h('div', {}, rows.map(function (x, i) {
          return h('a', { class: 'mv-row', href: base + 'Casino.dc.html?c=' + encodeURIComponent(x.c.slug) }, [h('span', { class: 'mv-rk', text: String(i + 1) }), avatar(x.c, 30), h('span', { class: 'mv-n' }, [h('b', { text: x.c.name }), h('small', { text: money(x.c.depTotal) })]), h('span', { class: 'mv-pill ' + cls, text: pct(x.p) })]);
        })) : h('div', { class: 'mv-empty', text: 'No ' + (cls === 'mv-up' ? 'gainers' : 'losers') + ' this period.' }),
        h('div', { class: 'mv-foot', text: foot })]);
    };
    grid.appendChild(list('Biggest gainers', '▲', 'mv-up', gainers, 'Deposit volume vs the previous ' + days + ' days'));
    grid.appendChild(list('Biggest losers', '▼', 'mv-dn', losers, 'Casinos under $1M deposits are left out'));
    host.appendChild(grid);
  }

  var seq = 0;
  function load() {
    var my = ++seq;
    fetch('/api/onchain/analytics?days=' + days, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (D) { if (my === seq) render(D); }).catch(function () { if (my === seq) render(null); });
  }
  function start() {
    var host = document.getElementById('sx-movers');
    if (!host) return setTimeout(start, 100);
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    if (typeof fetch === 'function') load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
