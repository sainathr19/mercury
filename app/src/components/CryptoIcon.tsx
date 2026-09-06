import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { UnistylesRuntime } from 'react-native-unistyles';
import { CryptoGlyph, CRYPTO_GLYPH_IDS } from './CryptoGlyph';
import { RemoteTokenIcon } from './RemoteTokenIcon';
import { localTokenIcon } from './icon-assets';
import { usePortfolio } from '../stores/portfolioStore';

export interface CryptoIconProps {
  coingeckoId: string;
  symbol: string;
  colorHex: string;
  /** Registry icon URL; used when we don't ship a local image. */
  imageUrl?: string;
  size?: number;
  /** Chain-icon key (from `chainIconKeyFor`) for a small chain badge at the
   *  bottom-right. Only set for non-native assets — natives get no badge. */
  chainKey?: string | null;
}

/** Asset icon: bundled asset → inline glyph → registry/price-feed image →
 *  colored chip. Bundled assets win so a shipped chain mark (e.g. the dark
 *  Ethereum) overrides the inline glyph; the Ethereum mark also swaps to a
 *  light chip in the app's dark (stealth) theme. Pass `chainKey` to overlay a
 *  small chain badge (used when the asset lives on a specific chain). */
export function CryptoIcon({ coingeckoId, symbol, colorHex, imageUrl = '', size = 32, chainKey }: CryptoIconProps) {
  const marketUri = usePortfolio((s) => s.market[coingeckoId]?.imageUrl); // hook: call unconditionally
  const dark = UnistylesRuntime.themeName === 'dark';
  const local = localTokenIcon(coingeckoId, dark);

  let base: ReactNode;
  if (local !== undefined) {
    base = <ExpoImage source={local} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="contain" />;
  } else if (CRYPTO_GLYPH_IDS.has(coingeckoId)) {
    base = <CryptoGlyph coingeckoId={coingeckoId} size={size} />;
  } else {
    const uri = imageUrl && imageUrl.length > 0 ? imageUrl : marketUri;
    base = <RemoteTokenIcon uri={uri} size={size} fallbackColor={colorHex} symbol={symbol} />;
  }

  if (!chainKey) return <>{base}</>;

  const badgeSize = Math.round(size * 0.42);
  const badgeLocal = localTokenIcon(chainKey, dark);
  return (
    <View style={{ width: size, height: size }}>
      {base}
      <View style={{ position: 'absolute', right: -2, bottom: -2 }}>
        {badgeLocal !== undefined ? (
          <ExpoImage
            source={badgeLocal}
            style={{ width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 }}
            contentFit="contain"
          />
        ) : (
          <CryptoGlyph coingeckoId={chainKey} size={badgeSize} />
        )}
      </View>
    </View>
  );
}
