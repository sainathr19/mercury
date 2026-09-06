import { useEffect } from 'react';
import { Modal, Text as RNText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale } from '../ui';
import { fontFamily } from '../theme/fonts';
import { useSettings } from '../stores/settingsStore';

/**
 * Full-screen AUTO-LOCK screen: shown only after the inactivity interval re-locks
 * an already-open wallet. Face ID unlocks it (the wallet stays open in memory).
 *
 * NOTE: a FAILED wallet open at launch is NOT handled here anymore — instead of a
 * dead-end "Unlock with Face ID" retry loop, the root layout logs the user out
 * and returns them to onboarding/sign-in (see app/_layout.tsx).
 *
 * Presented through a native Modal so it sits ABOVE everything — including any
 * sheet/modal that was open when the app locked — instead of behind it.
 */
export function LockScreen() {
  const theme = UnistylesRuntime.getTheme();
  const autoLocked = useSettings((s) => s.isLocked);
  const autoUnlock = useSettings((s) => s.unlock);

  const visible = autoLocked;
  const unlock = autoUnlock;

  useEffect(() => {
    // Auto-lock prompts for Face ID immediately.
    if (autoLocked) autoUnlock();
  }, [autoLocked, autoUnlock]);

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <Icon name="lock" size={28} color={theme.colors.text} />
          <RNText style={styles.heading}>Mercury is locked.</RNText>
          <RNText style={styles.subtitle}>Unlock with Face ID to continue.</RNText>

          <PressableScale style={styles.button} onPress={unlock}>
            <RNText style={styles.label}>Unlock with Face ID</RNText>
          </PressableScale>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Same background as the app (no gradient).
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.screen,
  },
  heading: {
    fontFamily: fontFamily.graphikBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: theme.colors.text,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: theme.colors.muted,
    textAlign: 'center',
  },
  button: {
    height: 56,
    minWidth: 200,
    paddingHorizontal: theme.spacing.xxl,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    marginTop: theme.spacing.lg,
  },
  label: { fontFamily: fontFamily.bold, fontSize: 16, color: theme.colors.primaryLabel },
}));
