/* Streax casino profile: header, 30-day volume, 24h and treasury cards, on-chain
   flows (24h / 7d / 30d), chain split, hot wallets by chain, largest deposits and
   a plain-language "for players" summary. Data from /api/casino/:slug/profile.
   Draws into #sx-profile on the casino page and follows the ?c= casino. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', good: '#4ADE80', bad: '#F87171', warn: '#E7B53C', v: '#8B5CF6', v2: '#A78BFA', track: '#1B1C20' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', good: '#16A34A', bad: '#DC2626', warn: '#B7791F', v: '#6D28D9', v2: '#7C3AED', track: '#EFEFF1' };
  var LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var CHAIN_COL = { Ethereum: '#8C8FFF', Tron: '#E5484D', 'BNB Chain': '#E7B53C', BSC: '#E7B53C', Solana: '#14F195', Polygon: '#A855F7', Bitcoin: '#F7931A', Litecoin: '#9CA3AF', Base: '#3B82F6', Arbitrum: '#60A5FA' };
  var base = NIGHT ? '../' : '';
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
  var st = { slug: null, win: '7d', data: null, trust: null };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) { if (attrs[k] == null) continue; if (k === 'text') el.textContent = attrs[k]; else if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else el.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(v) { if (v == null || isNaN(v)) return '–'; var a = Math.abs(v), s = v < 0 ? '-' : ''; return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a)); }
  function count(v) { v = v || 0; return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString('en-US'); }
  function pct(v, d) { return v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%'; }
  function fmtMin(m) { return m < 60 ? Math.round(m) + ' min' : m < 1440 ? (m / 60).toFixed(1) + ' h' : (m / 1440).toFixed(1) + ' d'; }
  function day(t) { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function logoFor(domain) { return domain && LOGOS.indexOf(domain) >= 0 ? base + 'assets/logos/casinos/' + domain + '.png' : ''; }
  function chg(v) { return v == null || !isFinite(v) ? null : h('span', { class: 'cp-chg ' + (v >= 0 ? 'up' : 'dn'), text: pct(v) }); }
  function card(title, extra, kids, cls) { return h('section', { class: 'cp-card ' + (cls || '') }, [h('div', { class: 'cp-ch' }, [h('span', { class: 'cp-ct', text: title }), extra || null])].concat(kids)); }
  function stat(label, value, note, big) { return h('div', { class: 'cp-stat' + (big ? ' big' : '') }, [h('small', { text: label }), h('b', { text: value }), note ? (typeof note === 'string' ? h('span', { text: note }) : note) : null]); }

  var css = '' +
    '#sx-profile{display:flex;flex-direction:column;gap:16px;margin-bottom:16px}' +
    '.cp-card{background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:16px;padding:18px;min-width:0;animation:cpIn .5s cubic-bezier(.2,.7,.2,1) both}' +
    '@keyframes cpIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.cp-ch{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}' +
    '.cp-ct{font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:' + C.ink + '}' +
    '.cp-sub{font-size:12px;color:' + C.faint + '}' +
    '.cp-head{position:relative;overflow:hidden;border-radius:18px;padding:22px;border:1px solid rgba(139,92,246,.22);background:radial-gradient(60% 120% at 0% 0%,rgba(124,58,237,.40),transparent 60%),radial-gradient(50% 90% at 100% 100%,rgba(99,102,241,.28),transparent 60%),linear-gradient(115deg,#0B0C1E,#0E1030 55%,#15124A);color:#F5F5F5}' +
    '.cp-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap}' +
    '.cp-logo{width:72px;height:72px;border-radius:18px;overflow:hidden;flex:none;background:rgba(255,255,255,.08);display:grid;place-items:center;font-weight:700;font-size:24px;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 14px 30px -14px rgba(0,0,0,.7)}' +
    '.cp-logo img{width:100%;height:100%;object-fit:cover}' +
    '.cp-name{font-size:30px;font-weight:700;letter-spacing:-.03em;line-height:1.1}.cp-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
    '.cp-tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E4E7}' +
    '.cp-tag.v{background:rgba(139,92,246,.18);border-color:rgba(167,139,250,.4);color:#DDD6FE}' +
    '.cp-acts{margin-left:auto;display:flex;gap:8px}' +
    '.cp-btn{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:10px;font-size:13.5px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,.18);color:#fff;background:rgba(255,255,255,.05)}' +
    '.cp-btn.p{border:0;background:linear-gradient(90deg,#A855F7,#7C3AED 55%,#6366F1)}' +
    '.cp-chains{display:flex;gap:6px;flex-wrap:wrap;margin-top:18px;align-items:center;font-size:12px;color:#A1A1AA}' +
    '.cp-dot{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.06);' + MONO + 'font-size:11px;color:#E4E4E7}.cp-dot i{width:7px;height:7px;border-radius:50%}' +
    '.cp-vol{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr);gap:20px;margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}' +
    '.cp-big small{display:block;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#A1A1AA}' +
    '.cp-big b{display:block;' + MONO + 'font-size:40px;font-weight:700;letter-spacing:-.03em;margin:4px 0}' +
    '.cp-big .ln{font-size:13px;color:#A1A1AA;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.cp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;margin-top:16px;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden}' +
    '.cp-kpis div{padding:10px 12px;border-left:1px solid rgba(255,255,255,.1)}.cp-kpis div:nth-child(odd){border-left:0}.cp-kpis div:nth-child(n+3){border-top:1px solid rgba(255,255,255,.1)}' +
    '.cp-kpis small{display:block;white-space:nowrap;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#A1A1AA}.cp-kpis b{display:block;' + MONO + 'font-size:14px;white-space:nowrap;font-weight:600;margin-top:2px}' +
    '.cp-bars{display:flex;align-items:flex-end;gap:3px;height:120px}.cp-bars i{flex:1;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#A78BFA,#6D28D9);min-height:2px;transform-origin:bottom;animation:cpBar .8s cubic-bezier(.2,.7,.2,1) both}' +
    '.cp-bars i:hover{background:#C4B5FD}@keyframes cpBar{from{transform:scaleY(0)}to{transform:none}}' +
    '.cp-bx{display:flex;justify-content:space-between;' + MONO + 'font-size:11px;color:#A1A1AA;margin-top:6px}' +
    '.cp-chg{' + MONO + 'font-size:12px;font-weight:700;padding:2px 7px;border-radius:6px}' +
    '.cp-chg.up{color:' + C.good + ';background:' + (NIGHT ? 'rgba(74,222,128,.12)' : 'rgba(22,163,74,.10)') + '}.cp-chg.dn{color:' + C.bad + ';background:' + (NIGHT ? 'rgba(248,113,113,.12)' : 'rgba(220,38,38,.08)') + '}' +
    '.cp-head .cp-chg.up{color:#4ADE80;background:rgba(74,222,128,.14)}.cp-head .cp-chg.dn{color:#F87171;background:rgba(248,113,113,.14)}' +
    '.cp-row4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}' +
    '.cp-mini{padding:16px}.cp-mini .cp-ch{margin-bottom:8px}' +
    '.cp-stat small{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';font-weight:600}' +
    '.cp-stat b{display:block;' + MONO + 'font-size:22px;font-weight:700;color:' + C.ink + ';margin:3px 0 2px;letter-spacing:-.02em}.cp-stat.big b{font-size:28px}' +
    '.cp-stat span{font-size:12.5px;color:' + C.muted + ';display:flex;gap:6px;align-items:center;flex-wrap:wrap}' +
    '.cp-g2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px}' +
    '.cp-seg{display:inline-flex;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.soft + '}' +
    '.cp-seg button{border:0;background:none;font:inherit;font-size:12.5px;padding:5px 11px;border-radius:7px;color:' + C.muted + ';cursor:pointer}.cp-seg button.on{background:' + C.v + ';color:#fff;font-weight:600}' +
    '.cp-flows{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;border:1px solid ' + C.line + ';border-radius:12px;overflow:hidden;margin-bottom:14px}' +
    '.cp-flows .cp-stat{padding:12px 14px;border-left:1px solid ' + C.line + '}.cp-flows .cp-stat:first-child{border-left:0}.cp-flows .cp-stat b{font-size:16px;white-space:nowrap}' +
    '.cp-leg{display:flex;gap:14px;font-size:12px;color:' + C.muted + '}.cp-leg span{display:flex;align-items:center;gap:6px}.cp-leg i{width:9px;height:9px;border-radius:3px}' +
    '.cp-svg{display:block;width:100%;height:190px}' +
    '.cp-li{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid ' + C.line + ';font-size:13.5px}.cp-li:first-child{border-top:0}' +
    '.cp-li .n{flex:1;min-width:80px;font-weight:500;color:' + C.ink + '}.cp-li .n small{display:block;font-size:11.5px;color:' + C.faint + ';font-weight:400}' +
    '.cp-li .v{' + MONO + 'font-weight:600;color:' + C.ink + ';white-space:nowrap}.cp-li .p{' + MONO + 'font-size:12px;color:' + C.muted + ';flex:none;width:44px;text-align:right}' +
    '.cp-bar{flex:none;width:70px;height:6px;border-radius:3px;background:' + C.track + ';overflow:hidden}.cp-bar i{display:block;height:100%;border-radius:3px}' +
    '.cp-sw{width:10px;height:10px;border-radius:3px;flex:none}' +
    '.cp-tx{' + MONO + 'font-size:12px;color:' + C.v2 + ';text-decoration:none;white-space:nowrap}.cp-tx:hover{text-decoration:underline}' +
    '.cp-faq details{border-top:1px solid ' + C.line + ';padding:12px 0}.cp-faq details:first-of-type{border-top:0}' +
    '.cp-faq summary{cursor:pointer;font-weight:600;color:' + C.ink + ';list-style:none;display:flex;justify-content:space-between;gap:10px}.cp-faq summary::-webkit-details-marker{display:none}' +
    '.cp-faq summary:after{content:"+";color:' + C.v2 + ';font-weight:700}.cp-faq details[open] summary:after{content:"–"}' +
    '.cp-faq p{margin:8px 0 0;color:' + C.muted + ';font-size:13.5px;line-height:1.6}' +
    '.cp-note{font-size:12px;color:' + C.faint + ';line-height:1.6}' +
    '.cp-empty{padding:14px 0;color:' + C.muted + ';font-size:13.5px}' +
    '.cp-sk{height:260px;border-radius:18px;background:linear-gradient(90deg,' + C.soft + ' 25%,' + C.track + ' 50%,' + C.soft + ' 75%);background-size:200% 100%;animation:cpSh 1.2s linear infinite}@keyframes cpSh{to{background-position:-200% 0}}' +
    'html.sx-has-profile #sec-overview{display:none!important}html.sx-has-flows #sec-activity,html.sx-has-flows #sec-wallets{display:none!important}' +
    '@media (max-width:1100px){.cp-row4{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-g2{grid-template-columns:minmax(0,1fr)}.cp-vol{grid-template-columns:minmax(0,1fr)}}' +
    '@media (max-width:640px){.cp-head{padding:16px}.cp-name{font-size:24px}.cp-logo{width:56px;height:56px;border-radius:14px}.cp-acts{margin-left:0;width:100%}.cp-acts .cp-btn{flex:1;justify-content:center}.cp-big b{font-size:32px}.cp-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-kpis div:nth-child(3){border-left:0}.cp-kpis div:nth-child(n+3){border-top:1px solid rgba(255,255,255,.1)}.cp-row4{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.cp-stat b{font-size:18px}.cp-flows{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-flows .cp-stat:nth-child(odd){border-left:0}.cp-flows .cp-stat:nth-child(n+3){border-top:1px solid ' + C.line + '}.cp-bar{width:60px}}' +
    (REDUCED ? '.cp-card,.cp-bars i,.cp-sk{animation:none}' : '');

  function pageCasino(slug) {
    try { var D = window.__sxPage.D; return D.casinos.filter(function (c) { return c.slug === slug; })[0] || null; } catch (e) { return null; }
  }
  function scoreFor(c) { try { var inst = window.__sxPage, s = inst.score(c, inst.D); return s && s.total != null ? s.total : null; } catch (e) { return null; } }

  function lineChart(rows) {
    var ns = 'http://www.w3.org/2000/svg', w = 640, hh = 190, n = rows.length;
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'cp-svg'); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + (hh + 18)); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Daily deposits and withdrawals, 30 days');
    if (n < 2) return svg;
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.dep, r.wd); }).concat([1]));
    var X = function (i) { return i / (n - 1) * w; }, Y = function (v) { return hh - 6 - v / max * (hh - 16); };
    var pts = function (k) { return rows.map(function (r, i) { return X(i).toFixed(1) + ',' + Y(r[k]).toFixed(1); }).join(' '); };
    var gid = 'cpg' + Math.random().toString(36).slice(2, 7), out = '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8B5CF6" stop-opacity=".32"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g < 4; g++) { var y = 10 + g * (hh - 16) / 3; out += '<line x1="0" x2="' + w + '" y1="' + y + '" y2="' + y + '" stroke="' + C.line + '" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>'; }
    out += '<polygon fill="url(#' + gid + ')" points="0,' + hh + ' ' + pts('dep') + ' ' + w + ',' + hh + '"/>';
    out += '<polyline fill="none" stroke="#A78BFA" stroke-width="2.2" vector-effect="non-scaling-stroke" points="' + pts('dep') + '"/>';
    out += '<polyline fill="none" stroke="' + C.bad + '" stroke-width="1.6" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" points="' + pts('wd') + '"/>';
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i, k) { out += '<text x="' + X(i) + '" y="' + (hh + 15) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '" font-size="11" fill="' + C.faint + '" font-family="Geist Mono,monospace">' + day(rows[i].t) + '</text>'; });
    svg.innerHTML = out;
    return svg;
  }

  function render() {
    var host = document.getElementById('sx-profile');
    var P = st.data, pc = pageCasino(st.slug);
    host.innerHTML = '';
    if (!P && !pc) return;
    var name = (P && P.name) || (pc && pc.name) || st.slug, domain = pc && pc.domain;
    var op = (pc && pc.op) || {};
    document.documentElement.classList.add('sx-has-profile');
    document.documentElement.classList.toggle('sx-has-flows', !!(P && P.tracked));

    // ---- header with 30-day volume
    var lg = logoFor(domain), logo = h('span', { class: 'cp-logo' }, [lg ? h('img', { src: lg, alt: '' }) : name.slice(0, 2).toUpperCase()]);
    var tags = [];
    if (P && P.tracked && P.rank30) tags.push(h('span', { class: 'cp-tag v', text: '#' + P.rank30 + ' by 30-day deposits' }));
    else if (pc && pc.rank) tags.push(h('span', { class: 'cp-tag v', text: '#' + pc.rank + ' in the published 24h snapshot' }));
    if (domain) tags.push(h('span', { class: 'cp-tag', text: domain }));
    var lic = op.licence || op.juris;
    if (lic) tags.push(h('span', { class: 'cp-tag', text: (op.licence ? 'Licence: ' : 'Jurisdiction: ') + lic }));
    var sc = pc ? scoreFor(pc) : null;
    if (sc != null) tags.push(h('span', { class: 'cp-tag', text: 'Streax Score ' + Math.round(sc) + '/100' }));
    var head = h('section', { class: 'cp-head' }, [
      h('div', { class: 'cp-top' }, [logo, h('div', {}, [h('div', { class: 'cp-name', text: name }), h('div', { class: 'cp-meta' }, tags)]),
        h('div', { class: 'cp-acts' }, [h('a', { class: 'cp-btn', href: base + 'Wallets.dc.html?c=' + encodeURIComponent(st.slug), text: 'Wallets' }), domain ? h('a', { class: 'cp-btn p', href: 'https://' + domain, target: '_blank', rel: 'noopener nofollow', text: 'Visit site ↗' }) : null])])
    ]);
    var chainsList = (P && P.chainsTracked) || ((pc && pc.chains) || []).map(function (x) { return x[0]; });
    if (chainsList.length) head.appendChild(h('div', { class: 'cp-chains' }, [h('span', { text: chainsList.length + ' chain' + (chainsList.length > 1 ? 's' : '') + (P && P.tracked ? ' tracked' : '') })].concat(chainsList.map(function (c) { return h('span', { class: 'cp-dot' }, [h('i', { style: 'background:' + (CHAIN_COL[c] || '#A1A1AA') }), c]); }))));
    if (P && P.tracked) {
      var d = P.d30, ch30 = d.prevDep > 0 ? (d.dep - d.prevDep) / d.prevDep * 100 : null;
      var mx = Math.max.apply(null, d.daily.map(function (r) { return r.dep; }).concat([1]));
      var largest = P.largest[0];
      head.appendChild(h('div', { class: 'cp-vol' }, [
        h('div', { class: 'cp-big' }, [h('small', { text: 'Deposit volume · 30 days' }), h('b', { text: money(d.dep) }), h('div', { class: 'ln' }, [chg(ch30), h('span', { text: 'vs the 30 days before · ' + P.share30.toFixed(1) + '% of tracked deposits' })]),
          h('div', { class: 'cp-kpis' }, [h('div', {}, [h('small', { text: 'Deposits' }), h('b', { text: count(d.txIn) })]), h('div', {}, [h('small', { text: 'Depositors' }), h('b', { text: count(d.depositors) })]), h('div', {}, [h('small', { text: 'Withdrawals' }), h('b', { text: money(d.wd) })]), h('div', {}, [h('small', { text: 'Largest' }), h('b', { text: largest ? money(largest.usd) : '–' })])])]),
        h('div', {}, [h('div', { class: 'cp-bars', role: 'img', 'aria-label': 'Daily deposits, 30 days' }, d.daily.map(function (r, i) { return h('i', { title: day(r.t) + ': ' + money(r.dep), style: 'height:' + Math.max(2, r.dep / mx * 100) + '%;animation-delay:' + (REDUCED ? 0 : i * 18) + 'ms' }); })),
          h('div', { class: 'cp-bx' }, [h('span', { text: d.daily.length ? day(d.daily[0].t) : '' }), h('span', { text: '30-day daily deposits' }), h('span', { text: d.daily.length ? day(d.daily[d.daily.length - 1].t) : '' })])])
      ]));
    } else {
      head.appendChild(h('div', { class: 'cp-vol' }, [
        h('div', { class: 'cp-big' }, [h('small', { text: 'Deposits · 24h (published snapshot)' }), h('b', { text: pc ? money(pc.dep) : '–' }), h('div', { class: 'ln' }, [h('span', { text: 'Live on-chain tracking is not set up for this casino yet. Figures come from the published snapshot.' })])]),
        h('div', { class: 'cp-kpis' }, [h('div', {}, [h('small', { text: 'Players 24h' }), h('b', { text: pc ? pc.walS || count(pc.wal) : '–' })]), h('div', {}, [h('small', { text: 'Deposits 24h' }), h('b', { text: pc ? pc.cntS || count(pc.cnt) : '–' })]), h('div', {}, [h('small', { text: 'Payouts 24h' }), h('b', { text: pc ? money(pc.pay) : '–' })]), h('div', {}, [h('small', { text: 'Hot wallet' }), h('b', { text: pc ? money(pc.hot) : '–' })])])
      ]));
    }
    host.appendChild(head);

    // ---- mini cards
    var T = st.trust || {}, pay = (T.payouts || {})[st.slug] || {}, cmp = (T.complaints || {})[st.slug] || { total: 0, resolved: 0, open: 0 };
    var mini = [];
    if (P && P.tracked) {
      var f = P.flows['24h'];
      mini.push(card('Deposits · 24h', null, [stat('', money(f.dep), count(f.txIn) + ' deposits · ' + count(f.depositors) + ' wallets')], 'cp-mini'));
      mini.push(card('Hot wallets', null, [stat('', money(P.treasury.total), h('span', {}, [chg(P.treasury.ch24), '24h', chg(P.treasury.ch7), '7d']))], 'cp-mini'));
    } else if (pc) {
      mini.push(card('Hot wallet', null, [stat('', money(pc.hot), 'Published snapshot')], 'cp-mini'));
      mini.push(card('Payout ratio · 24h', null, [stat('', pc.dep ? (pc.pay / pc.dep * 100).toFixed(1) + '%' : '–', 'Payouts ÷ deposits')], 'cp-mini'));
    }
    mini.push(card('Payout speed', null, [stat('', pay.count ? fmtMin(pay.median) : 'No reports', pay.count ? 'Median of ' + pay.count + ' verified reports' : h('a', { href: base + 'Complaints.dc.html', class: 'cp-tx', text: 'Report a payout →' }))], 'cp-mini'));
    mini.push(card('Complaints', null, [stat('', String(cmp.total || 0), (cmp.resolved || 0) + ' resolved · ' + (cmp.open || 0) + ' open')], 'cp-mini'));
    host.appendChild(h('div', { class: 'cp-row4' }, mini));

    if (!P || !P.tracked) return;

    // ---- flows + chain split
    var F = P.flows[st.win];
    var segBtns = [['24h', '24h'], ['7d', '7d'], ['30d', '30d']].map(function (o) { return h('button', { type: 'button', class: o[0] === st.win ? 'on' : '', 'aria-pressed': o[0] === st.win ? 'true' : 'false', text: o[1], on: { click: function () { st.win = o[0]; render(); } } }); });
    var flows = card('On-chain flows · deposits & withdrawals', h('span', { class: 'cp-seg', role: 'group', 'aria-label': 'Period' }, segBtns), [
      h('div', { class: 'cp-flows' }, [stat('Deposited', money(F.dep)), stat('Withdrawn', money(F.wd)), stat('Net flow', (F.dep - F.wd >= 0 ? '+' : '') + money(F.dep - F.wd)), stat('Deposits', count(F.txIn)), stat('Depositors', count(F.depositors))]),
      h('div', { class: 'cp-ch', style: 'margin-bottom:6px' }, [h('span', { class: 'cp-sub', text: 'Daily, last 30 days, US dollars' }), h('span', { class: 'cp-leg' }, [h('span', {}, [h('i', { style: 'background:#A78BFA' }), 'Deposits']), h('span', {}, [h('i', { style: 'background:' + C.bad }), 'Withdrawals'])])]),
      lineChart(P.d30.daily)
    ]);
    var split = card('Chain split · 7-day deposits', h('span', { class: 'cp-sub', text: P.chains7.length + ' chain' + (P.chains7.length === 1 ? '' : 's') }),
      P.chains7.length ? P.chains7.map(function (x) { return h('div', { class: 'cp-li' }, [h('span', { class: 'cp-sw', style: 'background:' + (CHAIN_COL[x.chain] || C.v) }), h('span', { class: 'n', text: x.chain }), h('span', { class: 'cp-bar' }, [h('i', { style: 'width:' + x.pct + '%;background:' + (CHAIN_COL[x.chain] || C.v) })]), h('span', { class: 'v', text: money(x.usd) }), h('span', { class: 'p', text: x.pct.toFixed(1) + '%' })]); })
        : [h('div', { class: 'cp-empty', text: 'No deposits recorded in the last 7 days.' })]);
    host.appendChild(h('div', { class: 'cp-g2' }, [flows, split]));

    // ---- treasury + largest deposits
    var Tr = P.treasury;
    var tre = card('Treasury · hot wallet balances', h('span', { class: 'cp-sub', text: '#' + Tr.rank + ' of ' + Tr.of + ' · ' + Tr.wallets + ' wallets' }), [
      h('div', { style: 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px' }, [h('b', { style: MONO + 'font-size:26px;color:' + C.ink, text: money(Tr.total) }), chg(Tr.ch24), h('span', { class: 'cp-sub', text: '24h' }), chg(Tr.ch7), h('span', { class: 'cp-sub', text: '7d' })])
    ].concat(Tr.chains.map(function (x) { return h('div', { class: 'cp-li' }, [h('span', { class: 'cp-sw', style: 'background:' + (CHAIN_COL[x.chain] || C.v) }), h('span', { class: 'n' }, [x.chain, h('small', { text: (x.coins.join(' · ') || 'no balance') + ' · ' + x.wallets + ' wallet' + (x.wallets > 1 ? 's' : '') })]), h('span', { class: 'cp-bar' }, [h('i', { style: 'width:' + x.pct + '%;background:' + (CHAIN_COL[x.chain] || C.v) })]), h('span', { class: 'v', text: money(x.usd) })]); })));
    var big = card('Largest deposits · 30 days', h('a', { class: 'cp-tx', href: base + 'BetFeed.dc.html', text: 'Whale feed →' }),
      P.largest.length ? P.largest.map(function (w) { return h('div', { class: 'cp-li' }, [h('span', { class: 'n' }, [money(w.usd), h('small', { text: (w.asset || '') + ' on ' + (w.chainName || '') + ' · ' + day(w.ts) })]), h('a', { class: 'cp-tx', href: w.txUrl, target: '_blank', rel: 'noopener', text: 'View tx ↗' })]); })
        : [h('div', { class: 'cp-empty', text: 'No single deposit over $10K in the last 30 days.' })]);
    host.appendChild(h('div', { class: 'cp-g2' }, [tre, big]));

    // ---- for players: plain answers
    var d30 = P.d30, ratio = d30.dep ? d30.wd / d30.dep * 100 : null, top = P.chains7[0];
    var qa = [
      ['How much money do players deposit at ' + name + '?', 'In the last 30 days players deposited ' + money(d30.dep) + ' in ' + count(d30.txIn) + ' deposits from ' + count(d30.depositors) + ' wallets. That ranks #' + P.rank30 + ' of ' + P.of + ' tracked casinos, ' + P.share30.toFixed(1) + '% of all tracked deposits.'],
      ['Does ' + name + ' pay out?', ratio == null ? 'Not enough data yet.' : name + ' sent ' + money(d30.wd) + ' back out in the same 30 days, ' + ratio.toFixed(0) + '% of what came in. ' + (pay.count ? 'Members report a median payout time of ' + fmtMin(pay.median) + ' across ' + pay.count + ' verified withdrawals.' : 'No verified payout-time reports yet; members can add one from the Complaints page.')],
      ['Which coin and chain should I deposit with?', top ? 'Most deposits arrive on ' + top.chain + ' (' + top.pct.toFixed(0) + '% in the last 7 days). Always copy the deposit address from your casino account and check the network before sending.' : 'No recent deposits to compare.'],
      ['How much does ' + name + ' hold in its hot wallets?', money(Tr.total) + ' across ' + Tr.wallets + ' tracked wallets, #' + Tr.rank + ' of ' + Tr.of + ' casinos. Hot wallets are what a casino can pay out today, not everything it owns.'],
      ['Is ' + name + ' safe?', (sc != null ? 'Its Streax Score is ' + Math.round(sc) + '/100. ' : '') + (cmp.total ? cmp.total + ' public complaint' + (cmp.total > 1 ? 's' : '') + ', ' + cmp.resolved + ' resolved and ' + cmp.open + ' still open. ' : 'No public complaints on Streax so far. ') + 'No score replaces your own checks: read the terms, start small and only gamble what you can afford to lose.']
    ];
    host.appendChild(card('For players · ' + name + ' in plain numbers', null, [h('div', { class: 'cp-faq' }, qa.map(function (x, i) { return h('details', i === 0 ? { open: '' } : {}, [h('summary', { text: x[0] }), h('p', { text: x[1] })]); })),
      h('p', { class: 'cp-note', style: 'margin:12px 0 0', text: 'Measured by Streax from the blockchain: deposits and balances are read from this casino\'s own wallets, priced in US dollars. Moves between its own wallets are left out. 18+. Gamble responsibly.' })]));
  }

  var seq = 0;
  function load(slug) {
    st.slug = slug; st.data = null;
    var host = document.getElementById('sx-profile');
    host.innerHTML = ''; host.appendChild(h('div', { class: 'cp-sk' }));
    var my = ++seq;
    var go = function (P) { if (my !== seq) return; st.data = P && P.tracked ? P : null; try { render(); } catch (e) { console.error(e); host.innerHTML = ''; } };
    if (typeof fetch !== 'function') return go(null);
    fetch('/api/casino/' + encodeURIComponent(slug) + '/profile', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(go).catch(function () { go(null); });
  }
  function current() {
    var s = new URLSearchParams(location.search).get('c');
    if (s) return s;
    try { return window.__sxPage.D.casinos[0].slug; } catch (e) { return null; }
  }
  function start() {
    var host = document.getElementById('sx-profile');
    if (!host || !window.__sxPage) return setTimeout(start, 100);
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    if (typeof fetch === 'function') fetch('/api/trust/summary', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { st.trust = j; if (st.data || st.slug) render(); }).catch(function () {});
    var cur = current(); if (cur) load(cur);
    // the page switches casino without reloading: follow the ?c= value
    setInterval(function () { var c = current(); if (c && c !== st.slug) load(c); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
