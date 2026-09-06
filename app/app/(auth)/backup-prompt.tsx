import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useToast } from '../../src/ui';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { useBackup } from '../../src/stores/backupStore';
import { useSession } from '../../src/stores/session';
import { fontFamily } from '../../src/theme/fonts';
import { posthog } from '../../src/lib/posthog';

const DESCRIPTION = 'Store a backup to iCloud to regain access if you lose your phone.';
const MIN_LENGTH = 8;

/**
 * Onboarding step 2 (OPTIONAL): set a password to encrypt a zero-knowledge
 * iCloud backup of the wallet. "Remind me later" enters the app without backing
 * up (the user can back up anytime from More → Backups). "Back up now" encrypts
 * in the Rust core and stores the ciphertext in iCloud, then enters the app.
 */
export default function BackupPrompt() {
  const router = useRouter();
  const show = useToast((s) => s.show);
  const { hydrate, enable, busy } = useBackup();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const pwInput = useRef<TextInput>(null);

  useEffect(() => {
    hydrate();
    const t = setTimeout(() => pwInput.current?.focus(), 400);
    return () => clearTimeout(t);
  }, [hydrate]);

  const mismatch = confirm.length > 0 && confirm !== pw;
  const canBackup = pw.length >= MIN_LENGTH && confirm === pw && !busy;

  // Optional: skip backup and enter the app. Clearing the pending mnemonic lets
  // the root gate route to home. Backup stays available under More → Backups.
  function remindLater() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    posthog.capture('backup_skipped');
    useSession.getState().clearMnemonic();
    router.replace('/(app)/home');
  }

  async function backupNow() {
    if (pw.length < MIN_LENGTH) {
      show(`Use at least ${MIN_LENGTH} characters.`, 'error');
      return;
    }
    if (confirm !== pw) return; // inline error already shown
    Keyboard.dismiss();
    try {
      await enable(pw);
      posthog.capture('backup_completed');
      show('Cloud backup is on.', 'success');
      useSession.getState().clearMnemonic();
      router.replace('/(app)/home');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Backup failed', 'error');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <OnboardingProgress step={2} />

        <View style={styles.heading}>
          <RNText style={styles.title}>Backup your wallet</RNText>
          <RNText style={styles.subtitle}>{DESCRIPTION}</RNText>
        </View>

        <View style={styles.field}>
          <TextInput
            ref={pwInput}
            style={styles.input}
            placeholder="Enter a password"
            placeholderTextColor="#72717A"
            value={pw}
            onChangeText={setPw}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
          <EyeToggle on={showPw} onPress={() => setShowPw((v) => !v)} />
        </View>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            placeholderTextColor="#72717A"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={backupNow}
          />
          <EyeToggle on={showConfirm} onPress={() => setShowConfirm((v) => !v)} />
        </View>

        {mismatch && <RNText style={styles.error}>Passwords don’t match.</RNText>}

        <View style={styles.spacer} />

        <Pressable style={styles.secondary} onPress={remindLater} disabled={busy}>
          <RNText style={styles.secondaryLabel}>Remind me later</RNText>
        </Pressable>
        <Pressable style={[styles.cta, canBackup && styles.ctaActive]} disabled={!canBackup} onPress={backupNow}>
          {busy ? <ActivityIndicator color="#F5F5F5" /> : <RNText style={styles.ctaLabel}>Back up now</RNText>}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EyeToggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable hitSlop={12} onPress={onPress} style={styles.eye}>
      <ExpoImage
        source={require('../../assets/icons/EyeIcon.svg')}
        style={[styles.eyeIcon, { opacity: on ? 1 : 0.45 }]}
        tintColor="#0B0D10"
        contentFit="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#F5F5F5', paddingHorizontal: theme.spacing.screen },
  fill: { flex: 1 },
  spacer: { flex: 1 },
  heading: { marginTop: 32, gap: 4 },
  title: { fontFamily: fontFamily.bold, fontSize: 18, letterSpacing: -0.36, color: '#0B0D10' },
  subtitle: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 20, letterSpacing: -0.3, color: '#8A8F98' },
  field: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBEBEB',
    borderRadius: theme.radius.md,
    paddingHorizontal: 18,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.3,
    color: '#0B0D10',
  },
  eye: { paddingLeft: 12 },
  eyeIcon: { width: 22, height: 22 },
  error: { marginTop: 12, fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.danger },
  secondary: {
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E6E6E6',
    marginBottom: theme.spacing.sm,
  },
  secondaryLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#0B0D10' },
  cta: {
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 6, 6, 0.4)',
    marginBottom: theme.spacing.md,
  },
  ctaActive: { backgroundColor: '#060606' },
  ctaLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#F5F5F5' },
}));
