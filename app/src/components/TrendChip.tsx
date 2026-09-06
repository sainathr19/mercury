import { View } from 'react-native';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Text } from '../ui/Text';

export interface TrendChipProps {
  changePercent: number;
  /** Show a +/- sign prefix. Default true. */
  signed?: boolean;
}

/** Colored percentage chip — green up / red down (mirrors DashboardView). */
export function TrendChip({ changePercent, signed = true }: TrendChipProps) {
  const positive = changePercent >= 0;
  const color = positive ? UnistylesRuntime.getTheme().colors.success : UnistylesRuntime.getTheme().colors.danger;
  const sign = signed ? (positive ? '+' : '') : '';
  return (
    <View style={styles.chip}>
      <Text variant="captionSemibold" color={color}>
        {sign}
        {changePercent.toFixed(2)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  chip: { flexDirection: 'row', alignItems: 'center' },
}));
