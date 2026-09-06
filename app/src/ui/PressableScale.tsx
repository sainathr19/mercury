import type React from 'react';
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  /** Scale at the bottom of the press. Default 0.96. */
  activeScale?: number;
  /** Fire a light haptic on press. Default true (set false to opt out / use a custom one). */
  haptic?: boolean;
}

export function PressableScale({
  children,
  style,
  activeScale = 0.96,
  disabled,
  haptic = true,
  onPress,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) scale.value = withSpring(activeScale, { damping: 18, stiffness: 320 });
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 18, stiffness: 320 });
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (!disabled && haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[animated, style as ViewStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
