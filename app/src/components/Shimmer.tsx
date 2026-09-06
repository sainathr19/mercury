import { useEffect } from 'react';
import { StyleSheet as RNStyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';

export interface ShimmerProps {
  width: number | `${number}%`;
  height: number;
  radius?: number;
}

/** Skeleton block with a bright highlight sweeping across it — used in place of
 *  "Loading…" text/values while data loads. */
export function Shimmer({ width, height, radius = 8 }: ShimmerProps) {
  const phase = useSharedValue(-1);

  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [phase]);

  const distance = typeof width === 'number' ? width : 180;
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: phase.value * distance }] }));
  const highlight = UnistylesRuntime.getTheme().colors.muted + '38';

  return (
    <View style={[styles.block, { width, height, borderRadius: radius, overflow: 'hidden' }]}>
      <Animated.View style={[RNStyleSheet.absoluteFill, sweep]}>
        <LinearGradient
          colors={['transparent', highlight, 'transparent']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { backgroundColor: theme.colors.cardBackground },
}));
