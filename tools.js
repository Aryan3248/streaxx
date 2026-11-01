/* Streax player tools on Home: casino health, the payout check ("can it pay
   me?") and the daily brief. Data from /api/health, /api/payout-check and
   /api/brief. Draws into #sx-tools. */
(function () {
  var NIGHT = /\/night\//.test(location.pathname);
  var C = NIGHT
    ? { ink: '#EDEDF0', muted: '#A0A0AB', faint: '#6B6B76', line: '#232328', card: '#111113', soft: '#16161A', up: '#3DD68C', dn: '#F2555A', warn: '#F5A524', v: '#8B6CFF' }
    : { ink: '#121218', muted: '#5B5B6B', faint: '#8E8E9C', line: '#E6E5EE', card: '#FFFFFF', soft: '#F6F6F9', up: '#12A15E', dn: '#DC3D43', warn: '#B7791F', v: '#6B4BEF' };
  var LOGOS = ['500.casino', 'acebet', 'bc.game', 'betfury.com', 'betstrike', 'bluff', 'cloudbet.com', 'cybet', 'duel.com', 'duelbits.com', 'flush', 'gamba.com', 'gamdom.com', 'goated.com', 'metawin.com', 'rainbet.com', 'razed.com', 'rollbit.com', 'roobet.com', 'shuffle.com', 'solcasino.io', 'sportsbet.io', 'stake.com', 'thrill.com', 'whale.io', 'winna.com', 'yeet.com'];
  var base = NIGHT ? '../' : '';
  var MONO = "font-family:'Geist Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
  var ST = { healthy: [C.up, 'Healthy'], watch: [C.warn, 'Watch'], warning: [C.dn, 'Warning'] };

  function h(tag, a, kids) {
    var el = document.createElement(tag);
    for (var k in a || {}) { if (a[k] == null) continue; if (k === 'text') el.textContent = a[k]; else if (k === 'on') { for (var e in a.on) el.addEventListener(e, a.on[e]); } else el.setAttribute(k, a[k]); }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(v) { if (v == null) return '–'; var a = Math.abs(v); return (v < 0 ? '-' : '') + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a)); }
  function logo(d, n, s) { s = s || 22; var src = d && LOGOS.indexOf(d) >= 0 ? base + 'assets/logos/casinos/' + d + '.png' : ''; return src ? h('img', { src: src, alt: '', style: 'width:' + s + 'px;height:' + s + 'px;border-radius:6px;flex:none' }) : h('span', { style: 'width:' + s + 'px;height:' + s + 'px;border-radius:6px;flex:none;display:grid;place-items:center;font-size:9px;font-weight:700;background:' + C.soft + ';color:' + C.muted, text: (n || '').slice(0, 2).toUpperCase() }); }
  function dot(s) { return h('span', { class: 'tl-st' }, [h('i', { style: 'background:' + ST[s][0] }), ST[s][1]]); }
  function card(title, side, kids) { return h('section', { class: 'tl-card' }, [h('div', { class: 'tl-ch' }, [h('h3', { text: title }), side ? h('span', { class: 'tl-s', text: side }) : null]), h('div', { class: 'tl-cb' }, kids)]); }
  function ago(t) { var m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; }

  var css = '#sx-tools{margin:18px 0;display:flex;flex-direction:column;gap:14px}' +
    '.tl-head h2{margin:0;font-size:17px;font-weight:600;letter-spacing:-.02em;color:' + C.ink + '}.tl-head p{margin:2px 0 0;font-size:13px;color:' + C.muted + '}' +
    '.tl-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}' +
    '.tl-card{border:1px solid ' + C.line + ';border-radius:12px;background:linear-gradient(180deg,' + (NIGHT ? 'rgba(255,255,255,.025)' : 'rgba(124,92,255,.035)') + ',transparent 120px),' + C.card + ';min-width:0}' +
    '.tl-ch{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;border-bottom:1px solid ' + C.line + '}.tl-ch h3{margin:0;font-size:13.5px;font-weight:600;color:' + C.ink + '}.tl-s{font-size:12px;color:' + C.faint + '}' +
    '.tl-cb{padding:14px 16px}' +
    '.tl-st{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:' + C.muted + ';white-space:nowrap}.tl-st i{width:7px;height:7px;border-radius:50%}' +
    '.tl-li{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid ' + C.line + ';color:inherit;text-decoration:none}.tl-li:first-child{border-top:0;padding-top:0}' +
    '.tl-li .nm{flex:1;min-width:0;font-size:13.5px;color:' + C.ink + '}.tl-li .nm small{display:block;font-size:12px;color:' + C.faint + '}' +
    '.tl-n{' + MONO + 'color:' + C.ink + '}' +
    '.tl-f label{display:block;font-size:12px;color:' + C.muted + ';margin:0 0 6px}' +
    '.tl-in{width:100%;box-sizing:border-box;height:36px;border:1px solid ' + C.line + ';border-radius:7px;background:' + (NIGHT ? '#0B0B0D' : '#fff') + ';color:' + C.ink + ';padding:0 10px;font:inherit;font-size:13.5px;margin-bottom:12px}' +
    '.tl-btn{height:34px;padding:0 14px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,#8B6CFF,#6B4BEF);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
    '.tl-gh{height:30px;padding:0 12px;border-radius:7px;border:1px solid ' + C.line + ';background:transparent;color:' + C.ink + ';font:inherit;font-size:12.5px;text-decoration:none;display:inline-flex;align-items:center}' +
    '.tl-v{display:flex;gap:10px;align-items:baseline;margin-top:14px}.tl-v b{font-size:19px;font-weight:600}' +
    '.tl-m{height:6px;border-radius:3px;background:' + C.line + ';overflow:hidden;margin:10px 0 4px}.tl-m i{display:block;height:100%;border-radius:3px;transition:width .8s cubic-bezier(.2,.7,.2,1)}' +
    '.tl-dl{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid ' + C.line + ';border-radius:8px;margin-top:12px}.tl-dl div{padding:9px 11px;border-left:1px solid ' + C.line + ';min-width:0}.tl-dl div:first-child{border-left:0}' +
    '.tl-dl small{display:block;font-size:11px;color:' + C.faint + '}.tl-dl b{display:block;' + MONO + 'font-size:13.5px;color:' + C.ink + ';margin-top:2px}' +
    '.tl-note{font-size:12px;color:' + C.faint + ';line-height:1.55;margin:10px 0 0}' +
    '.tl-brief h4{margin:4px 0 8px;font-size:15.5px;line-height:1.35;font-weight:600;color:' + C.ink + '}' +
    '@media (max-width:1100px){.tl-g{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}@media (max-width:640px){.tl-g{grid-template-columns:minmax(0,1fr)}}';

  var H = null;
  function healthCard() {
    if (!H || !H.casinos.length) return card('Casino health', null, [h('p', { class: 'tl-note', style: 'margin:0', text: 'Health appears once the on-chain monitor has read the casino wallets.' })]);
    var k = H.counts, flagged = H.casinos.filter(function (c) { return c.status !== 'healthy'; });
    var kids = [['healthy', k.healthy], ['watch', k.watch], ['warning', k.warning]].map(function (r) { return h('div', { class: 'tl-li' }, [h('span', { class: 'nm' }, [dot(r[0])]), h('span', { class: 'tl-n', text: String(r[1]) })]); });
    kids.push(h('p', { class: 'tl-note', text: 'From reserve changes, payout ratio, payout speed and complaints.' }));
    (flagged.length ? flagged.slice(0, 3) : H.casinos.slice(0, 2)).forEach(function (c) {
      kids.push(h('a', { class: 'tl-li', href: base + 'Casino.dc.html?c=' + encodeURIComponent(c.slug), style: 'margin-top:8px' }, [logo(c.domain, c.name), h('span', { class: 'nm' }, [c.name, h('small', { text: c.reasons[0] || (c.coverDays ? 'Reserves cover ' + c.coverDays.toFixed(1) + ' days of payouts' : 'No issues found') })]), dot(c.status)]));
    });
    kids.push(h('a', { class: 'tl-gh', href: base + 'Account.dc.html', style: 'margin-top:12px', text: 'Get alerts for casinos you follow' }));
    return card('Casino health', 'Today', kids);
  }
  function payoutCard() {
    var sel = h('select', { class: 'tl-in', 'aria-label': 'Casino' }, (H ? H.casinos : []).slice().sort(function (a, b) { return b.balance - a.balance; }).map(function (c) { return h('option', { value: c.slug, text: c.name }); }));
    var amt = h('input', { class: 'tl-in', type: 'text', inputmode: 'numeric', value: '50,000', 'aria-label': 'Amount in US dollars' });
    var out = h('div');
    var run = function () {
      var v = Number(String(amt.value).replace(/[^0-9.]/g, ''));
      if (!sel.value || !v) return;
      out.innerHTML = ''; out.appendChild(h('p', { class: 'tl-note', text: 'Checking...' }));
      fetch('/api/payout-check?c=' + encodeURIComponent(sel.value) + '&amount=' + v, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        out.innerHTML = '';
        if (!j.tracked) { out.appendChild(h('p', { class: 'tl-note', text: 'This casino is not tracked on-chain yet.' })); return; }
        var col = j.score >= 80 ? C.up : j.score >= 60 ? C.v : j.score >= 40 ? C.warn : C.dn;
        out.appendChild(h('div', { class: 'tl-v' }, [h('b', { style: 'color:' + col, text: j.verdict.charAt(0).toUpperCase() + j.verdict.slice(1) }), h('span', { class: 'tl-s', text: 'Confidence ' + j.score + ' / 100' })]));
        var bar = h('i', { style: 'width:0;background:' + col }); out.appendChild(h('div', { class: 'tl-m' }, [bar])); requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.width = j.score + '%'; }); });
        out.appendChild(h('div', { class: 'tl-dl' }, [h('div', {}, [h('small', { text: 'Hot wallet' }), h('b', { text: money(j.balance) })]), h('div', {}, [h('small', { text: 'Median payout' }), h('b', { text: j.payoutMedianMin != null ? Math.round(j.payoutMedianMin) + ' min' : 'No reports' })]), h('div', {}, [h('small', { text: 'Similar paid, 7d' }), h('b', { text: String(j.paidSimilar7d) })])]));
        out.appendChild(h('p', { class: 'tl-note', text: (j.reasons.length ? j.reasons.join('. ') + '. ' : '') + j.note }));
      }).catch(function () { out.innerHTML = ''; out.appendChild(h('p', { class: 'tl-note', text: 'Could not check right now.' })); });
    };
    var f = h('form', { class: 'tl-f', on: { submit: function (e) { e.preventDefault(); run(); } } }, [h('label', { text: 'Casino' }), sel, h('label', { text: 'Withdrawal amount (USD)' }), amt, h('button', { class: 'tl-btn', type: 'submit', text: 'Check' })]);
    setTimeout(run, 0);
    return card('Payout check', 'Can it pay me?', [f, out]);
  }
  function briefCard(B) {
    var items = (B && B.items) || [];
    if (!items.length) return card('Daily brief', null, [h('p', { class: 'tl-note', style: 'margin:0', text: 'The first brief is written after the on-chain monitor\'s first full day.' })]);
    var t = items[0];
    var kids = [h('div', { class: 'tl-brief' }, [h('span', { class: 'tl-s', text: new Date(t.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }), h('h4', { text: t.title }), h('p', { class: 'tl-note', style: 'margin:0;color:' + C.muted, text: t.body }),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [h('a', { class: 'tl-gh', target: '_blank', rel: 'noopener', href: 'https://x.com/intent/tweet?text=' + encodeURIComponent(t.title + ' (via Streax)') + '&url=' + encodeURIComponent(location.origin + '/Casino.dc.html?c=' + t.slug), text: 'Share' }), t.txUrl ? h('a', { class: 'tl-gh', href: t.txUrl, target: '_blank', rel: 'noopener', text: 'View transaction' }) : h('a', { class: 'tl-gh', href: base + 'Casino.dc.html?c=' + encodeURIComponent(t.slug), text: 'Open casino' })])])];
    items.slice(1, 3).forEach(function (x, i) { kids.push(h('a', { class: 'tl-li', href: base + 'Casino.dc.html?c=' + encodeURIComponent(x.slug), style: i === 0 ? 'margin-top:14px;padding-top:12px;border-top:1px solid ' + C.line : '' }, [h('span', { class: 'nm' }, [x.title, h('small', { text: new Date(x.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) })])])); });
    return card('Daily brief', ago(t.at) + ' ago', kids);
  }
  function render(B) {
    var host = document.getElementById('sx-tools'); host.innerHTML = '';
    host.appendChild(h('div', { class: 'tl-head' }, [h('h2', { text: 'Player tools' }), h('p', { text: 'Casino health, the payout check and today\'s on-chain brief.' })]));
    host.appendChild(h('div', { class: 'tl-g' }, [healthCard(), payoutCard(), briefCard(B)]));
  }
  function start() {
    var host = document.getElementById('sx-tools');
    if (!host) return setTimeout(start, 100);
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    if (typeof fetch !== 'function') return;
    Promise.all([fetch('/api/health', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/brief', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
      .then(function (r) { H = r[0]; render(r[1]); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
