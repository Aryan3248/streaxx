// Background function (up to 15 minutes): one full on-chain monitor run.
// Started by monitor-tick every few minutes, or by POST /api/admin/run-monitor.
import { run } from '../lib/onchain.mjs';
import { store } from '../lib/store.mjs';

export default async function handler(req) {
  if (!process.env.ADMIN_TOKEN || req.headers.get('x-streax-key') !== process.env.ADMIN_TOKEN) return new Response('Forbidden', { status: 403 });
  // one run at a time: a lock that expires after 14 minutes
  const lock = store('onchain');
  const cur = await lock.get('lock');
  if (cur && cur.until > Date.now()) return new Response('Already running', { status: 200 });
  await lock.set('lock', { until: Date.now() + 14 * 60000 });
  try { await run((m) => console.log(m)); }
  catch (e) { console.error('monitor failed', e); }
  finally { await lock.del('lock'); }
  return new Response('ok');
}
