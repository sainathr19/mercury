import '../src/polyfills';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useSession } from '../src/stores/session';
import { c } from '../src/ui/theme';

export default function RootLayout() {
  const init = useSession((s) => s.init);
  useEffect(() => { void init(); }, [init]);
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
    </>
  );
}
