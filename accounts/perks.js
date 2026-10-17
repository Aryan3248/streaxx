'use strict';
// What an account unlocks. Points only ever go up, so a level, once reached, is kept.

const LEVELS = [
  { id: 'member', name: 'Member', min: 0, watch: 10, alertMin: 50000, perks: ['Watchlist of 10 casinos', 'Whale alerts from $50K', 'Full 7, 30 and 90-day history', 'CSV downloads', 'Member bonus codes'] },
  { id: 'silver', name: 'Silver', min: 500, watch: 25, alertMin: 25000, perks: ['Watchlist of 25 casinos', 'Whale alerts from $25K', 'Silver bonus codes'] },
  { id: 'gold', name: 'Gold', min: 1500, watch: 100, alertMin: 10000, perks: ['Watchlist of 100 casinos', 'Whale alerts from $10K', 'Gold bonus codes'] }
];

// One-time rewards. The reason string is unique per account, so each is paid at most once.
const POINTS = {
  signup: { pts: 100, label: 'Joined Streax' },
  verify: { pts: 50, label: 'Confirmed email' },
  friend: { pts: 100, label: 'Joined with a friend\'s link' },
  telegram: { pts: 50, label: 'Connected Telegram alerts' },
  watch3: { pts: 50, label: 'Watched 3 casinos' },
  referral: { pts: 250, label: 'Friend joined' },
  payout: { pts: 25, label: 'Payout report verified' }
};
const REFERRALS_PER_DAY = 20;

const ALERT_OPTIONS = [10000, 25000, 50000, 100000, 250000, 1000000];

function levelFor(points) {
  let lv = LEVELS[0];
  LEVELS.forEach(l => { if (points >= l.min) lv = l; });
  return lv;
}
function nextLevel(points) {
  return LEVELS.find(l => l.min > points) || null;
}
function levelRank(id) {
  const i = LEVELS.findIndex(l => l.id === id);
  return i < 0 ? 0 : i;
}
function reasonLabel(reason) {
  const base = String(reason || '').split(':')[0];
  return (POINTS[base] && POINTS[base].label) || 'Bonus points';
}
function money(v) {
  return v >= 1e6 ? '$' + (v / 1e6) + 'M' : '$' + (v / 1e3) + 'K';
}

module.exports = { LEVELS, POINTS, ALERT_OPTIONS, REFERRALS_PER_DAY, levelFor, nextLevel, levelRank, reasonLabel, money };
