import { Stack } from 'expo-router';
import { UnistylesRuntime } from 'react-native-unistyles';

/**
 * The Send flow as a nested native stack inside the form sheet. Each step
 * (pick → address → amount → confirm) is its own screen, so we get the native
 * nav bar (close/back in the top-left) and a native slide-from-right push when
 * moving between steps. The `send` route in the parent (app) layout supplies
 * the form-sheet presentation; this stack lives inside it.
 */
export default function SendLayout() {
  const theme = UnistylesRuntime.getTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonDisplayMode: 'minimal', // chevron only, no "Back" label
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.appBackground },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { color: theme.colors.text },
        contentStyle: { backgroundColor: theme.colors.appBackground },
      }}
    />
  );
}
