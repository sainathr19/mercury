import * as SecureStore from 'expo-secure-store';

// Recovery phrases live in the iOS Keychain / Android Keystore (hardware-
// encrypted at rest), one entry per wallet alias. Reveal is gated by biometrics
// at the UI layer (lib/biometrics).
function keyFor(alias: string): string {
  return `mercury.mnemonic.${alias}`;
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
    return v ? v.split(' ') : null;
  } catch {
    return null;
  }
}

export async function clearMnemonic(alias = 'primary'): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(alias));
  } catch {}
}
