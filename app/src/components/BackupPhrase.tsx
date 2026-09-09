import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PostHogMaskView } from 'posthog-react-native';
import { Icon, PressableScale, Text, useToast } from '../ui';
import { fontFamily } from '../theme/fonts';

/**
 * Security-critical recovery-phrase backup UI. Shared by the onboarding backup
 * screen and the in-app "new wallet" backup, so the two never drift. The caller
 * owns where the words come from and what Continue does.
 *
 * Two stages on purpose. The words stay hidden until the user has actively
 * acknowledged what they are, so the phrase is not just sitting on screen the
 * instant the wallet is created — in a cafe, on a shared desk, or in whatever is
 * recording the screen.
 *
 * While hidden the real words are NOT RENDERED AT ALL. Placeholders hold the
 * grid's exact shape instead. Blurring or dimming the real thing would still put
 * the phrase in the view hierarchy and in any screenshot taken before consent.
 */
export function BackupPhrase({
  words,
  onContinue,
  title = 'Back up your wallet',
  continueLabel = 'Continue',
}: {
  words: string[];
  onContinue: () => void;
  title?: string;
  continueLabel?: string;
}) {
  const show = useToast((s) => s.show);
  const theme = UnistylesRuntime.getTheme();
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(words.join(' '));
    show('Copied to clipboard', 'success');
  }

  function reveal() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRevealed(true);
  }

  if (words.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="bodyMedium" color={theme.colors.muted}>
          Recovery phrase not available.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            These {words.length} words are the only way to recover your wallet. Write them down in
            order and keep them somewhere safe.
          </Text>
        </View>

        <View style={styles.warning}>
          <Icon name="warning" size={17} color="#B4761A" />
          <Text style={styles.warningText}>
            Anyone with these words can spend your funds. Never share them, and never type them
            into another app.
          </Text>
        </View>

        {/* The grid keeps the same footprint in both stages, so revealing does
            not shift everything below it. */}
        <PostHogMaskView>
          <View style={styles.grid}>
            {words.map((word, idx) => (
              <View key={idx} style={styles.cell}>
                <Text style={styles.index}>{idx + 1}</Text>
                {revealed ? (
                  <Animated.View entering={FadeIn.duration(260).delay(idx * 18)}>
                    <Text style={styles.word}>{word}</Text>
                  </Animated.View>
                ) : (
                  <View style={styles.redaction} />
                )}
              </View>
            ))}
          </View>
        </PostHogMaskView>

        {revealed && (
          <Animated.View entering={FadeIn.duration(300).delay(200)}>
            <PressableScale style={styles.copy} onPress={copy}>
              <Icon name="copy" size={15} color="#0B0D10" />
              <Text style={styles.copyLabel}>Copy to clipboard</Text>
            </PressableScale>
          </Animated.View>
        )}
      </ScrollView>

      {/* Pinned: the gate and the confirmation are the screen's actions, so they
          stay at the bottom while the words scroll above them. */}
      <View style={styles.footer}>
        {!revealed ? (
          <Animated.View exiting={FadeOut.duration(140)} style={styles.stage}>
            <CheckRow
              checked={false}
              label="I understand that anyone with these words can spend my funds."
              onPress={reveal}
            />
            <Text style={styles.hint}>Tick to reveal your recovery phrase.</Text>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(300).delay(160)} style={styles.stage}>
            <CheckRow
              checked={confirmed}
              label="I have written down my recovery phrase and stored it safely."
              onPress={() => setConfirmed((v) => !v)}
            />
            <PressableScale
              style={[styles.cta, confirmed ? styles.ctaOn : styles.ctaOff]}
              disabled={!confirmed}
              onPress={onContinue}
            >
              <Text style={styles.ctaLabel}>{continueLabel}</Text>
            </PressableScale>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** Checkbox row. One component for both stages so the reveal gate and the
 *  confirmation are the same control with the same hit area. */
function CheckRow({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.checkRow}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <Icon name="check" size={13} color="#ECEEE9" />}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  // Generous top padding: this screen opens straight from wallet creation with
  // no nav bar above it, so without it the title sits against the status bar.
  content: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    gap: 16,
  },
  footer: { paddingHorizontal: theme.spacing.screen, paddingTop: 4, paddingBottom: theme.spacing.md },
  empty: { padding: theme.spacing.lg },

  header: { gap: 6 },
  title: { fontFamily: fontFamily.semibold, fontSize: 26, letterSpacing: -0.9, color: '#0B0D10' },
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.24,
    color: '#6B7079',
  },

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
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.18,
    color: '#7A5514',
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
  cell: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  // Tabular-ish: fixed width and right-aligned so the words all start on the
  // same x, whether the index is one digit or two.
  index: {
    width: 18,
    textAlign: 'right',
    fontFamily: fontFamily.monoRegular,
    fontSize: 12,
    color: '#9AA0A8',
  },
  word: { fontFamily: fontFamily.monoRegular, fontSize: 15, letterSpacing: -0.1, color: '#0B0D10' },
  // Stands in for a word while hidden, at roughly a word's width so the grid
  // does not resize when the real thing arrives.
  redaction: { width: 62, height: 9, borderRadius: 5, backgroundColor: 'rgba(11,13,16,0.10)' },

  stage: { gap: 14 },
  hint: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.18,
    color: '#5F646D',
  },

  copy: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.08)',
  },
  copyLabel: { fontFamily: fontFamily.semibold, fontSize: 15, letterSpacing: -0.3, color: '#0B0D10' },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.07)',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(11,13,16,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: '#0B0D10', borderColor: '#0B0D10' },
  checkLabel: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: '#0B0D10',
  },

  cta: {
    height: 54,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOn: { backgroundColor: '#0B0D10' },
  ctaOff: { backgroundColor: 'rgba(11,13,16,0.16)' },
  ctaLabel: { fontFamily: fontFamily.semibold, fontSize: 16, letterSpacing: -0.32, color: '#ECEEE9' },
}));
