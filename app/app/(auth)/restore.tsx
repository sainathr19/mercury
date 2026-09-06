import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useToast } from '../../src/ui';
import { useBackup } from '../../src/stores/backupStore';
import { useSession } from '../../src/stores/session';
import { useWallets } from '../../src/stores/walletsStore';
import { fontFamily } from '../../src/theme/fonts';

const MIN_LENGTH = 8;

/**
 * Restore-from-iCloud, shown after sign-in when a cloud backup exists for this
 * account (new device / reinstall). Enter the backup password → the Rust core
 * decrypts the blob and re-imports the wallet, then the session opens it and the
 * root gate routes home. Falls back to creating a fresh wallet.
 */
export default function Restore() {
  const router = useRouter();
  const show = useToast((s) => s.show);
  const restore = useBackup((s) => s.restore);
  const busy = useBackup((s) => s.busy);
  const [pw, setPw] = useState('');
  const [creating, setCreating] = useState(false);
  const pwInput = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => pwInput.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  async function onRestore() {
    if (pw.length < MIN_LENGTH) return;
    Keyboard.dismiss();
    try {
      const ok = await restore(pw);
      if (!ok) {
        show('No backup found for this account.', 'info');
        return;
      }
      // Success: the wallet is open and already backed up. Still show the Face ID
      // step, then go straight home (no backup step needed).
      router.replace({ pathname: '/(auth)/enable-faceid', params: { next: 'home' } });
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      show(/auth|password|corrupt/i.test(m) ? 'Incorrect password or corrupt backup.' : 'Restore failed.', 'error');
      setPw('');
    }
  }

  async function createNew() {
    setCreating(true);
    try {
      await useSession.getState().create();
      // Register the wallet, then run the same first-run setup as onboarding:
      // Face ID (step 1) → backup (step 2, optional).
      await useWallets.getState().ensurePrimary();
      router.replace('/(auth)/enable-faceid');
    } catch {
      show('Could not create a wallet. Try again.', 'error');
      setCreating(false);
    }
  }

  const canRestore = pw.length >= MIN_LENGTH && !busy && !creating;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor="#0B0D10" contentFit="contain" />
        </Pressable>

        <View style={styles.heading}>
          <RNText style={styles.title}>Restore your wallet</RNText>
          <RNText style={styles.subtitle}>
            We found an iCloud backup for this account. Enter your backup password to restore your wallet on this device.
          </RNText>
        </View>

        <TextInput
          ref={pwInput}
          style={styles.field}
          placeholder="Backup password"
          placeholderTextColor="#72717A"
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !creating}
          returnKeyType="go"
          onSubmitEditing={onRestore}
        />

        {/* Spacer pushes the CTA to the bottom; it rides above the keyboard. */}
        <View style={styles.spacer} />
        <Pressable style={[styles.cta, canRestore && styles.ctaActive]} disabled={!canRestore} onPress={onRestore}>
          {busy ? <ActivityIndicator color="#F5F5F5" /> : <RNText style={styles.ctaLabel}>Restore</RNText>}
        </Pressable>
        <Pressable onPress={createNew} disabled={busy || creating} hitSlop={8} style={styles.alt}>
          <RNText style={styles.altLabel}>{creating ? 'Creating…' : 'Create a new wallet instead'}</RNText>
        </Pressable>
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
  // Title + description: 4px apart; 24px below the back button.
  heading: { marginTop: 24, gap: 4 },
  // "Restore your wallet" — 18px Bold, -2% tracking, dark.
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
  // Restore — fixed 48px pill pinned to the bottom. Disabled: #060606 @ 50%.
  cta: {
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 6, 6, 0.5)',
  },
  ctaActive: { backgroundColor: '#060606' },
  ctaLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#F5F5F5' },
  // "Create a new wallet instead" — secondary text link under the CTA.
  alt: { alignItems: 'center', paddingVertical: theme.spacing.md },
  altLabel: { fontFamily: fontFamily.bold, fontSize: 15, letterSpacing: -0.3, color: '#8A8F98' },
}));
