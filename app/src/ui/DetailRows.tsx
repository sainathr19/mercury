// Label -> value rows joined by a dotted leader.
//
// Every sheet that summarises a payment (send confirm, transaction detail,
// gateway send) was drawing its own label/value row with its own spacing. The
// references all use the same dotted-leader treatment, so it lives here once.
//
// The leader is a bordered View rather than a row of "." characters: a text
// leader cannot be made to end flush against the value, and its dot rhythm
// shifts with the font.
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from './Text';

export interface DetailRow {
  label: string;
  /** Pre-formatted. This component never formats money — callers own that. */
  value: string;
  /**
   * A second value shown after the first, in the primary text colour while the
   * first drops to muted — the "0.5 ETH  $1,240.00" pairing the transaction and
   * confirm sheets both use. Without it a caller has to concatenate, and the
   * crypto figure and its fiat equivalent end up indistinguishable.
   */
  secondary?: string;
  /** Renders the value in the app's monospace face, for hashes and addresses. */
  mono?: boolean;
  /** Emphasises the row as the total. */
  strong?: boolean;
  /** Overrides the value colour (a success green, a danger red). */
  valueColor?: string;
}

export function DetailRows({ rows }: { rows: DetailRow[] }) {
  return (
    <View style={styles.wrap}>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text variant={r.strong ? 'body' : 'bodyMedium'} style={styles.label}>
            {r.label}
          </Text>
          <View style={styles.leader} />
          {/* `Text` applies `style` after its own `color`, so an override has to
              come through the style to win. */}
          <Text
            variant={r.mono ? 'mono' : r.strong ? 'body' : 'bodyMedium'}
            style={[
              styles.value,
              r.secondary ? styles.valueMuted : null,
              r.valueColor ? { color: r.valueColor } : null,
            ]}
            numberOfLines={1}
          >
            {r.value}
            {!!r.secondary && <Text variant="bodyMedium" style={styles.secondary}>{`  ${r.secondary}`}</Text>}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 9, gap: 8 },
  label: { color: theme.colors.muted, flexShrink: 0 },
  // Takes the slack between label and value, so the dots always meet both.
  leader: {
    flex: 1,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderBottomColor: theme.colors.separator,
    // Sits on the text baseline rather than the row's vertical centre.
    transform: [{ translateY: -3 }],
  },
  value: { flexShrink: 1, maxWidth: '68%', textAlign: 'right' },
  valueMuted: { color: theme.colors.muted },
  secondary: { color: theme.colors.text },
}));
