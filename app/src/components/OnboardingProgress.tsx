import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** Thin black progress line for the sign-up setup flow (Face ID → Backup). The
 *  filled portion grows as `step` advances through `total` steps. */
export function OnboardingProgress({ step, total = 3 }: { step: number; total?: number }) {
  const pct = Math.max(0, Math.min(1, step / total)) * 100;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#0B0D10',
  },
}));
