import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { PostHogMaskView } from 'posthog-react-native';
import { Button, Card, Icon, Text, useToast } from '../ui';

/** Security-critical recovery-phrase backup UI: shows the BIP-39 words, requires
 *  an explicit "I've saved them" confirmation, then continues. Shared by the
 *  onboarding backup screen and the in-app "new wallet" backup so the two never
 *  drift. The caller owns where the words come from and what Continue does. */
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
  const [confirmed, setConfirmed] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(words.join(' '));
    show('Copied to clipboard', 'success');
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="headline">{title}</Text>
        <Text variant="bodyMedium" color={theme.colors.muted}>
          Write down these {words.length} words in order and store them somewhere safe. This is the
          only way to recover your wallet.
        </Text>
      </View>

      <View style={styles.warning}>
        <Icon name="warning" size={20} color={theme.colors.warning} />
        <View style={styles.warningText}>
          <Text variant="bodyBold">Keep this private</Text>
          <Text variant="caption" color={theme.colors.muted}>
            Anyone with these words can access your funds. Never share them.
          </Text>
        </View>
      </View>

      {words.length > 0 ? (
        // Never let the recovery phrase reach a session replay recording.
        <PostHogMaskView>
          <Card flush style={styles.grid}>
            {words.map((word, idx) => (
              <View key={idx} style={styles.wordCell}>
                <Text variant="caption" color={theme.colors.muted} style={styles.wordIndex}>
                  {idx + 1}
                </Text>
                <Text variant="mono">{word}</Text>
              </View>
            ))}
          </Card>
        </PostHogMaskView>
      ) : (
        <Text variant="bodyMedium" color={theme.colors.muted}>
          Recovery phrase not available.
        </Text>
      )}

      <Button title="Copy to clipboard" variant="secondary" onPress={copy} />

      <Pressable
        style={styles.confirm}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => setConfirmed((v) => !v)}
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: confirmed ? theme.colors.success : theme.colors.muted },
            confirmed && { backgroundColor: theme.colors.success },
          ]}
        >
          {confirmed && <Icon name="check" size={14} color={theme.colors.primaryLabel} />}
        </View>
        <Text variant="bodyMedium" style={styles.confirmText}>
          I have written down my recovery phrase and stored it safely.
        </Text>
      </Pressable>

      <Button title={continueLabel} onPress={onContinue} disabled={!confirmed || words.length === 0} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  header: { gap: theme.spacing.xs },
  warning: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: 'rgba(255,149,0,0.10)',
  },
  warningText: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  wordCell: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  wordIndex: { width: 20, textAlign: 'right' },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardBackground,
  },
  confirmText: { flex: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
