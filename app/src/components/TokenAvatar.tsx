import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { RemoteTokenIcon } from './RemoteTokenIcon';
import { CryptoGlyph } from './CryptoGlyph';

export interface TokenBadge {
  /** Remote chain-icon URL (preferred). */
  uri?: string | null;
  /** Or a local coin glyph id ('bitcoin' | 'ethereum' | 'solana' | 'tether'). */
  glyph?: string;
  fallbackColor?: string;
}

/**
 * Token icon with an optional small chain badge at the bottom-right (mirrors the
 * iOS CryptoIconView / RemoteVectorIcon chain badge). The badge gets a ring in
 * the row's background color so it reads as a separate chip.
 */
export function TokenAvatar({
  uri,
  fallbackColor,
  symbol,
  size = 40,
  badge,
}: {
  uri?: string | null;
  fallbackColor: string;
  symbol: string;
  size?: number;
  badge?: TokenBadge | null;
}) {
  const badgeSize = Math.round(size * 0.42);
  const showBadge = !!badge && (!!badge.uri || !!badge.glyph);
  return (
    <View style={{ width: size, height: size }}>
      <RemoteTokenIcon uri={uri ?? undefined} fallbackColor={fallbackColor} symbol={symbol} size={size} />
      {showBadge ? (
        <View style={styles.badge}>
          {badge!.uri ? (
            <RemoteTokenIcon uri={badge!.uri} fallbackColor={badge!.fallbackColor ?? '#8E8E93'} symbol="" size={badgeSize} />
          ) : (
            <CryptoGlyph coingeckoId={badge!.glyph!} size={badgeSize} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  badge: { position: 'absolute', right: -2, bottom: -2 },
}));
