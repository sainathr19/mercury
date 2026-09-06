import { Stack } from 'expo-router';

/** Nested stack for the Receive (Add Funds) flow, so the address screen is a
 *  real push — giving native swipe-back to "Choose Network", mirroring Send. */
export default function ReceiveLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
