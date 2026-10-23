// Scheduled every 10 minutes: one on-chain monitor run.
// Free Netlify plan: runs here in short slices (scheduled functions stop at 30 s).
// Paid plan: set STREAX_BACKGROUND=1 to hand the run to the 15-minute background function.
import { run } from '../lib/onchain.mjs';
import { store } from '../lib/store.mjs';

export default async function handler() {
  if (!process.env.ADMIN_TOKEN) { console.log('monitor-tick: set ADMIN_TOKEN to run the on-chain monitor'); return; }
  if (process.env.STREAX_BACKGROUND === '1') {
    const base = (process.env.URL || '').replace(/\/$/, '');
    const r = await fetch(base + '/.netlify/functions/monitor-background', { method: 'POST', headers: { 'x-streax-key': process.env.ADMIN_TOKEN } });
    console.log('monitor-tick: background start', r.status);
    return;
  }
  await slice(16000);
}

export async function slice(budgetMs) {
  const lock = store('onchain');
  const cur = await lock.get('lock');
  if (cur && cur.until > Date.now()) return { started: false, busy: true };
  await lock.set('lock', { until: Date.now() + 60000 });
  try { return { started: true, ...(await run((m) => console.log(m), { budgetMs })) }; }
  catch (e) { console.error('monitor failed', e); return { started: false, error: e.message }; }
  finally { await lock.del('lock'); }
}

export const config = { schedule: '*/10 * * * *' };
