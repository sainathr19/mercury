import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/stores/session';
import { Screen, Button, Card } from '../../src/ui/kit';
import { c, t, sp, r } from '../../src/ui/theme';

export default function Create() {
  const router = useRouter();
  const createWallet = useSession((s) => s.createWallet);
  const [phrase, setPhrase] = useState<string | null>(null);

  useEffect(() => { void createWallet().then(setPhrase); }, [createWallet]);

  if (!phrase) return <Screen><View /></Screen>;
  const words = phrase.split(' ');

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[t.h1, { marginTop: sp(3) }]}>Your recovery phrase</Text>
        <Text style={[t.sub, { marginTop: sp(1) }]}>
          These 12 words are the only way back into this wallet. Write them down
          and keep them offline.
        </Text>

        <View style={s.warn}>
          <Ionicons name="warning-outline" size={17} color="#E8B84B" />
          <Text style={s.warnText}>Anyone who has these words has your money.</Text>
        </View>

        <Card style={{ marginTop: sp(2) }}>
          <View style={s.grid}>
            {words.map((w, i) => (
              <View key={i} style={s.cell}>
                <Text style={s.idx}>{i + 1}</Text>
                <Text style={s.word}>{w}</Text>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>
      <Button title="I've written it down" onPress={() => router.push('/(auth)/verify' as never)} />
      <View style={{ height: sp(2) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: sp(2),
    backgroundColor: '#2A2312', borderRadius: r.sm, padding: sp(1.5),
  },
  warnText: { color: '#E8B84B', fontSize: 13.5, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  idx: { color: c.fg3, width: 24, fontSize: 12 },
  word: { color: c.fg, fontSize: 16.5, fontWeight: '500' },
});
