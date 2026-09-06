//! Encryption for "seamless" receive hints (the instant send/receive relay).
//
// A sender POSTs a small hint ({chain, token, amount, txHash, …}) to a relay
// mailbox so the recipient's phone can credit the balance instantly, before the
// RPC scan sees the tx. That hint is ENCRYPTED to the recipient so the relay
// (and anyone polling a mailbox) only ever sees opaque bytes — it learns nothing
// beyond what's already public on-chain.
//
// Scheme (all pure-JS, no native module, no Rust round-trip):
//   • Each wallet has a STATIC X25519 identity derived deterministically from its
//     mnemonic — no RNG, stable across launches, and the public half is published
//     to the hub (resolveHandle → enc_pub) so a sender can encrypt to a @handle.
//   • Each hint is an anonymous sealed box: ephemeral X25519 key → ECDH → HKDF →
//     XChaCha20-Poly1305. Only the holder of the recipient's static secret can
//     open it; a wrong-recipient / wrong-scheme blob fails AEAD auth → null.
//
// This is a UX side channel, NOT the wallet's value security — funds are still
// governed entirely on-chain. The mnemonic never leaves the device; only the
// X25519 public key does.

import 'react-native-get-random-values'; // ensure global.crypto.getRandomValues for randomBytes
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha2';
import { hkdf } from '@noble/hashes/hkdf';
import { randomBytes, bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { loadMnemonic } from './seedVault';
import { getActiveAlias } from './wallet';

const VERSION = 1;
const EPH_LEN = 32;
const NONCE_LEN = 24;
const HKDF_INFO = utf8ToBytes('SEAMLESS/v0/hint');

export interface EncIdentity {
  /** Static X25519 secret scalar (32 bytes) — never leaves the device. */
  sk: Uint8Array;
  /** Static X25519 public key, hex — published to the hub as `enc_pub`. */
  pubHex: string;
}

/** Deterministically derive the wallet's X25519 identity from its mnemonic.
 *  Pure (no RNG) so both the identity and its published pubkey are stable. */
export function deriveEncIdentity(mnemonic: string[]): EncIdentity {
  const sk = sha256(utf8ToBytes(`SEAMLESS/enc/v0|${mnemonic.join(' ')}`)); // 32 bytes
  return { sk, pubHex: bytesToHex(x25519.getPublicKey(sk)) };
}

// Cache the derived identity per alias so the receive poller isn't re-reading
// the keychain + re-deriving every few seconds.
const identityCache = new Map<string, EncIdentity>();

/** Load (and cache) the active wallet's encryption identity, or null if the
 *  mnemonic isn't available (e.g. locked / not yet set up). */
export async function loadEncIdentity(): Promise<EncIdentity | null> {
  const alias = getActiveAlias();
  const cached = identityCache.get(alias);
  if (cached) return cached;
  const mnemonic = await loadMnemonic(alias);
  if (!mnemonic || !mnemonic.length) return null;
  const id = deriveEncIdentity(mnemonic);
  identityCache.set(alias, id);
  return id;
}

/** Drop the cached identity for an alias (call on wallet reset / sign-out). */
export function clearEncIdentity(alias?: string): void {
  if (alias) identityCache.delete(alias);
  else identityCache.clear();
}

function keyFor(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  // Bind the derived key to both public keys so a blob can't be replayed against
  // a different recipient, and salt with the ephemeral key for per-message keys.
  return hkdf(sha256, shared, concatBytes(ephPub, recipientPub), HKDF_INFO, 32);
}

/** Seal `plaintext` to a recipient's X25519 public key (hex). Returns base64. */
export function sealTo(recipientPubHex: string, plaintext: Uint8Array): string {
  const recipientPub = hexToBytes(recipientPubHex);
  const ephSk = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephSk);
  const shared = x25519.getSharedSecret(ephSk, recipientPub);
  const key = keyFor(shared, ephPub, recipientPub);
  const nonce = randomBytes(NONCE_LEN);
  const aad = new Uint8Array([VERSION]);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  return base64.encode(concatBytes(new Uint8Array([VERSION]), ephPub, nonce, ct));
}

/** Open a sealed box with this wallet's static secret. Returns the plaintext, or
 *  null if the blob isn't ours / isn't this scheme / fails authentication. */
export function openSealed(sk: Uint8Array, b64: string): Uint8Array | null {
  try {
    const blob = base64.decode(b64);
    if (blob.length < 1 + EPH_LEN + NONCE_LEN || blob[0] !== VERSION) return null;
    let o = 1;
    const ephPub = blob.slice(o, (o += EPH_LEN));
    const nonce = blob.slice(o, (o += NONCE_LEN));
    const ct = blob.slice(o);
    const shared = x25519.getSharedSecret(sk, ephPub);
    const myPub = x25519.getPublicKey(sk);
    const key = keyFor(shared, ephPub, myPub);
    const aad = new Uint8Array([VERSION]);
    return xchacha20poly1305(key, nonce, aad).decrypt(ct);
  } catch {
    return null; // wrong recipient, tampered, or malformed → not for us
  }
}

export { utf8ToBytes, bytesToHex };
