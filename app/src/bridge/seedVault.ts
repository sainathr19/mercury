import * as SecureStore from 'expo-secure-store';

// Recovery phrases live in the iOS Keychain / Android Keystore (hardware-
// encrypted at rest), one entry per wallet alias. Reveal is gated by biometrics
// at the UI layer (lib/biometrics).
function keyFor(alias: string): string {
  return `mercury.mnemonic.${alias}`;
}

/** The key this used to be written under.
 *
 *  A wallet installed before the rename has its recovery phrase filed here and
 *  nowhere else. Reads fall back to it and rewrite under the new key, because a
 *  phrase the app cannot find is indistinguishable from one that is gone — and
 *  the only way back would be for the user to retype 12 words they may not have
 *  kept. Delete this once no install predates the rename. */
function legacyKeyFor(alias: string): string {
  return `standard.mnemonic.${alias}`;
}

export async function saveMnemonic(words: string[], alias = 'primary'): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(alias), words.join(' '));
  } catch {
    // non-fatal: recovery reveal just won't be available later
  }
}

export async function loadMnemonic(alias = 'primary'): Promise<string[] | null> {
  try {
    const v = await SecureStore.getItemAsync(keyFor(alias));
    if (v) return v.split(' ');
    // Written before the rename? Move it across, then answer from the new key.
    const legacy = await SecureStore.getItemAsync(legacyKeyFor(alias));
    if (!legacy) return null;
    await SecureStore.setItemAsync(keyFor(alias), legacy).catch(() => {});
    return legacy.split(' ');
  } catch {
    return null;
  }
}

export async function clearMnemonic(alias = 'primary'): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(alias));
    // Clear the pre-rename copy too. Leaving it behind would keep a recovery
    // phrase in the keychain after the user asked for it to be gone.
    await SecureStore.deleteItemAsync(legacyKeyFor(alias));
  } catch {}
}
