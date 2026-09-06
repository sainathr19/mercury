import { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { UnistylesRuntime } from 'react-native-unistyles';

/** A 2px shimmer bar with a bright sweep moving left→right on repeat — shown
 *  during pull-to-refresh, ported from the iOS DashLoadingBar. */
export function DashLoadingBar() {
  const { width } = useWindowDimensions();
  const theme = UnistylesRuntime.getTheme();
  const phase = useSharedValue(-1);

  useEffect(() => {
    phase.value = -1;
    phase.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
  }, [phase]);

  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (phase.value - 0.5) * width }] }));
  const c = theme.colors.text;

  return (
    <View style={{ height: 2, width: '100%', overflow: 'hidden' }} pointerEvents="none">
      <Animated.View style={[{ width: '100%', height: 2 }, sweep]}>
        <LinearGradient
          colors={['transparent', c + '33', c + 'E6', c + '33', 'transparent']}
          locations={[0, 0.35, 0.5, 0.65, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}
