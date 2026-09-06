import { requireNativeModule } from 'expo';

interface SecureKeystoreNative {
  wrap(plaintext: Uint8Array, alias: string): Promise<Uint8Array>;
  unwrap(ciphertext: Uint8Array, alias: string): Promise<Uint8Array>;
  remove(alias: string): Promise<void>;
}

export default requireNativeModule<SecureKeystoreNative>('SecureKeystore');
