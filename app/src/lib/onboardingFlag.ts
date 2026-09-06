// Tracks whether a first-run wallet was CREATED but the user hasn't finished
// onboarding yet (Face ID + the backup step). `session.create()` persists the
// wallet to disk immediately so the backup flow can read it — but if the user
// kills the app mid-onboarding, on the next launch `walletExists()` is true with
// no in-memory mnemonic, so the root gate would silently drop them into an
// unconfirmed wallet. This persisted flag lets bootstrap detect that abandoned
// state and wipe it instead. Set while a create-mnemonic is pending; cleared the
// moment the user actually reaches the app.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onboarding:incomplete';

export async function setOnboardingIncomplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort; worst case we fail open (old behavior) rather than lock out
  }
}

export async function clearOnboardingIncomplete(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}

export async function isOnboardingIncomplete(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}
