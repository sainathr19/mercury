import { useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet as RNStyleSheet, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';

/**
 * Custom bottom sheet: blurred backdrop, slides up from the bottom, and can be
 * swiped down to dismiss. A lighter, nicer alternative to a system modal.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = UnistylesRuntime.getTheme();
  const dark = UnistylesRuntime.themeName === 'dark';

  const translateY = useSharedValue(H);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
      backdrop.value = withTiming(1, { duration: 260 });
    }
  }, [visible, H]);

  function close() {
    backdrop.value = withTiming(0, { duration: 220 });
    translateY.value = withTiming(H, { duration: 260, easing: Easing.in(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onClose)();
    });
  }

  const pan = Gesture.Pan()
    .onChange((e) => {
      translateY.value = Math.max(0, translateY.value + e.changeY);
    })
    .onEnd((e) => {
      if (translateY.value > 110 || e.velocityY > 800) {
        backdrop.value = withTiming(0, { duration: 200 });
        translateY.value = withTiming(H, { duration: 240, easing: Easing.in(Easing.cubic) }, (fin) => {
          if (fin) runOnJS(onClose)();
        });
      } else {
        translateY.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[RNStyleSheet.absoluteFill, backdropStyle]}>
        <BlurView intensity={24} tint={dark ? 'dark' : 'light'} style={RNStyleSheet.absoluteFill} />
        <Pressable style={[RNStyleSheet.absoluteFill, styles.dim]} onPress={close} />
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.anchor}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, sheetStyle]}>
            <View style={styles.grabber} />
            {children}
          </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  dim: { backgroundColor: 'rgba(0,0,0,0.12)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.appBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.faint,
    marginBottom: theme.spacing.md,
  },
}));
