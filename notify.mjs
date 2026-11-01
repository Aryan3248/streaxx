// Outgoing email (Resend) and Telegram messages. Both are optional: without
// their keys the features report themselves as not ready.

export const mailReady = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
export const tgReady = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_NAME);

export async function sendMail(to, subject, text, html) {
  if (!mailReady()) throw new Error('Email is not set up on this server yet');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html: html || undefined })
  });
  if (!r.ok) throw new Error('Could not send the email (' + r.status + ')');
}

export async function tgSend(chatId, text) {
  if (!tgReady()) return;
  await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  }).catch(() => {});
}

export async function tgSetWebhook(url) {
  const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/setWebhook', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined, allowed_updates: ['message'] })
  });
  return r.json();
}
