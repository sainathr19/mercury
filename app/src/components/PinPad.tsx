import { View, Pressable } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, Text } from '../ui';

/**
 * Numeric PIN entry: a row of filled/empty dots above a 3×4 keypad. Controlled
 * via `value` / `onChange`; fires `onComplete` when `length` digits are entered.
 */
export function PinPad({
  value,
  onChange,
  length = 6,
  onComplete,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  onComplete?: (pin: string) => void;
}) {
  const theme = UnistylesRuntime.getTheme();

  function press(digit: string) {
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  }

  function backspace() {
    if (value.length) onChange(value.slice(0, -1));
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < value.length ? styles.dotFilled : styles.dotEmpty]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {keys.map((k, i) =>
          k === '' ? (
            <View key={`sp-${i}`} style={styles.key} />
          ) : k === 'back' ? (
            <Pressable key="back" style={styles.key} onPress={backspace} hitSlop={6}>
              <Icon name="backspace" size={24} color={theme.colors.text} />
            </Pressable>
          ) : (
            <Pressable key={k} style={styles.key} onPress={() => press(k)} hitSlop={6}>
              <Text variant="headlineMedium">{k}</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

const DOT = 12;
const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.xl, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: theme.spacing.md, height: DOT },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotFilled: { backgroundColor: theme.colors.text },
  dotEmpty: { borderWidth: 1.5, borderColor: theme.colors.faint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 280, rowGap: theme.spacing.md },
  key: { width: '33.33%', height: 64, alignItems: 'center', justifyContent: 'center' },
}));
