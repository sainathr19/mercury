import type { OwnerAuthBackend } from 'standard-rn';
import StandardNfc from '../../modules/standard-nfc/src/StandardNfcModule';

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}

/**
 * `OwnerAuthBackend` implementation backed by the native Secure Enclave (iOS) /
 * Android Keystore P-256 key. The Rust core uses this to burn the owner public
 * key onto a card (`SET_OWNER_KEY`) and to sign vendor-approval messages
 * (Face ID on device). The private key never leaves secure hardware.
 */
export class NativeOwnerAuth implements OwnerAuthBackend {
  async generateOwnerKey(cardId: string): Promise<ArrayBuffer> {
    const out = await StandardNfc.ownerGenerateKey(cardId);
    return toArrayBuffer(out);
  }

  async sign(cardId: string, message: ArrayBuffer): Promise<ArrayBuffer> {
    const out = await StandardNfc.ownerSign(cardId, new Uint8Array(message));
    return toArrayBuffer(out);
  }

  async delete_(cardId: string): Promise<void> {
    await StandardNfc.ownerDelete(cardId);
  }
}
