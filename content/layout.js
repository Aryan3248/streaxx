'use strict';
// Shared page frame for the server-rendered pages (articles, casino replies): head with SEO tags, top bar,
// footer and one stylesheet in the Streax light and night palettes.

const { esc } = require('./markdown');

const NAV = [
  ['Rankings', '/Rankings.dc.html'],
  ['Casinos', '/Casino.dc.html'],
  ['On-chain', '/Onchain.dc.html'],
  ['Complaints', '/Complaints.dc.html'],
  ['Wallet check', '/WalletCheck.dc.html'],
  ['Bonus calculator', '/BonusCalc.dc.html'],
  ['Articles', '/articles']
];

const CSS = `
:root{--bg:#F6F8FD;--ink:#0B1533;--sub:#55617F;--muted:#606C8A;--body:#33405F;--card:#FFFFFF;--border:#E3E9F5;--line:#E8EDF7;--soft:#F7F9FE;--chip:#EEF3FF;--chipInk:#2A3657;--accent:#2F54EB;--accentInk:#2442D6;--accentA:rgba(47,84,235,.08);--accentB:rgba(47,84,235,.22);--good:#0E7C66;--goodA:rgba(14,124,102,.08);--warn:#B45309;--warnA:rgba(180,83,9,.08);--bad:#C2410C;--badA:rgba(194,65,12,.08);--shadow:0 1px 2px rgba(16,24,64,.04),0 14px 40px -28px rgba(30,60,160,.35);--primary:linear-gradient(135deg,#4A75FF 0%,#2442D6 100%);--codeBg:#F1F4FB;--rootBg:radial-gradient(1100px 520px at 80% -8%,rgba(110,149,255,.18),transparent 62%),#F6F8FD}
[data-theme=night]{--bg:#070B17;--ink:#EAF0FF;--sub:#8C9AB9;--muted:#75829F;--body:#B7C3DD;--card:#0E1528;--border:#1C2742;--line:#18223A;--soft:#0B1222;--chip:#16203A;--chipInk:#C9D3EA;--accent:#8FA8FF;--accentInk:#B4C4FF;--accentA:rgba(143,168,255,.08);--accentB:rgba(143,168,255,.25);--good:#5EEAD4;--goodA:rgba(94,234,212,.08);--warn:#FCD34D;--warnA:rgba(252,211,77,.08);--bad:#FB923C;--badA:rgba(251,146,60,.08);--shadow:0 1px 2px rgba(0,0,0,.35),0 18px 44px -30px rgba(0,0,0,.9);--primary:linear-gradient(135deg,#5A82FF 0%,#2F54EB 100%);--codeBg:#0B1222;--rootBg:radial-gradient(1100px 520px at 80% -8%,rgba(62,107,255,.2),transparent 62%),#070B17}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--rootBg);background-attachment:fixed;color:var(--ink);font:16px/1.55 Geist,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%}
.skip{position:absolute;left:-9999px;top:8px;z-index:100;background:var(--card);color:var(--ink);padding:10px 14px;border-radius:10px}
.skip:focus{left:12px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px}
.top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:18px;height:66px}
.brand{display:inline-flex;align-items:center;gap:10px;flex:0 0 auto}
.brand img{width:32px;height:32px;border-radius:10px;box-shadow:0 6px 16px -8px rgba(37,72,190,.6)}
.brand span{font-family:'Instrument Serif',Georgia,serif;font-size:27px;line-height:1}
.nav{display:flex;align-items:center;gap:2px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{padding:8px 11px;border-radius:10px;font-size:14px;font-weight:500;color:var(--sub);white-space:nowrap}
.nav a:hover{color:var(--ink);background:var(--chip)}
.nav a[aria-current=page]{color:var(--accentInk);background:var(--accentA)}
.tools{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.iconbtn{width:40px;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--card);display:inline-flex;align-items:center;justify-content:center;color:var(--ink)}
.iconbtn:hover{border-color:var(--accentB)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border-radius:12px;font:inherit;font-size:14px;font-weight:600;border:1px solid var(--border);background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap}
.btn:hover{border-color:var(--accentB)}
.btn.primary{border:0;background:var(--primary);color:#fff;box-shadow:0 12px 28px -16px rgba(36,66,214,.75)}
.btn.primary:hover{filter:brightness(1.06)}
.avatar{width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;font-size:14px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.foot{margin-top:72px;border-top:1px solid var(--line);padding:36px 0 40px;color:var(--sub);font-size:13.5px}
.foot .cols{display:flex;flex-wrap:wrap;gap:28px;justify-content:space-between}
.foot .links{display:flex;flex-wrap:wrap;gap:8px 18px}
.foot .links a:hover{color:var(--ink)}
.foot .rg{margin-top:22px;font-size:12.5px;color:var(--muted);line-height:1.6}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accentInk)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--accentA);color:var(--accentInk)}
.card{background:var(--card);border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow)}
.serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400}
.mono{font-family:'Geist Mono',ui-monospace,monospace}
@media (max-width:900px){.top .wrap{height:auto;flex-wrap:wrap;padding-top:10px;padding-bottom:6px;gap:10px}.nav{order:3;flex:1 1 100%;margin:0 -6px}.tools{margin-left:auto}}
@media (max-width:520px){.wrap{padding:0 16px}.brand span{font-size:24px}.btn{padding:0 13px}}
`;

const ICON_MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path></svg>';
const ICON_SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';

function jsonLd(obj) { return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>'; }

// o: { title, desc, canonical, image, imageAlt, type, jsonld:[], night, user, current, body, extraCss, noindex, head }
function page(o) {
  const night = !!o.night;
  const t = esc(o.title);
  const d = esc(o.desc || '');
  const user = o.user;
  const nav = NAV.map(([label, href]) => '<a href="' + href + '"' + (o.current === href ? ' aria-current="page"' : '') + '>' + label + '</a>').join('');
  const acct = user
    ? '<a class="avatar" href="/Account.dc.html" title="My account" aria-label="My account">' + esc(user.initials || 'S') + '</a>'
    : '<a class="btn primary" href="/Signup.dc.html">Sign up</a>';
  return '<!doctype html>\n<html lang="en" data-theme="' + (night ? 'night' : 'light') + '">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<title>' + t + '</title>\n'
    + (d ? '<meta name="description" content="' + d + '">\n' : '')
    + (o.canonical ? '<link rel="canonical" href="' + esc(o.canonical) + '">\n' : '')
    + (o.noindex ? '<meta name="robots" content="noindex, nofollow">\n' : '<meta name="robots" content="index, follow, max-image-preview:large">\n')
    + '<meta name="theme-color" content="' + (night ? '#070B17' : '#F6F8FD') + '">\n'
    + '<meta property="og:site_name" content="Streax">\n<meta property="og:type" content="' + (o.type || 'website') + '">\n'
    + '<meta property="og:title" content="' + esc(o.ogTitle || o.title) + '">\n'
    + (d ? '<meta property="og:description" content="' + d + '">\n' : '')
    + (o.canonical ? '<meta property="og:url" content="' + esc(o.canonical) + '">\n' : '')
    + (o.image ? '<meta property="og:image" content="' + esc(o.image) + '">\n' + (o.imageAlt ? '<meta property="og:image:alt" content="' + esc(o.imageAlt) + '">\n' : '') : '')
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + (o.head || '')
    + '<link rel="icon" type="image/png" href="/assets/streax-icon.png">\n<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n'
    + '<link rel="alternate" type="application/rss+xml" title="Streax articles" href="/rss.xml">\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">\n'
    + '<style>' + CSS + (o.extraCss || '') + '</style>\n'
    + (o.jsonld || []).map(jsonLd).join('\n') + '\n'
    + '</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n'
    + '<header class="top"><div class="wrap">'
    + '<a class="brand" href="/" aria-label="Streax home"><img src="/assets/streax-logo.webp" alt="" width="32" height="32"><span>Streax</span></a>'
    + '<nav class="nav" aria-label="Main">' + nav + '</nav>'
    + '<div class="tools"><a class="iconbtn" href="/theme/' + (night ? 'light' : 'night') + '" aria-label="Switch to ' + (night ? 'light' : 'night') + ' mode" title="Switch to ' + (night ? 'light' : 'night') + ' mode">' + (night ? ICON_SUN : ICON_MOON) + '</a>' + acct + '</div>'
    + '</div></header>\n'
    + '<main id="main">' + o.body + '</main>\n'
    + '<footer class="foot"><div class="wrap"><div class="cols">'
    + '<div style="max-width:360px"><a class="brand" href="/"><img src="/assets/streax-logo.webp" alt="" width="28" height="28" style="width:28px;height:28px"><span style="font-size:24px">Streax</span></a><p style="margin:10px 0 0;line-height:1.6">Casino data you can check. Every number on Streax names its source.</p></div>'
    + '<div class="links">' + NAV.map(([l, h]) => '<a href="' + h + '">' + l + '</a>').join('') + '<a href="/rss.xml">RSS</a></div>'
    + '</div><p class="rg">18+ only. Gambling can be addictive. Play responsibly. Help: <a href="https://www.begambleaware.org" target="_blank" rel="noopener" style="text-decoration:underline">BeGambleAware.org</a> · GamCare.org.uk · GamblingTherapy.org<br>© ' + new Date().getUTCFullYear() + ' Streax · Not financial or legal advice · Some links may earn Streax a commission, which never changes a score.</p></div></footer>\n'
    + (o.scripts || '')
    + '</body>\n</html>\n';
}

module.exports = { page, esc, NAV, CSS };
