import { requireNativeModule } from 'expo';

interface SecureKeystoreNative {
  wrap(plaintext: Uint8Array, alias: string): Promise<Uint8Array>;
  unwrap(ciphertext: Uint8Array, alias: string): Promise<Uint8Array>;
  remove(alias: string): Promise<void>;
  /** Whether `alias`'s wrapping key is in the Secure Enclave rather than a
   *  software keychain key. See SecureEnclaveKeystore.isHardwareBacked. */
  isHardwareBacked(alias: string): Promise<boolean>;
}

export default requireNativeModule<SecureKeystoreNative>('SecureKeystore');
