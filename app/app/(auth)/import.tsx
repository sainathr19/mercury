import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Text } from '../../src/ui';
import { useSession } from '../../src/stores/session';
import { invalidWords, isValidPhrase } from '../../src/bridge/keys';

export default function Import() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const importWallet = useSession((s) => s.importWallet);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bad = invalidWords(text);
  const count = text.trim() ? text.trim().split(/\s+/).length : 0;
  const complete = count === 12 || count === 24;

  async function submit() {
    setBusy(true); setError(null);
    try {
      await importWallet(text);
      router.replace('/(auth)/lock');
    } catch {
      setError('That phrase is not valid. Check the order and spelling.');
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Text variant="titleMedium">Enter your recovery phrase</Text>
        <Text variant="subhead" color={theme.colors.muted} style={styles.sub}>
          12 or 24 words, separated by spaces.
        </Text>
        <Card>
          <Field
            value={text}
            onChangeText={(v) => { setText(v); setError(null); }}
            placeholder="witch collapse practice feed…"
            multiline
            style={styles.input}
            error={bad.length > 0 ? `Not valid words: ${bad.join(', ')}` : error ?? undefined}
          />
        </Card>
        <Text variant="caption" color={theme.colors.muted} style={styles.count}>{count} / 12 words</Text>
        <View style={{ flex: 1 }} />
        <Button
          title="Import"
          onPress={submit}
          loading={busy}
          shape="pill"
          disabled={!complete || bad.length > 0 || !isValidPhrase(text)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.lg },
  sub: { marginTop: 6, marginBottom: theme.spacing.lg },
  input: { minHeight: 110, textAlignVertical: 'top', lineHeight: 26 },
  count: { marginTop: theme.spacing.sm },
}));
