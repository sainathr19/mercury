import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="enable-faceid" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="import" />
      <Stack.Screen name="restore" />
      <Stack.Screen name="backup-prompt" />
    </Stack>
  );
}
