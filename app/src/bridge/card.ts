import type {
  WalletInterface,
  PairedCardInfo,
  CardVendor,
  VendorApprovalRequest,
  VendorApprovalResponse,
} from 'standard-rn';
import { NativeNfcTransport } from './nfc';
import { NativeOwnerAuth } from './ownerAuth';

/** Standard Wallet applet AID (see standard-ios/reset-card.sh). */
export const APPLET_AID_HEX = 'A00000080953544401';

/**
 * Vendor-approval relay endpoint. The Rust core defaults to relay.standard.xyz;
 * override here (or via settings) to point at a local/tunnelled relay.
 */
export const VENDOR_RELAY_URL = 'https://relay.standard.xyz';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}

/**
 * Encode a numeric PIN as one byte per digit value ("123456" → [1,2,3,4,5,6]),
 * matching the iOS `StandardWalletCard.pinBytes` convention the applet expects.
 */
export function pinToBytes(pin: string): ArrayBuffer {
  const digits = pin.trim();
  const out = new Uint8Array(digits.length);
  for (let i = 0; i < digits.length; i++) out[i] = digits.charCodeAt(i) - 48;
  return toArrayBuffer(out);
}

const appletAid = (): ArrayBuffer => toArrayBuffer(hexToBytes(APPLET_AID_HEX));

/**
 * Register the NFC transport, owner-auth backend, and vendor relay on a freshly
 * opened/created wallet. Required before any `card*` call. Idempotent per
 * wallet instance.
 */
export function configureCard(wallet: WalletInterface): void {
  try {
    wallet.setNfcTransport(new NativeNfcTransport());
    wallet.setOwnerAuth(new NativeOwnerAuth());
    wallet.setVendorRelayEndpoint(VENDOR_RELAY_URL);
  } catch (e) {
    // Non-fatal: card features are optional; the rest of the wallet still works.
    console.warn('[card] configureCard failed', e);
  }
}

// ---- High-level card operations (thin wrappers over the Rust facade) -------

export function listCards(wallet: WalletInterface): Promise<PairedCardInfo[]> {
  return wallet.cardList();
}

/** First-tap pairing: reads the card's attestation pubkey and pins it. */
export function pairCard(wallet: WalletInterface, label?: string): Promise<string> {
  return wallet.cardPair(appletAid(), label);
}

export function unpairCard(wallet: WalletInterface, cardId: string): Promise<void> {
  return wallet.cardUnpair(cardId);
}

/** Burn the owner Secure-Enclave key onto the card; returns its public id hex. */
export function setupOwnerKey(wallet: WalletInterface, cardId: string, pin: string): Promise<string> {
  return wallet.cardSetupOwnerKey(cardId, pinToBytes(pin));
}

export function listVendors(wallet: WalletInterface, cardId: string, pin: string): Promise<CardVendor[]> {
  return wallet.cardVendorList(cardId, pinToBytes(pin));
}

export function removeVendor(wallet: WalletInterface, cardId: string, vendorIndex: number, pin: string): Promise<void> {
  return wallet.cardVendorRemove(cardId, vendorIndex, pinToBytes(pin));
}

export function approveVendor(wallet: WalletInterface, request: VendorApprovalRequest): Promise<VendorApprovalResponse> {
  return wallet.cardVendorApprove(request);
}

export function registerRelay(wallet: WalletInterface, cardId: string, cardPublicId: string, pushToken: string): Promise<void> {
  return wallet.cardVendorRegisterRelay(cardId, cardPublicId, pushToken);
}

export function pollVendorRequests(wallet: WalletInterface, cardPublicId: string): Promise<VendorApprovalRequest[]> {
  return wallet.cardVendorPollRequests(cardPublicId);
}
