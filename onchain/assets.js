'use strict';
// Assets the monitor counts. Only these contracts are valued: casino hot wallets receive thousands of spam tokens,
// including fake "USDT" copies, so tokens are matched by contract address, never by symbol.

const STABLE = 'stable';

const CHAINS = {
  ethereum: {
    name: 'Ethereum', native: { sym: 'ETH', decimals: 18, price: 'coingecko:ethereum' },
    explorer: 'https://etherscan.io', etherscanId: 1,
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    tokens: {
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { sym: 'USDT', decimals: 6, price: STABLE },
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { sym: 'USDC', decimals: 6, price: STABLE },
      '0x6b175474e89094c44da98b954eedeac495271d0f': { sym: 'DAI', decimals: 18, price: STABLE },
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { sym: 'WETH', decimals: 18, price: 'coingecko:ethereum' },
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { sym: 'WBTC', decimals: 8, price: 'coingecko:bitcoin' },
      '0x046eee2cc3188071c02bfc1745a6b17c656e3f3d': { sym: 'RLB', decimals: 18, price: 'coingecko:rollbit-coin' },
      '0x8881562783028f5c1bcb985d2283d5e170d88888': { sym: 'SHFL', decimals: 18, price: 'coingecko:shuffle-2' }
    }
  },
  bsc: {
    name: 'BNB Chain', native: { sym: 'BNB', decimals: 18, price: 'bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    explorer: 'https://bscscan.com', etherscanId: 56,
    rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
    tokens: {
      '0x55d398326f99059ff775485246999027b3197955': { sym: 'USDT', decimals: 18, price: STABLE },
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { sym: 'USDC', decimals: 18, price: STABLE }
    }
  },
  polygon: {
    name: 'Polygon', native: { sym: 'POL', decimals: 18, price: 'coingecko:polygon-ecosystem-token' },
    explorer: 'https://polygonscan.com', etherscanId: 137,
    rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    tokens: {
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { sym: 'USDT', decimals: 6, price: STABLE },
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { sym: 'USDC', decimals: 6, price: STABLE },
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { sym: 'USDC.e', decimals: 6, price: STABLE }
    }
  },
  tron: {
    name: 'Tron', native: { sym: 'TRX', decimals: 6, price: 'tron:TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR' },
    explorer: 'https://tronscan.org/#',
    tokens: {
      TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { sym: 'USDT', decimals: 6, price: STABLE }
    }
  },
  solana: {
    name: 'Solana', native: { sym: 'SOL', decimals: 9, price: 'solana:So11111111111111111111111111111111111111112' },
    explorer: 'https://solscan.io',
    tokens: {
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { sym: 'USDC', decimals: 6, price: STABLE },
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { sym: 'USDT', decimals: 6, price: STABLE }
    }
  },
  bitcoin: {
    name: 'Bitcoin', native: { sym: 'BTC', decimals: 8, price: 'coingecko:bitcoin' },
    explorer: 'https://mempool.space',
    tokens: {}
  }
};

function token(chain, contract) {
  const c = CHAINS[chain];
  if (!c) return null;
  const key = (chain === 'ethereum' || chain === 'bsc' || chain === 'polygon') ? String(contract || '').toLowerCase() : contract;
  return c.tokens[key] || null;
}

// Every price key the monitor needs, for one DefiLlama request.
function priceKeys() {
  const keys = new Set();
  Object.values(CHAINS).forEach(c => {
    keys.add(c.native.price);
    Object.values(c.tokens).forEach(t => { if (t.price !== STABLE) keys.add(t.price); });
  });
  return [...keys];
}

function txUrl(chain, tx) {
  const c = CHAINS[chain];
  if (!c) return '';
  if (chain === 'tron') return c.explorer + '/transaction/' + tx;
  return c.explorer + '/tx/' + tx;
}
function addrUrl(chain, a) {
  const c = CHAINS[chain];
  if (!c) return '';
  if (chain === 'tron') return c.explorer + '/address/' + a;
  if (chain === 'solana') return c.explorer + '/account/' + a;
  return c.explorer + '/address/' + a;
}

module.exports = { CHAINS, STABLE, token, priceKeys, txUrl, addrUrl };
