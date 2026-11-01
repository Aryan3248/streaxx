/* Streax motion: sections reveal as they scroll in, big figures count up the
   first time they show a real value, chart lines draw in, and Home gets a live
   whale ticker. Loaded by support.js after the page renders. */
(function () {
  // phone tab bar: shrink while scrolling down, expand when scrolling up or near the top
  (function () {
    var last = window.scrollY, root = document.documentElement, tick = false;
    window.addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () {
        var y = window.scrollY, d = y - last;
        if (y < 80) root.classList.remove('sx-mini');
        else if (d > 6) root.classList.add('sx-mini');
        else if (d < -6) root.classList.remove('sx-mini');
        last = y; tick = false;
      });
    }, { passive: true });
  })();
  // phone: put the small Streax mark at the start of the search row
  (function () {
    var add = function () {
      var q = document.getElementById('gq');
      if (!q || document.querySelector('.sx-mlogo')) return !!q;
      var row = q; while (row && row.parentElement && !/flex-wrap: wrap/.test(row.parentElement.getAttribute('style') || '')) row = row.parentElement;
      row = row && row.parentElement;
      if (!row) return true;
      var night = /\/night\//.test(location.pathname), a = document.createElement('a');
      a.href = (night ? '' : '') + 'Home.dc.html'; a.setAttribute('aria-label', 'Streax home');
      a.innerHTML = '<img class="sx-mlogo" src="' + (night ? '../' : '') + 'assets/streax-mark.png" alt="Streax">';
      a.style.cssText = 'display:contents';
      row.insertBefore(a, row.firstChild); return true;
    };
    if (!add()) { var n = 0, t = setInterval(function () { if (add() || ++n > 40) clearInterval(t); }, 100); }
  })();
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.getElementById('dc-root');
  if (!root || REDUCED || !('IntersectionObserver' in window)) { ticker(); return; }
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };

  // ---- sections below the fold fade up when they scroll into view
  var revealIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('sx-show'); revealIO.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' });
  function reveal(scope) {
    (scope.querySelectorAll ? scope.querySelectorAll('main section:not(.cp-card):not(.cp-head):not(.mv-card):not(.hx-card)') : []).forEach(function (sec) {
      if (sec.__sxR) return; sec.__sxR = 1;
      if (sec.getBoundingClientRect().top > innerHeight) { sec.style.animation = 'none'; sec.classList.add('sx-wait'); revealIO.observe(sec); }
    });
  }

  // ---- big figures ($96.86M, 21.4K, 87) count up from zero once
  var NUM = /^([^\d-]*)(-?[\d,]*\.?\d+)([A-Za-z%]*)$/;
  function isFigure(el) {
    if (el.children.length) return false;
    var st = el.getAttribute('style') || '';
    if (!/Geist Mono|Instrument Serif/.test(st)) return false;
    var m = /font-size:\s*(\d+)px/.exec(st);
    return m && +m[1] >= 20;
  }
  function countUp(el) {
    var txt = el.textContent.trim(), m = NUM.exec(txt);
    if (!m) return false;
    var target = parseFloat(m[2].replace(/,/g, ''));
    if (!target) return false;
    var dec = (m[2].split('.')[1] || '').length, comma = m[2].indexOf(',') >= 0, t0 = performance.now(), dur = 900, last = null;
    var fmt = function (v) { var s = v.toFixed(dec); if (comma) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return m[1] + s + m[3]; };
    (function step(now) {
      if (last !== null && el.textContent !== last) return; // the page changed it: stop
      var p = Math.min(1, (now - t0) / dur);
      last = p < 1 ? fmt(target * ease(p)) : txt;
      el.textContent = last;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
    return true;
  }
  var figIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { figIO.unobserve(e.target); if (countUp(e.target)) e.target.__sxC = 2; else e.target.__sxC = 0; } });
  }, { threshold: 0.4 });
  function figures(scope) {
    var all = scope.querySelectorAll ? scope.querySelectorAll('main div, main span, main b, main strong') : [];
    for (var i = 0; i < all.length; i++) { var el = all[i]; if (el.__sxC || !isFigure(el)) continue; el.__sxC = 1; figIO.observe(el); }
  }

  // ---- line charts and sparklines draw from left to right
  var lineIO = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return; lineIO.unobserve(e.target);
      var p = e.target, len; try { len = p.getTotalLength(); } catch (x) { return; }
      if (!len) return;
      p.style.strokeDasharray = len + ' ' + len; p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)';
      p.style.strokeDashoffset = '0';
      setTimeout(function () { p.style.strokeDasharray = ''; p.style.transition = ''; }, 1200);
    });
  }, { threshold: 0.3 });
  function lines(scope) {
    (scope.querySelectorAll ? scope.querySelectorAll('main svg path, main svg polyline') : []).forEach(function (p) {
      if (p.__sxL || p.closest('[data-dc-keep]')) return; p.__sxL = 1;
      var f = p.getAttribute('fill'), s = p.getAttribute('stroke');
      if (s && s !== 'none' && (!f || f === 'none') && !p.getAttribute('stroke-dasharray')) lineIO.observe(p);
    });
  }

  function scan(scope) { reveal(scope); figures(scope); lines(scope); }
  scan(root);
  // later renders (live data arriving): catch new or changed nodes
  var queued = false;
  new MutationObserver(function () {
    if (queued) return; queued = true;
    requestAnimationFrame(function () { queued = false; scan(root); });
  }).observe(root, { childList: true, subtree: true, characterData: true });

  ticker();

  // ---- Home: a ticker of the latest whale moves under the header
  // Home: a ticker of every tracked casino, 24h deposits and change vs the day before.
  // Live from the monitor; falls back to the published 24h snapshot.
  function ticker() {
    if (!/(^|\/)(Home\.dc\.html|index\.html)?$/.test(location.pathname) || typeof fetch !== 'function') return;
    var night = /\/night\//.test(location.pathname), base = night ? '../' : '';
    var LOGOS = ['500.casino','acebet','bc.game','betfury.com','betstrike','bluff','cloudbet.com','cybet','duel.com','duelbits.com','flush','gamba.com','gamdom.com','goated.com','metawin.com','rainbet.com','razed.com','rollbit.com','roobet.com','shuffle.com','solcasino.io','sportsbet.io','stake.com','thrill.com','whale.io','winna.com','yeet.com'];
    var money = function (v) { return '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v)); };
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var spark = function (vals, up) {
      var max = Math.max.apply(null, vals.concat([1])), n = vals.length;
      if (n < 2) return '';
      var pts = vals.map(function (v, i) { return (i / (n - 1) * 44).toFixed(1) + ',' + (17 - v / max * 14).toFixed(1); }).join(' ');
      return '<svg class="sk" width="44" height="20" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="' + (up ? '#4ADE80' : '#F87171') + '" stroke-width="1.6" stroke-linecap="round"/></svg>';
    };
    var draw = function (rows, label) {
      var main = document.querySelector('#dc-root main');
      if (!main || rows.length < 3) return;
      var old = main.querySelector('.sx-ticker'); if (old) old.remove();
      var html = rows.map(function (r) {
        var lg = r.domain && LOGOS.indexOf(r.domain) >= 0 ? base + 'assets/logos/casinos/' + r.domain + '.png' : '';
        var up = r.chg == null || r.chg >= 0;
        return '<a class="tk-it" href="' + base + 'Casino.dc.html?c=' + encodeURIComponent(r.slug) + '">' + (lg ? '<img src="' + lg + '" alt="">' : '<i class="tk-ini">' + esc(r.name.slice(0, 2).toUpperCase()) + '</i>') +
          '<b>' + esc(r.name) + '</b><span class="tk-v">' + money(r.v) + '</span>' + spark(r.spark || [], up) +
          (r.chg == null ? '' : '<span class="tk-c ' + (up ? 'up' : 'dn') + '">' + (up ? '+' : '') + r.chg.toFixed(1) + '%</span>') + '</a>';
      }).join('');
      var box = document.createElement('div');
      box.className = 'sx-ticker sx-keep'; box.setAttribute('aria-label', 'Casino deposits, last 24 hours');
      box.innerHTML = '<span class="tk-lab"><i class="sx-live-dot"></i><span>' + label + '</span></span><div class="sx-ticker-view"><div class="sx-ticker-track">' + html + html + '</div></div>';
      var first = main.querySelector('section');
      if (first) first.parentNode.insertBefore(box, first); else main.prepend(box);
    };
    var snapshot = function () {
      try { draw(window.__sxPage.D.casinos.slice().sort(function (a, b) { return b.dep - a.dep; }).slice(0, 14).map(function (c) { return { name: c.name, slug: c.slug, domain: c.domain, v: c.dep, chg: null }; }), 'SNAPSHOT · 24H'); } catch (e) {}
    };
    fetch('/api/onchain/analytics?days=7', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (D) {
      var rows = (D && D.casinos || []).map(function (c) {
        var n = c.dep.length, today = c.dep[n - 1] || 0, prev = c.dep[n - 2] || 0;
        return { name: c.name, slug: c.slug, domain: c.domain, v: today || prev, chg: today && prev ? (today - prev) / prev * 100 : null, spark: c.dep };
      }).filter(function (r) { return r.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 14);
      if (rows.length >= 3) draw(rows, 'LIVE · 24H'); else snapshot();
    }).catch(snapshot);
  }
})();
