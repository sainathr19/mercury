//! Pure metadata for the chains a hardware card can transact on.
//
// Kept free of any native/bridge import so the per-chain decimals (the
// correctness-critical bit — a wrong value mis-scales every amount) can be
// unit-tested without pulling in `standard-rn`. Network labels live in the
// screens, which already import the networks config.

export type CardChain = 'btc' | 'eth' | 'usdc' | 'sol';

export interface CardChainMeta {
  chain: CardChain;
  /** Display ticker. */
  symbol: string;
  /** Atomic-unit decimals used to parse the entered amount. */
  decimals: number;
  /** CoinGecko id for USD price + icon lookup. */
  coingeckoId: string;
}

export const CARD_CHAINS: CardChainMeta[] = [
  { chain: 'btc', symbol: 'BTC', decimals: 8, coingeckoId: 'bitcoin' },
  { chain: 'eth', symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
  { chain: 'usdc', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'sol', symbol: 'SOL', decimals: 9, coingeckoId: 'solana' },
];

export function cardChainMeta(chain: CardChain): CardChainMeta {
  const meta = CARD_CHAINS.find((c) => c.chain === chain);
  if (!meta) throw new Error(`Unknown card chain: ${chain}`);
  return meta;
}
