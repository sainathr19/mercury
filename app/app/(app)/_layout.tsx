import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="receive" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="send" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="activity" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
