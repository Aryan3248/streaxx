'use strict';
// Entry point: reads settings from environment variables, opens the database, seeds the wallet registry and starts the indexer.

const fs = require('fs');
const path = require('path');

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

function config(env) {
  return {
    etherscanKey: env.ETHERSCAN_API_KEY || '',
    etherscanPaid: env.ETHERSCAN_PAID === '1',
    trongridKey: env.TRONGRID_API_KEY || '',
    solanaRpc: env.SOLANA_RPC_URL || '',
    rpc: { ethereum: env.ETH_RPC_URL || '', bsc: env.BSC_RPC_URL || '', polygon: env.POLYGON_RPC_URL || '' },
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChat: env.TELEGRAM_CHAT_ID || '',
    adminToken: env.ADMIN_TOKEN || '',
    whaleUsd: num(env.WHALE_USD, 50000),
    storeMinUsd: num(env.STORE_MIN_USD, 1000),
    pollMinutes: Math.max(2, num(env.POLL_MINUTES, 10)),
    backfillHours: Math.min(720, Math.max(1, num(env.BACKFILL_HOURS, 48))),
    balanceMinutes: Math.max(10, num(env.BALANCE_MINUTES, 60)),
    tokenMinutes: Math.max(10, num(env.TOKEN_MINUTES, 30)),
    alertWindowHours: num(env.ALERT_WINDOW_HOURS, 2),
    maxPagesPerWallet: Math.max(1, num(env.MAX_PAGES_PER_WALLET, 5)),
    maxSolanaTxPerWallet: Math.max(50, num(env.MAX_SOLANA_TX, 600)),
    mirrorFlowMinUsd: num(env.MIRROR_FLOW_MIN_USD, 5000),
    internalTx: env.INTERNAL_TX !== '0',
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data')
  };
}

function start(env, log) {
  if (env.ONCHAIN === 'off') { log('On-chain monitor: off (ONCHAIN=off)'); return null; }
  const { Store, available } = require('./db');
  if (!available) { log('On-chain monitor: off. It needs Node.js 22.5 or newer (built-in SQLite).'); return null; }
  const { Indexer } = require('./indexer');
  const cfg = config(env);
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'registry.json'), 'utf8'));
  const store = new Store(path.join(cfg.dataDir, 'onchain.db'));
  const n = store.seed(registry);
  const indexer = new Indexer(store, cfg, registry, log);
  const missing = [];
  if (!cfg.etherscanKey) missing.push('ETHERSCAN_API_KEY (Ethereum and Polygon transfers)');
  if (!cfg.trongridKey) missing.push('TRONGRID_API_KEY (faster Tron)');
  if (!cfg.solanaRpc) missing.push('SOLANA_RPC_URL (reliable Solana)');
  if (!cfg.telegramToken || !cfg.telegramChat) missing.push('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (whale alerts)');
  log('On-chain monitor: ' + n + ' registry wallets, database ' + path.join(cfg.dataDir, 'onchain.db') + ', every ' + cfg.pollMinutes + ' min');
  if (missing.length) log('On-chain monitor: not set yet: ' + missing.join('; '));
  if (env.ONCHAIN_INDEX !== 'off') indexer.start();
  return { cfg, store, indexer, registry, log };
}

module.exports = { start, config };
