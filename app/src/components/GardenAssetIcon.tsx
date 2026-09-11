// A Garden asset, drawn. The provider-side half of `SwapAssetIcon`.
//
// No registry lookup, unlike the Orchestra wrapper: Garden's catalog carries the
// CoinGecko id itself, so the mapping is pure.
import { SwapAssetIcon } from './SwapAssetIcon';
import { gardenIconAsset } from '../lib/gardenIcons';
import type { SwapAsset } from '../lib/gardenScope';

export function GardenAssetIcon({
  asset,
  size = 34,
  ringColor,
}: {
  asset: SwapAsset;
  size?: number;
  ringColor?: string;
}) {
  return <SwapAssetIcon asset={gardenIconAsset(asset)} size={size} ringColor={ringColor} />;
}
