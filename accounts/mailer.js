'use strict';
// Email through Resend (resend.com). Needs RESEND_API_KEY, and MAIL_FROM on a domain you verified in Resend.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml, footer) {
  return '<!doctype html><html><body style="margin:0;background:#F6F8FD;font-family:Helvetica,Arial,sans-serif;color:#0B1533">' +
    '<div style="max-width:560px;margin:0 auto;padding:28px 18px">' +
    '<div style="font-family:Georgia,serif;font-size:26px;color:#1B2FA8;margin-bottom:18px">Streax</div>' +
    '<div style="background:#FFFFFF;border:1px solid #E3E9F5;border-radius:16px;padding:24px">' +
    '<h1 style="margin:0 0 12px;font-size:20px">' + esc(title) + '</h1>' + bodyHtml + '</div>' +
    '<p style="font-size:12px;color:#606C8A;line-height:1.5;margin:16px 4px 0">' + (footer || 'You get this email because you have a Streax account.') +
    ' 18+ only. Gambling can be addictive; help is available at BeGambleAware.org.</p></div></body></html>';
}
function button(href, label) {
  return '<p style="margin:20px 0 6px"><a href="' + esc(href) + '" style="display:inline-block;background:#2F54EB;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">' + esc(label) + '</a></p>' +
    '<p style="font-size:12px;color:#606C8A;word-break:break-all">Or open: ' + esc(href) + '</p>';
}

async function send(cfg, to, subject, html, text) {
  if (!cfg.resendKey) throw new Error('Email is not set up (RESEND_API_KEY)');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctl.signal,
      headers: { authorization: 'Bearer ' + cfg.resendKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, html, text })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Resend: ' + (j.message || j.error || ('HTTP ' + res.status)));
    return j.id;
  } finally { clearTimeout(timer); }
}

const templates = {
  verify(base, name, link) {
    return { subject: 'Confirm your Streax email', html: layout('Confirm your email',
      '<p style="line-height:1.6">Hi ' + esc(name || 'there') + ', confirm your email to get 50 bonus points, email whale alerts and referral rewards.</p>' + button(link, 'Confirm email')),
      text: 'Confirm your Streax email: ' + link };
  },
  reset(base, name, link) {
    return { subject: 'Reset your Streax password', html: layout('Reset your password',
      '<p style="line-height:1.6">Hi ' + esc(name || 'there') + ', use this link within 30 minutes to choose a new password. If you did not ask for this, ignore this email.</p>' + button(link, 'Choose a new password')),
      text: 'Reset your Streax password (valid 30 minutes): ' + link };
  },
  alerts(base, name, items) {
    const rows = items.slice(0, 20).map(t => '<tr><td style="padding:8px 0;border-bottom:1px solid #EEF2FA;font-size:14px"><b>' + esc(t.casinoName) + '</b> ' + (t.dir === 'in' ? 'deposit' : 'withdrawal') +
      '<br><span style="color:#606C8A;font-size:12px">' + esc(t.amountLabel) + ' on ' + esc(t.chainName) + '</span></td>' +
      '<td style="padding:8px 0;border-bottom:1px solid #EEF2FA;text-align:right;font-size:14px;color:' + (t.dir === 'in' ? '#0E7C66' : '#C2410C') + '"><a href="' + esc(t.url) + '" style="color:inherit">' + esc(t.usdLabel) + '</a></td></tr>').join('');
    const more = items.length > 20 ? '<p style="font-size:13px;color:#606C8A">And ' + (items.length - 20) + ' more on the On-chain monitor.</p>' : '';
    return { subject: items.length === 1 ? 'Whale alert: ' + items[0].casinoName + ' ' + items[0].usdLabel : items.length + ' whale moves on your watchlist',
      html: layout('Whale moves on your watchlist', '<table style="width:100%;border-collapse:collapse">' + rows + '</table>' + more + button(base + '/Onchain.dc.html', 'Open the On-chain monitor'),
        'You get this email because you turned on email alerts. Change them on <a href="' + esc(base + '/Account.dc.html') + '">your account page</a>.'),
      text: items.map(t => t.casinoName + ' ' + (t.dir === 'in' ? 'deposit ' : 'withdrawal ') + t.usdLabel + ' ' + t.url).join('\n') };
  }
};

module.exports = { send, templates, esc, layout, button };
