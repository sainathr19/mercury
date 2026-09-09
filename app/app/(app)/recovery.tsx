import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PostHogMaskView } from 'posthog-react-native';
import { Icon, PressableScale, ScreenScaffold, Text, useToast } from '../../src/ui';
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
    <ScreenScaffold
      title="Recovery phrase"
      subtitle={
        step === 'review'
          ? 'Three things to confirm before the words are shown.'
          : 'Write these down in order. Anyone who has them controls this wallet.'
      }
      cta={
        step === 'review'
          ? { label: 'Show my phrase', onPress: onContinue, disabled: !allChecked }
          : { label: 'Done', onPress: () => router.back() }
      }
    >
      {step === 'review' ? (
        <View style={styles.card}>
          {REVIEW_ITEMS.map((item, i) => (
            <Pressable
              key={i}
              style={[styles.reviewRow, i > 0 && styles.divider]}
              onPress={() => toggle(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checks[i] }}
            >
              <View style={[styles.checkbox, checks[i] && styles.checkboxOn]}>
                {checks[i] && <Icon name="check" size={12} color="#ECEEE9" />}
              </View>
              <Text style={styles.reviewText}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          {/* Never let the recovery phrase reach a session replay recording. */}
          <PostHogMaskView>
            <View style={styles.grid}>
              {(words ?? []).map((w, i) => (
                <View key={i} style={styles.wordCell}>
                  <Text style={styles.wordNum}>{i + 1}</Text>
                  <Text style={styles.wordText}>{w}</Text>
                </View>
              ))}
            </View>
          </PostHogMaskView>

          <PressableScale style={styles.copyBtn} onPress={copy}>
            <Animated.View style={labelStyle}>
              <Text style={styles.copyLabel}>Copy to clipboard</Text>
            </Animated.View>
            <Animated.View style={[styles.copyTick, tickStyle]}>
              <Icon name="check" size={17} color={theme.colors.text} />
            </Animated.View>
          </PressableScale>

          <View style={styles.warning}>
            <Icon name="warning" size={16} color="#B4761A" />
            <Text style={styles.warningText}>
              Never type these words into another app, and never send them to anyone — including
              anyone claiming to be Mercury support.
            </Text>
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    overflow: 'hidden',
  },
  divider: { borderTopWidth: 1, borderTopColor: 'rgba(11,13,16,0.06)' },
  // Checkbox leads the row: the user is ticking a list, and a control on the
  // trailing edge reads as a result rather than an action.
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 15 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(11,13,16,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#0B0D10', borderColor: '#0B0D10' },
  reviewText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: theme.colors.text,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
    paddingVertical: 8,
  },
  wordCell: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  // Fixed width and right-aligned, so every word starts on the same x whether
  // its index is one digit or two.
  wordNum: { width: 18, textAlign: 'right', fontFamily: fontFamily.monoRegular, fontSize: 12, color: theme.colors.faint },
  wordText: { fontFamily: fontFamily.monoRegular, fontSize: 15, color: theme.colors.text },

  copyBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.08)',
  },
  copyLabel: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: theme.colors.text },
  // Stacked on the label so swapping them shifts nothing.
  copyTick: { position: 'absolute' },

  warning: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: 'rgba(180,118,26,0.09)',
  },
  warningText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.14,
    color: '#7A5514',
  },
}));
