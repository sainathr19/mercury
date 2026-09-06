import { View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '../ui/Text';

export interface RemoteTokenIconProps {
  uri?: string;
  size?: number;
  /** Fallback tint (chain color) shown while loading or when no uri. */
  fallbackColor: string;
  /** Symbol initial shown on the fallback chip. */
  symbol?: string;
}

/** Cached remote token icon (replaces the iOS WKWebView SVG hack). Falls back to
 *  a colored chip with the symbol's first letter. */
export function RemoteTokenIcon({ uri, size = 32, fallbackColor, symbol }: RemoteTokenIconProps) {
  const radius = size / 2;
  if (!uri) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: fallbackColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {symbol ? (
          <Text variant="captionBold" color="#FFFFFF">
            {symbol.slice(0, 1).toUpperCase()}
          </Text>
        ) : null}
      </View>
    );
  }
  // No background tint behind a loaded icon — the token art carries its own
  // shape/background (a colored chip is only used for the no-uri fallback above).
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius }}
      cachePolicy="disk"
      contentFit="contain"
      transition={150}
    />
  );
}
