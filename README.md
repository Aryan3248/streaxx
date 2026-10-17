# Streax

A crypto casino data platform with an on-chain casino monitor and free member accounts. Pages: Home, Rankings, Casino profile, On-chain monitor, Casino wallets, Analytics, Streamers, Live bet feed, Reviews and complaints, Leaderboard and codes, plus Log in, Sign up and My account. Light and night mode, phone, tablet and desktop layouts.

## Run it on your computer

1. Install Node.js 22 or newer from https://nodejs.org (the LTS button). The on-chain monitor needs version 22.5 or newer; the other pages also run on 18.
2. Unzip this folder anywhere, for example on your Desktop.
3. Start the server:
   - **Mac:** double-click `start-mac.command`. If macOS blocks it, right-click it, choose Open, then Open again.
   - **Windows:** double-click `start-windows.bat`.
   - **Or in a terminal** inside this folder: `npm start`
4. Your browser opens **http://localhost:3000**. Keep the start window open while you use the site.

No `npm install` is needed. The server has no dependencies.

## Put it online with Render (about $7.25 a month)

The on-chain monitor reads the blockchain around the clock, so it needs an always-on server with a small disk for its database. The free Render plan sleeps and has no disk, so `render.yaml` asks for the smallest paid instance ($7 a month) and a 1 GB disk ($0.25 a month).

1. Push this folder to a GitHub repository.
2. On https://render.com click **New**, then **Blueprint**, and pick the repository.
3. Render asks for the keys below. Paste the ones you have; you can add the rest later under **Environment**.
4. Click **Deploy Blueprint**. When it shows Live, open the `onrender.com` address.
5. To use your own domain, open the service, go to **Settings**, then **Custom Domains**.

`ADMIN_TOKEN` is created for you. Find it under the service's **Environment** tab; you need it for the wallet tool.

## Keys for the on-chain monitor (all free)

| Setting | What it unlocks | Where to get it |
|---|---|---|
| `ETHERSCAN_API_KEY` | Deposits and withdrawals on Ethereum and Polygon. Required for flows. | etherscan.io, sign up, then API Dashboard, then Add. Free plan: 3 calls a second, 100,000 a day. |
| `TRONGRID_API_KEY` | Faster, reliable Tron reading. Works slowly without it. | trongrid.io, sign up, then create an API key. |
| `SOLANA_RPC_URL` | Reliable Solana reading. | helius.dev, sign up for the free plan, copy the mainnet RPC URL (it contains your key). |
| `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` | Whale alerts posted to a Telegram channel. | In Telegram, message @BotFather, send /newbot and copy the token. Create a channel, add the bot as an admin, and use the channel name with @ (for example `@streaxwhales`) as the chat ID. |
| `WHALE_USD` | Size of a whale alert, in dollars. Default 50000. | Your choice. |

BNB Chain transfers need a paid Etherscan plan (set `ETHERSCAN_PAID=1`). BNB Chain and Polygon balances are read for free.

## Member accounts and perks

People sign up with Google or with email and a password. Accounts are free and need the 18+ box ticked.

| Perk | What members get |
|---|---|
| Watchlist and own whale alerts | Follow casinos (Watch button on Casino profile, or the account page). Big moves arrive by Telegram (instant) and email (one digest per check). |
| Full history and CSV | Guests see 24 hours on the On-chain monitor and 7 days on Casino wallets. Members unlock 7, 30 and 90 days and CSV downloads. |
| Member bonus codes | Codes you add in the admin tools. Members press Reveal to see them. You can limit a code to Silver or Gold members. |
| Points and levels | 100 for joining, 50 for confirming email, 50 for connecting Telegram, 50 for watching 3 casinos, 250 per friend who joins (the friend gets 100). Silver at 500 points, Gold at 1,500. |

| Level | Watchlist | Alerts from | Codes |
|---|---|---|---|
| Member (free) | 10 casinos | $50K | Member codes |
| Silver (500 points) | 25 casinos | $25K | Member and Silver codes |
| Gold (1,500 points) | 100 casinos | $10K | All codes |

Referral points are paid when the friend confirms their email, up to 20 friends a day per member, so fake sign-ups do not pay. Short links: `/login`, `/signup`, `/account` and invite links `/r/CODE`.

### Keys for accounts

| Setting | What it unlocks | Where to get it |
|---|---|---|
| `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` | "Continue with Google" | console.cloud.google.com: create a project, go to APIs and Services, then OAuth consent screen (External, add your site), then Credentials, Create credentials, OAuth client ID, Web application. Add the authorized redirect URI `https://YOUR-SITE/auth/google/callback` (for example `https://streax.onrender.com/auth/google/callback`) and, for testing on your computer, `http://localhost:3000/auth/google/callback`. |
| `RESEND_API_KEY` and `MAIL_FROM` | Confirmation emails, password reset, email whale alerts | resend.com: sign up, add and verify your domain, create an API key. Set `MAIL_FROM` to an address on that domain, for example `Streax <alerts@yourdomain.com>`. |
| `TELEGRAM_BOT_TOKEN` | Personal Telegram alerts (the same bot as the channel alerts) | Already in the table above. Members press Connect on their account page and then Start in Telegram. |
| `PUBLIC_URL` | Only if you use your own domain | Your site address, for example `https://streax.io`. On Render the `onrender.com` address is used automatically. |

Without `RESEND_API_KEY`, email accounts are treated as confirmed straight away and password reset is off; set it up before you promote the referral rewards.

### Admin tools

Open `/onchain-admin.html` and paste your `ADMIN_TOKEN` (in Render, under the service's Environment tab). There you can:
- see member numbers and download every member as a CSV (with who opted in to news emails),
- add, hide and delete member bonus codes and see how many members revealed each one,
- trace and add casino wallets.

Only list bonus codes you are allowed to promote in the countries your members live in. The account page marks offers as 18+ and says links may earn a commission.

## Studio: articles, complaints and casino reviews

Open `/studio` and paste your `ADMIN_TOKEN`. The Studio is only for you; readers never see it.

**Articles.** Write in Markdown with a toolbar, drop or paste images to upload them, pick a category, tag casinos and press Publish. Each article gets its own page at `/articles/your-title` with a search title, meta description, canonical link, social preview image and structured data for Google. The SEO tab shows how the result looks in Google and an 11-point checklist. A future publish date schedules the article. Drafts are hidden from readers; "Preview" opens a private link. Published articles are added to `/sitemap.xml` and `/rss.xml` automatically, and articles tagged with a casino appear on that casino's page. Submit `https://YOUR-SITE/sitemap.xml` once in Google Search Console.

**Complaints.** Members file complaints on the Complaints page, with an optional transaction hash that Streax matches on-chain. New complaints wait for your check in the Studio, so nothing goes public until you approve it. Approving gives you a private reply link to send to the casino's support or affiliate contact; the casino answers there without an account. Casinos get 7 days for a first reply, or the complaint closes as unresolved. When the casino says it is fixed, the player has 14 days to confirm or dispute. You can ask the player for details, post messages (public or private) and close a complaint as resolved, unresolved or rejected with a short published reason.

**Payout reports.** Members report how long a withdrawal took. Reports whose transaction hash matches a tracked casino wallet count straight away; others wait for your check. Three verified reports put payout speed into the Streax Score.

**Casino reviews.** For each casino, tick the checks you made yourself on its site (provably fair tools, licence, KYC timing, responsible gambling tools, support speed, account security) and save. These fill the five Review categories of the Streax Score.

## The Streax Score

Nine categories, each 0 to 10: on-chain activity and reserves (from the blockchain), payout speed and complaint record (from verified player reports), and fairness, licence, responsible gambling, support and security (from your reviews). Categories without enough evidence are left out and the score is scaled over the rest. Under half the weight rated, the score is labelled "Early score"; under 80% it is marked provisional. The full method is on every casino page and in the "How the Streax Score works" article. Commissions never change a score.

## Player tools

- **My wallet check** (`/WalletCheck.dc.html`): a player pastes a wallet and sees deposits, withdrawals and the net result with each tracked casino. Ethereum, BNB Chain and Polygon need `ETHERSCAN_API_KEY`; Tron works without a key. Addresses are never stored.
- **Bonus calculator** (`/BonusCalc.dc.html`): works out what a deposit match, free spins or rakeback is worth after wagering and house edge. Runs in the browser, so it also works on the static site.
- **Reserve warnings**: members who watch a casino get a Telegram or email warning when its tracked hot wallets fall 40% or more below their 7-day high, at most once a day per casino.

## How the on-chain monitor works

- **Wallets.** `onchain/registry.json` lists 59 Ethereum wallets of 16 casinos, taken from Etherscan public name tags (for example "Stake.com", "Roobet: Hot Wallet", "BC.GAME: Hot Wallet 3"). Every address passed its checksum.
- **Reading.** Every 10 minutes the server reads new transfers for each wallet: Etherscan for Ethereum and Polygon, TronGrid for Tron, a Solana RPC node for Solana, mempool.space for Bitcoin. On the first start it reads the last 48 hours.
- **Deposits and withdrawals.** Money arriving in a casino wallet counts as a deposit, money leaving as a withdrawal. Moves between two of the same casino's wallets are left out.
- **Only real assets count.** USDT, USDC, DAI, ETH, WETH, WBTC, BNB, POL, TRX, SOL, BTC and the casino tokens RLB and SHFL, matched by contract address. Fake tokens with copied names are ignored.
- **Dollar values.** Stablecoins count as one dollar; everything else uses the DefiLlama price at the time of reading.
- **Balances** refresh every hour over public RPC nodes. **Token analytics** (supply and burns, holders, DEX liquidity and trades) refresh every 30 minutes.
- **Storage.** A SQLite database in `DATA_DIR` keeps hourly totals for 120 days and individual transfers of $1,000 or more for 35 days.
- These totals are a floor: casinos also use wallets nobody has labeled yet.

## Add more casino wallets (Tron, Solana, Bitcoin and more)

Open `/onchain-admin.html` on your site (also linked from the On-chain monitor page) and paste your `ADMIN_TOKEN`.

1. In a casino, open deposit, choose a coin and network (for example USDT on Tron) and copy the deposit address.
2. Send a small deposit and wait until the casino credits it. The casino then sweeps the funds into its own wallet.
3. In the wallet tool, paste the deposit address and click **Trace**. The top destination is the casino's collection or hot wallet.
4. Click **Use this**, check the casino, and click **Add wallet**. It is tracked from the next run.

## API

| Address | What it returns |
|---|---|
| `/api/onchain/overview?window=24h` (or 7d, 30d) | Totals, per-casino deposits, withdrawals, net flow, balances, hourly flows, server status |
| `/api/onchain/casino/stakecom?days=30` | One casino: wallets with balances, daily flows, asset split, balance history, large transfers |
| `/api/onchain/whales?min=50000` | Latest large transfers with explorer links |
| `/api/onchain/tokens` | Casino token analytics |
| `/api/onchain/coverage` | Every tracked wallet and its source |
| `/api/onchain/status` | Which keys are set, last run, health of each data source |
| `/api/real` | Market strip, casino tokens, Kick streamers |
| `/api/onchain/export/flows.csv?window=30d`, `/api/onchain/export/whales.csv`, `/api/onchain/export/casino/stakecom.csv` | CSV downloads (members) |
| `/api/auth/me`, `/api/account` | Who is logged in, and the member's account data |
| `/api/codes` | Live member offers without the codes |
| `/api/articles` | Published articles (title, summary, cover, link) |
| `/api/complaints`, `/api/complaints?casino=stakecom` | Public complaints and counts |
| `/api/trust/casino/stakecom` | One casino's review, complaints, payout speed, reserves and tagged articles |
| `/api/trust/summary` | Reviews, complaint counts and payout speed for every casino |
| `/api/wallet-check?address=0x...` | Wallet check (not stored) |
| `/sitemap.xml`, `/rss.xml`, `/robots.txt` | For search engines and feed readers |

## Light and night mode

Click the moon button at the top of any page for night mode, and the sun button to go back. The site remembers your choice in this browser.

## What is live, what is a snapshot, what is sample

| Data | Status |
|---|---|
| On-chain monitor and Casino wallets | Live from the blockchain on the server. Without a server the pages list the tracked wallets and say that live numbers need the server. |
| Market strip, casino tokens, Kick streamers, Stake and Rollbit ETH balances | Live from DefiLlama, CoinGecko, the Kick API and public Ethereum nodes. |
| 43 casinos on Rankings and Casino profile: deposits, players, payouts, hot wallets | Snapshot as published by 99bitcoins (rechecked 12 Oct 2026). |
| Live bet feed, Reviews and complaints, Leaderboard and codes | Sample data with fictional casino names, marked Sample data. |
| Accounts, member perks and member codes | Work on the server. The static site and the design canvas show the pages with preview data. |
| Articles, complaints, payout reports, Streax Score reviews, wallet check | Work on the server and start empty, apart from three starter articles. The bonus calculator works everywhere. |

## Tests

`npm test` runs 30 tests offline: sign-up and login, sessions, Google sign-in, referrals, perks, codes, personal alerts, reserve warnings, account deletion, members-only history and CSV, articles and their SEO pages, the complaint flow, the Streax Score, Markdown safety, and the on-chain parsing for every chain.

## If something is not working

| What you see | Fix |
|---|---|
| "This site can't be reached" | The server is not running. Start it again and keep the window open. |
| On-chain pages say the server needs Node.js 22.5 | Install the current Node.js LTS from https://nodejs.org. |
| "Add an Etherscan API key" | Set `ETHERSCAN_API_KEY`. Balances work without it, flows do not. |
| Status shows a source as FAIL | Open `/api/onchain/status` to see the error. Rate limits recover by themselves on the next run. |
| Google button says it is not switched on | Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. |
| Google says redirect_uri_mismatch | Add `https://YOUR-SITE/auth/google/callback` exactly to the OAuth client's authorized redirect URIs. |
| Members do not get emails | Set `RESEND_API_KEY` and a `MAIL_FROM` on a domain verified in Resend. |
| No Telegram alerts | Check that the bot is an admin of the channel and the chat ID starts with @. Only transfers above `WHALE_USD` that happen after the server started are sent. |

18+ only. Not financial advice.
