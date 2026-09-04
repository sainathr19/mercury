import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/stores/session';
import { c } from '../src/ui/theme';

const DESTINATION = {
  'welcome': '/(auth)/welcome',
  'set-lock': '/(auth)/lock',
  'ready-unnamed': '/(app)/home',
  'ready': '/(app)/home',
} as const;

export default function Gate() {
  const router = useRouter();
  const { ready, route } = useSession();
  useEffect(() => {
    if (ready) router.replace(DESTINATION[route] as never);
  }, [ready, route, router]);
  return <View style={s.center}><ActivityIndicator color={c.accent} /></View>;
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
});
