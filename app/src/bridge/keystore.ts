import type { KeystoreBackend } from 'mercury-wallet-core';
import SecureKeystore from '../../modules/secure-keystore/src/SecureKeystoreModule';

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // Always copy into a fresh, non-shared ArrayBuffer (keystore payloads are tiny).
  return u8.slice().buffer as ArrayBuffer;
}

/**
 * `KeystoreBackend` implementation that wraps/unwraps the BIP-39 seed using a
 * Secure Enclave P-256 key (via the native `SecureKeystore` module). The Rust
 * core calls these methods over the ubrn callback bridge; the SE private key
 * never leaves the chip.
 */
export class SecureEnclaveKeystore implements KeystoreBackend {
  async wrap(plaintext: ArrayBuffer, alias: string): Promise<ArrayBuffer> {
    const out = await SecureKeystore.wrap(new Uint8Array(plaintext), alias);
    return toArrayBuffer(out);
  }

  async unwrap(ciphertext: ArrayBuffer, alias: string): Promise<ArrayBuffer> {
    const out = await SecureKeystore.unwrap(new Uint8Array(ciphertext), alias);
    return toArrayBuffer(out);
  }

  async delete_(alias: string): Promise<void> {
    await SecureKeystore.remove(alias);
  }
}
