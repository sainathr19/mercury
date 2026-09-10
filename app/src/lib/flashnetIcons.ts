//! Real art for a Flashnet asset, not a letter in a circle.
//
// `CryptoIcon` resolves by CoinGecko id: bundled SVG → inline glyph → an image
// URL → a coloured chip with the first letter. Flashnet's route table gives a
// symbol, a contract and decimals — no id and no icon — so every swap asset
// landed on that last fallback and the picker read as a list of grey initials.
//
// Two sources fix it, in order of trust:
//
//  1. The REGISTRY, matched on chain + contract. It carries both the CoinGecko
//     id and a real `imageUrl`, and matching on contract cannot confuse two
//     tokens that share a symbol.
//  2. This symbol map, for the assets the registry does not list. Symbols are
//     only consulted after the contract match fails, and only to name an id we
//     already ship or can fetch art for.
import type { Registry } from './registry';
import { SOURCE_CHAINS, DEST_CHAINS, type SwapAsset } from './flashnetScope';

/**
 * CoinGecko ids for the symbols on Flashnet's in-scope routes.
 *
 * Deliberately not clever: an explicit table of the ~20 things that can appear,
 * so a wrong icon is a visible edit rather than an emergent guess.
 */
const BY_SYMBOL: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  WETH: 'weth',
  SOL: 'solana',
  USDC: 'usd-coin',
  'USDC.E': 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  USDE: 'ethena-usde',
  USDG: 'global-dollar',
  PYUSD: 'paypal-usd',
  HSUSD: 'hsusd',
  PATHUSD: 'pathusd',
  WBTC: 'wrapped-bitcoin',
  // The wrapped-BTC family all point at the one bundled bitcoin-ring mark. A
  // deliberate approximation: cbBTC is not WBTC, but the app's own
  // `coingeckoId()` helper already folds CBBTC into 'wrapped-bitcoin', and a
  // recognisable BTC mark beats a coloured letter on a list of assets.
  CBBTC: 'wrapped-bitcoin',
  TBTC: 'wrapped-bitcoin',
  // POL is Polygon's native coin, so the chain mark IS its mark — and we ship
  // that one, where 'matic-network' would have found nothing.
  POL: 'polygon',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  AVAX: 'avalanche-2',
  SHX: 'stronghold-token',
};

/** The EVM chain id behind a Flashnet chain, when it has one. */
export function chainIdFor(chain: string): number | undefined {
  const evm = SOURCE_CHAINS[chain]?.evmChainId;
  return evm !== undefined ? Number(evm) : undefined;
}

/** The network NAME for a non-EVM chain, which is how `ChainBadge` finds its art. */
export function chainNetworkName(chain: string): string | undefined {
  const fam = DEST_CHAINS[chain];
  if (fam === 'btc') return 'Bitcoin';
  if (fam === 'sol') return 'Solana';
  return undefined;
}

export interface ResolvedIcon {
  coingeckoId: string;
  imageUrl: string;
  /** Tint for the fallback chip, so even an unknown token is not grey. */
  colorHex: string;
}

/** Deterministic tint from a symbol — the same asset is always the same colour. */
function tintFor(symbol: string): string {
  const PALETTE = ['#2980D9', '#1AA68C', '#7380BF', '#FF991A', '#7333D9', '#268CD1', '#D95F80', '#4B9E5F'];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

/**
 * The best icon we can find for one swap asset.
 *
 * Registry first (contract-matched), then the symbol table. Never throws and
 * always returns something renderable.
 */
export function resolveIcon(a: SwapAsset, registry: Registry): ResolvedIcon {
  const netKey = chainIdFor(a.chain) !== undefined ? String(chainIdFor(a.chain)) : a.chain;
  const net = registry.networks[netKey];
  const want = a.contractAddress?.toLowerCase();

  if (net) {
    // Native coin: the network's own asset. Token: matched on contract.
    if (!want && net.native) {
      return {
        coingeckoId: net.native.coingeckoId,
        imageUrl: net.native.imageUrl ?? '',
        colorHex: tintFor(a.symbol),
      };
    }
    if (want) {
      const hit = net.tokens?.find((t) => t.address?.toLowerCase() === want);
      if (hit) {
        return {
          coingeckoId: hit.coingeckoId,
          imageUrl: hit.imageUrl ?? '',
          colorHex: tintFor(a.symbol),
        };
      }
    }
  }

  return {
    coingeckoId: BY_SYMBOL[a.symbol.toUpperCase()] ?? a.symbol.toLowerCase(),
    imageUrl: '',
    colorHex: tintFor(a.symbol),
  };
}
