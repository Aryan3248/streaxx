// Member reviews of casinos: one review per member per casino, helpful votes,
// and hiding by admins.
import crypto from 'node:crypto';
import { store, update } from './store.mjs';
import { fail } from './http.mjs';
import { casinoBySlug, SITE } from './data.mjs';
import { currentUser, requireUser, publicName, limit } from './accounts.mjs';

const db = () => store('community');
const clean = (s, max) => String(s || '').replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, max);
const load = async () => (await db().get('reviews')) || { items: [] };

function view(r, u) {
  return { id: r.id, user: r.user, casino: r.casino, casinoName: (casinoBySlug(r.casino) || {}).name || r.casino, stars: r.stars, title: r.title, body: r.body, at: r.at, edited: r.edited || null,
    votes: r.voters.length, voted: !!(u && r.voters.includes(u.id)), mine: !!(u && r.uid === u.id) };
}

export const communityRoutes = {
  async 'GET /api/reviews'(req) {
    const u = await currentUser(req);
    const casino = new URL(req.url).searchParams.get('casino') || '';
    const all = (await load()).items.filter((r) => !r.hidden);
    const by = {};
    all.forEach((r) => { const x = (by[r.casino] = by[r.casino] || { slug: r.casino, name: (casinoBySlug(r.casino) || {}).name || r.casino, count: 0, sum: 0 }); x.count++; x.sum += r.stars; });
    const best = Object.values(by).map((x) => ({ slug: x.slug, name: x.name, count: x.count, avg: x.sum / x.count }));
    const list = all.filter((r) => !casino || r.casino === casino).sort((a, b) => b.at - a.at).slice(0, 100).map((r) => view(r, u));
    return { reviews: list, best, total: all.length, member: !!u };
  },
  async 'POST /api/reviews'(req, ctx, b) {
    const u = await requireUser(req);
    const cas = casinoBySlug(String(b.casino || ''));
    if (!cas) fail(400, 'Choose the casino.', { field: 'casino' });
    const stars = Math.round(Number(b.stars));
    if (!(stars >= 1 && stars <= 5)) fail(400, 'Pick 1 to 5 stars.', { field: 'stars' });
    const title = clean(b.title, 100), body = clean(b.body, 3000);
    if (title.length < 6) fail(400, 'Add a title of at least 6 characters.', { field: 'title' });
    if (body.length < 20) fail(400, 'Add at least 20 characters of detail.', { field: 'body' });
    await limit('review:' + u.id, 10, 3600);
    let out;
    await update(db(), 'reviews', (x) => {
      const old = x.items.find((r) => r.uid === u.id && r.casino === cas.slug);
      if (old) { Object.assign(old, { stars, title, body, edited: Date.now(), user: publicName(u) }); out = old; }
      else { out = { id: crypto.randomBytes(6).toString('hex'), uid: u.id, user: publicName(u), casino: cas.slug, stars, title, body, at: Date.now(), voters: [], hidden: false }; x.items.push(out); }
      return x;
    }, { items: [] });
    return { review: view(out, u), updated: !!out.edited };
  },
  async 'POST /api/reviews/:id/helpful'(req, ctx) {
    const u = await requireUser(req);
    let out;
    await update(db(), 'reviews', (x) => {
      const r = x.items.find((i) => i.id === ctx.params.id && !i.hidden);
      if (!r) fail(404, 'That review is gone');
      if (r.uid === u.id) fail(400, 'You cannot vote on your own review');
      r.voters = r.voters.includes(u.id) ? r.voters.filter((v) => v !== u.id) : r.voters.concat(u.id);
      out = r;
      return x;
    }, { items: [] });
    return { review: view(out, u) };
  }
};

export const communityAdminRoutes = {
  async 'GET /api/admin/member-reviews'() {
    return { reviews: (await load()).items.sort((a, b) => b.at - a.at).map(({ uid, voters, ...r }) => ({ ...r, votes: voters.length })) };
  },
  async 'POST /api/admin/member-reviews/:id'(req, ctx, b) {
    await update(db(), 'reviews', (x) => { const r = x.items.find((i) => i.id === ctx.params.id); if (!r) fail(404, 'Not found'); r.hidden = !!b.hidden; return x; }, { items: [] });
    return { ok: true };
  }
};

export { SITE };
