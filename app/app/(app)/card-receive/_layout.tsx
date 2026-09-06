import { Stack } from 'expo-router';
import { UnistylesRuntime } from 'react-native-unistyles';

/**
 * The receive-via-card flow as a nested native stack inside the form sheet.
 * Each step (amount → confirm) is its own screen, giving the native nav bar
 * (close/back top-left) and a slide-from-right push between steps. Mirrors the
 * Send flow's `send/_layout.tsx`.
 */
export default function CardReceiveLayout() {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.appBackground },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { color: theme.colors.text },
        contentStyle: { backgroundColor: theme.colors.appBackground },
      }}
    />
  );
}
