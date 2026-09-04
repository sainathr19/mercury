import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Button } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Welcome() {
  const router = useRouter();
  return (
    <Screen>
      <View style={s.hero}>
        <View style={s.mark}><Text style={s.markText}>M</Text></View>
        <Text style={s.title}>Mercury</Text>
        <Text style={[t.sub, { marginTop: sp(1), fontSize: 17 }]}>
          The wallet for everyday money.{'\n'}Send USDC to a name — no gas token, no bridging.
        </Text>
      </View>
      <Button title="Create a wallet" onPress={() => router.push('/(auth)/create' as never)} />
      <Button title="I already have one" kind="secondary" onPress={() => router.push('/(auth)/import' as never)} />
      <View style={{ height: sp(3) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center' },
  mark: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: c.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp(3),
  },
  markText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  title: { fontSize: 42, fontWeight: '700', color: c.fg, letterSpacing: -1.2 },
});
