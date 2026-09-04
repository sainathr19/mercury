// Native-only. Kept OUT of vault.ts so the Node test suite can import the
// vault without pulling in expo-secure-store.
import * as SecureStore from 'expo-secure-store';
import type { Storage } from './vault';

/** Device Storage. SecureStore keeps values in the Keychain / Keystore. */
export function secureStorage(): Storage {
  return {
    async get(k) { return SecureStore.getItemAsync(k); },
    async set(k, v) {
      // THIS_DEVICE_ONLY keeps the recovery phrase out of iCloud Keychain
      // backups. A phrase that syncs to the cloud is no longer only on device.
      await SecureStore.setItemAsync(k, v, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async del(k) { await SecureStore.deleteItemAsync(k); },
  };
}
