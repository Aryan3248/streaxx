/* Streax Market breakdown: casinos, unboxing sites and game providers ranked by
   on-chain deposits (Volume), payout behaviour (Fairness) or scores (Ratings),
   over 1D to 1Y. Data from /api/markets. Draws into #sx-page. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', accent: '#8B5CF6', good: '#4ADE80', bad: '#F87171', warn: '#E7B53C', track: '#1B1C20', hover: 'rgba(139,92,246,.07)' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', accent: '#6D28D9', good: '#16A34A', bad: '#DC2626', warn: '#B7791F', track: '#EFEFF1', hover: 'rgba(109,40,217,.05)' };
  var LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var base = NIGHT ? '../' : '';
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
  var TABS = [['casino', 'Casinos'], ['unboxing', 'Unboxing sites'], ['providers', 'Providers']];
  var VIEWS = [['volume', 'Volume'], ['fairness', 'Fairness'], ['ratings', 'Ratings']];
  var WINS = [['1d', '1D'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['1y', '1Y']];
  var q = new URLSearchParams(location.search);
  var st = { tab: pick(q.get('tab'), TABS, 'casino'), view: pick(q.get('view'), VIEWS, 'volume'), win: pick(q.get('w'), WINS, '7d'), sort: null, desc: true, data: null, loading: true, error: '' };
  function pick(v, list, d) { return list.some(function (x) { return x[0] === v; }) ? v : d; }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') el.textContent = attrs[k]; else if (k === 'html') el.innerHTML = attrs[k]; else if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else el.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(v) { if (v == null) return '–'; var a = Math.abs(v), s = v < 0 ? '-' : ''; return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a)); }
  function count(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v || 0)); }
  function logo(domain) { return domain && LOGOS.indexOf(domain) >= 0 ? base + 'assets/logos/casinos/' + domain + '.png' : domain ? 'https://www.google.com/s2/favicons?sz=64&domain=' + domain : ''; }
  function avatar(name, domain, size) {
    size = size || 28;
    var el = h('span', { class: 'mk-av', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.36) + 'px' }, [String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()]);
    var src = logo(domain);
    if (src) { var img = h('img', { src: src, alt: '', loading: 'lazy' }); img.onerror = function () { img.remove(); }; el.appendChild(img); }
    return el;
  }
  function seg(list, value, onPick, label) {
    return h('div', { class: 'mk-seg', role: 'group', 'aria-label': label }, list.map(function (o) {
      return h('button', { type: 'button', class: o[0] === value ? 'on' : '', 'aria-pressed': o[0] === value ? 'true' : 'false', text: o[1], on: { click: function () { onPick(o[0]); } } });
    }));
  }
  function bar(pct, color, w) { return h('span', { class: 'mk-bar', style: 'width:' + (w || 90) + 'px' }, [h('i', { style: 'width:' + Math.max(0, Math.min(100, pct)) + '%;background:' + (color || C.accent) })]); }
  function chg(v) { return v == null ? h('span', { class: 'mk-chg', style: 'color:' + C.faint, text: 'new' }) : h('span', { class: 'mk-chg', style: 'color:' + (v >= 0 ? C.good : C.bad), text: (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }); }
  function spark(vals, up) {
    var w = 96, hh = 26, max = Math.max.apply(null, vals.concat([1])), n = vals.length, ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', w); svg.setAttribute('height', hh); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh); svg.setAttribute('aria-hidden', 'true');
    if (n < 2) return svg;
    var pts = vals.map(function (v, i) { return (i / (n - 1) * w).toFixed(1) + ',' + (hh - 3 - v / max * (hh - 6)).toFixed(1); }).join(' ');
    var col = up ? C.good : C.bad;
    var area = document.createElementNS(ns, 'polygon'); area.setAttribute('points', '0,' + hh + ' ' + pts + ' ' + w + ',' + hh); area.setAttribute('fill', col); area.setAttribute('fill-opacity', '.12');
    var line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', pts); line.setAttribute('fill', 'none'); line.setAttribute('stroke', col); line.setAttribute('stroke-width', '1.6'); line.setAttribute('class', 'mk-line');
    svg.appendChild(area); svg.appendChild(line);
    return svg;
  }
  function stars(v) { if (v == null) return h('span', { style: 'color:' + C.faint, text: '–' }); return h('span', { class: 'mk-v', text: v.toFixed(1) + ' ★' }); }

  var css = '' +
    '#sx-page{margin-top:2px;display:flex;flex-direction:column;gap:16px}' +
    '.mk-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}' +
    '.mk-tabs{display:flex;gap:2px;border-bottom:1px solid ' + C.line + ';width:100%}' +
    '.mk-tabs button{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:10px 14px;font:inherit;font-size:14px;color:' + C.muted + ';cursor:pointer;transition:color .2s,border-color .2s}' +
    '.mk-tabs button.on{color:' + C.ink + ';border-color:' + C.accent + ';font-weight:600}.mk-tabs button:hover{color:' + C.ink + '}' +
    '.mk-seg{display:inline-flex;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.soft + '}' +
    '.mk-seg button{border:0;background:none;font:inherit;font-size:13px;padding:6px 12px;border-radius:7px;color:' + C.muted + ';cursor:pointer;transition:background-color .2s,color .2s}' +
    '.mk-seg button.on{background:' + C.accent + ';color:' + (NIGHT ? '#FFFFFF' : '#fff') + ';font-weight:600}' +
    '.mk-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    '.mk-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:10px;border:1px solid ' + C.line + ';background:' + C.card + ';color:' + C.ink + ';font:inherit;font-size:13px;cursor:pointer}' +
    '.mk-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid ' + C.line + ';border-radius:14px;background:' + C.card + ';overflow:hidden}' +
    '.mk-kpi{padding:14px 16px;border-left:1px solid ' + C.line + ';min-width:0}.mk-kpi:first-child{border-left:0}' +
    '.mk-kpi small{display:block;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + C.faint + '}' +
    '.mk-kpi b{display:block;' + MONO + 'font-size:21px;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.mk-kpi span{font-size:12px;color:' + C.muted + '}' +
    '.mk-card{border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:14px;overflow:hidden}' +
    '.mk-scroll{overflow-x:auto}' +
    '.mk-t{width:100%;border-collapse:collapse;font-size:13.5px}' +
    '.mk-t th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + C.faint + ';text-align:left;padding:12px 12px 10px;white-space:nowrap;border-bottom:1px solid ' + C.line + ';user-select:none}' +
    '.mk-t th.s{cursor:pointer}.mk-t th.s:hover{color:' + C.ink + '}.mk-t th .ar{margin-left:4px;color:' + C.accent + '}' +
    '.mk-t td{padding:10px 12px;border-top:1px solid ' + C.line + ';white-space:nowrap;vertical-align:middle}' +
    '.mk-t tr:first-child td{border-top:0}.mk-t .r{text-align:right}' +
    '.mk-t tbody tr{transition:background-color .15s}.mk-t tbody tr:hover{background:' + C.hover + '}' +
    '.mk-t tr.mk-sep td{background:' + C.soft + ';font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';padding:8px 12px}' +
    '.mk-rk{' + MONO + 'color:' + C.faint + ';font-size:12px;width:28px}' +
    '.mk-name{display:flex;align-items:center;gap:10px;min-width:0}.mk-name a{color:inherit;text-decoration:none;font-weight:600}.mk-name a:hover{text-decoration:underline}' +
    '.mk-name small{display:block;font-size:11.5px;color:' + C.faint + ';font-weight:400;margin-top:1px}' +
    '.mk-av{position:relative;flex:none;border-radius:50%;background:' + C.soft + ';color:' + C.muted + ';font-weight:600;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 0 1px ' + C.line + '}' +
    '.mk-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:' + C.card + '}' +
    '.mk-v{' + MONO + 'font-weight:600}.mk-m{' + MONO + 'color:' + C.muted + '}' +
    '.mk-chg{' + MONO + 'font-size:11.5px;font-weight:500;margin-left:6px}' +
    '.mk-bar{display:inline-block;height:6px;border-radius:3px;background:' + C.track + ';overflow:hidden;vertical-align:middle}' +
    '.mk-bar i{display:block;height:100%;border-radius:3px;transform-origin:left;transform:scaleX(0);transition:transform .9s cubic-bezier(.2,.7,.2,1)}' +
    '.mk-cellbar{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end}' +
    '.mk-pill{display:inline-block;font:600 11px/1.6 ' + "'Geist Mono',monospace" + ';padding:0 7px;border-radius:6px}' +
    '.mk-stack{display:inline-flex}.mk-stack .mk-av{margin-left:-6px;box-shadow:0 0 0 2px ' + C.card + '}.mk-stack .mk-av:first-child{margin-left:0}' +
    '.mk-empty{padding:28px 18px;text-align:center;color:' + C.muted + ';font-size:14px;line-height:1.6}' +
    '.mk-empty b{display:block;color:' + C.ink + ';font-size:15px;margin-bottom:4px}' +
    '.mk-note{font-size:12px;color:' + C.faint + ';padding:10px 14px;border-top:1px solid ' + C.line + ';display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
    '.mk-sk{height:44px;margin:8px 12px;border-radius:8px;background:linear-gradient(90deg,' + C.soft + ' 25%,' + C.track + ' 50%,' + C.soft + ' 75%);background-size:200% 100%;animation:mkSh 1.2s linear infinite}' +
    '@keyframes mkSh{to{background-position:-200% 0}}' +
    '.mk-in{animation:mkIn .45s cubic-bezier(.2,.7,.2,1) both}@keyframes mkIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    '.mk-busy{opacity:.55;transition:opacity .2s}' +
    '@media (max-width:900px){.mk-kpis{grid-template-columns:1fr 1fr}.mk-kpi:nth-child(3){border-left:0}.mk-kpi:nth-child(n+3){border-top:1px solid ' + C.line + '}.mk-hide{display:none}}' +
    '@media (max-width:640px){.mk-t .mk-bar{display:none}.mk-stack{display:none!important}.mk-m640{display:none}.mk-top{flex-direction:column;align-items:stretch}.mk-ctl{justify-content:space-between}.mk-seg button{padding:6px 9px}.mk-t td,.mk-t th{padding:9px 8px}.mk-tabs button{padding:10px 10px;font-size:13.5px}}' +
    (REDUCED ? '.mk-in,.mk-sk{animation:none}.mk-bar i{transition:none;transform:none}' : '');

  var root, body;
  function syncUrl() { var u = new URL(location.href); u.searchParams.set('tab', st.tab); u.searchParams.set('view', st.view); u.searchParams.set('w', st.win); history.replaceState(null, '', u); }

  function render() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'mk-tabs', role: 'tablist' }, TABS.map(function (t) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': t[0] === st.tab ? 'true' : 'false', class: t[0] === st.tab ? 'on' : '', text: t[1], on: { click: function () { st.tab = t[0]; st.sort = null; if (st.tab === 'providers' && st.win === '1d') st.win = '30d'; load(); } } });
    })));
    var ctl = h('div', { class: 'mk-ctl' }, [
      st.tab === 'providers' ? null : seg(VIEWS, st.view, function (v) { st.view = v; st.sort = null; syncUrl(); render(); }, 'View'),
      seg(WINS, st.win, function (w) { st.win = w; load(); }, 'Time window'),
      h('button', { type: 'button', class: 'mk-btn', text: 'Share', on: { click: function (e) { var b = e.currentTarget; try { navigator.clipboard.writeText(location.href); b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Share'; }, 1600); } catch (x) {} } } })
    ]);
    root.appendChild(h('div', { class: 'mk-top' }, [h('div', { class: 'mk-sub', style: 'font-size:13px;color:' + C.muted, text: subline() }), ctl]));
    if (st.tab !== 'providers') root.appendChild(kpis());
    body = h('div', { class: 'mk-card' + (st.loading && st.data ? ' mk-busy' : '') });
    root.appendChild(body);
    if (st.error) { body.appendChild(h('div', { class: 'mk-empty' }, [h('b', { text: 'Could not load the market data' }), st.error])); return; }
    if (!st.data) { for (var i = 0; i < 6; i++) body.appendChild(h('div', { class: 'mk-sk' })); return; }
    if (st.tab === 'providers') providersTable(); else sitesTable();
    grow();
  }
  function subline() {
    var w = { '1d': 'today', '7d': 'the last 7 days', '30d': 'the last 30 days', '90d': 'the last 90 days', '1y': 'the last 12 months' }[st.win];
    if (st.tab === 'providers') return 'Game providers ranked by the deposits of the casinos that carry them, ' + w + '.';
    return { volume: 'Ranked by on-chain deposit volume, ', fairness: 'Payout ratio, payout speed and complaints, ', ratings: 'Streax Score and member ratings, ' }[st.view] + w + '.';
  }
  function kpis() {
    var D = st.data || {}, rows = D.rows || [];
    var wd = rows.reduce(function (s, r) { return s + r.wd; }, 0), big = null;
    rows.forEach(function (r) { if (r.biggest && (!big || r.biggest.usd > big.usd)) big = { usd: r.biggest.usd, name: r.name, chain: r.biggest.chainName }; });
    var k = function (label, val, note) { return h('div', { class: 'mk-kpi' }, [h('small', { text: label }), h('b', { text: val }), h('span', { text: note })]); };
    return h('div', { class: 'mk-kpis mk-in' }, [
      k('Deposit volume', st.data ? money(D.total) : '…', 'into tracked wallets'),
      k('Withdrawals', st.data ? money(wd) : '…', 'paid out to players'),
      k(st.tab === 'unboxing' ? 'Sites tracked' : 'Casinos tracked', st.data ? String(rows.length) : '…', st.data ? (D.untracked || []).length + ' more without wallets yet' : ''),
      k('Biggest deposit', big ? money(big.usd) : '–', big ? big.name + (big.chain ? ' on ' + big.chain : '') : 'none over $10K yet')
    ]);
  }
  function head(cols) {
    return h('thead', {}, [h('tr', {}, cols.map(function (c) {
      var sortable = !!c.key, on = st.sort === c.key;
      return h('th', { class: (c.r ? 'r ' : '') + (c.hide ? 'mk-hide ' : '') + (c.m ? 'mk-m640 ' : '') + (sortable ? 's' : ''), 'aria-sort': on ? (st.desc ? 'descending' : 'ascending') : null, on: sortable ? { click: function () { if (st.sort === c.key) st.desc = !st.desc; else { st.sort = c.key; st.desc = true; } render(); } } : null }, [c.t, on ? h('span', { class: 'ar', text: st.desc ? '↓' : '↑' }) : null]);
    }))]);
  }
  function sorted(rows, key, def) {
    var k = st.sort || def;
    return rows.slice().sort(function (a, b) { var x = key(a, k), y = key(b, k); if (x == null) return 1; if (y == null) return -1; return st.desc ? y - x : x - y; });
  }
  function nameCell(r, note) { return h('span', { class: 'mk-name' }, [avatar(r.name, r.domain), h('span', { style: 'min-width:0' }, [h('a', { href: base + 'Casino.dc.html?c=' + encodeURIComponent(r.slug), text: r.name }), note ? h('small', { text: note }) : null])]); }
  function scoreOf(slug) {
    try { var inst = window.__sxPage, c = inst.D.casinos.filter(function (x) { return x.slug === slug; })[0]; var s = c && inst.score(c, inst.D); return s && s.total != null ? s.total : null; } catch (e) { return null; }
  }

  function sitesTable() {
    var D = st.data, rows = D.rows, un = D.untracked || [], view = st.view, max = Math.max.apply(null, rows.map(function (r) { return r.dep; }).concat([1]));
    if (!rows.length && !un.length) {
      body.appendChild(h('div', { class: 'mk-empty' }, st.tab === 'unboxing'
        ? [h('b', { text: 'No unboxing sites tracked yet' }), 'Unboxing sites such as Packdraw or Hypedrop appear here once their wallets are added. Admins add them under Sites and providers, then add the wallets.']
        : [h('b', { text: 'No data yet' }), 'The on-chain monitor has not recorded any deposits for this window.']));
      return;
    }
    var cols, cells, keyFn, def;
    if (view === 'volume') {
      def = 'dep';
      cols = [{ t: '#' }, { t: st.tab === 'unboxing' ? 'Site' : 'Casino' }, { t: 'Trend', hide: 1 }, { t: 'Deposit volume', key: 'dep', r: 1 }, { t: 'Deposits', key: 'deposits', r: 1, hide: 1 }, { t: 'Withdrawals', key: 'wd', r: 1 }, { t: 'Biggest dep.', key: 'big', r: 1, hide: 1 }, { t: 'Share', key: 'dep', r: 1, hide: 1 }];
      keyFn = function (r, k) { return k === 'big' ? (r.biggest ? r.biggest.usd : null) : r[k]; };
      cells = function (r, i) {
        return [h('td', { class: 'mk-rk', text: String(i + 1) }), h('td', {}, [h('span', { style: 'display:flex;align-items:center' }, [nameCell(r), chg(r.change)])]),
          h('td', { class: 'mk-hide' }, [spark(r.spark || [], r.change == null || r.change >= 0)]),
          h('td', { class: 'r' }, [h('span', { class: 'mk-v', text: money(r.dep) })]), h('td', { class: 'r mk-m mk-hide', text: count(r.deposits) }),
          h('td', { class: 'r mk-m', text: money(r.wd) }),
          h('td', { class: 'r mk-hide' }, [r.biggest ? h('a', { class: 'mk-m', href: r.biggest.txUrl, target: '_blank', rel: 'noopener', style: 'text-decoration:none;color:inherit', title: (r.biggest.asset || '') + ' on ' + (r.biggest.chainName || ''), text: money(r.biggest.usd) + ' ↗' }) : h('span', { style: 'color:' + C.faint, text: '–' })]),
          h('td', { class: 'r mk-hide' }, [h('span', { class: 'mk-cellbar' }, [bar(r.dep / max * 100, C.accent, 70), h('span', { class: 'mk-m', style: 'width:46px', text: (D.total ? r.dep / D.total * 100 : 0).toFixed(1) + '%' })])])];
      };
    } else if (view === 'fairness') {
      def = 'ratio';
      cols = [{ t: '#' }, { t: st.tab === 'unboxing' ? 'Site' : 'Casino' }, { t: 'Payout ratio', key: 'ratio', r: 1 }, { t: 'Median payout', key: 'speed', r: 1, m: 1 }, { t: 'Complaints resolved', key: 'res', r: 1, hide: 1 }, { t: 'Open', key: 'open', r: 1, hide: 1 }];
      keyFn = function (r, k) { return k === 'ratio' ? r.payoutRatio : k === 'speed' ? (r.payoutMedianMin != null ? -r.payoutMedianMin : null) : k === 'res' ? (r.complaints.total ? r.complaints.resolved / r.complaints.total : null) : k === 'open' ? -r.complaints.open : null; };
      cells = function (r, i) {
        var ratio = r.payoutRatio, rc = ratio == null ? C.faint : ratio >= 0.85 ? C.good : ratio >= 0.6 ? C.warn : C.bad;
        var c = r.complaints, resPct = c.total ? c.resolved / c.total * 100 : null;
        return [h('td', { class: 'mk-rk', text: String(i + 1) }), h('td', {}, [nameCell(r)]),
          h('td', { class: 'r' }, [ratio == null ? h('span', { style: 'color:' + C.faint, text: '–' }) : h('span', { class: 'mk-cellbar' }, [bar(Math.min(ratio, 1.2) / 1.2 * 100, rc, 70), h('span', { class: 'mk-v', style: 'width:52px', text: (ratio * 100).toFixed(0) + '%' })])]),
          h('td', { class: 'r mk-m640' }, [r.payoutMedianMin == null ? h('span', { style: 'color:' + C.faint, text: 'no reports' }) : h('span', {}, [h('span', { class: 'mk-v', text: fmtMin(r.payoutMedianMin) }), h('span', { class: 'mk-m', style: 'font-size:11.5px', text: ' · ' + r.payoutReports })])]),
          h('td', { class: 'r mk-hide' }, [resPct == null ? h('span', { style: 'color:' + C.faint, text: 'none' }) : h('span', { class: 'mk-cellbar' }, [bar(resPct, resPct >= 70 ? C.good : C.warn, 60), h('span', { class: 'mk-m', text: c.resolved + '/' + c.total })])]),
          h('td', { class: 'r mk-hide' }, [h('span', { class: 'mk-pill', style: c.open ? 'background:rgba(240,101,101,.12);color:' + C.bad : 'color:' + C.faint, text: String(c.open) })])];
      };
    } else {
      def = 'score';
      rows = rows.map(function (r) { return Object.assign({}, r, { score: scoreOf(r.slug) }); });
      un = un.map(function (r) { return Object.assign({}, r, { score: scoreOf(r.slug) }); });
      cols = [{ t: '#' }, { t: st.tab === 'unboxing' ? 'Site' : 'Casino' }, { t: 'Streax Score', key: 'score', r: 1 }, { t: 'Grade', r: 1 }, { t: 'Member rating', key: 'rating', r: 1 }, { t: 'Reviews', key: 'ratingCount', r: 1, hide: 1 }];
      keyFn = function (r, k) { return r[k]; };
      cells = function (r, i) {
        var s = r.score, col = s == null ? C.faint : s >= 80 ? C.good : s >= 60 ? C.warn : C.bad, g = s == null ? '–' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : 'D';
        return [h('td', { class: 'mk-rk', text: String(i + 1) }), h('td', {}, [nameCell(r)]),
          h('td', { class: 'r' }, [s == null ? h('span', { style: 'color:' + C.faint, text: 'not scored' }) : h('span', { class: 'mk-cellbar' }, [bar(s, col, 80), h('span', { class: 'mk-v', style: 'width:30px', text: String(Math.round(s)) })])]),
          h('td', { class: 'r' }, [h('span', { class: 'mk-pill', style: 'background:' + (s == null ? 'transparent' : s >= 80 ? 'rgba(139,92,246,.16)' : s >= 60 ? 'rgba(231,181,60,.14)' : 'rgba(240,101,101,.14)') + ';color:' + col, text: g })]),
          h('td', { class: 'r' }, [stars(r.rating)]), h('td', { class: 'r mk-m mk-hide', text: String(r.ratingCount || 0) })];
      };
    }
    var tb = h('tbody');
    sorted(rows, keyFn, def).forEach(function (r, i) { tb.appendChild(h('tr', { class: 'mk-in', style: 'animation-delay:' + Math.min(i * 0.025, 0.4) + 's' }, cells(r, i))); });
    if (un.length) {
      tb.appendChild(h('tr', { class: 'mk-sep' }, [h('td', { colspan: String(cols.length), text: 'Not tracked on-chain yet · ' + un.length + (view === 'volume' && st.tab === 'casino' ? ' · published 24h snapshot shown' : '') })]));
      (view === 'ratings' ? sorted(un, keyFn, def) : un).forEach(function (r, i) {
        var tds;
        if (view === 'volume') tds = [h('td', { class: 'mk-rk', text: String(rows.length + i + 1) }), h('td', {}, [nameCell(r, 'wallets not added yet')]), h('td', { class: 'mk-hide' }), h('td', { class: 'r mk-m', title: 'Published snapshot, 24h', text: r.snapshot24h ? r.snapshot24h + ' · 24h' : '–' }), h('td', { class: 'r mk-hide' }), h('td', { class: 'r', style: 'color:' + C.faint, text: '–' }), h('td', { class: 'r mk-hide' }), h('td', { class: 'r mk-hide' })];
        else tds = cells(Object.assign({ payoutRatio: null }, r), rows.length + i);
        tb.appendChild(h('tr', { style: 'opacity:.78' }, tds));
      });
    }
    body.appendChild(h('div', { class: 'mk-scroll' }, [h('table', { class: 'mk-t' }, [head(cols), tb])]));
    var note = view === 'volume' ? 'Deposits and withdrawals read from each site\'s own wallets. Moves between a site\'s wallets are left out. Biggest deposit counts single transfers of $10K or more.'
      : view === 'fairness' ? 'Payout ratio = withdrawals ÷ deposits in the window. Payout speed is the median of verified member payout reports. Complaints come from the Streax complaint desk.'
      : 'Streax Score is out of 100 from on-chain data, reviews, complaints and payouts. Member rating is the average of member reviews.';
    var days = D.historyDays || 0;
    body.appendChild(h('div', { class: 'mk-note' }, [h('span', { text: note }), st.win === '1y' && days < 300 ? h('span', { text: 'The monitor has ' + days + ' days of history so far; 1Y fills in over time.' }) : null]));
  }
  function fmtMin(m) { return m < 60 ? Math.round(m) + ' min' : m < 1440 ? (m / 60).toFixed(1) + ' h' : (m / 1440).toFixed(1) + ' d'; }

  function providersTable() {
    var rows = st.data.rows || [];
    if (!rows.length) { body.appendChild(h('div', { class: 'mk-empty' }, [h('b', { text: 'No providers listed yet' }), 'Game providers appear here once an admin lists them with the casinos that offer them. Their reach is the tracked deposit volume of those casinos.'])); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.reach; }).concat([1]));
    var tb = h('tbody');
    sorted(rows, function (r, k) { return r[k]; }, 'reach').forEach(function (r, i) {
      tb.appendChild(h('tr', { class: 'mk-in', style: 'animation-delay:' + Math.min(i * 0.03, 0.4) + 's' }, [
        h('td', { class: 'mk-rk', text: String(i + 1) }),
        h('td', {}, [h('span', { class: 'mk-name' }, [avatar(r.name, r.domain), h('span', {}, [h('b', { style: 'font-weight:600', text: r.name }), r.domain ? h('small', { text: r.domain }) : null])])]),
        h('td', { class: 'r' }, [h('span', { class: 'mk-v', text: money(r.reach) })]),
        h('td', { class: 'r mk-hide' }, [h('span', { class: 'mk-cellbar' }, [bar(r.reach / max * 100, C.accent, 80), h('span', { class: 'mk-m', style: 'width:46px', text: r.share.toFixed(1) + '%' })])]),
        h('td', { class: 'r' }, [h('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, [h('span', { class: 'mk-stack' }, r.casinos.slice(0, 5).map(function (c) { return avatar(c.name, (window.__sxDomains || {})[c.slug] || '', 22); })), h('span', { class: 'mk-m', text: r.casinoCount + (r.trackedCount < r.casinoCount ? ' (' + r.trackedCount + ' tracked)' : '') })])]),
        h('td', { class: 'r mk-hide' }, [r.rtp ? (r.source ? h('a', { class: 'mk-m', href: r.source, target: '_blank', rel: 'noopener', style: 'color:inherit', text: r.rtp + ' ↗' }) : h('span', { class: 'mk-m', text: r.rtp })) : h('span', { style: 'color:' + C.faint, text: '–' })])
      ]));
    });
    body.appendChild(h('div', { class: 'mk-scroll' }, [h('table', { class: 'mk-t' }, [head([{ t: '#' }, { t: 'Provider' }, { t: 'Reach', key: 'reach', r: 1 }, { t: 'Share', key: 'share', r: 1, hide: 1 }, { t: 'Casinos', key: 'casinoCount', r: 1 }, { t: 'Published RTP', r: 1, hide: 1 }]), tb])]));
    body.appendChild(h('div', { class: 'mk-note' }, [h('span', { text: 'Reach is the deposit volume of the tracked casinos that offer the provider, not the provider\'s own revenue.' })]));
  }

  function grow() {
    var bars = root.querySelectorAll('.mk-bar i');
    requestAnimationFrame(function () { requestAnimationFrame(function () { bars.forEach(function (b, i) { setTimeout(function () { b.style.transform = 'scaleX(1)'; }, REDUCED ? 0 : Math.min(i * 20, 400)); }); }); });
    if (REDUCED) return;
    root.querySelectorAll('.mk-line').forEach(function (p) { var len = 0; try { len = p.getTotalLength(); } catch (e) { return; } if (!len) return; p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect(); p.style.transition = 'stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)'; p.style.strokeDashoffset = 0; });
  }

  var seq = 0;
  function load() {
    syncUrl();
    st.loading = true; st.error = ''; var my = ++seq;
    render();
    var url = st.tab === 'providers' ? '/api/markets/providers?window=' + st.win : '/api/markets?window=' + st.win + '&kind=' + st.tab;
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); })
      .then(function (j) { if (my !== seq) return; st.data = j; st.loading = false; try { render(); } catch (e) { console.error(e); } })
      .catch(function (e) { if (my !== seq) return; st.loading = false; st.error = location.protocol === 'file:' ? 'Open the site through its web address; the data comes from the server.' : e.message; render(); });
  }

  function start() {
    root = document.getElementById('sx-page');
    if (!root) return setTimeout(start, 80);
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    try { var dm = {}; window.__sxPage.D.casinos.forEach(function (c) { dm[c.slug] = c.domain; }); window.__sxDomains = dm; } catch (e) {}
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
