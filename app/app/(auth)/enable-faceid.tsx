import { useEffect, useState } from 'react';
import { ActivityIndicator, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale, useToast } from '../../src/ui';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { enrollBiometrics } from '../../src/lib/biometrics';
import { useSettings } from '../../src/stores/settingsStore';
import { useSession } from '../../src/stores/session';
import { useWallets } from '../../src/stores/walletsStore';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

// TEMPORARY: skip the Face ID step during onboarding. See the block inside the
// component for what this does and does not affect, and how to revert.
const BYPASS_FACE_ID = true;

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
    // A restored wallet (`toHome`) already has its phrase written down, so it
    // goes straight in. A brand-new wallet is sent to the recovery-phrase
    // screen: the words are now the ONLY way to recover it, so setup cannot
    // finish without showing them.
    router.replace(toHome ? '/(app)/(tabs)/wallet' : '/(auth)/backup');
  }

  /** Create the wallet for a new user, then advance.
   *
   *  Split out of `enable()` because this step does more than turn on
   *  biometrics: the Secure-Enclave key and wrapped seed are set up HERE, so
   *  anything that skips this screen must still run this, or the user lands on
   *  the next screen with no wallet. */
  async function createAndAdvance(): Promise<void> {
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
        return; // stay on this step; retry re-creates
      }
    }
    goNext();
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
      await createAndAdvance();
    } finally {
      setBusy(false);
    }
  }

  // ── TEMPORARY: Face ID onboarding bypass ──────────────────────────────
  // Advance past this step without a biometric prompt, so a device with no
  // enrolled Face ID (a fresh simulator) can get through onboarding. Wallet
  // creation still runs — only the enroll is skipped.
  //
  // `biometricSend` deliberately stays false: this file's rule is that the flag
  // is never set without a real successful auth, and a bypass is not one.
  //
  // Nothing else is weakened. Send confirmation, the recovery-phrase reveal and
  // the app lock all still call requireAuth, and the phrase itself is still held
  // behind the keychain's own authentication, which no JS flag can turn off.
  //
  // TO REVERT: set BYPASS_FACE_ID to false, then delete this block.
  useEffect(() => {
    if (!BYPASS_FACE_ID) return;
    setBusy(true);
    createAndAdvance().finally(() => setBusy(false));
    // Mount-only: goNext() calls router.replace, so this cannot re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ── end TEMPORARY ─────────────────────────────────────────

  // While bypassing, this screen is a pass-through: its effect navigates on the
  // first commit. Painting the real UI first made it flash up and disappear, so
  // render a bare ground-coloured screen instead — the user should never see a
  // step they are not being asked to complete.
  if (BYPASS_FACE_ID) return <View style={styles.root} />;

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
        {busy ? <ActivityIndicator color="#ECEEE9" /> : <RNText style={styles.ctaLabel}>Enable Face ID</RNText>}
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#ECEEE9', paddingHorizontal: theme.spacing.screen },
  heading: { marginTop: 28, gap: 6 },
  // Same type system as the rest of onboarding: Semibold title at 26, Medium
  // supporting copy. Bold at both sizes was what made these screens shout.
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: '#0B0D10' },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: '#6B7079',
  },

  // Center-aligned Face ID banner (intrinsic 284×388), nudged 50% of its own
  // height downward per design.
  illustration: { flexGrow: 0, marginTop: 40, alignItems: 'center', justifyContent: 'center' },
  banner: { width: 260, aspectRatio: 284 / 388, transform: [{ translateY: '15%' }] },

  spacer: { flex: 1 },
  cta: {
    height: 54,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D10',
    marginBottom: theme.spacing.md,
  },
  ctaLabel: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.32, color: '#ECEEE9' },
}));
