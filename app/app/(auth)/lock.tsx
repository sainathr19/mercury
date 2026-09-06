import { useState } from 'react';
import { Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { Button, Text } from '../../src/ui';
import { OnboardingProgress } from '../../src/components/OnboardingProgress';
import { useSession } from '../../src/stores/session';

export default function Lock() {
  const router = useRouter();
  const theme = UnistylesRuntime.getTheme();
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
      router.replace('/(app)/home');
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.progress}><OnboardingProgress step={3} total={3} /></View>
      <View style={styles.body}>
        <Image source={require('../../assets/FaceIdBanner.png')} style={styles.banner} resizeMode="contain" />
        <Text variant="titleMedium">Lock your wallet</Text>
        <Text variant="subhead" color={theme.colors.muted} style={styles.sub}>
          Your recovery phrase is stored on this device only. A lock keeps it that
          way if someone else picks up your phone.
        </Text>
        {error ? <Text variant="subhead" color={theme.colors.danger}>{error}</Text> : null}
        <View style={{ flex: 1 }} />
        <Button title="Enable" onPress={() => proceed(false)} loading={busy} shape="pill" />
        <Button title="Not now" variant="ghost" onPress={() => proceed(true)} shape="pill" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.appBackground },
  progress: { paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.md },
  body: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg },
  banner: { width: '100%', height: 180, marginBottom: theme.spacing.lg },
  sub: { marginTop: 6 },
}));
