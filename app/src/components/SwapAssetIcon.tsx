// One swap asset, drawn: the token's own mark with its chain stamped on it.
//
// The chain badge is not decoration here. A swap endpoint is a PAIR, and USDC
// on Base and USDC on Solana are different destinations with different
// addresses and different delivery costs — so an icon that shows only the token
// is showing half the answer.
import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CryptoIcon } from './CryptoIcon';
import { ChainBadge } from './ChainBadge';
import { useRegistry } from '../stores/registryStore';
import { chainIdFor, chainNetworkName, resolveIcon } from '../lib/flashnetIcons';
import type { SwapAsset } from '../lib/flashnetScope';

export function SwapAssetIcon({
  asset,
  size = 34,
  /** Surface the badge overlaps, so it reads as separate from what is behind it. */
  ringColor,
}: {
  asset: SwapAsset;
  size?: number;
  ringColor?: string;
}) {
  const theme = UnistylesRuntime.getTheme();
  const registry = useRegistry((s) => s.registry);
  const icon = resolveIcon(asset, registry);
  const badge = Math.round(size * 0.44);

  return (
    <View style={{ width: size, height: size }}>
      <CryptoIcon
        coingeckoId={icon.coingeckoId}
        symbol={asset.symbol}
        colorHex={icon.colorHex}
        imageUrl={icon.imageUrl}
        size={size}
      />
      <View style={styles.badge}>
        <ChainBadge
          chainId={chainIdFor(asset.chain)}
          network={chainNetworkName(asset.chain) ?? asset.chainName}
          size={badge}
          ringColor={ringColor ?? theme.colors.cardBackground}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  badge: { position: 'absolute', right: -3, bottom: -2 },
}));
