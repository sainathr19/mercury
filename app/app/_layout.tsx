import '../src/polyfills';
import '../src/theme/unistyles';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { fontAssets } from '../src/theme/fonts';
import { ToastHost, ErrorBoundary } from '../src/ui';
import { useSession } from '../src/stores/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const init = useSession((s) => s.init);
  const [fontsLoaded] = useFonts(fontAssets);

  useEffect(() => { void init(); }, [init]);
  useEffect(() => { if (fontsLoaded) void SplashScreen.hideAsync(); }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
        <ToastHost />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
