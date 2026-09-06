import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useToast } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { fontFamily } from '../../src/theme/fonts';

const RESEND_SECONDS = 60;

/**
 * "Recovery Key" — adds a recovery email after social sign-in. Two steps:
 *   1. email entry → "Verify Email"
 *   2. 6-digit code entry (with resend countdown) → continue to PIN setup.
 *
 * email/code are UI-stubbed for now (no backend). With Apple sign-in the email
 * is usually prefilled. Wire to /v1/auth/email/start + /verify when auth lands.
 */
export default function RecoveryKey() {
  const router = useRouter();
  const navigation = useNavigation();
  const create = useSession((s) => s.create);
  const clearMnemonic = useSession((s) => s.clearMnemonic);
  const show = useToast((s) => s.show);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resend, setResend] = useState(0);
  const emailInput = useRef<TextInput>(null);
  const codeInput = useRef<TextInput>(null);

  // Stub: accept anything (even random) so testing isn't blocked.
  const emailValid = email.trim().length > 0;

  // Focus the email field once the push transition finishes (so the keyboard
  // slides up cleanly from the bottom). Fallback timer in case the event is
  // missed. Focus once.
  useEffect(() => {
    let done = false;
    const focus = () => {
      if (done || step !== 'email') return;
      done = true;
      emailInput.current?.focus();
    };
    const sub = (navigation as any).addListener?.('transitionEnd', (e: any) => {
      if (!e?.data?.closing) focus();
    });
    const t = setTimeout(focus, 500);
    return () => {
      sub?.();
      clearTimeout(t);
    };
  }, [navigation, step]);

  useEffect(() => {
    if (step !== 'code') return;
    setResend(RESEND_SECONDS);
    const t = setInterval(() => setResend((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step]);

  // Once the 6-digit code is entered (typed or iOS autofill), create a fresh
  // wallet and go straight to the dashboard — no PIN step. A new wallet is made
  // each time (sign-out wipes the previous one).
  useEffect(() => {
    if (code.length !== 6) return;
    Keyboard.dismiss();
    (async () => {
      try {
        await create();
        clearMnemonic(); // skip the recovery-phrase backup screen
        router.replace('/(app)/home');
      } catch {
        show('Could not set up your wallet. Try again.', 'error');
        setCode('');
      }
    })();
  }, [code, create, clearMnemonic, router, show]);

  function verifyEmail() {
    if (!emailValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('code');
  }

  function onBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 'code') {
      setStep('email');
      setCode('');
    } else {
      router.back();
    }
  }

  function onResend() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResend(RESEND_SECONDS);
    // TODO: await api.emailStart(email)
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor="#0B0D10" contentFit="contain" />
        </Pressable>

        <RNText style={styles.title}>Recovery Key</RNText>

        {step === 'email' ? (
          <>
            <RNText style={styles.subtitle} numberOfLines={1}>
              Add an email to regain access if you lose your phone.
            </RNText>

            <TextInput
              ref={emailInput}
              style={styles.field}
              placeholder="Email address"
              placeholderTextColor="#72717A"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={verifyEmail}
            />

            {/* Spacer pushes the CTA to the bottom; it rides above the keyboard. */}
            <View style={styles.spacer} />
            <Pressable style={[styles.cta, emailValid && styles.ctaActive]} disabled={!emailValid} onPress={verifyEmail}>
              <RNText style={styles.ctaLabel}>Verify Email</RNText>
            </Pressable>
          </>
        ) : (
          <>
            <RNText style={styles.subtitle}>
              Enter the 6-digit verification code sent to <RNText style={styles.subtitleStrong}>{email.trim()}</RNText>
            </RNText>

            <Pressable style={styles.otpRow} onPress={() => codeInput.current?.focus()}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={[styles.otpBox, i === code.length && styles.otpBoxActive]}>
                  <RNText style={styles.otpDigit}>{code[i] ?? ''}</RNText>
                </View>
              ))}
            </Pressable>

            <TextInput
              ref={codeInput}
              style={styles.hiddenInput}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
            />

            <Pressable disabled={resend > 0} onPress={onResend} hitSlop={8}>
              <RNText style={styles.resend}>{resend > 0 ? `Resend code (${resend})` : 'Resend code'}</RNText>
            </Pressable>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#F2F3F2', paddingHorizontal: theme.spacing.screen },
  fill: { flex: 1 },
  spacer: { flex: 1 },
  back: { marginTop: theme.spacing.md, width: 30, height: 30 },
  backIcon: { width: 30, height: 30 },
  // Recovery Key — 24px, ABC Bold.
  title: { marginTop: theme.spacing.lg, fontFamily: fontFamily.bold, fontSize: 24, letterSpacing: -0.5, color: '#0B0D10' },
  // 12px below the title; one line; 15px, -2% tracking, Medium.
  subtitle: { marginTop: 12, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: '#8A8F98' },
  subtitleStrong: { fontFamily: fontFamily.bold, color: '#0B0D10' },
  // 24px above the input; 12px vertical / 18px left padding; 15px black text.
  field: {
    marginTop: 24,
    backgroundColor: '#EBEBEB',
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingLeft: 18,
    paddingRight: 14,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.3,
    color: '#0B0D10',
  },
  // Verify Email — fixed 48px height; 15px, -2% label.
  // Disabled: #060606 @ 50%. Active: #060606. Label: off-white #F5F5F5.
  cta: {
    marginBottom: theme.spacing.md,
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 6, 6, 0.5)',
  },
  ctaActive: { backgroundColor: '#060606' },
  ctaLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#F5F5F5' },
  otpRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  otpBox: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 64,
    borderRadius: theme.radius.md,
    backgroundColor: '#EBEBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxActive: { borderWidth: 2, borderColor: '#9AA0A6', backgroundColor: 'transparent' },
  otpDigit: { fontFamily: fontFamily.bold, fontSize: 24, color: '#0B0D10' },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  resend: { marginTop: theme.spacing.lg, fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: '#8A8F98' },
}));
