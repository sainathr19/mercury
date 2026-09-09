// Filter pill. Used for the activity filters, and anywhere a small set of
// mutually exclusive options needs to sit inline in a header row.
import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      hitSlop={4}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text variant="captionSemibold" style={selected ? styles.labelOn : styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'transparent',
  },
  chipOn: { backgroundColor: theme.colors.tile },
  label: { color: theme.colors.muted },
  labelOn: { color: theme.colors.text },
}));
