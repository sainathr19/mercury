// One swap asset, drawn: the token's own mark with its chain stamped on it.
//
// The chain badge is not decoration here. A swap endpoint is a PAIR, and USDC
// on Base and USDC on Solana are different destinations with different
// addresses and different delivery costs — so an icon that shows only the token
// is showing half the answer.
//
// Takes a PRESENTATION descriptor rather than a provider's asset type. The
// wallet now swaps through two providers — Flashnet Orchestra on mainnet, Garden
// on testnet — whose asset shapes have nothing in common, and this component
// cares about none of the difference: it needs a symbol, something to resolve
// art from, and which chain to stamp. Each provider supplies that in its own
// `*Icons.ts`, so neither leaks into the view layer.
import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CryptoIcon } from './CryptoIcon';
import { ChainBadge } from './ChainBadge';

/** Everything the icon needs, and nothing about where the asset came from. */
export interface SwapIconAsset {
  symbol: string;
  /** Resolves bundled art first — always preferred over a URL. */
  coingeckoId: string;
  /** Tint for the fallback chip, so an unknown token is never grey. */
  colorHex: string;
  /** Remote art, used only when nothing is bundled for `coingeckoId`. */
  imageUrl?: string;
  /** EVM chain id for the badge. Resolves chain art most reliably. */
  chainId?: number;
  /** Network NAME, for a badge on a chain with no EVM id (Bitcoin, Solana). */
  network?: string;
}

export function SwapAssetIcon({
  asset,
  size = 34,
  /** Surface the badge overlaps, so it reads as separate from what is behind it. */
  ringColor,
}: {
  asset: SwapIconAsset;
  size?: number;
  ringColor?: string;
}) {
  const theme = UnistylesRuntime.getTheme();
  // 0.46, between the original 0.44 (a smudge at a 30pt icon) and 0.5 (which
  // read as heavy next to the coin). The network is half the identity of a swap
  // endpoint, so the mark has to be legible without competing with the token.
  const badge = Math.round(size * 0.46);

  return (
    <View style={{ width: size, height: size }}>
      <CryptoIcon
        coingeckoId={asset.coingeckoId}
        symbol={asset.symbol}
        colorHex={asset.colorHex}
        imageUrl={asset.imageUrl}
        size={size}
      />
      <View style={styles.badge}>
        <ChainBadge
          chainId={asset.chainId}
          network={asset.network}
          size={badge}
          ringColor={ringColor ?? theme.colors.cardBackground}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  // Matches CryptoIcon's own chain badge, so a swap row and a balance row put
  // the network mark in the same place.
  badge: { position: 'absolute', right: -2, bottom: -2 },
}));
