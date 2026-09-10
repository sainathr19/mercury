import { useEffect, useState } from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, PressableScale } from '../ui';
import { fontFamily } from '../theme/fonts';
import { useSettings } from '../stores/settingsStore';
import { useSession } from '../stores/session';
import { useAuth } from '../stores/authStore';

/**
 * Full-screen lock screen, for the two ways a wallet can be shut.
 *
 *  • AUTO-LOCK — the inactivity interval re-locked an already-open wallet.
 *    Face ID reopens it; the wallet never left memory.
 *  • FAILED OPEN — `bootstrap` found a wallet on disk but could not open it
 *    (the prompt was cancelled, biometry is locked out after failed attempts,
 *    the keychain was not readable yet after a reboot). Session status is
 *    'locked'.
 *
 * The second case used to be handled by the root layout, which signed the user
 * out and sent them to onboarding the instant status became 'locked'. That
 * traded a retry loop for something worse: cancelling one Face ID prompt put
 * "create or import a wallet" on screen, which to the person holding the phone
 * reads as their wallet being GONE. It never was — nothing deletes the keystore
 * — but nothing on that screen said so. So the failed case gets a lock screen
 * too, one that says the wallet is still there and asks before giving up.
 *
 * Presented through a native Modal so it sits ABOVE everything — including any
 * sheet/modal that was open when the app locked — instead of behind it.
 */
export function LockScreen() {
  const theme = UnistylesRuntime.getTheme();
  const autoLocked = useSettings((s) => s.isLocked);
  const autoUnlock = useSettings((s) => s.unlock);
  const failedOpen = useSession((s) => s.status === 'locked');
  const [working, setWorking] = useState(false);

  const visible = autoLocked || failedOpen;

  useEffect(() => {
    // Auto-lock prompts on sight: the wallet is already open and a prompt is
    // the only thing in the way.
    //
    // A failed open deliberately does NOT. Bootstrap has just prompted and been
    // refused, so prompting again on sight is exactly how the dead-end loop
    // this screen was blamed for gets built. The next attempt is the user's.
    if (autoLocked) autoUnlock();
  }, [autoLocked, autoUnlock]);

  async function unlock() {
    if (autoLocked) return autoUnlock();
    setWorking(true);
    try {
      await useSession.getState().unlock();
    } finally {
      setWorking(false);
    }
  }

  /** The escape hatch, now a choice rather than something done TO the user. */
  async function startOver() {
    await useAuth.getState().signOut().catch(() => {});
    useSession.setState({ status: 'onboarding', wallet: null, addresses: null, error: null });
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <Icon name="lock" size={28} color={theme.colors.text} />
          <RNText style={styles.heading}>Mercury is locked.</RNText>
          <RNText style={styles.subtitle}>
            {failedOpen && !autoLocked
              ? 'Your wallet is still on this device. Unlock to open it.'
              : 'Unlock with Face ID to continue.'}
          </RNText>

          <PressableScale style={styles.button} onPress={unlock}>
            <RNText style={styles.label}>{working ? 'Unlocking…' : 'Unlock with Face ID'}</RNText>
          </PressableScale>

          {/* Only for a failed open — an auto-lock has a wallet open in memory
              and nothing to recover from. */}
          {failedOpen && !autoLocked && (
            <Pressable hitSlop={12} style={styles.secondary} onPress={startOver}>
              <RNText style={styles.secondaryLabel}>Start over with your recovery phrase</RNText>
            </Pressable>
          )}
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
    fontFamily: fontFamily.semibold,
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
  label: { fontFamily: fontFamily.medium, fontSize: 16, color: theme.colors.primaryLabel },
  // Low emphasis on purpose: it is the last resort, not the way out.
  secondary: { marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm },
  secondaryLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    letterSpacing: -0.2,
    color: theme.colors.muted,
    textAlign: 'center',
  },
}));
