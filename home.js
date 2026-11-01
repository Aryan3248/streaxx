/* Streax Home grid: compact data cards in the style of a market terminal.
   Score rings, market share, biggest moves, insights and hot wallets, all from
   /api/onchain/analytics plus the page's own Streax Score. Draws into #sx-home. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', accent: '#8B5CF6', good: '#4ADE80', bad: '#F87171', track: '#1B1C20' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', accent: '#6D28D9', good: '#16A34A', bad: '#DC2626', track: '#EFEFF1' };
  var SHARE = ['#8B5CF6', '#6D28D9', '#C4B5FD', '#6B6D72', '#3A3B40'];
  var LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var base = NIGHT ? '../' : '';
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;";

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'html') el.innerHTML = attrs[k]; else el.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(v) { var a = Math.abs(v), s = v < 0 ? '-' : ''; return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a)); }
  function pct(a, b) { return b > 0 ? (a - b) / b * 100 : null; }
  function logo(domain) { return domain && LOGOS.indexOf(domain) >= 0 ? base + 'assets/logos/casinos/' + domain + '.png' : domain ? 'https://www.google.com/s2/favicons?sz=64&domain=' + domain : ''; }
  function avatar(name, domain, size) {
    size = size || 26;
    var el = h('span', { class: 'hx-av', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px' }, [name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()]);
    var src = logo(domain);
    if (src) { var img = h('img', { src: src, alt: '', loading: 'lazy' }); img.onerror = function () { img.remove(); }; el.appendChild(img); }
    return el;
  }
  function card(title, link, kids, cls) {
    return h('section', { class: 'hx-card ' + (cls || '') }, [h('div', { class: 'hx-head' }, [h('span', { class: 'hx-title', text: title }), link ? h('a', { class: 'hx-more', href: base + link[1], 'aria-label': link[0] }, [link[0] + ' ', h('span', { 'aria-hidden': 'true', text: '→' })]) : null])].concat(kids));
  }

  var css = '' +
    '#sx-home{margin-top:18px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}' +
    '.hx-card{border-radius:20px;border:1px solid ' + C.line + ';background:' + C.card + ';padding:20px;display:flex;flex-direction:column;gap:12px;min-width:0;' + (NIGHT ? '' : 'box-shadow:0 1px 2px rgba(10,11,14,.04),0 14px 40px -28px rgba(10,11,14,.10);') + 'transition:transform .25s cubic-bezier(.2,.7,.2,1),border-color .25s}' +
    '.hx-card:hover{transform:translateY(-2px);border-color:' + (NIGHT ? '#2A2C31' : '#DBDBE0') + '}' +
    '.hx-span2{grid-column:span 2}' +
    '.hx-head{display:flex;justify-content:space-between;align-items:center;gap:10px}' +
    '.hx-title{font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + C.ink + '}' +
    '.hx-more{font-size:13px;color:' + C.accent + ';text-decoration:none;white-space:nowrap}.hx-more:hover{text-decoration:underline}' +
    '.hx-av{position:relative;flex:none;border-radius:50%;background:' + C.soft + ';color:' + C.muted + ';font-weight:600;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 0 1px ' + C.line + '}' +
    '.hx-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:' + C.card + '}' +
    '.hx-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid ' + C.line + ';color:inherit;text-decoration:none;font-size:14px}' +
    '.hx-row:first-of-type{border-top:0}.hx-row .n{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hx-v{' + MONO + 'font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.hx-up{color:' + C.good + '}.hx-dn{color:' + C.bad + '}' +
    '.hx-chip{' + MONO + 'font-size:11px;color:' + C.faint + ';border:1px solid ' + C.line + ';border-radius:6px;padding:1px 5px}' +
    '.hx-rings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center;padding:4px 0}' +
    '.hx-ring svg{display:block;margin:0 auto 8px}.hx-ring a{color:inherit;text-decoration:none;font-weight:500;font-size:14px}.hx-ring small{display:block;font-size:12px;margin-top:2px}' +
    '.hx-ring circle.p{transition:stroke-dashoffset 1.3s cubic-bezier(.2,.7,.2,1)}' +
    '.hx-bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:' + C.track + '}' +
    '.hx-bar span{height:100%;transform-origin:left;transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}' +
    '.hx-mini{flex:none;width:70px;height:6px;border-radius:3px;background:' + C.track + ';overflow:hidden}.hx-mini span{display:block;height:100%;border-radius:3px;transform-origin:left;transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}' +
    '.hx-ins{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}' +
    '.hx-in{border:1px solid ' + C.line + ';background:' + C.soft + ';border-radius:14px;padding:14px;min-width:0}' +
    '.hx-in small{display:block;color:' + C.muted + ';font-size:12.5px}' +
    '.hx-in b{display:block;margin:4px 0 6px;font-weight:600;letter-spacing:-.01em}' +
    '.hx-in div{display:flex;align-items:center;gap:7px;color:' + C.muted + ';font-size:12.5px;min-width:0}.hx-in div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hx-sub{font-size:12px;color:' + C.faint + '}' +
    '.hx-lbl{font-size:12px;color:' + C.faint + ';margin-top:2px}' +
    '.hx-wait{opacity:0;transform:translateY(12px)}.hx-show{opacity:1;transform:none;transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}' +
    '@media (max-width:1100px){#sx-home{grid-template-columns:repeat(2,minmax(0,1fr))}.hx-span2{grid-column:span 2}}' +
    '@media (max-width:640px){#sx-home{grid-template-columns:minmax(0,1fr);gap:14px}.hx-span2{grid-column:auto}.hx-ins{grid-template-columns:repeat(2,minmax(0,1fr))}.hx-card{padding:16px}}' +
    (REDUCED ? '.hx-card,.hx-bar span,.hx-mini span,.hx-ring circle.p{transition:none!important}' : '');

  function scores() {
    var inst = window.__sxPage, out = [];
    try {
      inst.D.casinos.forEach(function (c) { var s = inst.score(c, inst.D); if (s && s.total) out.push({ name: c.name || c.n, slug: c.slug, domain: c.domain, total: s.total }); });
    } catch (e) {}
    return out.sort(function (a, b) { return b.total - a.total; }).slice(0, 7);
  }

  function ring(v, max) {
    var r = 30, len = 2 * Math.PI * r, col = v / max >= 0.8 ? C.good : C.accent, ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', 78); svg.setAttribute('height', 78); svg.setAttribute('viewBox', '0 0 78 78');
    var bg = document.createElementNS(ns, 'circle'); [['cx', 39], ['cy', 39], ['r', r], ['fill', 'none'], ['stroke', C.track], ['stroke-width', 6]].forEach(function (a) { bg.setAttribute(a[0], a[1]); });
    var p = document.createElementNS(ns, 'circle'); [['cx', 39], ['cy', 39], ['r', r], ['fill', 'none'], ['stroke', col], ['stroke-width', 6], ['stroke-linecap', 'round'], ['transform', 'rotate(-90 39 39)'], ['class', 'p'], ['stroke-dasharray', len], ['stroke-dashoffset', len]].forEach(function (a) { p.setAttribute(a[0], a[1]); });
    p.__to = len * (1 - Math.max(0, Math.min(1, v / max)));
    var t = document.createElementNS(ns, 'text'); [['x', 39], ['y', 46], ['text-anchor', 'middle'], ['fill', C.ink], ['font-size', 20], ['font-weight', 600], ['font-family', 'Geist Mono, ui-monospace, monospace']].forEach(function (a) { t.setAttribute(a[0], a[1]); });
    t.textContent = String(Math.round(v));
    svg.appendChild(bg); svg.appendChild(p); svg.appendChild(t);
    return svg;
  }

  function build(D) {
    var host = document.getElementById('sx-home');
    if (!host) return;
    host.innerHTML = '';
    var cs = (D.casinos || []).filter(function (c) { return c.depTotal > 0; }).sort(function (a, b) { return b.depTotal - a.depTotal; });
    if (!cs.length) { host.style.display = 'none'; return; }
    host.style.display = '';
    var total = cs.reduce(function (s, c) { return s + c.depTotal; }, 0) || 1;

    // Streax score rings
    var sc = scores();
    if (sc.length) {
      host.appendChild(card('Streax Score', ['Rankings', 'Rankings.dc.html'], [
        h('div', { class: 'hx-rings' }, sc.slice(0, 3).map(function (s) {
          return h('div', { class: 'hx-ring' }, [ring(s.total, 100), h('a', { href: base + 'Casino.dc.html?c=' + s.slug, text: s.name }), h('small', { class: s.total >= 80 ? 'hx-up' : '', style: s.total >= 80 ? '' : 'color:' + C.muted, text: s.total >= 80 ? 'Strong' : s.total >= 60 ? 'Fair' : 'Weak' })]);
        })),
        h('div', {}, sc.slice(3).map(function (s, i) {
          return h('a', { class: 'hx-row', href: base + 'Casino.dc.html?c=' + s.slug }, [h('span', { class: 'hx-v', style: 'width:18px;color:' + C.faint + ';font-weight:500', text: String(i + 4) }), h('span', { class: 'n', text: s.name }), h('span', { class: 'hx-mini' }, [h('span', { style: 'width:' + s.total + '%;background:' + (s.total >= 80 ? C.good : C.accent) + ';transform:scaleX(0)' })]), h('span', { class: 'hx-v', style: 'width:30px;text-align:right', text: String(Math.round(s.total)) })]);
        })),
        h('div', { class: 'hx-sub', text: 'Out of 100 · higher is safer · method published' })
      ]));
    }

    // market share
    var top = cs.slice(0, 5), rest = total - top.reduce(function (s, c) { return s + c.depTotal; }, 0);
    var bar = h('div', { class: 'hx-bar', role: 'img', 'aria-label': 'Deposit share of the top five casinos' }, top.map(function (c, i) { return h('span', { style: 'width:' + (c.depTotal / total * 100) + '%;background:' + SHARE[i] + ';transform:scaleX(0)' }); }));
    host.appendChild(card('Market share · 7D', ['Analytics', 'Analytics.dc.html'], [
      h('div', { class: 'hx-sub', html: '<b style="color:' + C.ink + '">' + (top.slice(0, 3).reduce(function (s, c) { return s + c.depTotal; }, 0) / total * 100).toFixed(1) + '%</b> of tracked deposits went to the top 3' }),
      bar,
      h('div', {}, top.map(function (c, i) {
        return h('a', { class: 'hx-row', href: base + 'Casino.dc.html?c=' + c.slug }, [h('span', { style: 'width:10px;height:10px;border-radius:3px;flex:none;background:' + SHARE[i] }), h('span', { class: 'n', text: c.name }), h('span', { class: 'hx-v', style: 'color:' + C.muted + ';font-weight:500', text: money(c.depTotal) }), h('span', { class: 'hx-v', style: 'width:52px;text-align:right', text: (c.depTotal / total * 100).toFixed(1) + '%' })]);
      }).concat(rest > 0 ? [h('div', { class: 'hx-row' }, [h('span', { style: 'width:10px;height:10px;border-radius:3px;flex:none;background:' + C.track }), h('span', { class: 'n', style: 'color:' + C.muted, text: (cs.length - top.length) + ' others' }), h('span', { class: 'hx-v', style: 'width:52px;text-align:right;color:' + C.muted, text: (rest / total * 100).toFixed(1) + '%' })])] : []))
    ]));

    // biggest moves
    var big = D.biggest || { in: [], out: [] };
    var mv = function (w) { return h('a', { class: 'hx-row', href: w.txUrl || '#', target: '_blank', rel: 'noopener' }, [avatar(w.name, w.domain, 24), h('span', { class: 'n', text: w.name }), h('span', { class: 'hx-chip', text: (w.asset || '') + (w.chainName ? ' · ' + w.chainName : '') }), h('span', { class: 'hx-v ' + (w.dir === 'in' ? 'hx-up' : 'hx-dn'), text: (w.dir === 'in' ? '+' : '-') + money(w.usd) })]); };
    if ((big.in || []).length || (big.out || []).length) {
      host.appendChild(card('Biggest moves · 7D', ['Whale feed', 'BetFeed.dc.html'], [
        h('div', { class: 'hx-lbl', text: 'Deposits' }), h('div', {}, (big.in || []).slice(0, 3).map(mv)),
        h('div', { class: 'hx-lbl', text: 'Withdrawals' }), h('div', {}, (big.out || []).slice(0, 3).map(mv))
      ]));
    }

    // insights
    var withPrev = cs.filter(function (c) { return c.prevDep > 0 && c.depTotal > 1e5; }).map(function (c) { return { c: c, p: pct(c.depTotal, c.prevDep) }; });
    var gain = withPrev.slice().sort(function (a, b) { return b.p - a.p; })[0], drop = withPrev.slice().sort(function (a, b) { return a.p - b.p; })[0];
    var most = cs.slice().sort(function (a, b) { return b.depositors - a.depositors; })[0];
    var hot = cs.slice().sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); })[0];
    var bal = cs.reduce(function (s, c) { return s + (c.balance || 0); }, 0);
    var bd = (big.in || [])[0];
    var tiles = [];
    var tile = function (label, val, color, c, note) { tiles.push(h('div', { class: 'hx-in' }, [h('small', { text: label }), h('b', { style: MONO + 'font-size:24px;color:' + (color || C.ink), text: val }), h('div', {}, [c ? avatar(c.name, c.domain, 18) : null, h('span', { text: note })])])); };
    if (gain && gain.p > 0) tile('Biggest gainer', '+' + gain.p.toFixed(1) + '%', C.good, gain.c, gain.c.name + ' vs last week');
    if (drop && drop.p < 0) tile('Biggest drop', drop.p.toFixed(1) + '%', C.bad, drop.c, drop.c.name + ' vs last week');
    tile('Deposits · 7D', money(total), null, null, cs.length + ' casinos on-chain');
    var wdT = cs.reduce(function (s2, c) { return s2 + (c.wdTotal || 0); }, 0);
    tile('Withdrawals · 7D', money(wdT), null, null, 'Paid out to players');
    tile('Net flow · 7D', (total - wdT >= 0 ? '+' : '') + money(total - wdT), total - wdT >= 0 ? C.good : C.bad, null, 'Deposits minus withdrawals');
    if (bd) tile('Biggest deposit', money(bd.usd), null, bd, bd.name + ' on ' + (bd.chainName || 'chain'));
    if (most && most.depositors) tile('Most depositors', String(most.depositors >= 1000 ? (most.depositors / 1000).toFixed(1) + 'K' : most.depositors), null, most, most.name);
    if (bal) tile('Hot wallet total', money(bal), null, hot, 'Largest: ' + (hot ? hot.name : ''));
    host.appendChild(card('Insights · this week', ['Analytics', 'Analytics.dc.html'], [h('div', { class: 'hx-ins' }, tiles.slice(0, tiles.length >= 6 ? 6 : 3))], 'hx-span2'));

    // hot wallets
    var hw = cs.filter(function (c) { return c.balance > 0; }).sort(function (a, b) { return b.balance - a.balance; }).slice(0, 5);
    if (hw.length) {
      var maxB = hw[0].balance;
      host.appendChild(card('Hot wallets', ['Casino wallets', 'Wallets.dc.html'], [
        h('div', {}, hw.map(function (c) {
          var chains = Object.keys(c.chainBal || {});
          return h('a', { class: 'hx-row', href: base + 'Wallets.dc.html?c=' + c.slug }, [avatar(c.name, c.domain, 24), h('span', { class: 'n', text: c.name }), h('span', { class: 'hx-mini' }, [h('span', { style: 'width:' + (c.balance / maxB * 100) + '%;background:' + C.accent + ';transform:scaleX(0)' })]), h('span', { class: 'hx-v', style: 'min-width:72px;text-align:right', text: money(c.balance) })]);
        })),
        h('div', { class: 'hx-sub', text: 'Live balances read from the blockchain · ' + (function () { var n = {}; hw.forEach(function (c) { Object.keys(c.chainBal || {}).forEach(function (k) { n[k] = 1; }); }); return Object.keys(n).join(', '); })() })
      ]));
    }

    // entrance: cards rise one after another, then bars grow and rings fill
    var cards = host.querySelectorAll('.hx-card');
    var go = function (el, i) {
      setTimeout(function () {
        el.classList.add('hx-show');
        el.querySelectorAll('.hx-bar span, .hx-mini span').forEach(function (s, k) { setTimeout(function () { s.style.transform = 'scaleX(1)'; }, 150 + k * 70); });
        el.querySelectorAll('circle.p').forEach(function (p) { setTimeout(function () { p.setAttribute('stroke-dashoffset', p.__to); }, 150); });
      }, REDUCED ? 0 : i * 80);
    };
    if (REDUCED || !('IntersectionObserver' in window)) { cards.forEach(function (el, i) { go(el, 0); }); return; }
    cards.forEach(function (el) { el.classList.add('hx-wait'); });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); go(e.target, Array.prototype.indexOf.call(cards, e.target) % 3); } });
    }, { threshold: 0.15 });
    cards.forEach(function (el) { io.observe(el); });
  }

  // Hero: tilted glass cards for the five biggest casinos. Live 7-day deposits
  // when the monitor has them, otherwise the published 24h snapshot.
  function heroCards(D) {
    var hero = document.querySelector('.sx-hero');
    if (!hero) return;
    var old = hero.querySelector('.hx-deck'); if (old) old.remove();
    var list = [], live = false;
    if (D && D.casinos) { list = D.casinos.filter(function (c) { return c.depTotal > 0; }).sort(function (a, b) { return b.depTotal - a.depTotal; }).slice(0, 5).map(function (c) { return { name: c.name, domain: c.domain, slug: c.slug, v: money(c.depTotal) }; }); live = list.length >= 3; }
    if (!live) {
      try { list = window.__sxPage.D.casinos.slice().sort(function (a, b) { return b.dep - a.dep; }).slice(0, 5).map(function (c) { return { name: c.name || c.n, domain: c.domain, slug: c.slug, v: money(c.dep) }; }); } catch (e) { list = []; }
    }
    if (!list.length) return;
    var deck = h('div', { class: 'hx-deck', 'aria-label': 'Top casinos by deposits' });
    list.forEach(function (c, i) {
      var src = logo(c.domain);
      deck.appendChild(h('a', { class: 'hx-tile', href: base + 'Casino.dc.html?c=' + encodeURIComponent(c.slug), style: '--i:' + i, title: c.name + ': ' + c.v + (live ? ' deposits, 7 days' : ' deposits, 24h') }, [
        src ? h('img', { src: src, alt: '' }) : h('span', { class: 'hx-ini', text: c.name.slice(0, 2).toUpperCase() }),
        h('b', { text: c.name.replace(/\.com$/, '') }), h('small', { text: c.v })
      ]));
    });
    hero.appendChild(deck);
  }
  var heroCss = '' +
    '.sx-hero .hx-deck{position:relative;flex:none;margin-left:auto;display:flex;align-items:center;z-index:2;padding:10px 6px 10px 20px}' +
    '.hx-tile{--r:calc((var(--i) - 2) * 5deg);width:112px;height:118px;margin-left:-16px;border-radius:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:#fff;' +
      'background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.16);box-shadow:0 24px 50px -24px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.18);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
      'transform:translateY(calc(var(--i) * 9px - 18px)) rotate(var(--r));transition:transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .35s;animation:hxIn .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i) * 90ms + 150ms)}' +
    '.hx-tile:nth-child(odd){transform:translateY(calc(var(--i) * 9px - 30px)) rotate(var(--r))}' +
    '.hx-tile:hover{transform:translateY(-14px) rotate(0) scale(1.06);z-index:3;box-shadow:0 30px 60px -20px rgba(139,92,246,.6),inset 0 1px 0 rgba(255,255,255,.25)}' +
    '.hx-tile img,.hx-ini{width:52px;height:52px;border-radius:14px;box-shadow:0 6px 18px -6px rgba(0,0,0,.6)}' +
    '.hx-ini{display:grid;place-items:center;background:rgba(255,255,255,.12);font-weight:700}' +
    '.hx-tile b{max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600;letter-spacing:-.01em}.hx-tile small{font:600 11.5px ' + "'Geist Mono',monospace" + ';color:#C4B5FD}' +
    '@keyframes hxIn{from{opacity:0;translate:0 24px}to{opacity:1;translate:0 0}}' +
    '@media (max-width:1380px){.hx-tile{width:96px;height:104px}.hx-tile img,.hx-ini{width:40px;height:40px}.hx-tile small{font-size:10.5px}}' +
    '@media (max-width:1240px){.sx-hero .hx-deck{margin:24px 0 0;padding:0;justify-content:flex-start;flex-wrap:wrap;gap:10px}.hx-tile{margin-left:0;transform:none!important;width:104px;height:104px}}' +
    '@media (max-width:640px){.sx-hero .hx-deck{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;width:100%}.hx-tile{width:auto;height:auto;aspect-ratio:1;border-radius:16px;gap:4px;padding:6px 2px}.hx-tile img,.hx-ini{width:32px;height:32px;border-radius:9px}.hx-tile b{font-size:10.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hx-tile small{display:none}}' +
    (REDUCED ? '.hx-tile{animation:none}' : '');
  function start() {
    if (!document.getElementById('sx-home')) return setTimeout(start, 100);
    var st = document.createElement('style'); st.textContent = css + heroCss; document.head.appendChild(st);
    heroCards(null);
    if (typeof fetch !== 'function') return;
    fetch('/api/onchain/analytics?days=7', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (D) { heroCards(D); if (D) build(D); else document.getElementById('sx-home').style.display = 'none'; })
      .catch(function () { document.getElementById('sx-home').style.display = 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
