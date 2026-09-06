import { Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { UnistylesRuntime } from 'react-native-unistyles';
import { currencyParts } from '../lib/format';
import { fontFamily } from '../theme/fonts';

export interface CurrencyTextProps {
  amount: number;
  size: number;
  /** Render masked (•••• ) when balances are hidden. */
  masked?: boolean;
  /** Override the letter spacing (defaults to -0.5). */
  letterSpacing?: number;
  /** Override the whole / fraction colors (default theme text / muted). */
  wholeColor?: string;
  fractionColor?: string;
  /** When set, shrink `size` down (never below `minSize`) so the value fits
   *  within this width. Used by the big home balance so large amounts
   *  (e.g. $40,000,000) don't run off the edge of the screen. */
  fitWidth?: number;
  /** Floor for the auto-fit shrink (defaults to half of `size`). */
  minSize?: number;
}

/** Currency amount with the dollars in the text color and the `.cents` in a
 *  lighter gray (two-tone, mirrors iOS). Masking crossfades smoothly between the
 *  value and "••••" — the dots are overlaid so the width never jumps. */
export function CurrencyText({ amount, size, masked, letterSpacing = -0.5, wholeColor, fractionColor, fitWidth, minSize }: CurrencyTextProps) {
  const theme = UnistylesRuntime.getTheme();
  const { whole, fraction } = currencyParts(amount);

  // Auto-fit: estimate the rendered width (bold numerals ≈ 0.58em each, plus the
  // per-glyph letter spacing) and scale the font down only when it would overflow
  // `fitWidth`. Small amounts keep the full `size`; large ones shrink to fit.
  const fitted = (() => {
    if (!fitWidth) return size;
    const chars = whole.length + fraction.length;
    const predicted = chars * (size * 0.58 + letterSpacing);
    if (predicted <= fitWidth) return size;
    const floor = minSize ?? size / 2;
    const ideal = (fitWidth / chars - letterSpacing) / 0.58;
    return Math.max(floor, ideal);
  })();

  const base = { fontFamily: fontFamily.bold, fontSize: fitted, letterSpacing } as const;

  const m = useDerivedValue(() => withTiming(masked ? 1 : 0, { duration: 220 }));
  const valueStyle = useAnimatedStyle(() => ({ opacity: 1 - m.value }));
  const dotsStyle = useAnimatedStyle(() => ({ opacity: m.value }));

  return (
    <View>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'baseline' }, valueStyle]}>
        <RNText style={[base, { color: wholeColor ?? theme.colors.text }]}>{whole}</RNText>
        <RNText style={[base, { color: fractionColor ?? theme.colors.muted }]}>{fraction}</RNText>
      </Animated.View>
      <Animated.View
        style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }, dotsStyle]}
        pointerEvents="none"
      >
        <RNText style={[base, { color: theme.colors.text }]}>••••</RNText>
      </Animated.View>
    </View>
  );
}
