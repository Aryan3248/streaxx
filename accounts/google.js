'use strict';
// "Continue with Google" (OpenID Connect, server-side code flow). Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
// The ID token comes straight from Google's token endpoint over HTTPS with our client secret, which Google's docs
// say is enough to trust it; the issuer, audience, expiry and nonce are still checked.

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

function authUrl(cfg, redirectUri, state, nonce) {
  const q = new URLSearchParams({
    client_id: cfg.googleClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, nonce, prompt: 'select_account'
  });
  return AUTH + '?' + q.toString();
}

function decodePayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('Google sent an unexpected token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

async function exchange(cfg, code, redirectUri, nonce) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let j;
  try {
    const res = await fetch(TOKEN, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
    });
    j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id_token) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || res.status));
  } finally { clearTimeout(timer); }
  const p = decodePayload(j.id_token);
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') throw new Error('Google token has the wrong issuer');
  if (p.aud !== cfg.googleClientId) throw new Error('Google token is for another app');
  if (!(p.exp * 1000 > Date.now())) throw new Error('Google token expired');
  if (nonce && p.nonce !== nonce) throw new Error('Google sign-in could not be matched to this browser');
  if (!p.sub || !p.email) throw new Error('Google did not share an email address');
  return { sub: String(p.sub), email: String(p.email).toLowerCase(), verified: p.email_verified === true || p.email_verified === 'true', name: p.name || p.given_name || '', picture: p.picture || '' };
}

module.exports = { authUrl, exchange, decodePayload };
