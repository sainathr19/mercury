import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PressableScale } from '../ui/PressableScale';
import { Text } from '../ui/Text';
import { RemoteTokenIcon } from './RemoteTokenIcon';

export interface AssetRowProps {
  name: string;
  symbol: string;
  balance: string;
  /** Fiat value or unit price line. */
  price?: string;
  /** Chain/token tint for the fallback icon chip. */
  color: string;
  iconUri?: string;
  onPress?: () => void;
}

/** A single portfolio asset row: icon, name/symbol, balance/value. Full Phase-1
 *  version adds 24h trend + tap affordance; the contract is locked here. */
export function AssetRow({ name, symbol, balance, price, color, iconUri, onPress }: AssetRowProps) {
  return (
    <PressableScale onPress={onPress} style={styles.row}>
      <RemoteTokenIcon uri={iconUri} fallbackColor={color} symbol={symbol} size={38} />
      <View style={styles.mid}>
        <Text variant="headlineSmall">{name}</Text>
        <Text variant="subhead" color={mutedColor()}>
          {symbol}
        </Text>
      </View>
      <View style={styles.end}>
        <Text variant="headlineSmall">{balance}</Text>
        {price ? (
          <Text variant="subhead" color={mutedColor()}>
            {price}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const mutedColor = () => UnistylesRuntime.getTheme().colors.muted;

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  mid: { flex: 1, gap: 2 },
  end: { alignItems: 'flex-end', gap: 2 },
}));
