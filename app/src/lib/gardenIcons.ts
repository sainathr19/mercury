//! Real art for a Garden asset.
//
// Garden's catalog carries a CoinGecko id AND its own icon URL for every asset,
// and the interesting part is knowing which to trust for what.
//
// The trap: `token_ids.coingecko` is the id of the UNDERLYING asset, not of the
// token. WBTC, cbBTC and iBTC all report `bitcoin`, and USDC.e and AlphaUSD both
// report `usd-coin`. Resolving art from that id drew three different wrapped-BTC
// tokens as the same plain Bitcoin glyph, which is precisely the confusion a
// token mark exists to prevent — on a swap screen the whole question is WHICH
// wrapped BTC you are holding.
//
// So the id is used only where it genuinely identifies the token, and the symbol
// picks the mark everywhere else. Garden's own `icon` is the fallback for
// everything we ship no art for, which is most of its long tail.
import { colorForSymbol } from './asset-color';
import type { SwapIconAsset } from '../components/SwapAssetIcon';
import type { SwapAsset } from './gardenScope';

/**
 * Symbol → the art key to resolve with.
 *
 * Keys on the LEFT are Garden symbols, uppercased. Values are either a CoinGecko
 * id the app ships a mark or glyph for, or a bundled pseudo-id (`cbbtc`) added
 * because no CoinGecko id distinguishes that token from its underlying.
 *
 * Anything absent falls through to Garden's own icon URL, which is always
 * present and always asset-specific — a better answer than a wrong bundled mark.
 */
const ART_BY_SYMBOL: Record<string, string> = {
  // Glyphs (vector, no network fetch).
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  USDT: 'tether',
  // Bundled marks.
  USDC: 'usd-coin',
  USDC2: 'usd-coin',
  'USDC.E': 'usd-coin',
  PATHUSD: 'pathusd',
  WBTC: 'wrapped-bitcoin',
  // Bundled BECAUSE the CoinGecko id does not distinguish them.
  CBBTC: 'cbbtc',
  IBTC: 'ibtc',
  SEED: 'seed',
};

/**
 * Does this asset's badge tell the reader anything?
 *
 * Bitcoin on Bitcoin and SOL on Solana do not: there is one of each, and
 * stamping a chain's own mark onto its own coin is noise that also hides part of
 * the token art underneath. The app already draws this distinction for held
 * balances (`needsChainBadge`); this is the same rule for swap assets.
 */
export function needsNetworkBadge(asset: SwapAsset): boolean {
  if (asset.family === 'btc') return false;
  if (asset.family === 'sol') return !!asset.tokenAddress;
  return true;
}

/** A Garden asset as the icon component wants it. Never throws. */
export function gardenIconAsset(asset: SwapAsset): SwapIconAsset {
  const key = ART_BY_SYMBOL[asset.symbol.toUpperCase()];
  const badge = needsNetworkBadge(asset);
  return {
    symbol: asset.symbol,
    // No bundled match → a key that deliberately resolves to nothing local, so
    // `CryptoIcon` falls through to Garden's URL instead of to a wrong mark.
    // The asset id is unique per token, which is exactly the property needed.
    coingeckoId: key ?? asset.id,
    colorHex: colorForSymbol(asset.symbol),
    imageUrl: asset.iconUrl,
    chainId: badge && asset.evmChainId !== undefined ? Number(asset.evmChainId) : undefined,
    network: badge ? (asset.family === 'sol' ? 'Solana' : undefined) : undefined,
  };
}
