import { useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { useToast } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { useWallets } from '../../src/stores/walletsStore';
import { mapError } from '../../src/lib/errors';
import { fontFamily } from '../../src/theme/fonts';

/** Restore from a 12 or 24-word recovery phrase. Mirrors standard-ios
 *  RestoreWalletView. On success the root layout routes into the app. */
export default function ImportWallet() {
  const router = useRouter();
  const importPhrase = useSession((s) => s.importPhrase);
  const show = useToast((s) => s.show);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const theme = UnistylesRuntime.getTheme();

  const words = useMemo(
    () => input.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()),
    [input],
  );
  const count = words.length;
  const validCount = count === 12 || count === 24;

  async function onRestore() {
    Keyboard.dismiss();
    try {
      setInFlight(true);
      await importPhrase(words);
      // Register the (re)imported wallet in the registry so it shows under
      // Wallets & Accounts (importPhrase only updates the session).
      await useWallets.getState().ensurePrimary();
    } catch (e) {
      show(mapError(e).message, 'error');
    } finally {
      setInFlight(false);
    }
  }

  const countColor = count === 0 ? '#8A8F98' : validCount ? theme.colors.success : theme.colors.warning;
  const canRestore = validCount && !inFlight;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ExpoImage source={require('../../assets/icons/arrowLeft.svg')} style={styles.backIcon} tintColor="#0B0D10" contentFit="contain" />
        </Pressable>

        <View style={styles.heading}>
          <RNText style={styles.title}>Restore Wallet</RNText>
          <RNText style={styles.subtitle}>Enter your 12 or 24-word recovery phrase, separated by spaces.</RNText>
        </View>

        <TextInput
          style={styles.field}
          placeholder="word1 word2 word3 …"
          placeholderTextColor="#72717A"
          value={input}
          onChangeText={setInput}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textAlignVertical="top"
        />

        <RNText style={[styles.count, { color: countColor }]}>
          {count} word{count === 1 ? '' : 's'}
        </RNText>

        {/* Spacer pushes the CTA to the bottom; it rides above the keyboard. */}
        <View style={styles.spacer} />
        <Pressable style={[styles.cta, canRestore && styles.ctaActive]} disabled={!canRestore} onPress={onRestore}>
          {inFlight ? (
            <ActivityIndicator color="#F5F5F5" />
          ) : (
            <RNText style={styles.ctaLabel}>Restore Wallet</RNText>
          )}
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
  // "Restore Wallet" — 18px Bold, -2% tracking, dark.
  title: { fontFamily: fontFamily.bold, fontSize: 18, letterSpacing: -0.36, color: '#0B0D10' },
  // Description — 15px Medium, -2% tracking, mid grey.
  subtitle: { fontFamily: fontFamily.medium, fontSize: 15, letterSpacing: -0.3, color: '#8A8F98' },
  // Phrase field — search-input style, 12px vertical / 18px horizontal padding.
  field: {
    marginTop: 16,
    minHeight: 120,
    backgroundColor: '#EBEBEB',
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.3,
    color: '#0B0D10',
  },
  count: { marginTop: 8, fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.26 },
  // Restore — fixed 48px pill pinned to the bottom. Disabled: #060606 @ 50%.
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
