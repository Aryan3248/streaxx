/* Streax Analytics page: KPI cards, animated multi-series charts with casino
   logos riding the line ends, breakdown tables, biggest moves, record days,
   movers and wallet balances. Data: GET /api/onchain/analytics?days=N.
   Draws into #sx-analytics (marked data-dc-keep so the page shell leaves it alone). */
(function () {
  'use strict';
  var BASE = (function () { var s = document.currentScript; return s && s.src ? s.src.replace(/analytics\.js(\?.*)?$/, '') : ''; })();
  var NIGHT = /\/night\//.test(location.pathname);
  var LOCAL_LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var CHAIN_LOGO = { Ethereum: 'chain_eth', Tron: 'chain_trx', Solana: 'chain_sol', 'BNB Chain': 'chain_bnb', Bitcoin: 'chain_btc' };
  var PALETTE = ['#8B5CF6', '#3B82F6', '#0EA5E9', '#14B8A6', '#A855F7', '#EAB308', '#F97316', '#EC4899', '#6366F1', '#64748B', '#2563EB', '#06B6D4'];
  var C = NIGHT
    ? { ink: '#F5F5F5', muted: '#959597', faint: '#6B6D72', line: '#1F2024', card: '#121317', soft: '#16171B', accent: '#8B5CF6', good: '#34D399', bad: '#F87171', grid: 'rgba(255,255,255,0.07)' }
    : { ink: '#0A0B0E', muted: '#5E6068', faint: '#94969C', line: '#E7E7EA', card: '#FFFFFF', soft: '#F6F6F7', accent: '#6D28D9', good: '#16A34A', bad: '#DC2626', grid: 'rgba(10,11,14,0.08)' };
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); }
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) { var el = document.createElementNS(SVGNS, tag); for (var k in attrs || {}) el.setAttribute(k, attrs[k]); return el; }
  function money(v, dec) {
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + a.toFixed(dec == null ? 2 : dec);
  }
  function count(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)); }
  function pct(a, b) { return b > 0 ? (a - b) / b * 100 : null; }
  function day(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function ago(t) { var m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }
  function short(x) { x = String(x || ''); return x.length > 14 ? x.slice(0, 6) + '…' + x.slice(-4) : x; }
  function initials(n) { var t = String(n).replace(/[^A-Za-z0-9]/g, ''); return (t.charAt(0) + (t.charAt(1) || '')).toUpperCase(); }
  function logoUrl(domain) {
    if (!domain) return '';
    if (LOCAL_LOGOS.indexOf(domain) !== -1) return BASE + 'assets/logos/casinos/' + domain + '.png';
    return domain.indexOf('.') > 0 ? 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=128' : '';
  }
  function avatar(name, url, size) {
    var el = h('span', { class: 'ax-av', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px' }, [initials(name)]);
    if (url) { var img = h('img', { src: url, alt: '', loading: 'lazy' }); img.onerror = function () { img.remove(); }; el.appendChild(img); }
    return el;
  }
  function chainIcon(name) { var k = CHAIN_LOGO[name]; return avatar(name, k ? BASE + 'assets/logos/' + k + '.png' : '', 20); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function countUp(el, to, fmt) {
    if (REDUCED) { el.textContent = fmt(to); return; }
    var t0 = performance.now(), d = 900;
    (function step(now) { var p = Math.min(1, (now - t0) / d); el.textContent = fmt(to * ease(p)); if (p < 1) requestAnimationFrame(step); })(t0);
  }
  function seg(options, value, onPick, solid) {
    var wrap = h('div', { class: 'ax-seg' + (solid ? ' ax-seg-solid' : ''), role: 'group' });
    options.forEach(function (o) {
      wrap.appendChild(h('button', { type: 'button', class: o[0] === value ? 'on' : '', 'aria-pressed': o[0] === value ? 'true' : 'false', text: o[1], on: { click: function () { onPick(o[0]); } } }));
    });
    return wrap;
  }

  // ------------------------------------------------------------------ styles
  var css = '' +
    '.ax{display:flex;flex-direction:column;gap:16px;min-width:0;color:' + C.ink + '}' +
    '.ax-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}' +
    '.ax-btn{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 14px;border-radius:10px;border:1px solid ' + C.line + ';background:' + C.card + ';color:' + C.ink + ';font:inherit;font-size:13.5px;cursor:pointer;transition:background .15s ease}' +
    '.ax-btn:hover{background:' + C.soft + '}' +
    '.ax-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;border:1px solid ' + C.line + ';background:' + C.card + '}' +
    '.ax-seg button{border:0;background:transparent;color:' + C.muted + ';font:inherit;font-size:13px;font-weight:500;padding:0 12px;min-height:32px;border-radius:8px;cursor:pointer;transition:background .2s ease,color .2s ease}' +
    '.ax-seg button:hover{color:' + C.ink + '}' +
    '.ax-seg button.on{background:' + C.accent + ';color:#fff}' +
    '.ax-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}' +
    '.ax-kpi{position:relative;overflow:hidden;border-radius:16px;border:1px solid ' + C.line + ';background:' + C.card + ';padding:16px 18px 54px;min-height:118px;box-sizing:border-box}' +
    '.ax-kpi-l{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:' + C.muted + '}' +
    '.ax-kpi-v{margin-top:10px;font-size:30px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums}' +
    '.ax-kpi svg{position:absolute;left:0;right:0;bottom:0;width:100%;height:46px}' +
    '.ax-stack{display:flex;align-items:center;margin-top:10px}.ax-stack .ax-av{margin-left:-6px;border:2px solid ' + C.card + '}.ax-stack .ax-av:first-child{margin-left:0}.ax-stack small{margin-left:8px;color:' + C.muted + ';font-size:12px}' +
    '.ax-card{border-radius:18px;border:1px solid ' + C.line + ';background:' + C.card + ';padding:20px;min-width:0;box-sizing:border-box}' +
    '.ax-card h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.02em}' +
    '.ax-card h2 small{font-size:13px;font-weight:400;color:' + C.muted + ';margin-left:8px}' +
    '.ax-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}' +
    '.ax-ctrl{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
    '.ax-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;margin:6px 0 4px}' +
    '.ax-leg{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;color:' + C.muted + ';font:inherit;font-size:13px;cursor:pointer;padding:3px 4px;border-radius:999px;transition:opacity .2s ease}' +
    '.ax-leg.off{opacity:.35}.ax-leg .ax-av{box-shadow:0 0 0 2px var(--c)}' +
    '.ax-av{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:50%;background:' + C.soft + ';color:' + C.muted + ';font-weight:600;overflow:hidden}' +
    '.ax-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.ax-chart{position:relative;width:100%;user-select:none}' +
    '.ax-chart svg{display:block;width:100%;overflow:visible}' +
    '.ax-wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-size:46px;font-weight:700;letter-spacing:-.03em;color:' + C.ink + ';opacity:.035}' +
    '.ax-tip{position:absolute;z-index:5;pointer-events:none;min-width:200px;border-radius:12px;border:1px solid ' + C.line + ';background:' + C.card + ';box-shadow:0 16px 40px -18px rgba(20,20,40,.35);padding:10px 12px;font-size:12.5px;opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease}' +
    '.ax-tip.on{opacity:1;transform:none}' +
    '.ax-tip b{display:block;margin-bottom:6px;font-size:12px;color:' + C.muted + ';font-weight:500}' +
    '.ax-tip div{display:flex;align-items:center;gap:7px;padding:2px 0}.ax-tip div span:nth-child(2){flex:1}.ax-tip div span:last-child{font-variant-numeric:tabular-nums;font-weight:600}' +
    '.ax-tbl{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}' +
    '.ax-tbl th{text-align:left;font-size:11.5px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:' + C.muted + ';padding:10px 10px;border-bottom:1px solid ' + C.line + '}' +
    '.ax-tbl td{padding:12px 10px;border-bottom:1px solid ' + C.line + '}' +
    '.ax-tbl tr:last-child td{border-bottom:0}' +
    '.ax-tbl tbody tr{transition:background .15s ease}.ax-tbl tbody tr:hover{background:' + C.soft + '}' +
    '.ax-tbl .r{text-align:right}.ax-tbl .n{color:' + C.muted + ';width:28px}' +
    '.ax-name{display:flex;align-items:center;gap:10px;font-weight:600}' +
    '.ax-chg{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;font-size:12px;font-weight:600}' +
    '.ax-up{color:' + C.good + ';background:' + (NIGHT ? 'rgba(52,211,153,.12)' : 'rgba(22,163,74,.09)') + '}.ax-down{color:' + C.bad + ';background:' + (NIGHT ? 'rgba(248,113,113,.12)' : 'rgba(220,38,38,.08)') + '}' +
    '.ax-link{color:' + C.accent + ';text-decoration:none;font-size:13px;white-space:nowrap}.ax-link:hover{text-decoration:underline}' +
    '.ax-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}' +
    '.ax-fade{transition:filter .35s ease,opacity .35s ease}.ax-busy .ax-fade{filter:blur(5px);opacity:.45;pointer-events:none}' +
    '.ax-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}' +
    '.ax-sk{display:inline-block;border-radius:8px;background:linear-gradient(90deg,' + C.soft + ' 25%,' + (NIGHT ? '#1B1C20' : '#ECECEF') + ' 50%,' + C.soft + ' 75%);background-size:200% 100%;animation:axSh 1.2s infinite linear}' +
    '@keyframes axSh{from{background-position:200% 0}to{background-position:-200% 0}}' +
    '.ax-empty{padding:34px 16px;text-align:center;color:' + C.muted + ';font-size:14px;line-height:1.6}' +
    '.ax-movers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}' +
    '.ax-mv{border-radius:14px;border:1px solid ' + C.line + ';padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:' + C.card + '}' +
    '.ax-mv svg{width:100%;height:34px}' +
    '.ax-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:' + C.good + ';padding:3px 9px;border-radius:999px;background:' + (NIGHT ? 'rgba(52,211,153,.12)' : 'rgba(22,163,74,.09)') + '}' +
    '.ax-live i{width:7px;height:7px;border-radius:50%;background:' + C.good + ';animation:axPulse 1.6s infinite}' +
    '@keyframes axPulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5)}70%{box-shadow:0 0 0 7px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}' +
    '.ax-in{animation:axIn .5s cubic-bezier(.2,.7,.2,1) both}@keyframes axIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (max-width:1100px){.ax-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ax-two{grid-template-columns:minmax(0,1fr)}.ax-movers{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '@media (max-width:640px){.ax-kpis{grid-template-columns:minmax(0,1fr)}.ax-card{padding:16px}.ax-kpi-v{font-size:26px}.ax-movers{grid-template-columns:minmax(0,1fr)}.ax-wm{font-size:30px}.ax-tbl{font-size:13px}.ax-tbl td,.ax-tbl th{padding:10px 6px;white-space:nowrap}}';
  document.head.appendChild(h('style', { text: css }));

  // ------------------------------------------------------------------ charts
  // Smooth path through points (monotone cubic), so lines never overshoot.
  function smooth(pts) {
    if (pts.length < 2) return pts.length ? 'M' + pts[0][0] + ' ' + pts[0][1] : '';
    var n = pts.length, dx = [], m = [], t = [];
    for (var i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
      if (q > 9) { var k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var d = 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    for (i = 0; i < n - 1; i++) {
      var c1x = pts[i][0] + dx[i] / 3, c1y = pts[i][1] + t[i] * dx[i] / 3, c2x = pts[i + 1][0] - dx[i] / 3, c2y = pts[i + 1][1] - t[i + 1] * dx[i] / 3;
      d += ' C' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ' ' + pts[i + 1][0].toFixed(2) + ' ' + pts[i + 1][1].toFixed(2);
    }
    return d;
  }

  // Multi-series chart. Lines draw from left to right with each logo riding the tip.
  function lineChart(host, o) {
    host.innerHTML = '';
    var hidden = o.hidden || {};
    var wrap = h('div', { class: 'ax-chart' });
    if (o.legend !== false) {
      var leg = h('div', { class: 'ax-legend' });
      o.series.forEach(function (sr) {
        var b = h('button', { type: 'button', class: 'ax-leg' + (hidden[sr.id] ? ' off' : ''), style: '--c:' + sr.color, title: 'Show or hide ' + sr.name, on: { click: function () { hidden[sr.id] = !hidden[sr.id]; o.hidden = hidden; lineChart(host, Object.assign({}, o, { animate: false })); } } }, [avatar(sr.name, sr.logo, 22), sr.name]);
        leg.appendChild(b);
      });
      host.appendChild(leg);
    }
    host.appendChild(wrap);
    var W = Math.max(300, host.clientWidth || 800), H = o.height || (W < 640 ? 260 : 360);
    var padL = 6, padR = W < 640 ? 52 : 74, padT = 22, padB = 28, iw = W - padL - padR, ih = H - padT - padB;
    var vis = o.series.filter(function (sr) { return !hidden[sr.id]; });
    var all = []; vis.forEach(function (sr) { sr.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var max = Math.max.apply(null, all.concat([0])), min = Math.min.apply(null, all.concat([0]));
    var sqrt = o.scale === 'sqrt' && min >= 0;
    var tr = sqrt ? function (v) { return Math.sqrt(Math.max(0, v)); } : function (v) { return v; };
    var top = tr(max) || 1, bot = sqrt ? 0 : tr(min);
    if (top === bot) top = bot + 1;
    var Y = function (v) { return padT + ih - (tr(v) - bot) / (top - bot) * ih; };
    var n = o.dates.length, X = function (i) { return padL + (n < 2 ? iw / 2 : i / (n - 1) * iw); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': o.label || 'Chart' });
    var defs = s('defs'); svg.appendChild(defs);
    // grid and y labels
    for (var g = 0; g <= 4; g++) {
      var fr = g / 4, val = sqrt ? Math.pow(bot + (top - bot) * fr, 2) : bot + (top - bot) * fr, y = padT + ih - fr * ih;
      svg.appendChild(s('line', { x1: padL, x2: padL + iw, y1: y, y2: y, stroke: C.grid, 'stroke-dasharray': '3 5' }));
      var tl = s('text', { x: W - 4, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.faint }); tl.textContent = o.fmt(val); svg.appendChild(tl);
    }
    // x labels
    var step = Math.max(1, Math.ceil(n / (W < 640 ? 4 : 8)));
    for (var i = 0; i < n; i += step) { var xl = s('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle', 'font-size': 11, fill: C.faint }); xl.textContent = day(o.dates[i]); svg.appendChild(xl); }
    var lines = [], heads = [];
    vis.forEach(function (sr, si) {
      var pts = []; var last = null;
      sr.values.forEach(function (v, k) { if (v == null) v = last; if (v == null) return; last = v; pts.push([X(k), Y(v)]); });
      if (!pts.length) return;
      var d = smooth(pts);
      var gid = 'axg' + Math.random().toString(36).slice(2, 8);
      var grad = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(s('stop', { offset: '0%', 'stop-color': sr.color, 'stop-opacity': si === 0 ? 0.22 : 0.10 }));
      grad.appendChild(s('stop', { offset: '100%', 'stop-color': sr.color, 'stop-opacity': 0 }));
      defs.appendChild(grad);
      var clipId = gid + 'c', clip = s('clipPath', { id: clipId }), rect = s('rect', { x: 0, y: 0, width: o.animate === false ? W : 0, height: H });
      clip.appendChild(rect); defs.appendChild(clip);
      if (si < 3 && o.area !== false) svg.appendChild(s('path', { d: d + ' L' + pts[pts.length - 1][0] + ' ' + (padT + ih) + ' L' + pts[0][0] + ' ' + (padT + ih) + ' Z', fill: 'url(#' + gid + ')', 'clip-path': 'url(#' + clipId + ')' }));
      var path = s('path', { d: d, fill: 'none', stroke: sr.color, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      svg.appendChild(path);
      lines.push({ sr: sr, path: path, rect: rect, pts: pts });
    });
    wrap.appendChild(svg);
    if (o.watermark !== false) wrap.appendChild(h('div', { class: 'ax-wm', text: 'Streax' }));
    // logo heads (HTML on top of the SVG so images stay crisp)
    var headLayer = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    wrap.appendChild(headLayer);
    lines.forEach(function (L) {
      var el = avatar(L.sr.name, L.sr.logo, 24);
      el.style.position = 'absolute'; el.style.boxShadow = '0 0 0 2px ' + L.sr.color + ', 0 4px 12px -4px rgba(0,0,0,.4)'; el.style.transform = 'translate(-50%,-50%)';
      headLayer.appendChild(el); heads.push(el); L.head = el;
    });
    function placeHeads(p) {
      // final positions, nudged apart so logos at the end don't sit on top of each other
      var ends = lines.map(function (L) { var len = L.path.getTotalLength(), pt = L.path.getPointAtLength(len * p); return { L: L, x: pt.x, y: pt.y }; });
      if (p >= 1) {
        ends.sort(function (a, b) { return a.y - b.y; });
        for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 20) ends[k].y = ends[k - 1].y + 20;
        // keep the stack inside the plot: push it back up from the bottom edge
        var floor = padT + ih;
        for (var q = ends.length - 1; q >= 0; q--) { var lim = q === ends.length - 1 ? floor : ends[q + 1].y - 20; if (ends[q].y > lim) ends[q].y = lim; }
      }
      ends.forEach(function (e) { e.L.head.style.left = (e.x / W * 100) + '%'; e.L.head.style.top = e.y + 'px'; });
    }
    if (o.animate !== false && !REDUCED) {
      lines.forEach(function (L) { var len = L.path.getTotalLength(); L.len = len; L.path.style.strokeDasharray = len + ' ' + len; L.path.style.strokeDashoffset = len; });
      var t0 = performance.now(), dur = 1500;
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur), e = ease(p);
        lines.forEach(function (L) { L.path.style.strokeDashoffset = L.len * (1 - e); L.rect.setAttribute('width', padL + iw * e + 2); });
        placeHeads(Math.max(0.0001, e));
        if (p < 1) requestAnimationFrame(step); else lines.forEach(function (L) { L.path.style.strokeDasharray = ''; });
      })(t0);
    } else { lines.forEach(function (L) { L.rect.setAttribute('width', W); }); placeHeads(1); }
    // hover: crosshair, dots and a tooltip with every series
    var cross = s('line', { y1: padT, y2: padT + ih, stroke: C.faint, 'stroke-dasharray': '3 4', opacity: 0 }); svg.appendChild(cross);
    var dots = lines.map(function (L) { var c = s('circle', { r: 4, fill: C.card, stroke: L.sr.color, 'stroke-width': 2, opacity: 0 }); svg.appendChild(c); return c; });
    var tip = h('div', { class: 'ax-tip' }); wrap.appendChild(tip);
    function move(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
      var k = Math.max(0, Math.min(n - 1, Math.round((x - padL) / iw * (n - 1))));
      cross.setAttribute('x1', X(k)); cross.setAttribute('x2', X(k)); cross.setAttribute('opacity', 1);
      var rows = [];
      lines.forEach(function (L, j) { var v = L.sr.values[k]; if (v == null) { dots[j].setAttribute('opacity', 0); return; } dots[j].setAttribute('cx', X(k)); dots[j].setAttribute('cy', Y(v)); dots[j].setAttribute('opacity', 1); rows.push([L.sr, v]); });
      rows.sort(function (a, b) { return b[1] - a[1]; });
      tip.innerHTML = '';
      tip.appendChild(h('b', { text: day(o.dates[k]) }));
      rows.forEach(function (rw) { tip.appendChild(h('div', {}, [h('span', { style: 'width:8px;height:8px;border-radius:50%;background:' + rw[0].color }), h('span', { text: rw[0].name }), h('span', { text: o.fmt(rw[1]) })])); });
      var left = X(k) / W * r.width; tip.style.left = (left > r.width - 240 ? left - 220 : left + 14) + 'px'; tip.style.top = '10px';
      tip.classList.add('on');
    }
    function leave() { cross.setAttribute('opacity', 0); dots.forEach(function (d) { d.setAttribute('opacity', 0); }); tip.classList.remove('on'); }
    svg.addEventListener('mousemove', move); svg.addEventListener('mouseleave', leave);
    svg.addEventListener('touchstart', function (e) { move(e.touches[0]); }, { passive: true });
  }

  function spark(values, color, w, hgt, animate) {
    var max = Math.max.apply(null, values.concat([0])), min = Math.min.apply(null, values.concat([max]));
    var span = max - min || 1, n = values.length;
    var pts = values.map(function (v, i) { return [n < 2 ? w / 2 : i / (n - 1) * w, hgt - 4 - (v - min) / span * (hgt - 10)]; });
    var svg = s('svg', { viewBox: '0 0 ' + w + ' ' + hgt, preserveAspectRatio: 'none' });
    var gid = 'axs' + Math.random().toString(36).slice(2, 8), defs = s('defs'), g = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.22 })); g.appendChild(s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.appendChild(g); svg.appendChild(defs);
    if (!pts.length) return svg;
    var d = smooth(pts);
    svg.appendChild(s('path', { d: d + ' L' + w + ' ' + hgt + ' L0 ' + hgt + ' Z', fill: 'url(#' + gid + ')' }));
    var p = s('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' });
    svg.appendChild(p);
    if (animate !== false && !REDUCED) requestAnimationFrame(function () { var len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)'; requestAnimationFrame(function () { p.style.strokeDashoffset = 0; }); });
    return svg;
  }

  // ------------------------------------------------------------------- state
  var st = { days: 30, mode: 'dep', group: 'casino', moverDir: 'up', moverUnit: '$', balView: 'casino', showAll: false, data: null, loading: true, error: '' };
  var root, els = {}, charts = {};

  function load(days) {
    st.days = days; st.loading = true; if (root) root.classList.add('ax-busy');
    return fetch('/api/onchain/analytics?days=' + days, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) { st.data = j; st.error = ''; })
      .catch(function (e) { st.error = location.protocol === 'file:' ? 'You opened the page as a file, so there is no server to read the blockchain. Open your Render site URL, or run npm start and open http://localhost:10000' : 'The on-chain server did not answer (' + e.message + ').'; })
      .then(function () { st.loading = false; render(true); });
  }
  function setDays(d) { if (d !== st.days) load(d); }
  function periods(onPick) { return seg([[7, '7D'], [30, '30D'], [90, '90D']], st.days, onPick || setDays, true); }
  function empty(msg) { return h('div', { class: 'ax-empty', text: msg }); }
  function hasData() { var D = st.data; return D && D.kpis && (D.kpis.dep > 0 || D.casinos.some(function (c) { return c.balance > 0; })); }
  function noDataText() { return st.error || 'Live figures appear here after the on-chain monitor has read the tracked casino wallets. Add your Etherscan key and run the monitor from the admin page.'; }

  // ------------------------------------------------------------------ render
  function build() {
    root.innerHTML = '';
    root.className = 'ax' + (st.loading ? ' ax-busy' : '');
    // top bar
    var how = h('button', { type: 'button', class: 'ax-btn', on: { click: openSources } }, ['How it works']);
    var share = h('button', { type: 'button', class: 'ax-btn', on: { click: function () { try { navigator.clipboard.writeText(location.href); share.textContent = 'Link copied'; setTimeout(function () { share.textContent = 'Share'; }, 1600); } catch (e) {} } } }, ['Share']);
    root.appendChild(h('div', { class: 'ax-top' }, [
      h('div', { class: 'ax-ctrl' }, [seg([['live', 'Crypto casinos']], 'live', function () {}, true), h('span', { class: 'ax-live', title: 'Updated by the Streax on-chain monitor' }, [h('i'), 'Live on-chain'])]),
      h('div', { class: 'ax-ctrl' }, [share, h('a', { class: 'ax-btn', href: 'Rankings.dc.html' }, ['Compare']), how, periods()])
    ]));
    els.kpis = h('div', { class: 'ax-kpis' }); root.appendChild(els.kpis);
    els.series = h('section', { class: 'ax-card ax-in' }); root.appendChild(els.series);
    var two = h('div', { class: 'ax-two' }); els.bigIn = h('section', { class: 'ax-card ax-in' }); els.bigOut = h('section', { class: 'ax-card ax-in' }); two.appendChild(els.bigIn); two.appendChild(els.bigOut); root.appendChild(two);
    var two2 = h('div', { class: 'ax-two' }); els.records = h('section', { class: 'ax-card ax-in' }); els.feed = h('section', { class: 'ax-card ax-in' }); two2.appendChild(els.records); two2.appendChild(els.feed); root.appendChild(two2);
    els.movers = h('section', { class: 'ax-card ax-in' }); root.appendChild(els.movers);
    els.balance = h('section', { class: 'ax-card ax-in' }); root.appendChild(els.balance);
  }

  function render(animate) {
    if (!root) return;
    if (!els.kpis) build();
    root.classList.toggle('ax-busy', st.loading);
    var top = root.querySelector('.ax-top .ax-ctrl:last-child .ax-seg:last-child'); if (top) top.replaceWith(periods());
    renderKpis(animate); renderSeries(animate); renderBiggest(); renderRecords(); renderFeed(); renderMovers(animate); renderBalance(animate);
  }

  function renderKpis(animate) {
    var D = st.data, el = els.kpis; el.innerHTML = '';
    var k = D && D.kpis, ready = k && !st.loading;
    var dd = st.days + 'D';
    var defs = [
      ['Deposit volume (' + dd + ')', k ? k.dep : 0, money, k ? k.depSpark : [], k && k.prevDep ? (k.dep >= k.prevDep) : true],
      ['Deposit transfers (' + dd + ')', k ? k.txIn : 0, count, k ? k.txSpark : [], true],
      ['Avg deposit size (' + dd + ')', k ? k.avg : 0, function (v) { return money(v); }, k ? k.avgSpark : [], k ? (k.avgSpark[k.avgSpark.length - 1] >= k.avgSpark[0]) : true],
      ['Casinos tracked', k ? k.casinos : 0, function (v) { return String(Math.round(v)); }, null]
    ];
    defs.forEach(function (d, i) {
      var v = h('div', { class: 'ax-kpi-v' });
      var card = h('div', { class: 'ax-kpi ax-in', style: 'animation-delay:' + (i * 0.05) + 's' }, [h('div', { class: 'ax-kpi-l', text: d[0] }), v]);
      if (!ready) v.appendChild(h('span', { class: 'ax-sk', style: 'width:110px;height:30px' }));
      else if (animate) countUp(v, d[1], d[2]); else v.textContent = d[2](d[1]);
      if (d[3]) { if (ready && d[3].length) card.appendChild(spark(d[3], d[4] ? C.good : C.bad, 300, 46, animate)); }
      else {
        var stack = h('div', { class: 'ax-stack' });
        (D && D.casinos || []).slice(0, 5).forEach(function (c) { stack.appendChild(avatar(c.name, logoUrl(c.domain), 22)); });
        if (D && D.casinos.length > 5) stack.appendChild(h('small', { text: '+' + (D.casinos.length - 5) }));
        card.appendChild(stack); card.style.paddingBottom = '18px';
      }
      el.appendChild(card);
    });
  }

  // drop leading days where nothing was recorded yet (keeps at least 7 days)
  function trim(series, dates) {
    var first = dates.length;
    series.forEach(function (sr) { for (var k = 0; k < sr.values.length; k++) if (sr.values[k]) { first = Math.min(first, k); break; } });
    var from = Math.max(0, Math.min(first, dates.length - 7));
    if (!from) return { series: series, dates: dates };
    return { dates: dates.slice(from), series: series.map(function (sr) { return Object.assign({}, sr, { values: sr.values.slice(from) }); }) };
  }
  function modeVal(c, i) { return st.mode === 'dep' ? c.dep[i] : st.mode === 'wd' ? c.wd[i] : c.dep[i] - c.wd[i]; }
  function renderSeries(animate) {
    var D = st.data, el = els.series; el.innerHTML = '';
    var title = { dep: 'Deposit', wd: 'Withdrawal', net: 'Net flow' }[st.mode];
    el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { html: title + ' timeseries <small>daily, US dollars</small>' })]));
    var chart = h('div', { class: 'ax-fade' }); el.appendChild(chart);
    if (!hasData()) { chart.appendChild(st.loading ? h('div', { class: 'ax-sk', style: 'display:block;height:300px' }) : empty(noDataText())); }
    else {
      var cs = D.casinos.filter(function (c) { return st.mode === 'wd' ? c.wdTotal > 0 : st.mode === 'dep' ? c.depTotal > 0 : c.depTotal + c.wdTotal > 0; })
        .sort(function (a, b) { return (st.mode === 'wd' ? b.wdTotal - a.wdTotal : b.depTotal - a.depTotal); }).slice(0, 10);
      var tr0 = trim(cs.map(function (c, i) { return { id: c.slug, name: c.name, logo: logoUrl(c.domain), color: PALETTE[i % PALETTE.length], values: D.dates.map(function (_, k) { return modeVal(c, k); }) }; }), D.dates);
      var series = tr0.series;
      var args = { series: series, dates: tr0.dates, fmt: function (v) { return money(v, 0); }, scale: st.mode === 'net' ? 'linear' : 'sqrt', animate: animate, label: title + ' per casino per day' };
      charts.series = { host: chart, args: args };
      if (!series.length) chart.appendChild(empty('Nothing recorded for this period yet. The monitor reads a few wallets every 10 minutes.'));
      else requestAnimationFrame(function () { lineChart(chart, args); });
    }
    // controls + breakdown table
    var ctrl = h('div', { class: 'ax-head', style: 'margin-top:18px' }, [
      seg([['dep', 'Deposits'], ['wd', 'Withdrawals'], ['net', 'Net flow']], st.mode, function (m) { st.mode = m; renderSeries(true); }, true),
      h('div', { class: 'ax-ctrl' }, [seg([['casino', 'Casino'], ['chain', 'Chain'], ['token', 'Token']], st.group, function (g) { st.group = g; st.showAll = false; renderSeries(false); }, true), periods()])
    ]);
    el.appendChild(ctrl);
    var tblWrap = h('div', { class: 'ax-scroll ax-fade' }); el.appendChild(tblWrap);
    if (!hasData()) return;
    var label = { dep: 'Deposit volume', wd: 'Withdrawal volume', net: 'Net flow' }[st.mode];
    var rows, head;
    if (st.group === 'casino') {
      head = ['#', 'Casino', label, '% change', 'Transfers', 'Depositors', 'Avg deposit'];
      rows = D.casinos.map(function (c) {
        var v = st.mode === 'dep' ? c.depTotal : st.mode === 'wd' ? c.wdTotal : c.depTotal - c.wdTotal, prev = st.mode === 'dep' ? c.prevDep : st.mode === 'wd' ? c.prevWd : c.prevDep - c.prevWd;
        return { name: c.name, logo: logoUrl(c.domain), v: v, none: !c.depTotal && !c.wdTotal && !c.txInTotal && !c.txOutTotal, chg: st.mode === 'net' ? null : pct(v, prev), a: count(st.mode === 'wd' ? c.txOutTotal : c.txInTotal), b: count(c.depositors), c: c.txInTotal ? money(c.depTotal / c.txInTotal) : 'n/a', href: 'Wallets.dc.html?c=' + c.slug };
      });
    } else {
      var list = st.group === 'chain' ? D.chains : D.tokens;
      head = ['#', st.group === 'chain' ? 'Chain' : 'Token', label, '% change', 'Withdrawals', 'Share', ''];
      var tot = list.reduce(function (s2, x) { return s2 + x.dep; }, 0) || 1;
      rows = list.map(function (x) {
        var v = st.mode === 'dep' ? x.dep : st.mode === 'wd' ? x.wd : x.dep - x.wd;
        return { name: x.name, chain: st.group === 'chain', v: v, chg: st.mode === 'dep' ? pct(x.dep, x.prevDep) : null, a: money(x.wd), b: (x.dep / tot * 100).toFixed(1) + '%', c: '' };
      });
    }
    rows.sort(function (a, b) { return b.v - a.v; });
    var shown = st.showAll ? rows : rows.slice(0, 10);
    var tb = h('tbody');
    shown.forEach(function (r, i) {
      var chg = r.chg == null ? h('span', { text: '–', style: 'color:' + C.faint }) : h('span', { class: 'ax-chg ' + (r.chg >= 0 ? 'ax-up' : 'ax-down'), text: (r.chg >= 0 ? '+' : '') + r.chg.toFixed(1) + '%' });
      var nameCell = h('span', { class: 'ax-name' }, [r.chain ? chainIcon(r.name) : avatar(r.name, r.logo, 26), r.href ? h('a', { href: r.href, text: r.name, style: 'color:inherit;text-decoration:none' }) : r.name]);
      tb.appendChild(h('tr', { class: 'ax-in', style: 'animation-delay:' + Math.min(i * 0.03, 0.3) + 's' }, [h('td', { class: 'n', text: String(i + 1) }), h('td', {}, [nameCell]),
        r.none ? h('td', { class: 'r', text: 'Not read yet', style: 'color:' + C.faint + ';font-weight:500' }) : h('td', { class: 'r', text: money(r.v), style: st.mode === 'net' ? 'color:' + (r.v >= 0 ? C.good : C.bad) + ';font-weight:600' : 'font-weight:600' }), h('td', { class: 'r' }, [chg]), h('td', { class: 'r', text: r.none ? '' : r.a }), h('td', { class: 'r', text: r.none ? '' : r.b }), h('td', { class: 'r', text: r.none ? '' : r.c })]));
    });
    tblWrap.appendChild(h('table', { class: 'ax-tbl' }, [h('thead', {}, [h('tr', {}, head.map(function (x, i) { return h('th', { class: i > 1 ? 'r' : '', text: x }); }))]), tb]));
    if (rows.length > 10) tblWrap.appendChild(h('div', { style: 'text-align:center;margin-top:10px' }, [h('button', { type: 'button', class: 'ax-btn', text: st.showAll ? 'Show less' : 'Show all ' + rows.length, on: { click: function () { st.showAll = !st.showAll; renderSeries(false); } } })]));
  }

  function moveTable(list, dir) {
    var tb = h('tbody');
    list.forEach(function (w, i) {
      tb.appendChild(h('tr', { class: 'ax-in', style: 'animation-delay:' + (i * 0.04) + 's' }, [
        h('td', {}, [h('span', { class: 'ax-name' }, [avatar(w.name, logoUrl(w.domain), 26), w.name])]),
        h('td', {}, [h('a', { class: 'ax-link', href: w.txUrl, target: '_blank', rel: 'noopener', text: short(w.hash) + ' ↗' })]),
        h('td', {}, [h('span', { class: 'ax-name', style: 'font-weight:500' }, [chainIcon(w.chainName), w.chainName])]),
        h('td', { class: 'r', text: money(w.usd), style: 'font-weight:650;color:' + (dir === 'in' ? C.good : C.bad) })
      ]));
    });
    return h('div', { class: 'ax-scroll ax-fade' }, [h('table', { class: 'ax-tbl' }, [h('thead', {}, [h('tr', {}, ['Casino', 'TX', 'Chain', 'Amount'].map(function (x, i) { return h('th', { class: i === 3 ? 'r' : '', text: x }); }))]), tb])]);
  }
  function renderBiggest() {
    [['in', els.bigIn, 'Biggest deposits'], ['out', els.bigOut, 'Biggest withdrawals']].forEach(function (x) {
      var el = x[1]; el.innerHTML = '';
      el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { text: x[2] }), periods()]));
      var list = st.data && st.data.biggest ? st.data.biggest[x[0]].slice(0, 6) : [];
      el.appendChild(list.length ? moveTable(list, x[0]) : (st.loading ? h('div', { class: 'ax-sk', style: 'display:block;height:180px' }) : empty(hasData() ? 'No single move of $10K or more in this period.' : noDataText())));
    });
  }
  function renderRecords() {
    var el = els.records; el.innerHTML = '';
    el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { html: 'Record days <small>biggest single-day deposits</small>' }), periods()]));
    var list = st.data && st.data.records ? st.data.records.slice(0, 6) : [];
    if (!list.length) { el.appendChild(st.loading ? h('div', { class: 'ax-sk', style: 'display:block;height:180px' }) : empty(noDataText())); return; }
    var tb = h('tbody');
    list.forEach(function (r, i) {
      tb.appendChild(h('tr', { class: 'ax-in', style: 'animation-delay:' + (i * 0.04) + 's' }, [h('td', {}, [h('span', { class: 'ax-name' }, [avatar(r.name, logoUrl(r.domain), 26), r.name])]), h('td', { text: day(r.day), style: 'color:' + C.muted }),
        h('td', { class: 'r', text: money(r.dep), style: 'font-weight:650;color:' + C.good }), h('td', { class: 'r', text: count(r.txIn) }), h('td', { class: 'r', text: money(r.wd), style: 'color:' + C.bad })]));
    });
    el.appendChild(h('div', { class: 'ax-scroll ax-fade' }, [h('table', { class: 'ax-tbl' }, [h('thead', {}, [h('tr', {}, ['Casino', 'Date', 'Volume', 'Deposits', 'Withdrawn'].map(function (x, i) { return h('th', { class: i > 1 ? 'r' : '', text: x }); }))]), tb])]));
  }
  var feedTimer = null;
  function renderFeed() {
    var el = els.feed; el.innerHTML = '';
    el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { text: 'Deposit feed' }), h('span', { class: 'ax-live' }, [h('i'), 'Live'])]));
    var box = h('div', { class: 'ax-fade' }); el.appendChild(box);
    function fill() {
      fetch('/api/onchain/whales?limit=6&min=10000', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { items: [] }; }).then(function (j) {
        box.innerHTML = '';
        if (!j.items.length) { box.appendChild(empty('Big deposits and withdrawals show here within minutes. Updates every minute.')); return; }
        var tb = h('tbody');
        j.items.forEach(function (w, i) {
          var inn = w.dir === 'in';
          tb.appendChild(h('tr', { class: 'ax-in', style: 'animation-delay:' + (i * 0.04) + 's' }, [h('td', {}, [h('span', { class: 'ax-name' }, [avatar(w.name, '', 26), w.name])]), h('td', {}, [h('span', { class: 'ax-name', style: 'font-weight:500' }, [chainIcon(w.chainName), w.asset])]),
            h('td', { text: ago(w.ts), style: 'color:' + C.muted }), h('td', { class: 'r', text: (inn ? '+' : '-') + money(w.usd), style: 'font-weight:650;color:' + (inn ? C.good : C.bad) })]));
        });
        box.appendChild(h('div', { class: 'ax-scroll' }, [h('table', { class: 'ax-tbl' }, [h('thead', {}, [h('tr', {}, ['Casino', 'Asset', 'When', 'Amount'].map(function (x, i) { return h('th', { class: i === 3 ? 'r' : '', text: x }); }))]), tb])]));
        // casino logos come from the analytics list
        var map = {}; (st.data && st.data.casinos || []).forEach(function (c) { map[c.name] = logoUrl(c.domain); });
        box.querySelectorAll('tbody tr').forEach(function (tr, i) { var w = j.items[i], u = map[w.name]; if (u) tr.querySelector('.ax-av').replaceWith(avatar(w.name, u, 26)); });
      }).catch(function () { box.innerHTML = ''; box.appendChild(empty('The on-chain server did not answer.')); });
    }
    fill(); clearInterval(feedTimer); feedTimer = setInterval(fill, 60000);
  }
  function renderMovers(animate) {
    var D = st.data, el = els.movers; el.innerHTML = '';
    el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { html: 'Biggest movers <small>deposits vs the previous ' + st.days + ' days</small>' }),
      h('div', { class: 'ax-ctrl' }, [seg([['$', '$'], ['%', '%']], st.moverUnit, function (u) { st.moverUnit = u; renderMovers(false); }, true), periods(), seg([['up', 'Gainers'], ['down', 'Decliners']], st.moverDir, function (d) { st.moverDir = d; renderMovers(true); }, true)])]));
    if (!hasData()) { el.appendChild(st.loading ? h('div', { class: 'ax-sk', style: 'display:block;height:120px' }) : empty(noDataText())); return; }
    var list = D.casinos.filter(function (c) { return c.prevDep > 0; }).map(function (c) { return { c: c, d: c.depTotal - c.prevDep, p: pct(c.depTotal, c.prevDep) }; });
    var key = st.moverUnit === '$' ? 'd' : 'p';
    list.sort(function (a, b) { return st.moverDir === 'up' ? b[key] - a[key] : a[key] - b[key]; });
    list = list.filter(function (x) { return st.moverDir === 'up' ? x.d > 0 : x.d < 0; }).slice(0, 8);
    if (!list.length) { el.appendChild(empty('Not enough history yet to compare with the previous period.')); return; }
    var grid = h('div', { class: 'ax-movers ax-fade' });
    list.forEach(function (x, i) {
      var up = x.d >= 0, col = up ? C.good : C.bad;
      grid.appendChild(h('div', { class: 'ax-mv ax-in', style: 'animation-delay:' + (i * 0.04) + 's' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [h('span', { class: 'ax-name' }, [avatar(x.c.name, logoUrl(x.c.domain), 24), x.c.name]),
          h('span', { class: 'ax-chg ' + (up ? 'ax-up' : 'ax-down'), text: st.moverUnit === '$' ? (up ? '+' : '') + money(x.d) : (up ? '+' : '') + x.p.toFixed(1) + '%' })]),
        spark(x.c.dep, col, 200, 34, animate),
        h('div', { style: 'font-size:12.5px;color:' + C.muted, text: money(x.c.depTotal) + ' this period' })
      ]));
    });
    el.appendChild(grid);
  }
  function renderBalance(animate) {
    var D = st.data, el = els.balance; el.innerHTML = '';
    el.appendChild(h('div', { class: 'ax-head' }, [h('h2', { html: 'Wallet balance <small>tracked hot wallets</small>' })]));
    var chart = h('div', { class: 'ax-fade' }); el.appendChild(chart);
    if (!hasData()) { chart.appendChild(st.loading ? h('div', { class: 'ax-sk', style: 'display:block;height:300px' }) : empty(noDataText())); }
    else {
      var cs = D.casinos.filter(function (c) { return c.bal.some(function (v) { return v != null; }); }).sort(function (a, b) { return b.balance - a.balance; }).slice(0, 8);
      if (!cs.length) chart.appendChild(empty('Balance history builds from the first daily reading.'));
      else {
        var trb = trim(cs.map(function (c, i) { return { id: c.slug, name: c.name, logo: logoUrl(c.domain), color: PALETTE[i % PALETTE.length], values: c.bal }; }), D.dates);
        var series = trb.series;
        var bargs = { series: series, dates: trb.dates, fmt: function (v) { return money(v, 0); }, scale: 'sqrt', animate: animate, label: 'Wallet balance per casino' };
        charts.balance = { host: chart, args: bargs };
        var obs = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { obs.disconnect(); lineChart(chart, bargs); } }, { threshold: 0.2 });
        obs.observe(chart);
      }
    }
    var ctrl = h('div', { class: 'ax-head', style: 'margin-top:18px' }, [seg([['casino', 'By casino'], ['chain', 'By chain']], st.balView, function (v) { st.balView = v; renderBalance(false); }, true), periods()]);
    el.appendChild(ctrl);
    if (!hasData()) return;
    var chains = {}; D.casinos.forEach(function (c) { Object.keys(c.chainBal || {}).forEach(function (k) { chains[k] = (chains[k] || 0) + c.chainBal[k]; }); });
    var cnames = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; });
    var tb = h('tbody'), head;
    if (st.balView === 'casino') {
      head = ['#', 'Casino'].concat(cnames).concat(['Total']);
      D.casinos.slice().sort(function (a, b) { return b.balance - a.balance; }).filter(function (c) { return c.balance > 0; }).forEach(function (c, i) {
        tb.appendChild(h('tr', {}, [h('td', { class: 'n', text: String(i + 1) }), h('td', {}, [h('span', { class: 'ax-name' }, [avatar(c.name, logoUrl(c.domain), 26), c.name])])]
          .concat(cnames.map(function (k) { return h('td', { class: 'r', text: c.chainBal[k] ? money(c.chainBal[k]) : 'n/a', style: c.chainBal[k] ? '' : 'color:' + C.faint }); }))
          .concat([h('td', { class: 'r', text: money(c.balance), style: 'font-weight:650' })])));
      });
    } else {
      head = ['#', 'Chain', 'Balance', 'Share'];
      var tot = cnames.reduce(function (a, k) { return a + chains[k]; }, 0) || 1;
      cnames.forEach(function (k, i) { tb.appendChild(h('tr', {}, [h('td', { class: 'n', text: String(i + 1) }), h('td', {}, [h('span', { class: 'ax-name' }, [chainIcon(k), k])]), h('td', { class: 'r', text: money(chains[k]), style: 'font-weight:650' }), h('td', { class: 'r', text: (chains[k] / tot * 100).toFixed(1) + '%' })])); });
    }
    el.appendChild(h('div', { class: 'ax-scroll ax-fade' }, [h('table', { class: 'ax-tbl' }, [h('thead', {}, [h('tr', {}, head.map(function (x, i) { return h('th', { class: i > 1 ? 'r' : '', text: x }); }))]), tb])]));
  }

  function openSources() {
    var b = Array.prototype.find.call(document.querySelectorAll('button'), function (x) { return /Sources and methodology/.test(x.textContent); });
    if (b) b.click();
  }

  // -------------------------------------------------------------------- boot
  // On resize only the charts are redrawn (no animation); tables stay as they are.
  var resizeT, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(resizeT);
    resizeT = setTimeout(function () { ['series', 'balance'].forEach(function (k) { var c = charts[k]; if (c && c.host.isConnected && c.host.querySelector('svg')) lineChart(c.host, Object.assign({}, c.args, { animate: false })); }); }, 200);
  });
  (function wait() {
    root = document.getElementById('sx-analytics');
    if (!root) return setTimeout(wait, 60);
    build(); render(false); load(st.days);
  })();
})();
