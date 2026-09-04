import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/stores/session';
import { Screen, Button } from '../../src/ui/kit';
import { c, t, sp } from '../../src/ui/theme';

export default function Lock() {
  const router = useRouter();
  const enableLock = useSession((s) => s.enableLock);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function proceed(skip: boolean) {
    setBusy(true); setError(null);
    try {
      if (!skip) {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!hw || !enrolled) {
          setError('This device has no biometrics or passcode set up. You can continue without one.');
          return;
        }
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Mercury' });
        if (!res.success) { setError('Not confirmed. Try again.'); return; }
      }
      await enableLock();
      router.replace('/(app)/home' as never);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <View style={s.hero}>
        <View style={s.icon}><Ionicons name="finger-print" size={34} color={c.accent} /></View>
        <Text style={t.h1}>Lock your wallet</Text>
        <Text style={[t.sub, { marginTop: sp(1) }]}>
          Your recovery phrase is stored on this device only. A lock keeps it that
          way if someone else picks up your phone.
        </Text>
        {error && <Text style={s.err}>{error}</Text>}
      </View>
      <Button title="Enable" onPress={() => proceed(false)} loading={busy} />
      <Button title="Not now" kind="ghost" onPress={() => proceed(true)} />
      <View style={{ height: sp(3) }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center' },
  icon: {
    width: 68, height: 68, borderRadius: 22, backgroundColor: c.accentDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp(3),
  },
  err: { color: c.bad, fontSize: 14, marginTop: sp(2) },
});
