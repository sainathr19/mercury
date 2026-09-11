// A Flashnet Orchestra asset, drawn.
//
// `SwapAssetIcon` is provider-agnostic by design (the wallet swaps through
// Orchestra on mainnet and Garden on testnet), so something has to turn one
// provider's asset into the descriptor it takes. Doing that here rather than at
// each call site keeps the registry lookup in one place and the call sites a
// single component name.
import { SwapAssetIcon } from './SwapAssetIcon';
import { useRegistry } from '../stores/registryStore';
import { flashnetIconAsset } from '../lib/flashnetIcons';
import type { SwapAsset } from '../lib/flashnetScope';

export function FlashnetAssetIcon({
  asset,
  size = 34,
  ringColor,
}: {
  asset: SwapAsset;
  size?: number;
  ringColor?: string;
}) {
  const registry = useRegistry((s) => s.registry);
  return <SwapAssetIcon asset={flashnetIconAsset(asset, registry)} size={size} ringColor={ringColor} />;
}
