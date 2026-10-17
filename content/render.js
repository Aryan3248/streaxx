'use strict';
// Server-rendered article pages: the index, categories, each article, plus sitemap.xml, rss.xml and robots.txt.
// Real HTML on first load, so search engines and link previews read the full text.

const md = require('./markdown');
const { page, esc } = require('./layout');
const { CATEGORIES } = require('./store');

const PER_PAGE = 12;
const catName = id => (CATEGORIES.find(c => c.id === id) || { name: 'Articles' }).name;
const fmtDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const isoDate = ms => new Date(ms).toISOString();
const abs = (base, u) => (!u ? '' : /^https?:/i.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u));
const initials = n => (String(n || 'Streax').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || 'S').toUpperCase();
const tagList = s => String(s || '').split(',').map(t => t.trim()).filter(Boolean);
const DEFAULT_AUTHOR = 'Streax Research';

const ARTICLE_CSS = `
.hero{padding:44px 0 8px}
.hero h1{margin:12px 0 10px;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:clamp(40px,6vw,64px);line-height:1.02;letter-spacing:-.01em}
.hero p.lead{margin:0;max-width:640px;font-size:18px;line-height:1.6;color:var(--sub)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:26px 0 8px}
.tab{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--card);font-size:14px;font-weight:500;color:var(--sub)}
.tab:hover{color:var(--ink);border-color:var(--accentB)}
.tab[aria-current=page]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.tab .n{font-family:'Geist Mono',monospace;font-size:12px;opacity:.75}
.feature{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);overflow:hidden;margin-top:22px}
.feature .media{aspect-ratio:16/10;min-height:100%}
.feature .txt{padding:32px;display:flex;flex-direction:column;gap:12px;justify-content:center}
.feature h2{margin:0;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:clamp(30px,3.4vw,42px);line-height:1.06}
.feature p{margin:0;color:var(--sub);font-size:16.5px;line-height:1.6}
.feature .pill{align-self:flex-start}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:22px}
.acard{display:flex;flex-direction:column;overflow:hidden;transition:transform .18s ease,box-shadow .18s ease}
.acard:hover{transform:translateY(-3px);box-shadow:0 1px 2px rgba(16,24,64,.05),0 26px 50px -30px rgba(30,60,160,.45)}
.acard .media{aspect-ratio:16/9}
.acard .txt{padding:18px 18px 20px;display:flex;flex-direction:column;gap:8px;flex:1 1 auto}
.acard h3{margin:0;font-size:19px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
.acard p{margin:0;font-size:14.5px;line-height:1.55;color:var(--sub);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px;color:var(--muted)}
.meta .dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6}
.media{position:relative;display:block;background:#1d3fd6 url(/assets/streax-card.webp) center/cover no-repeat;overflow:hidden}
.media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.media .ph{position:absolute;inset:0;display:flex;align-items:flex-end;padding:18px;color:#fff;font-family:'Instrument Serif',Georgia,serif;font-size:28px;line-height:1.05;background:linear-gradient(180deg,rgba(10,20,80,0) 30%,rgba(10,20,80,.55))}
.pager{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:30px}
.empty{margin-top:24px;padding:56px 24px;text-align:center}
.empty h2{margin:0 0 8px;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:36px}
.empty p{margin:0 auto;max-width:460px;color:var(--sub)}
.band{margin-top:40px;padding:30px;border-radius:24px;color:#fff;background:#2442D6 url(/assets/streax-banner.webp) center/cover;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between;box-shadow:0 30px 70px -40px rgba(31,58,214,.8)}
.band h2{margin:0;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:32px;line-height:1.1}
.band p{margin:6px 0 0;color:rgba(255,255,255,.9)}
.band .btn{background:#fff;color:#1B2FA8;border:0}
.crumbs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13.5px;color:var(--muted);padding-top:28px}
.crumbs a:hover{color:var(--ink)}
.ahead{max-width:820px;padding-top:14px}
.ahead h1{margin:14px 0 12px;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:clamp(38px,5.4vw,60px);line-height:1.04;letter-spacing:-.01em}
.ahead .dek{margin:0;font-size:20px;line-height:1.55;color:var(--sub)}
.byline{display:flex;align-items:center;gap:12px;margin-top:22px}
.byline .av{width:42px;height:42px;border-radius:50%;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:15px;flex:0 0 auto}
.cover{margin:30px 0 0;border-radius:24px;overflow:hidden;aspect-ratio:16/8;position:relative;box-shadow:var(--shadow)}
.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cover figcaption{position:absolute;left:12px;bottom:12px;font-size:12px;color:#fff;background:rgba(0,0,0,.45);padding:4px 8px;border-radius:8px}
.layout{display:grid;grid-template-columns:minmax(0,720px) minmax(0,300px);gap:56px;justify-content:space-between;margin-top:40px}
.side{position:sticky;top:90px;align-self:start;display:flex;flex-direction:column;gap:16px}
.side .card{padding:18px}
.side h2{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.toc{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.toc a{display:block;padding:6px 10px;border-radius:9px;font-size:14px;line-height:1.4;color:var(--sub);border-left:2px solid transparent}
.toc a:hover{color:var(--ink);background:var(--soft)}
.toc a.on{color:var(--accentInk);background:var(--accentA);border-left-color:var(--accent)}
.toc .l3 a{padding-left:22px;font-size:13.5px}
.share{display:flex;gap:8px;flex-wrap:wrap}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border-radius:999px;background:var(--chip);color:var(--chipInk);font-size:13.5px;font-weight:500}
.chip:hover{background:var(--accentA);color:var(--accentInk)}
.prose{font-size:18px;line-height:1.75;color:var(--body);min-width:0}
.prose>*:first-child{margin-top:0}
.prose p{margin:0 0 1.15em}
.prose h2{margin:1.9em 0 .6em;font-size:29px;line-height:1.2;letter-spacing:-.02em;color:var(--ink);font-weight:600;scroll-margin-top:90px}
.prose h3{margin:1.6em 0 .5em;font-size:22px;line-height:1.3;color:var(--ink);font-weight:600;scroll-margin-top:90px}
.prose h4{margin:1.4em 0 .4em;font-size:18px;color:var(--ink)}
.prose a{color:var(--accentInk);text-decoration:underline;text-decoration-color:var(--accentB);text-underline-offset:3px;text-decoration-thickness:1.5px}
.prose a:hover{text-decoration-color:currentColor}
.prose strong{color:var(--ink)}
.prose ul,.prose ol{margin:0 0 1.2em;padding-left:1.3em}
.prose li{margin:.35em 0}
.prose li.task{list-style:none;margin-left:-1.3em;display:flex;gap:10px;align-items:flex-start}
.prose .tick{width:18px;height:18px;border-radius:6px;border:1.5px solid var(--border);margin-top:6px;flex:0 0 auto}
.prose .tick.on{background:var(--good);border-color:var(--good)}
.prose blockquote{margin:1.5em 0;padding:4px 0 4px 22px;border-left:3px solid var(--accent);font-family:'Instrument Serif',Georgia,serif;font-size:26px;line-height:1.35;color:var(--ink)}
.prose blockquote p{margin:0}
.prose .callout{margin:1.5em 0;padding:16px 18px;border-radius:16px;background:var(--accentA);border:1px solid var(--accentB);font-size:16.5px;line-height:1.65}
.prose .callout p:last-child{margin-bottom:0}
.prose .callout-t{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accentInk);margin-bottom:4px}
.prose .callout-warning{background:var(--warnA);border-color:color-mix(in srgb,var(--warn) 30%,transparent)}
.prose .callout-warning .callout-t{color:var(--warn)}
.prose .callout-tip{background:var(--goodA);border-color:color-mix(in srgb,var(--good) 30%,transparent)}
.prose .callout-tip .callout-t{color:var(--good)}
.prose code{font-family:'Geist Mono',monospace;font-size:.86em;background:var(--codeBg);border:1px solid var(--line);padding:.1em .35em;border-radius:6px}
.prose pre{margin:1.4em 0;padding:16px 18px;border-radius:14px;background:var(--codeBg);border:1px solid var(--line);overflow-x:auto;font-size:14.5px;line-height:1.6}
.prose pre code{background:none;border:0;padding:0}
.prose figure{margin:1.8em 0}
.prose figure img,.prose p img{display:block;width:100%;height:auto;border-radius:16px}
.prose figcaption{margin-top:8px;font-size:14px;color:var(--muted);text-align:center}
.prose hr{border:0;height:1px;background:var(--line);margin:2.2em 0}
.prose .table{overflow-x:auto;margin:1.5em 0;border:1px solid var(--border);border-radius:14px}
.prose table{width:100%;border-collapse:collapse;font-size:15.5px;line-height:1.5}
.prose th{background:var(--soft);text-align:left;font-size:13px;font-weight:600;color:var(--sub);padding:10px 14px;border-bottom:1px solid var(--border)}
.prose td{padding:10px 14px;border-bottom:1px solid var(--line)}
.prose tr:last-child td{border-bottom:0}
.after{margin-top:34px;padding-top:24px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:16px}
.note{font-size:13.5px;line-height:1.6;color:var(--muted)}
.progress{position:fixed;left:0;top:0;height:3px;width:0;background:var(--primary);z-index:60}
.draftbar{background:var(--warnA);border:1px solid color-mix(in srgb,var(--warn) 35%,transparent);color:var(--warn);border-radius:14px;padding:10px 14px;font-size:14px;margin-top:18px}
@media (max-width:1020px){.layout{grid-template-columns:minmax(0,1fr)}.side{position:static}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.feature{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.grid{grid-template-columns:minmax(0,1fr)}.feature .txt{padding:22px}.prose{font-size:17px}.prose h2{font-size:25px}.ahead .dek{font-size:18px}.cover{border-radius:18px;aspect-ratio:16/10}.band{padding:22px}.hero{padding-top:30px}}
`;

function media(a, eager) {
  return '<span class="media" aria-hidden="true">' + (a.cover
    ? '<img src="' + esc(a.cover) + '" alt=""' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">'
    : '<span class="ph">' + esc(catName(a.category)) + '</span>') + '</span>';
}
function metaLine(a) {
  const r = md.render(a.body || '');
  return '<span class="meta"><span>' + esc(catName(a.category)) + '</span><span class="dot"></span><time datetime="' + isoDate(a.published_at) + '">' + fmtDate(a.published_at) + '</time><span class="dot"></span><span>' + r.minutes + ' min read</span></span>';
}
function card(a) {
  return '<a class="card acard" href="/articles/' + esc(a.slug) + '">' + media(a) + '<span class="txt">' + metaLine(a)
    + '<h3>' + esc(a.title) + '</h3>' + (a.dek ? '<p>' + esc(a.dek) + '</p>' : '') + '</span></a>';
}

function org(base) {
  return { '@type': 'Organization', name: 'Streax', url: base + '/', logo: { '@type': 'ImageObject', url: base + '/assets/streax-logo.webp' } };
}

function indexPage(ctx, store, opts) {
  const base = ctx.base;
  const cat = opts.category || '';
  const pageNo = Math.max(1, opts.page || 1);
  const counts = store.categoryCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const res = store.published({ category: cat, limit: PER_PAGE, offset: (pageNo - 1) * PER_PAGE });
  const rows = res.rows;
  const pages = Math.max(1, Math.ceil(res.total / PER_PAGE));
  const C = CATEGORIES.find(c => c.id === cat);
  const path = cat ? '/articles/category/' + cat : '/articles';
  const tabs = '<nav class="tabs" aria-label="Article categories"><a class="tab" href="/articles"' + (!cat ? ' aria-current="page"' : '') + '>All<span class="n">' + total + '</span></a>'
    + CATEGORIES.map(c => '<a class="tab" href="/articles/category/' + c.id + '"' + (cat === c.id ? ' aria-current="page"' : '') + '>' + c.name + '<span class="n">' + (counts[c.id] || 0) + '</span></a>').join('') + '</nav>';
  let list = '';
  if (!rows.length) {
    list = '<div class="card empty"><h2>' + (cat ? 'No ' + esc(C.name.toLowerCase()) + ' yet' : 'The first articles are on the way') + '</h2><p>Streax research covers casino payouts, reserves, fairness and bonuses, backed by on-chain data. Create a free account and we will email you when new pieces go live.</p><p style="margin-top:18px"><a class="btn primary" href="/Signup.dc.html">Create free account</a></p></div>';
  } else {
    let rest = rows;
    if (pageNo === 1) {
      const f = rows.find(a => a.featured) || rows[0];
      rest = rows.filter(a => a !== f);
      list += '<a class="card feature" href="/articles/' + esc(f.slug) + '">' + media(f, true) + '<span class="txt"><span class="pill">' + (f.featured ? 'Featured' : 'Latest') + '</span><h2>' + esc(f.title) + '</h2>' + (f.dek ? '<p>' + esc(f.dek) + '</p>' : '') + metaLine(f) + '</span></a>';
    }
    if (rest.length) list += '<div class="grid">' + rest.map(card).join('') + '</div>';
    if (pages > 1) {
      list += '<nav class="pager" aria-label="Pages">' + (pageNo > 1 ? '<a class="btn" rel="prev" href="' + path + (pageNo > 2 ? '?page=' + (pageNo - 1) : '') + '">Newer</a>' : '')
        + '<span class="meta">Page ' + pageNo + ' of ' + pages + '</span>' + (pageNo < pages ? '<a class="btn" rel="next" href="' + path + '?page=' + (pageNo + 1) + '">Older</a>' : '') + '</nav>';
    }
  }
  const title = (C ? C.name + ' · Streax articles' : 'Crypto casino research and guides · Streax') + (pageNo > 1 ? ' · page ' + pageNo : '');
  const desc = C ? C.blurb + ' Research from Streax, the on-chain crypto casino tracker.' : 'Research, guides and weekly reports on crypto casinos: payouts, reserves, fairness and bonuses, backed by on-chain data.';
  const body = '<div class="wrap"><section class="hero"><span class="eyebrow">Streax research</span><h1>' + (C ? esc(C.name) : 'Read the money behind crypto casinos.') + '</h1><p class="lead">' + esc(C ? C.blurb : 'Investigations, guides and weekly numbers from the Streax monitor. Every claim links to its source.') + '</p>' + tabs + '</section>'
    + list
    + '<section class="band" aria-label="Weekly report"><div><h2>Get the weekly casino report</h2><p>The biggest moves, new complaints and score changes. Free with a Streax account.</p></div><a class="btn" href="/Signup.dc.html">Create free account</a></section></div>';
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: C ? C.name : 'Streax articles', url: base + path, description: desc, isPartOf: { '@type': 'WebSite', name: 'Streax', url: base + '/' },
    mainEntity: { '@type': 'ItemList', itemListElement: rows.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: base + '/articles/' + a.slug })) } }];
  return page({ title, desc, canonical: base + path + (pageNo > 1 ? '?page=' + pageNo : ''), image: base + '/assets/streax-card.webp', jsonld: ld, night: ctx.night, user: ctx.user, current: '/articles', extraCss: ARTICLE_CSS, body,
    head: (pageNo > 1 ? '<link rel="prev" href="' + base + path + (pageNo > 2 ? '?page=' + (pageNo - 1) : '') + '">\n' : '') + (pageNo < pages ? '<link rel="next" href="' + base + path + '?page=' + (pageNo + 1) + '">\n' : '') });
}

const SHARE_X = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zM16.7 19.2h1.7L7.4 4.7H5.6z"></path></svg>';
const SHARE_TG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4L3 11l6 2.5L11.5 20l3-4.5 4.5 3.5z"></path><path d="M9 13.5l12-9.5"></path></svg>';
const COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';

// casinoName(slug) -> display name, or the slug
function articlePage(ctx, store, a, opts = {}) {
  const base = ctx.base;
  const host = (base.split('://')[1] || '').split('/')[0];
  const r = md.render(a.body || '', { host });
  const url = base + '/articles/' + a.slug;
  const pub = a.published_at || a.updated || Date.now();
  const updated = a.updated && a.updated - pub > 6 * 3600000 ? a.updated : 0;
  const author = a.author || DEFAULT_AUTHOR;
  const tags = tagList(a.tags);
  const casinos = tagList(a.casinos);
  const related = store.published({ category: a.category, exclude: a.id, limit: 3 }).rows;
  if (related.length < 3) store.published({ exclude: a.id, limit: 6 }).rows.forEach(x => { if (related.length < 3 && !related.find(y => y.id === x.id)) related.push(x); });
  const image = abs(base, a.cover || (r.firstImage && r.firstImage.src) || '/assets/streax-card.webp');
  const desc = a.seo_desc || a.dek || r.plain.slice(0, 155);
  const toc = r.toc.filter(t => t.level <= 3);
  const side = '<aside class="side" aria-label="On this page">'
    + (toc.length >= 2 ? '<div class="card"><h2>On this page</h2><ol class="toc" id="toc">' + toc.map(t => '<li class="l' + t.level + '"><a href="#' + t.id + '">' + esc(t.text) + '</a></li>').join('') + '</ol></div>' : '')
    + '<div class="card"><h2>Share</h2><div class="share">'
    + '<a class="btn" href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(a.title) + '&url=' + encodeURIComponent(url) + '" target="_blank" rel="noopener noreferrer" aria-label="Share on X">' + SHARE_X + 'X</a>'
    + '<a class="btn" href="https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(a.title) + '" target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram">' + SHARE_TG + 'Telegram</a>'
    + '<button class="btn" type="button" id="copy-link" data-url="' + esc(url) + '">' + COPY + '<span>Copy link</span></button></div></div>'
    + (casinos.length ? '<div class="card"><h2>Casinos in this article</h2><div class="chips">' + casinos.map(s => '<a class="chip" href="/Casino.dc.html?c=' + encodeURIComponent(s) + '">' + esc(opts.casinoName ? opts.casinoName(s) : s) + '</a>').join('') + '</div></div>' : '')
    + (!ctx.user ? '<div class="card" style="background:var(--accentA);border-color:var(--accentB)"><h2 style="color:var(--accentInk)">Free member perks</h2><p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:var(--body)">Whale alerts for the casinos you follow, full on-chain history and member codes.</p><a class="btn primary" href="/Signup.dc.html" style="width:100%">Create free account</a></div>' : '')
    + '</aside>';
  const body = '<div class="progress" id="progress" aria-hidden="true"></div><div class="wrap">'
    + (opts.preview ? '<div class="draftbar" role="status">Preview of an unpublished article. Only people with this link can see it, and search engines are told not to index it.</div>' : '')
    + '<nav class="crumbs" aria-label="Breadcrumb"><a href="/articles">Articles</a><span aria-hidden="true">/</span><a href="/articles/category/' + esc(a.category) + '">' + esc(catName(a.category)) + '</a></nav>'
    + '<article><header class="ahead"><span class="pill">' + esc(catName(a.category)) + '</span><h1>' + esc(a.title) + '</h1>' + (a.dek ? '<p class="dek">' + esc(a.dek) + '</p>' : '')
    + '<div class="byline"><span class="av" aria-hidden="true">' + esc(initials(author)) + '</span><span style="display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">' + esc(author) + (a.author_role ? '<span style="font-weight:400;color:var(--muted)"> · ' + esc(a.author_role) + '</span>' : '') + '</span>'
    + '<span class="meta"><time datetime="' + isoDate(pub) + '">' + fmtDate(pub) + '</time>' + (updated ? '<span class="dot"></span><span>Updated <time datetime="' + isoDate(updated) + '">' + fmtDate(updated) + '</time></span>' : '') + '<span class="dot"></span><span>' + r.minutes + ' min read</span></span></span></div></header>'
    + (a.cover ? '<figure class="cover"><img src="' + esc(a.cover) + '" alt="' + esc(a.cover_alt || '') + '" fetchpriority="high" decoding="async"></figure>' : '')
    + '<div class="layout"><div class="prose" id="prose">' + r.html
    + '<div class="after">' + (tags.length ? '<div class="chips" aria-label="Tags">' + tags.map(t => '<span class="chip">#' + esc(t) + '</span>').join('') + '</div>' : '')
    + '<p class="note">Streax checks every figure against its source before publishing. Spotted a mistake? Tell us through Support on any Streax page and we will correct it with a note. 18+ only. Not financial or legal advice.</p></div>'
    + '</div>' + side + '</div></article>'
    + (related.length ? '<section style="margin-top:56px" aria-labelledby="more"><h2 id="more" class="serif" style="margin:0;font-size:36px">Keep reading</h2><div class="grid">' + related.map(card).join('') + '</div></section>' : '')
    + '<section class="band" aria-label="Weekly report"><div><h2>Get the weekly casino report</h2><p>The biggest moves, new complaints and score changes, in your inbox.</p></div><a class="btn" href="/Signup.dc.html">Create free account</a></section></div>';
  const ld = [{ '@context': 'https://schema.org', '@type': a.category === 'news' ? 'NewsArticle' : 'Article', headline: a.title.slice(0, 110), description: desc, image: [image],
    datePublished: isoDate(pub), dateModified: isoDate(a.updated || pub), author: author === DEFAULT_AUTHOR ? org(base) : { '@type': 'Person', name: author }, publisher: org(base),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }, articleSection: catName(a.category), keywords: tags.join(', '), wordCount: r.words, inLanguage: 'en' },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Articles', item: base + '/articles' },
    { '@type': 'ListItem', position: 2, name: catName(a.category), item: base + '/articles/category/' + a.category },
    { '@type': 'ListItem', position: 3, name: a.title, item: url }] }];
  const script = '<script>(function(){var p=document.getElementById("progress"),art=document.getElementById("prose");function f(){if(!art)return;var r=art.getBoundingClientRect(),h=art.offsetHeight-innerHeight*0.6,d=Math.min(1,Math.max(0,-r.top/(h>0?h:1)));p.style.width=(d*100).toFixed(1)+"%";}addEventListener("scroll",f,{passive:true});f();'
    + 'var b=document.getElementById("copy-link");if(b)b.addEventListener("click",function(){var u=b.getAttribute("data-url"),s=b.querySelector("span");(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){s.textContent="Copied";setTimeout(function(){s.textContent="Copy link";},1600);},function(){prompt("Copy this link",u);});});'
    + 'var t=document.getElementById("toc");if(t&&"IntersectionObserver" in window){var links={};t.querySelectorAll("a").forEach(function(a){links[a.getAttribute("href").slice(1)]=a;});var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){Object.keys(links).forEach(function(k){links[k].classList.toggle("on",k===e.target.id);});}});},{rootMargin:"-90px 0px -70% 0px"});Object.keys(links).forEach(function(k){var el=document.getElementById(k);if(el)io.observe(el);});}})();</script>';
  return page({ title: (a.seo_title || a.title) + ' · Streax', ogTitle: a.seo_title || a.title, desc, canonical: url, image, imageAlt: a.cover_alt || a.title, type: 'article', jsonld: opts.preview ? [] : ld,
    night: ctx.night, user: ctx.user, current: '/articles', extraCss: ARTICLE_CSS, body, scripts: script, noindex: !!opts.preview,
    head: '<meta property="article:published_time" content="' + isoDate(pub) + '">\n<meta property="article:modified_time" content="' + isoDate(a.updated || pub) + '">\n<meta property="article:section" content="' + esc(catName(a.category)) + '">\n' + tags.map(t => '<meta property="article:tag" content="' + esc(t) + '">\n').join('') });
}

function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }

function sitemap(base, store, casinoSlugs) {
  const now = isoDate(Date.now()).slice(0, 10);
  const urls = [];
  const add = (loc, lastmod, freq, pri) => urls.push('<url><loc>' + xmlEsc(base + loc) + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + (freq ? '<changefreq>' + freq + '</changefreq>' : '') + (pri ? '<priority>' + pri + '</priority>' : '') + '</url>');
  add('/', now, 'hourly', '1.0');
  ['Rankings', 'Onchain', 'Wallets', 'Analytics', 'Streamers', 'Complaints', 'WalletCheck', 'BonusCalc'].forEach(p => add('/' + p + '.dc.html', now, 'daily', '0.8'));
  (casinoSlugs || []).forEach(s => add('/Casino.dc.html?c=' + encodeURIComponent(s), now, 'daily', '0.7'));
  const list = store.published({ limit: 100 }).rows;
  add('/articles', list.length ? isoDate(list[0].published_at).slice(0, 10) : now, 'daily', '0.8');
  CATEGORIES.forEach(c => add('/articles/category/' + c.id, null, 'weekly', '0.5'));
  let off = 0;
  for (;;) {
    const rows = store.published({ limit: 100, offset: off }).rows;
    rows.forEach(a => add('/articles/' + a.slug, isoDate(a.updated || a.published_at).slice(0, 10), 'monthly', '0.7'));
    if (rows.length < 100) break;
    off += 100;
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
}

function rss(base, store) {
  const rows = store.published({ limit: 30 }).rows;
  const items = rows.map(a => '<item><title>' + xmlEsc(a.title) + '</title><link>' + xmlEsc(base + '/articles/' + a.slug) + '</link><guid isPermaLink="true">' + xmlEsc(base + '/articles/' + a.slug) + '</guid>'
    + '<pubDate>' + new Date(a.published_at).toUTCString() + '</pubDate><category>' + xmlEsc(catName(a.category)) + '</category>'
    + '<description>' + xmlEsc(a.dek || a.seo_desc || '') + '</description></item>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Streax articles</title><link>' + xmlEsc(base + '/articles') + '</link>'
    + '<atom:link href="' + xmlEsc(base + '/rss.xml') + '" rel="self" type="application/rss+xml"/><description>Research, guides and weekly reports on crypto casinos.</description><language>en</language>'
    + (rows.length ? '<lastBuildDate>' + new Date(rows[0].published_at).toUTCString() + '</lastBuildDate>' : '') + '\n' + items + '\n</channel></rss>\n';
}

function robots(base) {
  return 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /studio\nDisallow: /reply/\nDisallow: /onchain-admin.html\nDisallow: /Account.dc.html\n\nSitemap: ' + base + '/sitemap.xml\n';
}

module.exports = { indexPage, articlePage, sitemap, rss, robots, ARTICLE_CSS, PER_PAGE };
