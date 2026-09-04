import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/stores/session';
import { pickChallenge, checkChallenge } from '../../src/bridge/verify';
import { Screen, Button, Card } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Verify() {
  const router = useRouter();
  const vault = useSession((s) => s.vault);
  const [phrase, setPhrase] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void vault?.loadPhrase().then((p) => setPhrase(p ?? '')); }, [vault]);
  const indices = useMemo(() => (phrase ? pickChallenge(phrase) : []), [phrase]);

  function submit() {
    if (checkChallenge(phrase, indices, answers)) router.push('/(auth)/lock' as never);
    else setError("That doesn't match. Check your written copy.");
  }

  return (
    <Screen>
      <Text style={[t.h1, { marginTop: sp(4) }]}>Confirm your phrase</Text>
      <Text style={[t.sub, { marginTop: sp(1), marginBottom: sp(3) }]}>
        Type these three words to prove you saved it.
      </Text>
      {indices.map((wordIndex, i) => (
        <Card key={wordIndex} style={{ marginBottom: sp(1.25) }}>
          <Text style={t.cap}>Word {wordIndex + 1}</Text>
          <TextInput
            style={s.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={answers[i]}
            placeholder="…"
            placeholderTextColor={c.fg3}
            onChangeText={(v) => { const n = [...answers]; n[i] = v; setAnswers(n); setError(null); }}
          />
        </Card>
      ))}
      {error && <Text style={s.err}>{error}</Text>}
      <View style={{ flex: 1 }} />
      <Button title="Continue" onPress={submit} disabled={answers.some((a) => !a.trim())} />
      <View style={{ height: sp(2) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { color: c.fg, fontSize: 17, paddingTop: 8, paddingBottom: 2 },
  err: { color: c.bad, fontSize: 14, marginTop: 4 },
});
