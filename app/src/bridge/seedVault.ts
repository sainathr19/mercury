import * as SecureStore from 'expo-secure-store';

// ─────────────────────────────────────────────────────────────────────────────
//  The recovery phrase.
//
//  This is the one secret in the wallet that cannot be rotated: change the
//  device, change the passcode, reinstall the app — the phrase is still the
//  wallet. So it is stored under the strictest keychain class iOS offers, and
//  the biometric gate lives in the keychain rather than in app code.
//
//  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY buys three things:
//    • it is excluded from every backup and from device-to-device restore, so
//      the phrase cannot leave the phone it was created on;
//    • it cannot be written at all on a device with no passcode;
//    • removing the passcode DELETES it rather than leaving it on a newly
//      unprotected device. That last one is the reason for this class over
//      WHEN_UNLOCKED_THIS_DEVICE_ONLY, and it is behaviour an app cannot
//      implement for itself.
//
//  `requireAuthentication` moves the check from a JavaScript `if` — which can
//  fail open — to the operating system refusing to return bytes.
// ─────────────────────────────────────────────────────────────────────────────

function keyFor(alias: string): string {
  return `mercury.mnemonic.${alias}`;
}

const PROMPT = 'Unlock to use your recovery phrase';

/** Options every write must carry. Omitting them silently falls back to
 *  WHEN_UNLOCKED with no authentication — which is how this started. */
function hardened(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: PROMPT,
  };
}

/**
 * Whether this device can hold a recovery phrase at all.
 *
 * False on a device with no passcode or no enrolled biometrics. The wallet still
 * works there — the seed lives in the Secure-Enclave-wrapped database — but the
 * phrase is not written, because the only classes that would accept it are ones
 * that survive a backup.
 */
export function canStorePhrase(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export async function saveMnemonic(words: string[], alias = 'primary'): Promise<void> {
  if (!canStorePhrase()) return; // see canStorePhrase — deliberate, not a failure
  try {
    await SecureStore.setItemAsync(keyFor(alias), words.join(' '), hardened());
  } catch {
    // Non-fatal: the wallet is unaffected, only in-app reveal is unavailable.
  }
}

/**
 * Read the phrase, prompting for biometrics or the device passcode.
 *
 * Also migrates: an install from before this file was hardened has its phrase
 * under the old, unauthenticated, backup-eligible attributes. Those items are
 * readable without a prompt, so the first read rewrites them under the strict
 * class and deletes the original. Leaving the old copy behind would mean the
 * hardening bought nothing — the weaker item would still be the one in backups.
 */
export async function loadMnemonic(alias = 'primary'): Promise<string[] | null> {
  const key = keyFor(alias);
  try {
    const v = await SecureStore.getItemAsync(key, hardened());
    if (v) return v.split(' ');
  } catch {
    // Prompt cancelled, or nothing stored under the strict attributes yet.
    // Fall through: a pre-hardening item may still be there.
  }

  try {
    const legacy = await SecureStore.getItemAsync(key);
    if (!legacy) return null;
    if (canStorePhrase()) {
      await SecureStore.setItemAsync(key, legacy, hardened());
    } else {
      // Cannot re-store it safely on this device, and leaving it under the old
      // attributes keeps it in backups. Removing it is the safer of the two.
      await SecureStore.deleteItemAsync(key);
    }
    return legacy.split(' ');
  } catch {
    return null;
  }
}

export async function clearMnemonic(alias = 'primary'): Promise<void> {
  const key = keyFor(alias);
  // Delete under both option sets: a keychain item written with different
  // attributes is a different item, and "forget this wallet" has to mean it.
  try {
    await SecureStore.deleteItemAsync(key, hardened());
  } catch {}
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}
