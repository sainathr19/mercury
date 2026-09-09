import { useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Icon, useToast } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { useWallets } from '../../src/stores/walletsStore';
import { mapError } from '../../src/lib/errors';
import { fontFamily } from '../../src/theme/fonts';

const GROUND = '#ECEEE9';

/** Restore from a 12 or 24-word recovery phrase. On success the root layout
 *  routes into the app — this screen does not navigate itself.
 *
 *  The phrase field is monospaced and the word count is live, because the two
 *  things that go wrong here are a typo'd word and a miscount, and both are only
 *  catchable if the user can actually see what they typed. */
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

  /** Paste the phrase from the clipboard, normalising whatever shape it arrives
   *  in. Phrases get copied out of password managers and notes apps with hard
   *  line breaks, tabs, numbering and stray double spaces; without collapsing
   *  that the word count is wrong and the import fails on a phrase that is
   *  actually correct. */
  async function onPaste() {
    try {
      const raw = await Clipboard.getStringAsync();
      if (!raw?.trim()) {
        show('Clipboard is empty.', 'info');
        return;
      }
      const cleaned = raw
        .replace(/\d+[.)]/g, ' ')   // strip "1." / "1)" numbering
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      setInput(cleaned);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      show('Could not read the clipboard.', 'error');
    }
  }

  const canRestore = validCount && !inFlight;
  // Says how far along the phrase is rather than just colouring it: "5 of 12"
  // is actionable, a red 5 is not.
  const countLabel = count === 0 ? 'Paste or type your phrase' : validCount ? `${count} words` : `${count} of 12`;
  const countColor = count === 0 ? theme.colors.muted : validCount ? theme.colors.success : theme.colors.muted;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} hitSlop={14} style={styles.backBtn}>
            <Icon name="back" size={19} color="#0B0D10" />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.heading}>
            <RNText style={styles.title}>Import a wallet</RNText>
            <RNText style={styles.subtitle}>
              Enter the 12 or 24-word recovery phrase for the wallet you want to restore.
            </RNText>
          </View>

          <View style={styles.fieldCard}>
            <TextInput
              style={styles.field}
              placeholder="witch collapse practice feed…"
              placeholderTextColor="#9AA0A8"
              value={input}
              onChangeText={setInput}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.fieldFooter}>
              <RNText style={[styles.count, { color: countColor }]}>{countLabel}</RNText>
              {/* One slot, two states: Paste while the field is empty, Clear once
                  there is something to clear. Both are the same affordance in the
                  same place, so the footer never reflows. */}
              <Pressable hitSlop={10} onPress={input.length > 0 ? () => setInput('') : onPaste}>
                <RNText style={styles.action}>{input.length > 0 ? 'Clear' : 'Paste'}</RNText>
              </Pressable>
            </View>
          </View>

          <RNText style={styles.note}>
            Your phrase never leaves this device. Mercury has no account and no server to send it to.
          </RNText>
        </View>

        <Pressable
          style={[styles.cta, canRestore ? styles.ctaActive : styles.ctaOff]}
          disabled={!canRestore}
          onPress={onRestore}
        >
          {inFlight ? (
            <ActivityIndicator color={GROUND} />
          ) : (
            <RNText style={styles.ctaLabel}>Import wallet</RNText>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: GROUND },
  fill: { flex: 1, paddingHorizontal: theme.spacing.screen },

  // A row of its own, so the back button has a real hit area and the heading
  // below it is not pushed around by the icon's size.
  navBar: { height: 44, justifyContent: 'center' },
  backBtn: { width: 34, height: 34, justifyContent: 'center' },

  body: { flex: 1, gap: 18 },
  heading: { gap: 6 },
  // Semibold, not Bold: at 26px the heavier cut was the reason this screen read
  // as shouty rather than calm.
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: '#0B0D10' },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: '#6B7079',
  },

  // The field gets a card of its own so the count and Clear sit INSIDE it,
  // reading as one control rather than three stacked elements.
  fieldCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  // Monospaced: BIP-39 words are checked character by character, and a
  // proportional face makes a transposed letter easy to miss.
  field: {
    minHeight: 104,
    fontFamily: fontFamily.monoRegular,
    fontSize: 15,
    lineHeight: 23,
    color: '#0B0D10',
  },
  fieldFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(11,13,16,0.06)',
  },
  count: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: -0.2 },
  action: { fontFamily: fontFamily.semibold, fontSize: 13, letterSpacing: -0.2, color: '#0B0D10' },

  note: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: '#5F646D',
  },

  cta: {
    height: 54,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  ctaActive: { backgroundColor: '#0B0D10' },
  ctaOff: { backgroundColor: 'rgba(11,13,16,0.16)' },
  ctaLabel: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.32, color: GROUND },
}));
