// In-memory stand-in for the native keychain.
//
// The suites that pull this in (authStore, auth) inject their own fake client
// and never intend to touch the keychain — it arrives purely through the import
// graph, and the real module needs the native bridge, so requiring it made the
// suite fail to LOAD. Behaving like a real store rather than throwing means a
// test that does reach for it gets sane behaviour instead of a crash.
const store = new Map();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'afterFirstUnlockThisDeviceOnly';

export async function getItemAsync(key) {
  return store.has(key) ? store.get(key) : null;
}
export async function setItemAsync(key, value) {
  store.set(key, String(value));
}
export async function deleteItemAsync(key) {
  store.delete(key);
}
export async function isAvailableAsync() {
  return true;
}
