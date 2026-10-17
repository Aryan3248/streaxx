'use strict';
// Three starter articles, added once to an empty articles database so /articles is never blank on a new site.
// They explain how Streax works; edit or unpublish them in the Studio like any other article.

const DAY = 86400000;

const ARTICLES = [
  {
    slug: 'how-the-streax-score-works',
    title: 'How the Streax Score works',
    dek: 'Nine categories, three kinds of evidence and one rule: we never guess. Here is exactly how every casino on Streax is scored.',
    category: 'guides', featured: 1, author: 'Streax Research', author_role: 'Methodology',
    cover: '/assets/articles/streax-score.webp', cover_alt: 'A glass sphere on a blue gradient, the Streax score illustration',
    tags: 'Streax Score,methodology,trust', keyword: 'Streax Score',
    seo_title: 'How the Streax Score rates crypto casinos',
    seo_desc: 'The Streax Score rates crypto casinos on nine weighted categories, from on-chain reserves and payout speed to complaints, fairness and licence checks.',
    body: `Most casino ratings are a number with no workings. The Streax Score shows its workings. Every casino gets up to nine category scores from 0 to 10, each with a weight, a source and a short note on what we found.

> [!IMPORTANT]
> Commissions never change a score. Some links on Streax may earn us a commission, but the score is calculated the same way for every casino, partner or not.

## Three kinds of evidence

Each category comes from one of three places, and the casino page labels which one:

- **On-chain**: read straight from the blockchain by the Streax monitor. Nobody can edit these numbers, including us.
- **Players**: complaints and payout reports from Streax members, checked before they count.
- **Review**: checks our team runs on the casino site itself, such as whether self-exclusion actually works.

## The nine categories

| Category | Weight | Source | What we measure |
|---|---:|---|---|
| On-chain activity | 15% | On-chain | Deposit volume and how many wallets deposit |
| Reserves | 15% | On-chain | Hot wallet money compared with a day of deposits |
| Payout speed | 15% | Players | Median time from withdrawal request to coins arriving |
| Complaint record | 15% | Players | Share of closed complaints the casino resolved |
| Fairness and RTP | 10% | Review | Provably fair games, a verifier, client seeds, published RTP |
| Licence and compliance | 10% | Review | A licence we could check, KYC timing, geo-blocking, AML policy |
| Responsible gambling | 8% | Review | Self-exclusion, limits, cool-off periods, help links |
| Support | 7% | Review | 24/7 live chat and how fast a person answers |
| Account security | 5% | Review | Two-factor login and withdrawal confirmation |

## We never guess

If we do not have enough evidence for a category, it is left out. It is not set to zero and it is not set to average. The score is then scaled over the categories we could rate.

A category needs a minimum before it counts:

- **Payout speed** needs at least 3 verified payout reports from the last 90 days.
- **Complaint record** needs at least 3 closed complaints, resolved or unresolved. Rejected complaints never count against a casino.
- **Review categories** need most of their checks answered with a clear yes or no.

When the rated categories add up to less than 80% of the total weight, the score is marked **Provisional**. Below 25% we show no score at all.

## How reserves are scored

Casinos keep working money in hot wallets to pay withdrawals. We compare that balance with one day of deposits. A casino holding five days of deposits or more scores 10 out of 10; one holding a single day scores 5. A sharp fall in reserves over the last week lowers the score, because that is when withdrawals tend to slow down.

Hot wallets are not proof of solvency. A casino can hold more money in cold storage that we cannot see. Reserves tell you whether a casino can pay out today, not what it owns.

## How payout speed is measured

Members [report a withdrawal](/Complaints.dc.html) with the time they asked for it and the transaction hash of the payout. When the transaction matches a casino wallet in the Streax monitor, the report is verified automatically and the arrival time comes from the blockchain, not from the player. Other reports are checked by hand before they count. We use the median, so one unlucky week does not sink a casino and one lucky payout does not lift it.

## Grades

| Score | Grade |
|---|---|
| 85 to 100 | Excellent |
| 70 to 84 | Good |
| 55 to 69 | Fair |
| 40 to 54 | Weak |
| Below 40 | Poor |

## Something wrong?

If a figure on a casino page is wrong, tell us through Support on any Streax page. Casinos can send evidence too. We correct mistakes and note the change.
`
  },
  {
    slug: 'how-to-file-a-casino-complaint',
    title: 'How to file a casino complaint that gets resolved',
    dek: 'A stuck withdrawal or a frozen account is stressful. These steps give your complaint the best chance of a fast, fair answer.',
    category: 'guides', featured: 0, author: 'Streax Research', author_role: 'Player help',
    cover: '/assets/articles/complaints-guide.webp', cover_alt: 'A flowing silver ribbon on a dark blue background',
    tags: 'complaints,withdrawals,KYC', keyword: 'casino complaint',
    seo_title: 'How to file a crypto casino complaint that gets resolved',
    seo_desc: 'Step by step: what to try first, which evidence to collect and how a Streax casino complaint is handled, from the first check to a published outcome.',
    body: `A Streax casino complaint is public, free and backed by on-chain evidence. Casinos see that the outcome is published, which is often what gets a stuck case moving. Here is how to give yours the best chance.

## 1. Ask the casino first

Open a ticket or live chat and explain the problem in one message. Ask for a reference number and a timeframe. Most issues are fixed at this stage, and we will ask whether you tried, because casinos deserve a chance to fix things before they are named.

## 2. Collect your evidence

- **Transaction hashes** for every deposit or withdrawal involved. You can find them in your wallet history or on a block explorer.
- **Dates and times**, including when you asked for the withdrawal and when support last replied.
- **Screenshots** of the support chat, the cashier and any message about your account.
- **The exact amount** and the coin and network you used.

> [!TIP]
> Add a transaction hash when you file. If the transaction touched a casino wallet the Streax monitor tracks, we match it automatically and your complaint shows it as verified.

## 3. File on Streax

Open the [Complaints page](/Complaints.dc.html), choose the casino and what went wrong, and describe what happened in plain words. Keep personal details out: your complaint is public once it is sent to the casino.

## 4. What happens next

1. **Being checked.** Streax reads every complaint before it goes anywhere, usually within 2 working days. We may ask you for more details.
2. **Waiting for the casino.** We send it to the casino, which has 7 days to reply on the public page.
3. **Casino says it is fixed.** If the casino reports a fix, you have 14 days to confirm it or dispute it.
4. **Closed.** Every complaint ends as resolved, unresolved or rejected, and the outcome is published either way.

## What each outcome means

| Outcome | Meaning | Counts against the casino? |
|---|---|---|
| Resolved | The issue was fixed, paid or settled | No, it helps the casino |
| Unresolved | The casino did not reply in time or would not fix it | Yes |
| Rejected | The complaint was not valid or the player stopped replying | No |

## Common cases

**KYC after a big win.** Casinos may verify your identity, but verification should not be used to delay a withdrawal indefinitely. Send the documents they ask for once, keep copies, and note the date.

**Deposit not credited.** Check that you used the right address and network. Coins sent on the wrong network are usually the player's responsibility, but casinos can often recover them if asked quickly.

**Self-exclusion ignored.** If you asked to be excluded and could still deposit, file under self-exclusion. These cases are treated as serious.

> [!NOTE]
> If gambling is causing you harm, stop playing first and sort out the complaint second. Free, confidential help is available at BeGambleAware.org and GamblingTherapy.org.
`
  },
  {
    slug: 'wagering-requirements-explained',
    title: 'Wagering requirements explained: what a bonus is really worth',
    dek: 'A 100% match sounds like free money. The wagering rules decide whether it is worth anything at all. Here is the maths in two minutes.',
    category: 'guides', featured: 0, author: 'Streax Research', author_role: 'Player help',
    cover: '/assets/articles/wagering-guide.webp', cover_alt: 'Three stacks of glass casino chips rising from left to right',
    tags: 'bonuses,wagering,RTP', keyword: 'wagering requirements',
    seo_title: 'Wagering requirements explained with real examples',
    seo_desc: 'How to work out what a casino bonus is really worth: wagering requirements, house edge and expected loss, with worked examples and a free calculator.',
    body: `Wagering requirements are the bets you must place before a bonus can be withdrawn, usually a multiple of the bonus. They decide whether the bonus is worth anything.

## The one formula you need

Every bet has a house edge: the share of each bet the casino keeps on average. A slot with 96% RTP has a 4% house edge. So while you wager, you expect to lose:

**Expected loss = total wagering × house edge**

The bonus is worth roughly the bonus amount minus that expected loss.

## A worked example

You deposit $100 and get a 100% match, so a $100 bonus. The terms say 35x on the bonus.

- Total wagering: $100 × 35 = **$3,500**
- On slots with 96% RTP, the house edge is 4%
- Expected loss while wagering: $3,500 × 4% = **$140**
- Expected value: $100 bonus minus $140 loss = **minus $40**

On average this bonus costs you $40. The same bonus on games with a 1% house edge would cost only $35 to clear, leaving it worth about $65, which is why many casinos exclude low-edge games or count them at a reduced rate.

## Small print that changes the maths

| Term | What it does |
|---|---|
| Wagering on deposit plus bonus | Doubles the wagering in a 100% match, and the expected loss with it |
| Game contribution | If a game counts 10%, you must bet ten times as much on it |
| Max bet | Bets above the limit can void the bonus |
| Max cashout | Caps what you can withdraw, whatever you win |
| Time limit | Unfinished wagering is lost when it expires |

> [!WARNING]
> Expected value is an average over many players. Any one player can win or lose much more. A bonus with a positive expected value is still gambling.

## Rakeback is different

Rakeback returns a share of the house edge on every bet, usually with no wagering. If you bet $10,000 at a 1% edge, the casino expects to keep $100, and 10% rakeback returns $10. It is smaller than a headline bonus, but it is real money.

## Do the sums for any offer

The Streax bonus calculator does this maths for you: enter the bonus, the wagering and the games you play, and it shows the expected value, the wagering needed and the terms to watch.

[Open the bonus calculator](/BonusCalc.dc.html)
`
  }
];

function seed(store, log) {
  if (store.all().length) return 0;
  const now = Date.now();
  ARTICLES.forEach((a, i) => {
    const t = now - (ARTICLES.length - i) * DAY;
    const row = store.save(0, Object.assign({}, a, { status: 'published', published_at: t }));
    store.db.prepare('UPDATE articles SET created = ?, updated = ? WHERE id = ?').run(t, t, row.id);
  });
  log('Articles: added ' + ARTICLES.length + ' starter articles. Edit or unpublish them in the Studio.');
  return ARTICLES.length;
}

module.exports = { seed, ARTICLES };
