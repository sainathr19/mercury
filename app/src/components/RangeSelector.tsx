import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale } from '../ui/PressableScale';
import { Text } from '../ui/Text';
import { UnistylesRuntime } from 'react-native-unistyles';

export interface RangeSelectorProps {
  ranges: string[];
  selected: string;
  onSelect: (r: string) => void;
}

/** Functional placeholder — a row of selectable range pills (1H/1D/1W/…). */
export function RangeSelector({ ranges, selected, onSelect }: RangeSelectorProps) {
  return (
    <View style={styles.row}>
      {ranges.map((r) => {
        const active = r === selected;
        return (
          <PressableScale key={r} onPress={() => onSelect(r)} style={styles.pill(active)}>
            <Text
              variant="captionSemibold"
              color={active ? UnistylesRuntime.getTheme().colors.primaryLabel : UnistylesRuntime.getTheme().colors.muted}
            >
              {r}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', gap: theme.spacing.xs },
  pill: (active: boolean) => ({
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: active ? theme.colors.primary : 'transparent',
  }),
}));
