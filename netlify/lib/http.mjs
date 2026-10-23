// Small helpers for Netlify Functions (web Request/Response API).

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
}
export function csv(filename, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="' + filename + '"', 'cache-control': 'no-store' } });
}

export async function body(req) {
  const t = await req.text();
  if (!t) return {};
  try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : {}; } catch { fail(400, 'Could not read the request'); }
}

export function cookies(req) {
  const out = {};
  (req.headers.get('cookie') || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function setCookie(name, value, { maxAge, httpOnly = true, path = '/' } = {}) {
  let c = name + '=' + encodeURIComponent(value) + '; Path=' + path + '; SameSite=Lax; Secure';
  if (httpOnly) c += '; HttpOnly';
  if (maxAge != null) c += '; Max-Age=' + maxAge;
  return c;
}

export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export function siteUrl(req) {
  return (process.env.SITE_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
}

// fetch with a timeout, returning parsed JSON or throwing.
export async function getJson(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'streax-server/1.0', ...(opts.headers || {}) } });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && (j.error_description || j.error || j.message)) || ('HTTP ' + r.status + ' from ' + new URL(url).host));
    if (j == null) throw new Error('Bad response from ' + new URL(url).host);
    return j;
  } finally { clearTimeout(t); }
}
