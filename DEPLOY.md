# Streax on Netlify: site + API

The site now has its own backend in `netlify/functions`. It serves every `/api/*`
endpoint the pages call, Google sign-in under `/auth/*`, and invite links under `/r/*`.
Data is kept in Netlify Blobs, so no database is needed.

## Deploy

Netlify's drag-and-drop upload does not deploy functions. Use one of these:

**Git (recommended):** push this folder to a GitHub repo, then in Netlify choose
*Add new site > Import an existing project*. The settings come from `netlify.toml`.

**Netlify CLI:**

```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Deploy on Render instead

`server.mjs` runs the same site and API as one Node server, and `render.yaml` sets it up.

1. Push this folder to a GitHub repo.
2. In Render choose *New > Blueprint* and pick the repo. Render reads `render.yaml`.
3. Fill in the keys it asks for (see the table below). `ADMIN_TOKEN` and
   `TELEGRAM_WEBHOOK_SECRET` are generated for you; copy `ADMIN_TOKEN` from the
   service's Environment tab to unlock the admin page.

Data is saved as files on a 1 GB persistent disk at `/var/data`, which needs the
Starter plan or higher. On the Free plan, remove the `disk` block from `render.yaml`;
the site works but accounts, complaints and on-chain history reset on every deploy
or restart, and the service sleeps when idle, which pauses the monitor.
The monitor runs inside the server every 10 minutes (`MONITOR_MINUTES` changes it).
For Google sign-in, use `https://YOUR-SERVICE.onrender.com/auth/google/callback`.

## Environment variables

Set them under *Site configuration > Environment variables*, then redeploy.

| Variable | Needed for |
| --- | --- |
| `ADMIN_TOKEN` | **Required.** Any random string of 16+ characters. Unlocks `/onchain-admin.html` and runs the on-chain monitor. |
| `ETHERSCAN_API_KEY` | Deposits, withdrawals, whales, the wallet checker and transaction checks on complaints and payout reports. Free key from etherscan.io. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email confirmation, password reset and email whale alerts (resend.com). `MAIL_FROM` example: `Streax <alerts@yourdomain.com>`. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `TELEGRAM_WEBHOOK_SECRET` | Telegram whale alerts. Create the bot with @BotFather. `TELEGRAM_BOT_NAME` is the bot's username without the @. The secret is any random string. After deploying, press *Connect the Telegram webhook* in the admin page. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google". In Google Cloud, add `https://YOUR-SITE/auth/google/callback` as an authorized redirect URI. |
| `ETH_RPC_URL` | Optional. Ethereum RPC for balances. Default: `https://ethereum-rpc.publicnode.com`. |
| `TRONGRID_API_KEY`, `ETHPLORER_API_KEY` | Optional. Higher rate limits for Tron and token holder counts. |
| `ODDS_API_KEY` | Optional. Turns on Sports odds (comparison, sportsbook ranking, slip check). Free key at the-odds-api.com, 500 requests a month. Prediction markets work without it. |
| `ODDS_CACHE_MIN` | Optional. Minutes between odds refreshes per league (default 180, which keeps a free key inside its monthly limit). |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | Optional, recommended. Official Kick API for streamers (create an app at kick.com, Settings > Developer). Without them the site tries Kick's public website endpoint, which Kick may block. |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Optional. Adds Twitch streamers live in the Slots and casino categories (register an app at dev.twitch.tv/console). |
| `ETHERSCAN_MIN_GAP_MS` | Optional. Gap between Etherscan calls. Default 350 ms fits the free plan (3 calls per second); lower it on a paid plan. |
| `SITE_URL` | Optional. Your custom domain, used in emails and invite links. Defaults to Netlify's `URL`. |

Anything not set just shows as "not available yet" on the site instead of breaking.

## How it runs

- `netlify/functions/api.mjs`: all API routes.
- `netlify/functions/monitor-tick.mjs`: runs every 10 minutes and starts
  `monitor-background.mjs`. That one reads every tracked wallet, then updates flows,
  depositors, whales, balances (hourly) and token stats, and sends whale alerts.
  The first run reads the last 48 hours. Scheduled functions only run on the
  published production deploy.
- `netlify/lib/`: the code shared by the functions. `netlify/lib/data/` holds the casino
  list and the wallet registry taken from the pages.
- `support.js` now sets `$local = true`, so every page uses the live API.

## Live data on the pages

- **Rankings, Analytics, Home and casino profiles:** casinos with tracked wallets show live
  24h deposits, depositing wallets, withdrawals, hot wallet balances and chain split from the
  monitor (`/api/live/casinos`). They are marked "Live". The other casinos keep the 99bitcoins
  snapshot from 12 Oct 2026, marked "Snapshot 12 Oct". Live figures count only the labeled
  wallets, so they are lower than published totals. Add more wallets in the admin page to
  widen coverage.
- **Whale feed** (was Bet feed): every deposit or withdrawal of $10K or more at a tracked
  casino, refreshed every minute, plus the biggest moves over 7, 30 and 90 days.
- **Leaderboard and codes:** a monthly leaderboard of member points, and a code drop feed
  from the codes you add in the admin page (members reveal them; claims are counted).
- **Community:** real member reviews (one per member per casino, helpful votes) and the
  public complaints from the complaint process.

## Admin page

Open `/onchain-admin.html` and enter your `ADMIN_TOKEN`. From there you can:

- Check which keys are set and see the last monitor run, or start a run now.
- Moderate complaints: approve, reject, post casino replies, mark "says it is fixed", and close them.
- Approve payout reports that could not be matched on-chain.
- Trace a deposit address and add casino wallets (Ethereum or Tron).
- Edit member codes, casino reviews (these feed the Streax Score) and article links as JSON.
- Hide or restore member reviews posted on the Community page.
- Status tab, "Live data only": hides the 12 Oct 2026 snapshot so Rankings, Analytics and Home
  list only the casinos the monitor tracks. Turn it on once your main casinos are tracked
  and have a week of data. It can be switched back at any time.

Complaint deadlines settle on their own. A casino that does not reply in 7 days
closes the complaint as unresolved. A "fixed" reply the player does not dispute in
14 days closes it as resolved.


## Market breakdown and Sports odds

- **Market breakdown** (`Markets.dc.html`) ranks casinos and unboxing sites by on-chain deposits over 1D, 7D, 30D, 90D or 1Y, with Volume, Fairness and Ratings views. Casinos without tracked wallets are listed separately with their published snapshot, never as $0. 1Y fills in as the monitor builds history (daily totals are kept two years).
- **Unboxing sites and providers**: in the admin page, open **Sites and providers**. Add an unboxing site (for example Packdraw), then add its wallets in the **Wallets** tab. Providers are listed with the casinos that carry them; their reach is those casinos' tracked deposit volume.
- **Sports odds** (`Sports.dc.html`) needs `ODDS_API_KEY`. Books come from The Odds API's EU region, so the list is mainstream sportsbooks rather than crypto casinos.
