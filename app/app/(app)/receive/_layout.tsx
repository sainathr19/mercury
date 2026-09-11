import { Stack } from 'expo-router';

/**
 * Nested stack for the Receive (Add Funds) flow.
 *
 * One screen now that addresses expand in place instead of being pushed — but
 * the nesting is still load-bearing: `index.tsx` reaches the sheet's detents
 * with `navigation.getParent()`, which resolves to the `(app)` stack only
 * because this layer sits in between.
 */
export default function ReceiveLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
