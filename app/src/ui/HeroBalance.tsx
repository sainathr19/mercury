// The wallet's headline figure.
//
// Reference treatment: a small raised currency glyph, oversized numerals, and
// dimmed cents — the cents are already two-tone in `CurrencyText`, so this adds
// the label row, the superscript glyph and the change line around it.
import type { ReactNode } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { CurrencyText } from './CurrencyText';
import { Text } from './Text';

export interface HeroBalanceProps {
  amount: number;
  /** Small label above the figure, e.g. "Total balance". */
  label?: string;
  /** Rendered at the trailing edge of the label row — a network pill, a selector. */
  labelAccessory?: ReactNode;
  masked?: boolean;
  /** Tapping the figure toggles masking. */
  onPress?: () => void;
  /** The 24h change row, or a shimmer while it loads. Omitted when absent. */
  footer?: ReactNode;
}

export function HeroBalance({ amount, label, labelAccessory, masked, onPress, footer }: HeroBalanceProps) {
  const theme = UnistylesRuntime.getTheme();
  const body = (
    <View style={styles.block}>
      {(label || labelAccessory) && (
        <View style={styles.labelRow}>
          {!!label && (
            <Text variant="subheadSemibold" color={theme.colors.muted}>
              {label}
            </Text>
          )}
          {labelAccessory}
        </View>
      )}
      <CurrencyText
        amount={amount}
        size={46}
        minSize={30}
        // Physical screen width — STABLE across modal presentation. The window
        // width shrinks during the form-sheet card-stack animation, which used to
        // shrink the balance whenever a sheet opened.
        fitWidth={Dimensions.get('screen').width - theme.spacing.screen * 2}
        letterSpacing={-1.3}
        symbolScale={0.42}
        fractionColor={theme.colors.faint}
        masked={masked}
      />
      {footer}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { gap: 6, paddingTop: 2, paddingBottom: theme.spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
