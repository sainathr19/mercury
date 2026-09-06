import StandardNfc from '../../modules/standard-nfc/src/StandardNfcModule';

/**
 * High-level APDU client for the minimal Standard Wallet JavaCard applet,
 * ported from `standard-ios`'s `StandardWalletCard`. Drives the native NFC
 * transport directly (beginSession/sendApdu/endSession).
 *
 * Commands:
 *   SELECT      (00 A4) — select applet by AID
 *   GET_STATUS  (80 32) — [provisioned:1][triesRemaining:1]
 *   IMPORT_KEY  (80 10) — one-time pairing: burn PIN + EVM/SOL/BTC keys
 *   VERIFY_PIN  (80 20) — unlock the card for this session
 *   GET_PUBKEY  (80 40) — 65-byte uncompressed EVM pubkey
 *   GET_SOLPUB  (80 41) — 32-byte Ed25519 (Solana) pubkey
 *   SIGN_HASH   (80 50) — ECDSA-sign 32-byte hash (EVM key) → DER
 *   SIGN_BTC    (80 52) — ECDSA-sign 32-byte hash (BTC m/84' key) → DER
 *   SIGN_ED     (80 51) — Ed25519-sign message (Solana) → 64 bytes
 */

export const APPLET_AID = new Uint8Array([0xa0, 0x00, 0x00, 0x08, 0x09, 0x53, 0x54, 0x44, 0x01]);

export type CardErrorKind =
  | 'alreadyInitialized'
  | 'wrongPin'
  | 'channelRequired'
  | 'cardLocked'
  | 'responseLength'
  | 'sw';

export class CardError extends Error {
  kind: CardErrorKind;
  constructor(kind: CardErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'CardError';
  }
}

/** Encode a short ISO-7816 APDU. case 4 (data+Le) or case 2 (Le only). */
function encodeApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data: Uint8Array = new Uint8Array(0),
  le = 256
): Uint8Array {
  const leByte = le >= 256 ? 0x00 : le;
  if (data.length > 0) {
    const out = new Uint8Array(5 + data.length + 1);
    out.set([cla, ins, p1, p2, data.length], 0);
    out.set(data, 5);
    out[5 + data.length] = leByte;
    return out;
  }
  return new Uint8Array([cla, ins, p1, p2, leByte]);
}

/** A live NFC session against the applet. Open with `CardSession.open`. */
export class CardSession {
  private constructor(readonly id: number) {}

  static async open(prompt: string): Promise<CardSession> {
    const id = await StandardNfc.beginSession(prompt);
    return new CardSession(id);
  }

  async close(): Promise<void> {
    try {
      await StandardNfc.endSession(this.id);
    } catch {
      /* already closed */
    }
  }

  /** Transceive one APDU; checks the status word and returns the data bytes. */
  private async send(apdu: Uint8Array): Promise<Uint8Array> {
    const resp = await StandardNfc.sendApdu(this.id, apdu);
    if (resp.length < 2) throw new CardError('sw', 'Empty card response');
    const sw1 = resp[resp.length - 2];
    const sw2 = resp[resp.length - 1];
    const data = resp.subarray(0, resp.length - 2);
    if (sw1 === 0x90 && sw2 === 0x00) return data;
    if (sw1 === 0x69 && sw2 === 0x85) throw new CardError('alreadyInitialized', 'Card already has a wallet. Reset it before re-pairing.');
    if (sw1 === 0x69 && sw2 === 0x82) throw new CardError('wrongPin', 'Wrong PIN — check the PIN and try again');
    if (sw1 === 0x69 && sw2 === 0x83) throw new CardError('cardLocked', 'Card is locked — too many wrong PIN attempts. Reset the card to recover.');
    if (sw1 === 0x69 && sw2 === 0x00) throw new CardError('channelRequired', 'Card not unlocked — verify PIN first');
    throw new CardError('sw', `Card returned error ${hex(sw1)}${hex(sw2)}`);
  }

  selectApplet(): Promise<Uint8Array> {
    return this.send(encodeApdu(0x00, 0xa4, 0x04, 0x00, APPLET_AID));
  }

  async getStatus(): Promise<{ provisioned: boolean; triesRemaining: number }> {
    const resp = await this.send(encodeApdu(0x80, 0x32, 0, 0));
    if (resp.length < 2) throw new CardError('responseLength', `Expected 2 status bytes, got ${resp.length}`);
    return { provisioned: resp[0] === 0x01, triesRemaining: resp[1] };
  }

  /** Data: [pinLen][pin][evmPriv:32][evmPub:65][edSeed:32][edPub:32][btcPriv:32] */
  async importKey(args: {
    pin: Uint8Array;
    evmPriv: Uint8Array;
    evmPub: Uint8Array;
    edSeed: Uint8Array;
    edPub: Uint8Array;
    btcPriv: Uint8Array;
  }): Promise<void> {
    const { pin, evmPriv, evmPub, edSeed, edPub, btcPriv } = args;
    const payload = concat([new Uint8Array([pin.length]), pin, evmPriv, evmPub, edSeed, edPub, btcPriv]);
    await this.send(encodeApdu(0x80, 0x10, 0, 0, payload));
  }

  async verifyPin(pin: Uint8Array): Promise<void> {
    await this.send(encodeApdu(0x80, 0x20, 0, 0, pin));
  }

  async getPubkey(): Promise<Uint8Array> {
    const resp = await this.send(encodeApdu(0x80, 0x40, 0, 0));
    if (resp.length !== 65 || resp[0] !== 0x04) throw new CardError('responseLength', `Expected 65-byte pubkey, got ${resp.length}`);
    return resp;
  }

  async getSolPubkey(): Promise<Uint8Array> {
    const resp = await this.send(encodeApdu(0x80, 0x41, 0, 0));
    if (resp.length !== 32) throw new CardError('responseLength', `Expected 32-byte Sol pubkey, got ${resp.length}`);
    return resp;
  }

  signHash(hash: Uint8Array): Promise<Uint8Array> {
    return this.send(encodeApdu(0x80, 0x50, 0, 0, hash));
  }

  signBtcHash(hash: Uint8Array): Promise<Uint8Array> {
    return this.send(encodeApdu(0x80, 0x52, 0, 0, hash));
  }

  async signEd(message: Uint8Array): Promise<Uint8Array> {
    const resp = await this.send(encodeApdu(0x80, 0x51, 0, 0, message));
    if (resp.length !== 64) throw new CardError('responseLength', `Expected 64-byte Ed signature, got ${resp.length}`);
    return resp;
  }
}

/** "123456" → [1,2,3,4,5,6], matching the applet PIN format. */
export function pinBytes(pin: string): Uint8Array {
  const trimmed = pin.trim();
  const out = new Uint8Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) out[i] = trimmed.charCodeAt(i) - 48;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function hex(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase();
}
