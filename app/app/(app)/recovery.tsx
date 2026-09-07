import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PostHogMaskView } from 'posthog-react-native';
import { Button, Icon, PressableScale, Text, useToast } from '../../src/ui';
import { loadMnemonic } from '../../src/bridge/seedVault';
import { getActiveAlias } from '../../src/bridge/wallet';
import { requireAuth, authFailureMessage } from '../../src/lib/biometrics';
import { fontFamily } from '../../src/theme/fonts';

// The three things the user must acknowledge before the phrase is revealed.
const REVIEW_ITEMS = [
  'My recovery phrase is the only way to restore my wallet.',
  'I will not share my recovery phrase with anyone.',
  'No one is watching or recording my screen.',
];

export default function Recovery() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const show = useToast((s) => s.show);

  const [step, setStep] = useState<'review' | 'phrase'>('review');
  const [checks, setChecks] = useState([false, false, false]);
  const [words, setWords] = useState<string[] | null>(null);

  // Drop the phrase when the screen goes away. Leaving it in component state
  // keeps it reachable for as long as React holds the tree, which is longer
  // than the user is looking at it.
  useEffect(() => () => setWords(null), []);
  const allChecked = checks.every(Boolean);

  // Copy → tick crossfade (same treatment as the receive address copy button):
  // the label and the ✓ are stacked, so swapping them causes no layout shift.
  const copied = useSharedValue(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - copied.value,
    transform: [{ scale: 0.9 + (1 - copied.value) * 0.1 }],
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: copied.value,
    transform: [{ scale: 0.6 + copied.value * 0.4 }],
  }));

  function toggle(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setChecks((c) => c.map((v, idx) => (idx === i ? !v : v)));
  }

  async function onContinue() {
    if (!allChecked) return;
    const auth = await requireAuth('Reveal your recovery phrase');
    if (!auth.ok) {
      if (auth.reason === 'no-device-auth') show(authFailureMessage(auth.reason), 'error');
      return;
    }
    const w = await loadMnemonic(getActiveAlias());
    if (!w || w.length === 0) {
      show('Recovery phrase not available on this device.', 'error');
      return;
    }
    setWords(w);
    setStep('phrase');
  }

  async function copy() {
    if (!words) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(words.join(' '));
    copied.value = withTiming(1, { duration: 180 });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      copied.value = withTiming(0, { duration: 240 });
    }, 1400);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ExpoImage
            source={require('../../assets/icons/arrowLeft.svg')}
            style={styles.backIcon}
            tintColor={theme.colors.text}
            contentFit="contain"
          />
        </Pressable>
        <Text style={styles.pageTitle}>Recovery Phrase</Text>
        {step === 'review' && (
          <Text style={styles.description} color={theme.colors.muted}>
            Before you continue, review the following items.
          </Text>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {step === 'review' ? (
          <View style={styles.card}>
            {REVIEW_ITEMS.map((item, i) => (
              <Pressable
                key={i}
                style={styles.reviewRow}
                onPress={() => toggle(i)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: checks[i] }}
              >
                <Text style={styles.reviewText}>{item}</Text>
                <View style={[styles.checkbox, checks[i] && styles.checkboxOn]}>
                  {checks[i] && <Icon name="check" size={11} color={theme.colors.primaryLabel} />}
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            {/* Never let the recovery phrase reach a session replay recording. */}
            <PostHogMaskView style={styles.card}>
              <View style={styles.grid}>
                {(words ?? []).map((w, i) => (
                  <View key={i} style={styles.wordCell}>
                    <Text style={styles.wordNum} color={theme.colors.muted}>
                      {i + 1}
                    </Text>
                    <Text style={styles.wordText}>{w}</Text>
                  </View>
                ))}
              </View>
            </PostHogMaskView>

            {/* Warning shown only on the words page. */}
            <View style={styles.warning}>
              <Icon name="warning" size={20} color={theme.colors.text} />
              <Text style={styles.warningText}>
                If someone has your Recovery Phrase they will have full control of your wallet.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'review' ? (
          <Button title="Continue" shape="pill" disabled={!allChecked} onPress={onContinue} />
        ) : (
          <>
            <PressableScale style={styles.copyBtn} onPress={copy}>
              <Animated.View style={labelStyle}>
                <Text variant="bodyBold">Copy to clipboard</Text>
              </Animated.View>
              <Animated.View style={[styles.copyTick, tickStyle]}>
                <Icon name="check" size={18} color={theme.colors.text} />
              </Animated.View>
            </PressableScale>
            <Button title="Done" shape="pill" onPress={() => router.back()} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.appBackground },
  // Back arrow, then title 24px below it (standard), description under the title.
  header: { paddingHorizontal: 18, paddingTop: theme.spacing.md },
  backIcon: { width: 30, height: 30 },
  pageTitle: { fontSize: 18, fontFamily: fontFamily.bold, letterSpacing: -0.36, color: theme.colors.text, marginTop: 24 },
  description: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, marginTop: 6 },

  content: { paddingHorizontal: 18, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg },
  card: { backgroundColor: theme.colors.cardBackground, borderRadius: theme.radius.md, overflow: 'hidden' },

  // Standard row padding: 18 x / 12 y. 24px gap between the text and the box.
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 24, paddingHorizontal: 18, paddingVertical: 12 },
  reviewText: { flex: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },
  // 15px mid-grey filled square (unchecked); fills black with a white tick when checked.
  checkbox: {
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: theme.colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.colors.text },

  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: theme.spacing.sm },
  wordCell: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10 },
  // Fixed number column so every word starts at the same x (no drift on 2-digit numbers).
  wordNum: { width: 18, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3 },
  wordText: { fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },

  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(255,59,48,0.12)',
  },
  warningText: { flex: 1, fontSize: 15, fontFamily: fontFamily.medium, letterSpacing: -0.3, color: theme.colors.text },

  // Buttons pinned to the bottom.
  footer: { paddingHorizontal: 18, paddingBottom: theme.spacing.md, paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  copyBtn: {
    height: 52,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBackground,
  },
  copyTick: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
}));
