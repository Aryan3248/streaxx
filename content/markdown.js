'use strict';
// A small, safe Markdown renderer shared by the server (article pages) and the Studio editor preview.
// Raw HTML is never passed through: every character of the source is escaped first, then a fixed set of
// Markdown forms is turned into tags. Links and images only accept http(s), site-relative and /uploads/ URLs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StreaxMarkdown = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^\/(?!\/)[^\s"'<>]*$/.test(s)) return s;
    if (/^#[A-Za-z0-9_-]+$/.test(s)) return s;
    if (/^[A-Za-z0-9._-]+\.dc\.html(\?[^\s"'<>]*)?$/.test(s)) return s;
    return '';
  }
  function slugify(s) {
    return String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 70) || 'section';
  }

  // Inline forms on already-escaped text.
  function inline(src, opts) {
    var codes = [], tags = [];
    var keep = function (t) { tags.push(t); return '\u0001' + (tags.length - 1) + '\u0001'; };
    var s = src.replace(/`([^`\n]+)`/g, function (m, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, alt, url, title) {
      var u = safeUrl(url.replace(/&amp;/g, '&'));
      if (!u) return alt;
      return keep('<img src="' + esc(u) + '" alt="' + alt + '" loading="lazy" decoding="async"' + (title ? ' title="' + title + '"' : '') + '>');
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
      var u = safeUrl(url.replace(/&amp;/g, '&'));
      if (!u) return text;
      var ext = /^https?:/i.test(u) && !(opts.host && u.toLowerCase().indexOf('://' + opts.host.toLowerCase()) !== -1);
      return keep('<a href="' + esc(u) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : '') + '>') + text + keep('</a>');
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return tags[Number(i)]; });
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return '<code>' + codes[Number(i)] + '</code>'; });
    return s;
  }

  function tableRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split('|').map(function (c) { return c.trim(); });
  }

  // Returns { html, toc: [{id, text, level}], words, minutes, firstImage, plain }
  function render(md, opts) {
    opts = opts || {};
    var lines = String(md || '').replace(/[\u0000\u0001]/g, '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], toc = [], used = {}, words = 0, plain = [];
    var i = 0;
    function heading(level, text) {
      var h = inline(esc(text), opts), id = slugify(h), n = 2;
      while (used[id]) id = slugify(h) + '-' + (n++);
      used[id] = 1;
      if (level <= 3) toc.push({ id: id, text: h.replace(/<[^>]+>/g, ''), level: level });
      words += String(text).split(/\s+/).length;
      out.push('<h' + level + ' id="' + id + '">' + h + '</h' + level + '>');
    }
    function para(buf) {
      var t = buf.join(' ').trim();
      if (!t) return;
      words += t.split(/\s+/).length;
      plain.push(t);
      out.push('<p>' + inline(esc(t), opts) + '</p>');
    }
    var buf = [];
    function flush() { para(buf); buf = []; }
    while (i < lines.length) {
      var line = lines[i];
      var fence = /^```\s*([A-Za-z0-9_-]*)\s*$/.exec(line);
      if (fence) {
        flush();
        var code = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code' + (fence[1] ? ' data-lang="' + esc(fence[1]) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      var h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) { flush(); heading(Math.max(2, h[1].length), h[2]); i++; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        var callout = /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i.exec(q[0] || '');
        var inner = render(q.slice(callout ? 1 : 0).join('\n'), opts).html;
        if (callout) out.push('<aside class="callout callout-' + callout[1].toLowerCase() + '"><strong class="callout-t">' + ({ note: 'Note', tip: 'Tip', warning: 'Warning', important: 'Important' })[callout[1].toLowerCase()] + '</strong>' + inner + '</aside>');
        else out.push('<blockquote>' + inner + '</blockquote>');
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        var ordered = /^\s*\d+[.)]\s+/.test(line);
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          var item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
          var task = /^\[( |x|X)\]\s+/.exec(item);
          words += item.split(/\s+/).length;
          plain.push(item);
          items.push('<li' + (task ? ' class="task"' : '') + '>' + (task ? '<span class="tick' + (task[1] === ' ' ? '' : ' on') + '" aria-hidden="true"></span>' : '') + inline(esc(task ? item.slice(task[0].length) : item), opts) + '</li>');
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        var head = tableRow(line), aligns = tableRow(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''; });
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(tableRow(lines[i])); i++; }
        var th = head.map(function (c, k) { return '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(esc(c), opts) + '</th>'; }).join('');
        rows.concat([head]).forEach(function (r) { r.forEach(function (c) { if (c) words += c.split(/\s+/).length; }); });
        var tb = rows.map(function (r) { return '<tr>' + head.map(function (x, k) { return '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(esc(r[k] || ''), opts) + '</td>'; }).join('') + '</tr>'; }).join('');
        out.push('<div class="table"><table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>');
        continue;
      }
      var img = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line);
      if (img) {
        flush();
        var u = safeUrl(img[2]);
        if (u) out.push('<figure><img src="' + esc(u) + '" alt="' + esc(img[1]) + '" loading="lazy" decoding="async">' + (img[3] ? '<figcaption>' + inline(esc(img[3]), opts) + '</figcaption>' : '') + '</figure>');
        i++;
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      buf.push(line);
      i++;
    }
    flush();
    var firstImage = null;
    var m = /<img src="([^"]+)" alt="([^"]*)"/.exec(out.join(''));
    if (m) firstImage = { src: m[1], alt: m[2] };
    return { html: out.join('\n'), toc: toc, words: words, minutes: Math.max(1, Math.round(words / 230)), firstImage: firstImage, plain: plain.join(' ').replace(/[*_`#>[\]()!|~]/g, '').replace(/\s+/g, ' ').trim() };
  }

  return { render: render, esc: esc, slugify: slugify, safeUrl: safeUrl };
}));
