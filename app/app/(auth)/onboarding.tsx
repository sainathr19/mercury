import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Text as RNText, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { PressableScale, useToast } from '../../src/ui';
import { fontFamily } from '../../src/theme/fonts';
import { signInWithApple, signInWithGoogle, isGoogleConfigured } from '../../src/bridge/providerSignIn';
import { useAuth } from '../../src/stores/authStore';
import { useBackup } from '../../src/stores/backupStore';
import { useSession } from '../../src/stores/session';
import type { Provider } from '../../src/bridge/auth';
import { posthog } from '../../src/lib/posthog';

/** Welcome screen — create a new wallet or import an existing one.
 *  Mirrors the standard-ios marketing onboarding. */
export default function Onboarding() {
  const router = useRouter();
  const show = useToast((s) => s.show);
  const signIn = useAuth((s) => s.signIn);
  const [busy, setBusy] = useState<Provider | null>(null);

  // Sign-in-first onboarding: verify identity at the hub, then continue. If a
  // wallet already exists on this device (returning user re-authenticating), the
  // root gate routes to the app/unlock; only a brand-new user proceeds to wallet
  // creation. (Address registration happens after the wallet is created.)
  async function signInWith(provider: Provider) {
    if (busy) return;
    setBusy(provider);
    try {
      const tok = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      if (!tok) return; // user cancelled
      await signIn(provider, tok.idToken, { nonce: tok.nonce });

      const hubUser = useAuth.getState().user;
      if (hubUser?.id) {
        posthog.identify(hubUser.id, {
          $set: { provider },
        });
      }
      posthog.capture('user_signed_in', { provider });

      // No local wallet yet: if this account has an iCloud backup (new device /
      // reinstall), offer restore; otherwise create a fresh on-device wallet and
      // go straight in. The seed is saved to the keychain (revealable later);
      // backup stays an opt-in step.
      if (useSession.getState().status === 'onboarding') {
        await useBackup.getState().hydrate();
        if (useBackup.getState().exists) {
          posthog.capture('wallet_restored', { provider });
          router.push('/(auth)/restore');
        } else {
          // First-time user: DON'T create the wallet yet. Go to the Face ID step
          // first so the iOS "Allow Face ID" consent appears there — not here on
          // the loading page while the wallet's Secure Enclave key is set up. The
          // wallet is created on that screen right after Face ID is enabled (see
          // enable-faceid). While status is still `onboarding`, the root gate
          // leaves us on this (auth) screen (it only redirects when NOT in auth).
          posthog.capture('signup_faceid_step', { provider });
          router.replace('/(auth)/enable-faceid');
        }
      }
    } catch (e) {
      // User cancellations are silent; any real failure (e.g. the hub is
      // unreachable) surfaces as the top red exclamation pill with a friendly
      // message rather than a raw error string.
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel/i.test(msg)) show('Unable to sign in. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  }

  function onGoogle() {
    if (!isGoogleConfigured()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      show('Google sign-in isn’t set up yet.', 'info');
      return;
    }
    signInWith('google');
  }

  return (
    <View style={styles.root}>

      {/* Bottom blur artwork — full width, pinned to the bottom. */}
      <Image source={require('../../assets/BottomBlur.png')} style={styles.bottomBlur} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <RNText style={styles.heading}>Pay privately.{'\n'}With anything.</RNText>
          <RNText style={styles.subtitle}>Get paid, pay anywhere, and keep{'\n'}your money private.</RNText>
        </View>

        <View style={styles.actions}>
          {/* One provider per platform: Apple on iOS, Google on Android. */}
          {Platform.OS === 'ios' ? (
            <PressableScale style={[styles.button, styles.primary]} disabled={!!busy} onPress={() => signInWith('apple')}>
              {busy === 'apple' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <ExpoImage source={require('../../assets/icons/Apple.svg')} style={styles.icon} tintColor="#FFFFFF" contentFit="contain" />
                  <RNText style={styles.primaryLabel}>Continue with Apple</RNText>
                </>
              )}
            </PressableScale>
          ) : (
            <PressableScale style={[styles.button, styles.secondary]} haptic={false} disabled={!!busy} onPress={onGoogle}>
              {busy === 'google' ? (
                <ActivityIndicator color="#0B0D10" />
              ) : (
                <>
                  <ExpoImage source={require('../../assets/icons/Google.svg')} style={styles.icon} contentFit="contain" />
                  <RNText style={styles.secondaryLabel}>Continue with Google</RNText>
                </>
              )}
            </PressableScale>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  // BottomBlur.png — full width, pinned to the bottom (intrinsic 402×561).
  bottomBlur: { position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', aspectRatio: 402 / 561, resizeMode: 'cover' },
  safe: { flex: 1, justifyContent: 'space-between', paddingHorizontal: theme.spacing.screen },
  hero: { paddingTop: theme.spacing.xxl, gap: 12 },
  // "Pay privately. With anything." — Graphik Bold, 36px, -3% tracking.
  // (No Graphik *Wide* cut is bundled; drop Graphik-Wide-Bold.otf into
  //  assets/fonts + fonts.ts to use the wide version.)
  heading: {
    fontFamily: fontFamily.graphikBold,
    fontSize: 36,
    lineHeight: 36,
    letterSpacing: -1.08, // -3% of 36px
    color: '#0B0D10',
  },
  // Description — ABCDiatype Medium, 18px, -2% tracking.
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.36, // -2% of 18px
    color: '#8A8F98',
  },
  actions: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  button: {
    height: 48,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  icon: { width: 18, height: 18 },
  primary: { backgroundColor: '#0B0D10' },
  primaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, color: '#FFFFFF' },
  secondary: { backgroundColor: 'rgba(255,255,255,0.92)' },
  secondaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, color: '#0B0D10' },
}));
