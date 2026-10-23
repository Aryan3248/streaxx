// "Continue with Google" (OAuth 2.0 authorization code flow).
import { cookies, setCookie, siteUrl, getJson } from './http.mjs';
import { store } from './store.mjs';
import { createUser, startSession, getUser, updateUser, userByEmail, rand } from './accounts.mjs';

const STATE_COOKIE = 'sx_gstate';
const ready = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const safeNext = (n) => (/^\/[A-Za-z0-9._~\/-]*(\?[A-Za-z0-9._~=&%-]*)?$/.test(n || '') && !String(n).startsWith('//') ? n : '');
const callback = (req) => siteUrl(req) + '/auth/google/callback';

export async function googleStart(req) {
  const q = new URL(req.url).searchParams;
  const mode = q.get('mode') === 'signup' ? 'signup' : 'login';
  const back = mode === 'signup' ? '/Signup.dc.html' : '/Login.dc.html';
  if (!ready()) return { redirect: back + '?err=google_off' };
  const st = { nonce: rand(16), mode, adult: q.get('adult') === '1', ref: (q.get('ref') || '').slice(0, 12), marketing: q.get('marketing') === '1', next: safeNext(q.get('next')) };
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: callback(req), response_type: 'code', scope: 'openid email profile', state: st.nonce, prompt: 'select_account'
  });
  const val = Buffer.from(JSON.stringify(st)).toString('base64url');
  return { redirect: url, cookie: setCookie(STATE_COOKIE, val, { maxAge: 600, path: '/auth/google' }) };
}

export async function googleCallback(req) {
  const q = new URL(req.url).searchParams;
  const clear = setCookie(STATE_COOKIE, '', { maxAge: 0, path: '/auth/google' });
  let st = null;
  try { st = JSON.parse(Buffer.from(cookies(req)[STATE_COOKIE] || '', 'base64url').toString()); } catch {}
  const back = (code) => ({ redirect: (st && st.mode === 'signup' ? '/Signup.dc.html' : '/Login.dc.html') + '?err=' + code + (st && st.next ? '&next=' + encodeURIComponent(st.next) : ''), cookie: clear });
  if (q.get('error')) return back('google_cancel');
  if (!st || !st.nonce || q.get('state') !== st.nonce) return back('google_state');
  let info;
  try {
    const tok = await getJson('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.get('code') || '', client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: callback(req), grant_type: 'authorization_code' })
    });
    // The ID token comes straight from Google over TLS, so its payload can be read without re-checking the signature.
    info = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString());
    if (info.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('aud');
  } catch { return back('google_failed'); }
  if (!info.email_verified) return back('google_unverified');
  const email = String(info.email).toLowerCase();
  let u = null, isNew = false;
  const link = await store('users').get('google/' + info.sub);
  if (link) u = await getUser(link.id);
  if (!u) {
    u = await userByEmail(email);
    if (u) {
      u = await updateUser(u.id, (x) => { x.google = info.sub; if (!x.avatar && info.picture) x.avatar = info.picture; x.verified = true; });
      await store('users').set('google/' + info.sub, { id: u.id });
    }
  }
  if (!u) {
    if (st.mode !== 'signup' || !st.adult) return { redirect: '/Signup.dc.html?err=google_confirm' + (st.next ? '&next=' + encodeURIComponent(st.next) : ''), cookie: clear };
    u = await createUser({ name: info.name, email, password: null, marketing: st.marketing, ref: st.ref, google: info.sub, avatar: info.picture, verified: true });
    isNew = true;
  }
  const sess = await startSession(u);
  return { redirect: st.next || (isNew ? '/Account.dc.html?welcome=1' : '/Account.dc.html'), cookies: [clear, sess] };
}
