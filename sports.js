/* Streax Sports odds: compare sportsbook prices per match (best price highlighted),
   rank books by margin, check a pasted bet slip, and browse sports prediction
   markets. Data from /api/odds/*. Draws into #sx-page. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', accent: '#8B5CF6', good: '#4ADE80', bad: '#F87171', warn: '#E7B53C', track: '#1B1C20', best: 'rgba(139,92,246,.16)' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', accent: '#6D28D9', good: '#16A34A', bad: '#DC2626', warn: '#B7791F', track: '#EFEFF1', best: 'rgba(109,40,217,.10)' };
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
  var TABS = [['odds', 'Odds comparison'], ['books', 'Sportsbook ranking'], ['slip', 'Paste a slip'], ['predict', 'Prediction markets']];
  var q = new URLSearchParams(location.search);
  var st = { tab: TABS.some(function (t) { return t[0] === q.get('tab'); }) ? q.get('tab') : 'odds', league: q.get('league') || '', leagues: [], ready: null, open: {} };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (attrs[k] != null) el.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function getJ(url, opts) { return fetch(url, Object.assign({ cache: 'no-store' }, opts || {})).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); }); }
  function when(iso) { var d = new Date(iso), now = new Date(), tm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); if (d - now < 0) return 'Live · started ' + tm; var days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5); return (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + tm; }
  function usd(v) { return '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : Math.round(v)); }
  function ini(s) { return String(s).replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }

  var css = '' +
    '#sx-page{margin-top:2px;display:flex;flex-direction:column;gap:16px}' +
    '.sp-tabs{display:flex;gap:2px;border-bottom:1px solid ' + C.line + ';overflow-x:auto;scrollbar-width:none}' +
    '.sp-tabs button{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:10px 14px;font:inherit;font-size:14px;color:' + C.muted + ';cursor:pointer;white-space:nowrap;transition:color .2s,border-color .2s}' +
    '.sp-tabs button.on{color:' + C.ink + ';border-color:' + C.accent + ';font-weight:600}' +
    '.sp-chips{display:flex;gap:8px;flex-wrap:wrap}' +
    '.sp-chip{border:1px solid ' + C.line + ';background:' + C.card + ';color:' + C.muted + ';font:inherit;font-size:13px;border-radius:999px;padding:6px 13px;cursor:pointer;transition:all .2s}' +
    '.sp-chip.on{background:' + C.accent + ';border-color:' + C.accent + ';color:' + (NIGHT ? '#FFFFFF' : '#fff') + ';font-weight:600}' +
    '.sp-card{border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:14px;overflow:hidden}' +
    '.sp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}' +
    '.sp-mh{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px 10px}' +
    '.sp-mh b{font-size:15px;font-weight:600;letter-spacing:-.01em}.sp-mh small{display:block;font-size:12px;color:' + C.faint + ';margin-top:3px}' +
    '.sp-n{font:600 11px ' + "'Geist Mono',monospace" + ';color:' + C.muted + ';border:1px solid ' + C.line + ';border-radius:6px;padding:2px 7px;white-space:nowrap}' +
    '.sp-t{width:100%;border-collapse:collapse;font-size:13px}' +
    '.sp-t th{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + C.faint + ';text-align:right;padding:6px 16px;border-top:1px solid ' + C.line + '}' +
    '.sp-t th:first-child,.sp-t td:first-child{text-align:left}' +
    '.sp-t td{padding:8px 16px;border-top:1px solid ' + C.line + ';text-align:right;' + MONO + '}' +
    '.sp-t td:first-child{font-family:inherit;font-weight:500;display:flex;align-items:center;gap:8px}' +
    '.sp-t td.best{color:' + C.good + ';font-weight:700;background:' + C.best + '}' +
    '.sp-t tr.bestrow td{border-top:1px solid ' + C.line + ';background:' + C.soft + ';font-weight:700}' +
    '.sp-bk{width:22px;height:22px;border-radius:6px;background:' + C.soft + ';box-shadow:0 0 0 1px ' + C.line + ';display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:' + C.muted + ';flex:none}' +
    '.sp-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid ' + C.line + ';font-size:12px;color:' + C.faint + '}' +
    '.sp-more{background:none;border:0;font:inherit;font-size:12.5px;color:' + C.accent + ';cursor:pointer;padding:0}' +
    '.sp-empty{padding:30px 18px;text-align:center;color:' + C.muted + ';font-size:14px;line-height:1.6}.sp-empty b{display:block;color:' + C.ink + ';font-size:15px;margin-bottom:4px}' +
    '.sp-note{font-size:12px;color:' + C.faint + '}' +
    '.sp-r{width:100%;border-collapse:collapse;font-size:13.5px}.sp-r th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + C.faint + ';text-align:left;padding:12px 14px;border-bottom:1px solid ' + C.line + '}' +
    '.sp-r td{padding:11px 14px;border-top:1px solid ' + C.line + '}.sp-r tr:first-child td{border-top:0}.sp-r .r{text-align:right}' +
    '.sp-bar{display:inline-block;width:110px;height:6px;border-radius:3px;background:' + C.track + ';overflow:hidden;vertical-align:middle;margin-right:8px}.sp-bar i{display:block;height:100%;border-radius:3px;transform-origin:left;transition:transform .9s cubic-bezier(.2,.7,.2,1)}' +
    '.sp-slip{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}' +
    '.sp-ta{width:100%;min-height:200px;box-sizing:border-box;border:1px solid ' + C.line + ';background:' + C.soft + ';color:' + C.ink + ';border-radius:12px;padding:12px 14px;font:13.5px/1.6 ' + "'Geist Mono',monospace" + ';resize:vertical}' +
    '.sp-btn{height:40px;padding:0 18px;border-radius:10px;border:0;background:' + C.accent + ';color:' + (NIGHT ? '#FFFFFF' : '#fff') + ';font:inherit;font-weight:600;cursor:pointer}' +
    '.sp-pick{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid ' + C.line + '}.sp-pick:first-child{border-top:0}' +
    '.sp-pick b{font-weight:600}.sp-pick small{display:block;font-size:12px;color:' + C.faint + ';margin-top:2px}' +
    '.sp-pm{padding:14px 16px;display:flex;flex-direction:column;gap:10px}' +
    '.sp-pm h4{margin:0;font-size:14.5px;font-weight:600;line-height:1.35}' +
    '.sp-o{display:grid;grid-template-columns:minmax(0,1fr) 120px 48px;gap:10px;align-items:center;font-size:13px}' +
    '.sp-o span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sp-sk{height:150px;border-radius:14px;background:linear-gradient(90deg,' + C.soft + ' 25%,' + C.track + ' 50%,' + C.soft + ' 75%);background-size:200% 100%;animation:spSh 1.2s linear infinite}@keyframes spSh{to{background-position:-200% 0}}' +
    '.sp-in{animation:spIn .45s cubic-bezier(.2,.7,.2,1) both}@keyframes spIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (max-width:1100px){.sp-grid{grid-template-columns:minmax(0,1fr)}}' +
    '@media (max-width:760px){.sp-r .sp-bar{display:none}.sp-tabs{-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent)}.sp-slip{grid-template-columns:minmax(0,1fr)}.sp-t td,.sp-t th{padding:7px 10px}.sp-o{grid-template-columns:minmax(0,1fr) 80px 44px}.sp-hide{display:none}}' +
    (REDUCED ? '.sp-in,.sp-sk{animation:none}.sp-bar i{transition:none}' : '');

  var root, pane;
  function syncUrl() { var u = new URL(location.href); u.searchParams.set('tab', st.tab); if (st.league) u.searchParams.set('league', st.league); history.replaceState(null, '', u); }
  function render() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'sp-tabs', role: 'tablist' }, TABS.map(function (t) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': t[0] === st.tab ? 'true' : 'false', class: t[0] === st.tab ? 'on' : '', text: t[1], on: { click: function () { st.tab = t[0]; syncUrl(); render(); } } });
    })));
    pane = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
    root.appendChild(pane);
    ({ odds: oddsTab, books: booksTab, slip: slipTab, predict: predictTab })[st.tab]();
  }
  function notReady(what) {
    return h('div', { class: 'sp-card sp-empty sp-in' }, [h('b', { text: 'Live odds are not connected yet' }), what + ' appear here once the site\'s odds feed is switched on. Prediction markets work already.']);
  }
  function skel(n) { var g = h('div', { class: 'sp-grid' }); for (var i = 0; i < n; i++) g.appendChild(h('div', { class: 'sp-sk' })); return g; }
  function err(e) { return h('div', { class: 'sp-card sp-empty' }, [h('b', { text: 'Could not load this right now' }), location.protocol === 'file:' ? 'Open the site through its web address; the data comes from the server.' : e.message]); }

  // ---------- odds comparison
  function oddsTab() {
    if (st.ready === false) { pane.appendChild(notReady('Prices from the sportsbooks')); return; }
    pane.appendChild(h('div', { class: 'sp-chips' }, st.leagues.map(function (l) { return h('button', { type: 'button', class: 'sp-chip' + (l.key === st.league ? ' on' : ''), text: l.name, on: { click: function () { st.league = l.key; st.open = {}; syncUrl(); render(); } } }); })));
    var box = h('div'); pane.appendChild(box); box.appendChild(skel(4));
    getJ('/api/odds/league/' + encodeURIComponent(st.league)).then(function (j) {
      box.innerHTML = '';
      if (!j.ready) { box.appendChild(notReady('Prices from the sportsbooks')); return; }
      if (!j.events.length) { box.appendChild(h('div', { class: 'sp-card sp-empty' }, [h('b', { text: 'No upcoming matches' }), 'There are no priced matches in ' + (j.name || 'this league') + ' right now. Try another league.'])); return; }
      var g = h('div', { class: 'sp-grid' });
      j.events.forEach(function (ev, i) { g.appendChild(match(ev, i)); });
      box.appendChild(g);
      box.appendChild(h('div', { class: 'sp-note', style: 'margin-top:10px', text: 'Decimal odds, match result market. Best price per outcome is highlighted. "Market" is the bookmaker margin if you took every best price; under 100% means an arbitrage. Prices refresh about every ' + Math.round((j.cachedMinutes || 180) / 60) + ' h; always check the book before betting.' }));
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(err(e)); });
  }
  function match(ev, i) {
    var open = st.open[ev.id], shown = open ? ev.books : ev.books.slice(0, 5);
    var lbl = function (o) { return o === ev.home ? 'Home' : o === ev.away ? 'Away' : o; };
    var t = h('table', { class: 'sp-t' }, [h('thead', {}, [h('tr', {}, [h('th', { text: ev.books.length + ' books' })].concat(ev.outcomes.map(function (o) { return h('th', { title: o, text: lbl(o) }); })))])]);
    var tb = h('tbody');
    shown.forEach(function (b) {
      tb.appendChild(h('tr', {}, [h('td', {}, [h('span', { class: 'sp-bk', text: ini(b.name) }), b.name])].concat(ev.outcomes.map(function (o) {
        var p = b.prices[o], isBest = p && ev.best[o] && p === ev.best[o].price;
        return h('td', { class: isBest ? 'best' : '', text: p ? p.toFixed(2) : '–' });
      }))));
    });
    tb.appendChild(h('tr', { class: 'bestrow' }, [h('td', { text: 'Best price' })].concat(ev.outcomes.map(function (o) { return h('td', { title: ev.best[o] ? ev.best[o].book : '', style: 'color:' + C.good, text: ev.best[o] ? ev.best[o].price.toFixed(2) : '–' }); }))));
    t.appendChild(tb);
    var mk = ev.bestMargin;
    return h('div', { class: 'sp-card sp-in', style: 'animation-delay:' + Math.min(i * 0.04, 0.4) + 's' }, [
      h('div', { class: 'sp-mh' }, [h('div', {}, [h('b', { text: ev.home + ' v ' + ev.away }), h('small', { text: when(ev.start) })]), h('span', { class: 'sp-n', text: ev.books.length + ' BOOKS' })]),
      h('div', { style: 'overflow-x:auto' }, [t]),
      h('div', { class: 'sp-foot' }, [ev.books.length > 5 ? h('button', { type: 'button', class: 'sp-more', text: open ? 'Show fewer books' : 'Show ' + (ev.books.length - 5) + ' more books', on: { click: function () { st.open[ev.id] = !open; render(); } } }) : h('span'),
        h('span', { style: mk != null && mk < 0 ? 'color:' + C.good + ';font-weight:600' : '', text: mk == null ? '' : 'Market ' + (100 + mk).toFixed(1) + '%' })])
    ]);
  }

  // ---------- sportsbook ranking
  function booksTab() {
    var box = h('div', { class: 'sp-card' }); pane.appendChild(box); box.appendChild(h('div', { class: 'sp-sk', style: 'margin:12px;height:220px' }));
    getJ('/api/odds/books').then(function (j) {
      box.innerHTML = '';
      if (!j.ready) { box.replaceWith(notReady('Sportsbook rankings')); return; }
      if (!j.rows.length) { box.appendChild(h('div', { class: 'sp-empty' }, [h('b', { text: 'Not enough prices yet' }), 'The ranking builds from the leagues opened on the Odds comparison tab. Open a few leagues and come back.'])); return; }
      var lo = j.rows[0].margin, hi = j.rows[j.rows.length - 1].margin, tb = h('tbody');
      j.rows.forEach(function (r, i) {
        var pct = hi > lo ? 100 - (r.margin - lo) / (hi - lo) * 80 : 100, col = r.margin <= 3 ? C.good : r.margin <= 6 ? C.warn : C.bad;
        tb.appendChild(h('tr', { class: 'sp-in', style: 'animation-delay:' + Math.min(i * 0.03, 0.4) + 's' }, [h('td', { style: MONO + 'color:' + C.faint, text: String(i + 1) }), h('td', {}, [h('span', { style: 'display:flex;align-items:center;gap:8px;font-weight:600' }, [h('span', { class: 'sp-bk', text: ini(r.name) }), r.name])]),
          h('td', { class: 'r' }, [h('span', { class: 'sp-bar' }, [h('i', { style: 'width:' + pct + '%;background:' + col + ';transform:scaleX(0)' })]), h('span', { style: MONO + 'font-weight:600', text: r.margin.toFixed(2) + '%' })]),
          h('td', { class: 'r sp-hide', style: MONO, text: String(r.markets) }), h('td', { class: 'r sp-hide', style: MONO, text: String(r.leagues) })]));
      });
      box.appendChild(h('div', { style: 'overflow-x:auto' }, [h('table', { class: 'sp-r' }, [h('thead', {}, [h('tr', {}, [h('th', { text: '#' }), h('th', { text: 'Sportsbook' }), h('th', { class: 'r', text: 'Avg margin' }), h('th', { class: 'r sp-hide', text: 'Matches' }), h('th', { class: 'r sp-hide', text: 'Leagues' })])]), tb])]));
      box.appendChild(h('div', { class: 'sp-foot', text: 'Margin is the bookmaker\'s built-in edge on the match result market, averaged over the last 7 days of prices. Lower is better for players.' }));
      requestAnimationFrame(function () { requestAnimationFrame(function () { box.querySelectorAll('.sp-bar i').forEach(function (b) { b.style.transform = 'scaleX(1)'; }); }); });
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(err(e)); });
  }

  // ---------- paste a slip
  function slipTab() {
    var ta = h('textarea', { class: 'sp-ta', 'aria-label': 'Your bet slip', placeholder: 'One pick per line, team and your odds:\nArsenal 2.10\nLos Angeles Lakers @ 1.85\nReal Madrid 1.72' });
    try { ta.value = sessionStorage.getItem('sx_slip') || ''; } catch (e) {}
    var out = h('div', { class: 'sp-card' }, [h('div', { class: 'sp-empty' }, [h('b', { text: 'See if another book pays more' }), 'Paste your picks and we compare each one with every sportsbook we track.'])]);
    var btn = h('button', { type: 'button', class: 'sp-btn', text: 'Check slip', on: { click: function () {
      try { sessionStorage.setItem('sx_slip', ta.value); } catch (e) {}
      btn.disabled = true; btn.textContent = 'Checking...';
      getJ('/api/odds/slip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: ta.value }) }).then(function (j) {
        out.innerHTML = '';
        if (!j.ready) { out.replaceWith(out = notReady('Slip checks')); return; }
        j.picks.forEach(function (p) {
          if (!p.found) { out.appendChild(h('div', { class: 'sp-pick' }, [h('div', {}, [h('b', { text: p.line }), h('small', { text: 'No match found in the leagues we have prices for' })]), h('span', { style: 'color:' + C.faint, text: '–' })])); return; }
          var better = p.better, gain = p.gainPct;
          out.appendChild(h('div', { class: 'sp-pick sp-in' }, [h('div', {}, [h('b', { text: p.pick }), h('small', { text: p.match + ' · ' + when(p.start) + ' · ' + p.books + ' books' })]),
            h('div', { style: 'text-align:right' }, [h('div', { style: MONO + 'font-weight:700;color:' + C.good, text: p.best.toFixed(2) + ' at ' + p.bestBook }),
              h('small', { style: 'display:block;font-size:12px;color:' + (better ? C.good : C.faint), text: p.yours == null ? 'add your odds to compare' : better ? '+' + gain.toFixed(1) + '% more than your ' + p.yours.toFixed(2) : 'your ' + p.yours.toFixed(2) + ' is the best price' })])]));
        });
        if (j.accaBest && j.picks.filter(function (p) { return p.found; }).length > 1) out.appendChild(h('div', { class: 'sp-pick', style: 'background:' + C.soft }, [h('b', { text: 'As an accumulator' }), h('span', { style: MONO + 'font-weight:700', text: (j.accaYours ? j.accaYours.toFixed(2) + ' → ' : '') + j.accaBest.toFixed(2) })]));
        if (j.note) out.appendChild(h('div', { class: 'sp-foot', text: j.note }));
      }).catch(function (e) { out.innerHTML = ''; out.appendChild(err(e)); }).then(function () { btn.disabled = false; btn.textContent = 'Check slip'; });
    } } });
    pane.appendChild(h('div', { class: 'sp-slip' }, [h('div', { class: 'sp-card', style: 'padding:16px;display:flex;flex-direction:column;gap:12px' }, [h('b', { style: 'font-size:15px', text: 'Your slip' }), ta, h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [btn, h('span', { class: 'sp-note', text: 'Nothing is placed or stored on the server.' })])]), out]));
  }

  // ---------- prediction markets
  function predictTab() {
    var box = h('div'); pane.appendChild(box); box.appendChild(skel(4));
    getJ('/api/odds/predictions').then(function (j) {
      box.innerHTML = '';
      if (!j.events.length) { box.appendChild(h('div', { class: 'sp-card sp-empty' }, [h('b', { text: 'No open sports markets' }), 'Check back later.'])); return; }
      var g = h('div', { class: 'sp-grid' });
      j.events.forEach(function (e, i) {
        var mk = e.markets[0];
        var rows = (e.markets.length > 1 ? e.markets.slice(0, 5).map(function (m) { var yes = m.outcomes.filter(function (o) { return /^yes$/i.test(o.name); })[0] || m.outcomes[0]; return { name: m.question, prob: yes.prob }; }) : mk.outcomes.map(function (o) { return { name: o.name, prob: o.prob }; }))
          .sort(function (a, b) { return (b.prob || 0) - (a.prob || 0); });
        g.appendChild(h('div', { class: 'sp-card sp-in', style: 'animation-delay:' + Math.min(i * 0.04, 0.4) + 's' }, [
          h('div', { class: 'sp-pm' }, [h('div', { style: 'display:flex;justify-content:space-between;gap:10px' }, [h('h4', { text: e.title }), h('span', { class: 'sp-n', text: usd(e.volume24h) + ' 24h' })])].concat(rows.map(function (o) {
            var p = o.prob == null ? 0 : o.prob;
            return h('div', { class: 'sp-o' }, [h('span', { title: o.name, text: o.name }), h('span', { class: 'sp-bar', style: 'width:100%;margin:0' }, [h('i', { style: 'width:' + p + '%;background:' + C.accent + ';transform:scaleX(0)' })]), h('span', { style: MONO + 'font-weight:600;text-align:right', text: o.prob == null ? '–' : (p < 1 && p > 0 ? '<1' : Math.round(p)) + '%' })]);
          }))),
          h('div', { class: 'sp-foot' }, [h('span', { text: e.ends ? 'Ends ' + new Date(e.ends).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '' }), h('a', { href: e.url, target: '_blank', rel: 'noopener nofollow', style: 'color:' + C.accent + ';text-decoration:none', text: 'Polymarket ↗' })])
        ]));
      });
      box.appendChild(g);
      box.appendChild(h('div', { class: 'sp-note', style: 'margin-top:10px', text: 'Implied probabilities from Polymarket prices, refreshed every 10 minutes. Shown for information only.' }));
      requestAnimationFrame(function () { requestAnimationFrame(function () { box.querySelectorAll('.sp-bar i').forEach(function (b, k) { setTimeout(function () { b.style.transform = 'scaleX(1)'; }, REDUCED ? 0 : Math.min(k * 15, 500)); }); }); });
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(err(e)); });
  }

  function start() {
    root = document.getElementById('sx-page');
    if (!root) return setTimeout(start, 80);
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    getJ('/api/odds/leagues').then(function (j) {
      st.ready = j.ready; st.leagues = j.leagues;
      if (!st.leagues.some(function (l) { return l.key === st.league; })) st.league = st.leagues[0].key;
      // without an odds key, open on the tab that works
      if (!j.ready && !new URLSearchParams(location.search).get('tab')) st.tab = 'predict';
      render();
    }).catch(function (e) { st.ready = false; st.leagues = []; render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
