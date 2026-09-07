import { requireNativeModule } from 'expo';

/**
 * Zero-knowledge cloud backup of a small (<1 KB) opaque wallet blob.
 *
 * The blob is stored in the user's OWN cloud — iOS CloudKit private database,
 * Android Google Drive `appDataFolder` — so it syncs with the user's account
 * and never touches our servers. This module only moves opaque bytes: it never
 * sees keys, seeds, or plaintext. The Rust wallet core encrypts/decrypts the
 * blob; we just `put`/`get`/`delete` it under a caller-chosen `id`. Mirrors
 * `secure-keystore` and `the NFC module`.
 *
 * Bytes cross the bridge as `Uint8Array` (Expo marshals to `Data` on iOS and
 * `ByteArray` on Android), matching how `secure-keystore`/`the NFC module` pass
 * binary payloads — no base64.
 *
 * - `putBlob` saves-or-updates the blob for `id` (idempotent).
 * - `getBlob` returns the blob, or `null` when no backup exists for `id`.
 * - `deleteBlob` removes the backup for `id` (no-op if absent).
 * - `isAvailable` reports whether the user's cloud is usable right now
 *   (iOS: an iCloud account is signed in; Android: the Drive scope is granted).
 */
interface CloudBackupNative {
  putBlob(id: string, bytes: Uint8Array): Promise<void>;
  getBlob(id: string): Promise<Uint8Array | null>;
  deleteBlob(id: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

// Resolve lazily: `requireNativeModule` throws synchronously when the native
// module isn't compiled into the running client (e.g. a stale dev client or
// Expo Go). Cloud backup is an optional feature, so resolve on first use and
// degrade gracefully instead of crashing app bootstrap.
let cached: CloudBackupNative | null | undefined;

function resolve(): CloudBackupNative | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<CloudBackupNative>('CloudBackup');
  } catch {
    cached = null;
    console.warn('[CloudBackup] native module unavailable — rebuild the dev client to enable cloud backup');
  }
  return cached;
}

/** Whether the native cloud-backup module is present in this client build. */
export function isCloudBackupModuleAvailable(): boolean {
  return resolve() !== null;
}

function required(): CloudBackupNative {
  const mod = resolve();
  if (!mod) throw new Error('Cloud backup is unavailable in this build. Rebuild the app (expo run:ios/android) to enable it.');
  return mod;
}

const CloudBackup: CloudBackupNative = {
  putBlob: (id, bytes) => required().putBlob(id, bytes),
  getBlob: (id) => required().getBlob(id),
  deleteBlob: (id) => required().deleteBlob(id),
  // When the module isn't compiled in, the user's cloud is effectively unusable.
  isAvailable: () => (resolve() ? required().isAvailable() : Promise.resolve(false)),
};

export default CloudBackup;
