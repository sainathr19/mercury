import { requireNativeModule } from 'expo';

/**
 * Native NFC + owner-auth bridge for the hardware-wallet card.
 *
 * The Rust core (`standard-wallet`) owns the APDU/secure-channel/signing
 * ceremony and drives the card through the `NfcTransport` callbacks below; this
 * module is the thin iOS CoreNFC / Android IsoDep transport plus the Secure
 * Enclave owner-auth key used for vendor approvals. Mirrors `secure-keystore`.
 *
 * - `beginSession` opens an NFC session (CoreNFC "hold your card" prompt on iOS,
 *   reader-mode on Android) and returns an opaque numeric session handle.
 * - `sendApdu` transceives one command APDU; the response is the raw response
 *   bytes with SW1/SW2 appended (the Rust side parses the status word).
 * - `endSession` closes the session and dismisses the prompt.
 * - `ownerGenerateKey` / `ownerSign` / `ownerDelete` back the `OwnerAuthBackend`;
 *   the P-256 private key never leaves the Secure Enclave / Android Keystore.
 */
interface StandardNfcNative {
  isAvailable(): Promise<boolean>;

  beginSession(prompt: string): Promise<number>;
  sendApdu(session: number, apdu: Uint8Array): Promise<Uint8Array>;
  endSession(session: number): Promise<void>;

  ownerGenerateKey(cardId: string): Promise<Uint8Array>;
  ownerSign(cardId: string, message: Uint8Array): Promise<Uint8Array>;
  ownerDelete(cardId: string): Promise<void>;

  bip39Seed(mnemonic: string): Promise<Uint8Array>;
}

// Resolve lazily: `requireNativeModule` throws synchronously when the native
// module isn't compiled into the running client (e.g. a stale dev client or
// Expo Go). Since this module is imported during app bootstrap, resolve on
// first use instead so the app always boots — only card features degrade.
let cached: StandardNfcNative | null | undefined;

function resolve(): StandardNfcNative | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<StandardNfcNative>('StandardNfc');
  } catch {
    cached = null;
    console.warn('[StandardNfc] native module unavailable — rebuild the dev client to enable card features');
  }
  return cached;
}

/** Whether the native NFC module is present in this client build. */
export function isNfcModuleAvailable(): boolean {
  return resolve() !== null;
}

function required(): StandardNfcNative {
  const mod = resolve();
  if (!mod) throw new Error('NFC is unavailable in this build. Rebuild the app (expo run:ios/android) to enable card features.');
  return mod;
}

const StandardNfc: StandardNfcNative = {
  isAvailable: () => (resolve() ? required().isAvailable() : Promise.resolve(false)),
  beginSession: (prompt) => required().beginSession(prompt),
  sendApdu: (session, apdu) => required().sendApdu(session, apdu),
  endSession: (session) => required().endSession(session),
  ownerGenerateKey: (cardId) => required().ownerGenerateKey(cardId),
  ownerSign: (cardId, message) => required().ownerSign(cardId, message),
  ownerDelete: (cardId) => required().ownerDelete(cardId),
  bip39Seed: (mnemonic) => required().bip39Seed(mnemonic),
};

export default StandardNfc;
