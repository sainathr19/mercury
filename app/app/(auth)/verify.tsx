import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Card, Field, Text } from '../../src/ui';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { useSession } from '../../src/stores/session';
import { pickChallenge, checkChallenge } from '../../src/bridge/verify';

export default function Verify() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
  const vault = useSession((s) => s.vault);
  const [phrase, setPhrase] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void vault?.loadPhrase().then((p) => setPhrase(p ?? '')); }, [vault]);
  const indices = useMemo(() => (phrase ? pickChallenge(phrase) : []), [phrase]);

  function submit() {
    if (checkChallenge(phrase, indices, answers)) router.push('/(auth)/lock');
    else setError("That doesn't match. Check your written copy.");
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.progress}><OnboardingProgress step={2} total={3} /></View>
      <View style={styles.body}>
        <Text variant="titleMedium">Confirm your phrase</Text>
        <Text variant="subhead" color={theme.colors.muted} style={styles.sub}>
          Type these three words to prove you saved it.
        </Text>
        {indices.map((wordIndex, i) => (
          <Card key={wordIndex} style={styles.card}>
            <Field
              label={`Word ${wordIndex + 1}`}
              value={answers[i]}
              onChangeText={(v) => { const n = [...answers]; n[i] = v; setAnswers(n); setError(null); }}
              placeholder="…"
            />
          </Card>
        ))}
        {error ? <Text variant="subhead" color={theme.colors.danger}>{error}</Text> : null}
        <View style={{ flex: 1 }} />
        <Button title="Continue" onPress={submit} shape="pill" disabled={answers.some((a) => !a.trim())} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  progress: { paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md },
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg },
  sub: { marginTop: 6, marginBottom: theme.spacing.lg },
  card: { marginBottom: theme.spacing.sm },
}));
