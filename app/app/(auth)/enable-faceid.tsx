import { useState } from 'react';
import { ActivityIndicator, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale, useToast } from '../../src/ui';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { enrollBiometrics } from '../../src/lib/biometrics';
import { useSettings } from '../../src/stores/settingsStore';
import { useBackup } from '../../src/stores/backupStore';
import { useSession } from '../../src/stores/session';
import { useWallets } from '../../src/stores/walletsStore';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

/** Onboarding step: enable Face ID / device biometrics for sending (mandatory —
 *  no skip). Enabling sets `biometricSend`, which gates the send-confirm prompt.
 *
 *  Params:
 *   - `next: 'home'` → restored wallet (already backed up) continues to the app.
 *   - default        → new wallet continues to the (optional) backup step. */
export default function EnableFaceId() {
  const router = useRouter();
  const show = useToast((s) => s.show);
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [busy, setBusy] = useState(false);
  const toHome = next === 'home';

  function goNext() {
    // Never ask to back up a wallet that's already backed up. `enabled` is set
    // by a successful restore, so a restored wallet skips the backup step; a
    // brand-new wallet (enabled === false) continues to it.
    const alreadyBackedUp = useBackup.getState().enabled;
    router.replace(toHome || alreadyBackedUp ? '/(app)/home' : '/(auth)/backup-prompt');
  }

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      // Mandatory: require a REAL Face ID prompt to succeed before enabling or
      // advancing. No bypass — the step isn't complete until biometrics pass.
      // This enroll is the FIRST biometric call, so the iOS "Allow Face ID"
      // consent appears HERE (on this screen), not earlier during signup.
      const res = await enrollBiometrics('Enable Face ID');
      if (!res.ok) {
        if (res.reason === 'unavailable') {
          show('Set up Face ID in your device settings, then try again.', 'error');
        }
        return; // cancelled/failed → stay on this step, flag stays off
      }
      useSettings.getState().setBiometricSend(true);
      posthog.capture('faceid_enabled');
      // New user: create the wallet NOW — after the Face ID consent — so the SE
      // key + wrapped seed are set up post-consent (a restored wallet, `toHome`,
      // already exists, so skip). `create()` sets the pending mnemonic, which
      // keeps the root gate on this setup flow until backup-prompt clears it.
      if (!toHome && useSession.getState().status === 'onboarding') {
        try {
          await useSession.getState().create();
          // Register the primary wallet in the registry (mirrors the import flow)
          // so it shows under Wallets & Accounts without needing a relaunch.
          await useWallets.getState().ensurePrimary();
          posthog.capture('wallet_created');
        } catch {
          show('Couldn’t set up your wallet. Please try again.', 'error');
          return; // stay on this step; Face ID is enrolled, retry re-creates
        }
      }
      goNext();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* The restored-wallet flow is a single step, so no 3-step bar there. */}
      {!toHome && <OnboardingProgress step={1} />}

      <View style={styles.heading}>
        <RNText style={styles.title}>Enable Face ID</RNText>
        <RNText style={styles.subtitle}>
          Add an extra layer of security by requiring Face ID to send transactions.
        </RNText>
      </View>

      <View style={styles.illustration}>
        <ExpoImage source={require('../../assets/FaceIdBanner.png')} style={styles.banner} contentFit="contain" />
      </View>

      <View style={styles.spacer} />

      <PressableScale style={styles.cta} disabled={busy} onPress={enable}>
        {busy ? <ActivityIndicator color="#F5F5F5" /> : <RNText style={styles.ctaLabel}>Enable Face ID</RNText>}
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#F5F5F5', paddingHorizontal: theme.spacing.screen },
  heading: { marginTop: 32, gap: 4 },
  title: { fontFamily: fontFamily.bold, fontSize: 18, letterSpacing: -0.36, color: '#0B0D10' },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 20, letterSpacing: -0.3, color: '#8A8F98' },

  // Center-aligned Face ID banner (intrinsic 284×388), nudged 50% of its own
  // height downward per design.
  illustration: { flexGrow: 0, marginTop: 40, alignItems: 'center', justifyContent: 'center' },
  banner: { width: 260, aspectRatio: 284 / 388, transform: [{ translateY: '15%' }] },

  spacer: { flex: 1 },
  cta: {
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#060606',
    marginBottom: theme.spacing.md,
  },
  ctaLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#F5F5F5' },
}));
