import { evmExplorerTxUrl } from '../bridge/evmChain';
import type { ActivityItem } from '../bridge/activity';

// Pure EVM transaction-history mapper. Takes the raw rows from a Blockscout
// (Etherscan-compatible) `txlist` + `tokentx` query and turns them into the
// app's ActivityItem shape. No native imports → unit-testable in isolation
// (mirrors src/lib/activity-merge.ts). The network fetch lives in
// src/bridge/activity.ts which calls into here.

/** Keyless Blockscout REST base per EVM chain id (Etherscan-compatible `/api`). */
export const BLOCKSCOUT_BASES: Record<string, string> = {
  // Mainnets
  '1': 'https://eth.blockscout.com',
  '10': 'https://optimism.blockscout.com',
  '137': 'https://polygon.blockscout.com',
  '8453': 'https://base.blockscout.com',
  '42161': 'https://arbitrum.blockscout.com',
  // Testnets
  '11155111': 'https://eth-sepolia.blockscout.com',
  '421614': 'https://arbitrum-sepolia.blockscout.com',
  '84532': 'https://base-sepolia.blockscout.com',
};

/** Native-gas token per chain id (defaults to ETH). */
const NATIVE: Record<string, { symbol: string; coingeckoId: string; colorHex: string }> = {
  '1': { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  '11155111': { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  '10': { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  '8453': { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  '42161': { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
  '137': { symbol: 'POL', coingeckoId: 'matic-network', colorHex: '#8247E5' },
};
const DEFAULT_NATIVE = NATIVE['1'];

/** Human network name per chain id (for the activity row's subtitle). */
const CHAIN_NAMES: Record<string, string> = {
  '1': 'Ethereum',
  '10': 'Optimism',
  '137': 'Polygon',
  '8453': 'Base',
  '42161': 'Arbitrum One',
  '56': 'BNB Smart Chain',
  '43114': 'Avalanche',
  '11155111': 'Sepolia',
  '421614': 'Arbitrum Sepolia',
  '84532': 'Base Sepolia',
};
export function evmNetworkName(chainId: bigint): string {
  return CHAIN_NAMES[chainId.toString()] ?? `Chain ${chainId.toString()}`;
}

const TOKEN_COLOR: Record<string, string> = {
  'usd-coin': '#2980D9',
  tether: '#26A17B',
  dai: '#F5AC37',
  'wrapped-bitcoin': '#F09242',
  weth: '#627EEA',
  chainlink: '#2A5ADA',
  uniswap: '#FF007A',
  aave: '#B6509E',
};
const DEFAULT_TOKEN_COLOR = '#8E8E93';

/** Token symbol → CoinGecko id for the common ERC-20s (empty if unknown). */
function tokenCoingecko(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case 'USDC':
    case 'USDC2':
      return 'usd-coin';
    case 'USDT':
      return 'tether';
    case 'DAI':
      return 'dai';
    case 'WBTC':
    case 'CBBTC':
      return 'wrapped-bitcoin';
    case 'WETH':
      return 'weth';
    case 'LINK':
      return 'chainlink';
    case 'UNI':
      return 'uniswap';
    case 'AAVE':
      return 'aave';
    default:
      return '';
  }
}

/** Raw row from Blockscout/Etherscan `action=txlist` (native transfers). */
export interface RawEvmTx {
  hash: string;
  from: string;
  to: string;
  value: string; // wei
  timeStamp: string; // unix seconds
  isError?: string; // "1" = reverted
  gasUsed?: string;
  gasPrice?: string; // wei
}
/** Raw row from Blockscout/Etherscan `action=tokentx` (ERC-20 transfers). */
export interface RawEvmTokenTx {
  hash: string;
  from: string;
  to: string;
  value: string; // atomic units
  timeStamp: string;
  tokenSymbol: string;
  tokenDecimal: string;
  gasUsed?: string;
  gasPrice?: string; // wei
}

export interface EvmMapOptions {
  address: string;
  chainId: bigint;
  native: RawEvmTx[];
  tokens: RawEvmTokenTx[];
  /** Spot price of the native gas token (USD); 0 → hide USD on native rows. */
  ethPrice: number;
  /** Resolve a token's USD spot price by CoinGecko id (0 → hide USD). */
  priceOf: (coingeckoId: string) => number;
}

function fmt(v: number, dec: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
function usd(v: number, sign: string): string {
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function counterparty(sent: boolean, other: string): string {
  const short = other.length > 12 ? `${other.slice(0, 6)}…${other.slice(-4)}` : other;
  return `${sent ? 'To' : 'From'} ${short}`;
}
function toBigInt(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
/** Gas fee (gasUsed × gasPrice, in the native token) fields for a sent tx.
 *  Empty when the raw row lacks gas data. The fee is always paid in the chain's
 *  native token, even for ERC-20 transfers. */
function evmFeeFields(gasUsed: string | undefined, gasPrice: string | undefined, symbol: string, price: number) {
  const g = toBigInt(gasUsed ?? '');
  const p = toBigInt(gasPrice ?? '');
  if (g === null || p === null) return {};
  const fee = Number(g * p) / 1e18;
  return { feeText: `${fmt(fee, 6)} ${symbol}`, ...(price > 0 ? { feeUsdText: usd(fee * price, '') } : {}) };
}

/**
 * Map raw Blockscout rows → ActivityItem[]. Items are keyed by the bare tx hash
 * so an optimistic just-sent EVM tx (prepended with the same hash) reconciles to
 * confirmed on the next scan (see mergeActivity). Skips: reverted txs, zero-value
 * native txs (contract calls), self-transfers, and rows unrelated to `address`.
 */
export function mapEvmActivity(opts: EvmMapOptions): ActivityItem[] {
  const addr = opts.address.toLowerCase();
  const chain = NATIVE[opts.chainId.toString()] ?? DEFAULT_NATIVE;
  const network = evmNetworkName(opts.chainId);
  const now = Math.floor(Date.now() / 1000);
  const out: ActivityItem[] = [];

  for (const tx of opts.native ?? []) {
    if (!tx?.hash) continue;
    if (tx.isError === '1') continue;
    const value = toBigInt(tx.value);
    if (value === null || value === 0n) continue; // contract call / no native movement
    const from = (tx.from ?? '').toLowerCase();
    const to = (tx.to ?? '').toLowerCase();
    if (from !== addr && to !== addr) continue;
    if (from === addr && to === addr) continue; // self-send, nothing to show
    const sent = from === addr;
    const amt = Number(value) / 1e18;
    out.push({
      id: tx.hash,
      symbol: chain.symbol,
      coingeckoId: chain.coingeckoId,
      colorHex: chain.colorHex,
      type: sent ? 'sent' : 'received',
      label: counterparty(sent, sent ? to : from),
      amountText: `${sent ? '-' : '+'}${fmt(amt, 6)} ${chain.symbol}`,
      usdText: opts.ethPrice > 0 ? usd(amt * opts.ethPrice, sent ? '-' : '+') : '',
      timestamp: Number(tx.timeStamp) || now,
      status: 'confirmed',
      explorerUrl: evmExplorerTxUrl(opts.chainId, tx.hash),
      network,
      ...(sent ? evmFeeFields(tx.gasUsed, tx.gasPrice, chain.symbol, opts.ethPrice) : {}),
    });
  }

  for (const t of opts.tokens ?? []) {
    if (!t?.hash) continue;
    const value = toBigInt(t.value);
    if (value === null || value === 0n) continue;
    const from = (t.from ?? '').toLowerCase();
    const to = (t.to ?? '').toLowerCase();
    if (from !== addr && to !== addr) continue;
    const sent = from === addr;
    const decimals = Number(t.tokenDecimal) || 18;
    const amt = Number(value) / Math.pow(10, decimals);
    const symbol = t.tokenSymbol || 'TOKEN';
    const cg = tokenCoingecko(symbol);
    const price = cg ? opts.priceOf(cg) : 0;
    out.push({
      id: t.hash,
      symbol,
      coingeckoId: cg,
      colorHex: (cg && TOKEN_COLOR[cg]) || DEFAULT_TOKEN_COLOR,
      type: sent ? 'sent' : 'received',
      label: counterparty(sent, sent ? to : from),
      amountText: `${sent ? '-' : '+'}${fmt(amt, Math.min(decimals, 6))} ${symbol}`,
      usdText: price > 0 ? usd(amt * price, sent ? '-' : '+') : '',
      timestamp: Number(t.timeStamp) || now,
      status: 'confirmed',
      explorerUrl: evmExplorerTxUrl(opts.chainId, t.hash),
      network,
      // Gas is paid in the native token (chain.symbol), not the ERC-20 itself.
      ...(sent ? evmFeeFields(t.gasUsed, t.gasPrice, chain.symbol, opts.ethPrice) : {}),
    });
  }

  return out;
}
