import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useToast } from '../../src/ui';
import { useBackup } from '../../src/stores/backupStore';
import { fontFamily } from '../../src/theme/fonts';

const DESCRIPTION = 'Store a backup to iCloud to regain access if you lose your phone.';
const MIN_LENGTH = 8;

/**
 * Opt-in zero-knowledge cloud backup, mirroring the onboarding backup screen: a
 * minimal two-step flow (set password → confirm) that encrypts the seed in the
 * Rust core and stores the ciphertext in the user's own iCloud. We never see the
 * password or the seed. If a backup already exists, this becomes a one-tap
 * "Remove backup" instead.
 */
export default function CloudBackup() {
  const router = useRouter();
  const show = useToast((s) => s.show);
  const { enabled, exists, busy, hydrated, hydrate, enable } = useBackup();
  const [step, setStep] = useState<'set' | 'confirm'>('set');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const pwInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const backedUp = enabled || exists;

  // Focus the field for the active step — only once the status check is done and
  // we're actually showing the password form (not the loading/backed-up views).
  useEffect(() => {
    if (!hydrated || backedUp) return;
    const t = setTimeout(() => {
      (step === 'set' ? pwInput : confirmInput).current?.focus();
    }, step === 'set' ? 400 : 0);
    return () => clearTimeout(t);
  }, [step, backedUp, hydrated]);

  function onBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!backedUp && step === 'confirm') {
      setStep('set');
      setConfirm('');
    } else {
      router.back();
    }
  }

  // Password step → confirm step.
  function next() {
    if (pw.length < MIN_LENGTH) {
      show(`Use at least ${MIN_LENGTH} characters.`, 'error');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('confirm');
  }

  // Confirm step → kick off the backup and leave immediately. We DON'T await it
  // here: the encrypt + iCloud upload runs in the background while this screen
  // pops back to More, where the Cloud Backup row shows a spinner (useBackup.busy)
  // until it finishes and then updates itself. This way the user never sees this
  // screen flip from the password form to the backed-up view.
  function turnOn() {
    if (confirm !== pw) {
      show('Passwords don’t match.', 'error');
      return;
    }
    Keyboard.dismiss();
    enable(pw)
      .then(() => show('Cloud backup is on.', 'success'))
      .catch((e) => show(e instanceof Error ? e.message : 'Backup failed', 'error'));
    router.back();
  }

  const confirming = step === 'confirm';
  const canContinue = confirming ? confirm.length >= MIN_LENGTH && !busy : pw.length >= MIN_LENGTH;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor="#0B0D10" contentFit="contain" />
        </Pressable>

        {!hydrated ? (
          // Status unknown until the iCloud availability/exists check resolves —
          // show a spinner instead of flashing the password form then the
          // backed-up view.
          <View style={styles.loading}>
            <ActivityIndicator color="#8A8F98" />
          </View>
        ) : backedUp ? (
          // Once backed up it stays backed up — no remove option (mandatory backup).
          <View style={styles.heading}>
            <RNText style={styles.title}>Cloud Backup</RNText>
            <RNText style={styles.subtitle}>
              {enabled ? 'Your wallet is backed up to iCloud.' : 'An iCloud backup exists for this account.'}
            </RNText>
          </View>
        ) : (
          <>
            <View style={styles.heading}>
              <RNText style={styles.title}>{confirming ? 'Confirm Backup Key' : 'Backup Key'}</RNText>
              <RNText style={styles.subtitle}>{DESCRIPTION}</RNText>
            </View>

            {confirming ? (
              <TextInput
                ref={confirmInput}
                style={styles.field}
                placeholder="Password"
                placeholderTextColor="#72717A"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                returnKeyType="go"
                onSubmitEditing={turnOn}
              />
            ) : (
              <TextInput
                ref={pwInput}
                style={styles.field}
                placeholder="Password"
                placeholderTextColor="#72717A"
                value={pw}
                onChangeText={setPw}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={next}
              />
            )}

            {/* Spacer pushes the CTA to the bottom; it rides above the keyboard. */}
            <View style={styles.spacer} />
            <Pressable
              style={[styles.cta, (canContinue || busy) && styles.ctaActive]}
              disabled={!canContinue}
              onPress={confirming ? turnOn : next}
            >
              {busy ? (
                <ActivityIndicator color="#F5F5F5" />
              ) : (
                <RNText style={styles.ctaLabel}>{confirming ? 'Turn on Backup' : 'Continue'}</RNText>
              )}
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { marginTop: theme.spacing.md, width: 30, height: 30 },
  backIcon: { width: 30, height: 30 },
  // Title + description: 4px apart; 24px below the back button.
  heading: { marginTop: 24, gap: 4 },
  // "Backup Key" — 18px Bold, -2% tracking, dark.
  title: { fontFamily: fontFamily.bold, fontSize: 18, letterSpacing: -0.36, color: '#0B0D10' },
  // Description — 15px Medium, -2% tracking, mid grey.
  subtitle: { fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: '#8A8F98' },
  // Password field — search-input style, 12px vertical / 18px horizontal padding.
  field: {
    marginTop: 16,
    backgroundColor: '#EBEBEB',
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.3,
    color: '#0B0D10',
  },
  // CTA — fixed 48px pill pinned to the bottom. Disabled: #060606 @ 50%.
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
}));
