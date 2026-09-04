import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../../src/stores/session';
import { invalidWords, isValidPhrase } from '../../src/bridge/keys';
import { Screen, Button, Card } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Import() {
  const router = useRouter();
  const importWallet = useSession((s) => s.importWallet);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bad = invalidWords(text);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const complete = wordCount === 12 || wordCount === 24;

  async function submit() {
    setBusy(true); setError(null);
    try {
      await importWallet(text);
      router.replace('/(auth)/lock' as never);
    } catch {
      setError('That phrase is not valid. Check the order and spelling.');
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Text style={[t.h1, { marginTop: sp(4) }]}>Enter your recovery phrase</Text>
      <Text style={[t.sub, { marginTop: sp(1), marginBottom: sp(2) }]}>
        12 or 24 words, separated by spaces.
      </Text>
      <Card>
        <TextInput
          style={s.input}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          value={text}
          onChangeText={(v) => { setText(v); setError(null); }}
          placeholder="witch collapse practice feed…"
          placeholderTextColor={c.fg3}
        />
      </Card>
      <Text style={[t.cap, { marginTop: 10 }]}>{wordCount} / 12 words</Text>
      {bad.length > 0 && <Text style={s.err}>Not valid words: {bad.join(', ')}</Text>}
      {error && <Text style={s.err}>{error}</Text>}
      <View style={{ flex: 1 }} />
      <Button
        title="Import"
        onPress={submit}
        loading={busy}
        disabled={!complete || bad.length > 0 || !isValidPhrase(text)}
      />
      <View style={{ height: sp(2) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { color: c.fg, fontSize: 17, minHeight: 110, textAlignVertical: 'top', lineHeight: 26 },
  err: { color: c.bad, fontSize: 14, marginTop: 8 },
});
