import type { NfcTransport, NfcSession } from 'standard-rn';
import StandardNfc from '../../modules/standard-nfc/src/StandardNfcModule';

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}

/**
 * `NfcTransport` implementation backed by the native `StandardNfc` module
 * (iOS CoreNFC / Android IsoDep). The Rust core calls these over the ubrn
 * callback bridge to drive the card; we only marshal the opaque session handle
 * (u64 ↔ JS number) and APDU bytes (ArrayBuffer ↔ Uint8Array).
 */
export class NativeNfcTransport implements NfcTransport {
  async beginSession(prompt: string): Promise<NfcSession> {
    const id = await StandardNfc.beginSession(prompt);
    return BigInt(id);
  }

  async sendApdu(session: NfcSession, apdu: ArrayBuffer): Promise<ArrayBuffer> {
    const out = await StandardNfc.sendApdu(Number(session), new Uint8Array(apdu));
    return toArrayBuffer(out);
  }

  async endSession(session: NfcSession): Promise<void> {
    await StandardNfc.endSession(Number(session));
  }
}

/** Whether NFC hardware is available + enabled on this device. */
export function nfcAvailable(): Promise<boolean> {
  return StandardNfc.isAvailable();
}
