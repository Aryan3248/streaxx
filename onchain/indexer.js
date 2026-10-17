'use strict';
// The on-chain indexer: every few minutes it reads new transfers for every tracked casino wallet, values them in USD,
// separates internal moves (between one casino's own wallets) from real deposits and withdrawals, stores hourly totals
// and sends whale alerts. Balances refresh hourly, token analytics every 30 minutes.

const { norm, sleep } = require('./util');
const prices = require('./prices');
const telegram = require('./telegram');
const tokens = require('./tokens');
const evm = require('./chains/evm');
const { tron } = require('./chains/tron');
const { solana } = require('./chains/solana');
const { bitcoin } = require('./chains/btc');
const { CHAINS } = require('./assets');

const ADAPTERS = { ethereum: evm.ethereum, bsc: evm.bsc, polygon: evm.polygon, tron, solana, bitcoin };

class Indexer {
  constructor(store, cfg, registry, log) {
    this.store = store;
    this.cfg = cfg;
    this.registry = registry;
    this.log = log || (() => {});
    this.running = false;
    this.startedAt = Date.now();
    this.lastRun = null;
    this.lastBalances = 0;
    this.lastTokens = 0;
    this.lastPrune = 0;
    this.tokenLive = {};
    this.timer = null;
    // Listeners (personal member alerts): runStart(), transfer(t) for each new transfer, runEnd() after a run.
    this.hooks = { runStart: [], transfer: [], runEnd: [] };
  }

  ctx() { return { cfg: this.cfg, store: this.store, log: this.log }; }

  ownerMap() {
    const m = new Map();
    this.store.wallets().forEach(w => m.set(w.chain + '|' + w.address, w.casino));
    return m;
  }

  // Which wallets get transfer indexing this run. Same-address mirrors on BNB Chain and Polygon are indexed
  // only once their balance shows they are in use, to save API calls.
  flowWallets() {
    const bal = new Map();
    this.store.db.prepare('SELECT chain, address, SUM(usd) AS usd FROM balances GROUP BY chain, address').all()
      .forEach(r => bal.set(r.chain + '|' + r.address, r.usd || 0));
    return this.store.wallets().filter(w => {
      const a = ADAPTERS[w.chain];
      if (!a || !a.flowsEnabled(this.cfg) || w.role === 'funder') return false;
      if (w.source === 'mirror') return (bal.get(w.chain + '|' + w.address) || 0) >= this.cfg.mirrorFlowMinUsd;
      return true;
    });
  }

  classify(list, owner, casino) {
    return list.map(t => {
      const cpOwner = t.cp ? owner.get(t.chain + '|' + norm(t.chain, t.cp)) : null;
      const usd = prices.usd(t.chain, t.asset, t.amount, t.token);
      return Object.assign({}, t, { casino, internal: cpOwner === casino, cpCasino: cpOwner && cpOwner !== casino ? cpOwner : null, usd });
    });
  }

  async indexChain(chain, wallets, owner, names, stats) {
    const adapter = ADAPTERS[chain];
    const label = CHAINS[chain].name;
    let failsInRow = 0;
    for (const w of wallets) {
      if (failsInRow >= 3) { stats.errors.push(label + ': skipped the remaining wallets after 3 failures in a row'); break; }
      try {
        const { list, more } = await adapter.transfers(this.ctx(), w);
        const rows = this.classify(list, owner, w.casino);
        const fresh = this.store.record(rows, { storeMinUsd: this.cfg.storeMinUsd });
        stats.transfers += fresh.length;
        if (more) stats.behind += 1;
        this.store.source(label, true);
        failsInRow = 0;
        const alertFrom = Math.max(this.startedAt, Date.now() - this.cfg.alertWindowHours * 3600000);
        fresh.forEach(t => {
          if (!t.internal && t.ts >= alertFrom) this.emit('transfer', t);
          if (t.internal || !(t.usd >= this.cfg.whaleUsd) || t.ts < alertFrom) return;
          stats.whales += 1;
          if (telegram.send(this.cfg, this.log, t, names[t.casino] || t.casino)) this.store.markAlerted(t);
        });
      } catch (e) {
        stats.errors.push(label + ' ' + w.address.slice(0, 10) + ': ' + e.message);
        this.store.source(label, false, e);
        failsInRow += 1;
        if (/API key|apikey|Invalid/i.test(e.message)) break;
      }
    }
  }

  async balances() {
    const byChain = {};
    this.store.wallets().forEach(w => { if (ADAPTERS[w.chain]) (byChain[w.chain] = byChain[w.chain] || []).push(w); });
    const errors = [];
    await Promise.all(Object.entries(byChain).map(async ([chain, ws]) => {
      const label = CHAINS[chain].name + ' balances';
      try {
        const rows = await ADAPTERS[chain].balances(this.ctx(), ws);
        this.store.tx(() => rows.forEach(r => this.store.setBalance(r.chain, r.address, r.asset, r.amount, prices.usd(r.chain, r.asset, r.amount) || 0)));
        this.store.source(label, true);
      } catch (e) { errors.push(label + ': ' + e.message); this.store.source(label, false, e); }
    }));
    this.store.rollBalanceDay();
    return errors;
  }

  emit(name, arg) {
    (this.hooks[name] || []).forEach(fn => { try { fn(arg); } catch (e) { this.log('Hook ' + name + ': ' + e.message); } });
  }
  async emitAsync(name) {
    for (const fn of this.hooks[name] || []) { try { await fn(); } catch (e) { this.log('Hook ' + name + ': ' + e.message); } }
  }

  async runOnce() {
    if (this.running) return null;
    this.running = true;
    this.emit('runStart');
    const id = this.store.runStart();
    const stats = { transfers: 0, whales: 0, behind: 0, errors: [] };
    const t0 = Date.now();
    try {
      try { await prices.refresh(); this.store.source('DefiLlama prices', true); } catch (e) { stats.errors.push('prices: ' + e.message); this.store.source('DefiLlama prices', false, e); }
      if (Date.now() - this.lastBalances > this.cfg.balanceMinutes * 60000) {
        stats.errors.push(...await this.balances());
        this.lastBalances = Date.now();
      }
      const owner = this.ownerMap();
      const names = this.store.casinoNames();
      const groups = {};
      this.flowWallets().forEach(w => { (groups[w.chain] = groups[w.chain] || []).push(w); });
      // Ethereum, BNB Chain and Polygon share one Etherscan key and rate limit, so they run one after another.
      const evmChains = ['ethereum', 'polygon', 'bsc'].filter(c => groups[c]);
      const jobs = [(async () => { for (const c of evmChains) await this.indexChain(c, groups[c], owner, names, stats); })()];
      ['tron', 'solana', 'bitcoin'].forEach(c => { if (groups[c]) jobs.push(this.indexChain(c, groups[c], owner, names, stats)); });
      await Promise.all(jobs);
      if (Date.now() - this.lastTokens > this.cfg.tokenMinutes * 60000 && (this.registry.tokens || []).length) {
        try { this.tokenLive = await tokens.refresh(this.ctx(), this.registry.tokens); } catch (e) { stats.errors.push('tokens: ' + e.message); }
        this.lastTokens = Date.now();
      }
      if (Date.now() - this.lastPrune > 6 * 3600000) { this.store.prune(); this.lastPrune = Date.now(); }
    } finally {
      this.running = false;
      const note = stats.transfers + ' new transfers, ' + stats.whales + ' whale alerts' + (stats.behind ? ', ' + stats.behind + ' wallets catching up' : '') +
        (stats.errors.length ? ', ' + stats.errors.length + ' errors' : '') + ', ' + Math.round((Date.now() - t0) / 1000) + 's';
      this.store.runEnd(id, stats.errors.length === 0, note);
      this.lastRun = Object.assign({ at: Date.now(), ms: Date.now() - t0 }, stats, { errors: stats.errors.slice(0, 20) });
      this.log('On-chain run: ' + note + (stats.errors.length ? ' | ' + stats.errors.slice(0, 3).join(' | ') : ''));
      this.behind = stats.behind;
    }
    await this.emitAsync('runEnd');
    return this.lastRun;
  }

  start() {
    const loop = async () => {
      try { await this.runOnce(); } catch (e) { this.log('On-chain run failed: ' + e.message); }
      // Wallets still catching up on history get a quicker next run.
      const wait = this.behind ? 60000 : this.cfg.pollMinutes * 60000;
      this.timer = setTimeout(loop, wait);
    };
    this.timer = setTimeout(loop, 3000);
  }
  stop() { clearTimeout(this.timer); }
}

module.exports = { Indexer, ADAPTERS, sleep };
