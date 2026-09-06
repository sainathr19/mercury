import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';
import { useSession } from '../src/stores/session';

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
    if (ready) router.replace(DESTINATION[route]);
  }, [ready, route, router]);
  return (
    <View style={styles.center}>
      <ActivityIndicator color={UnistylesRuntime.getTheme().colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.appBackground },
}));
