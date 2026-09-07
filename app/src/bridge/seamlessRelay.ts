//! "Seamless" receive-hint transport over the stealth relay mailbox.
//
// Reuses the deployed stealth relay (a dumb, identity-blind store-and-forward
// mailbox: POST submit / GET fetch / POST ack, opaque base64 blobs, idempotent
// by content hash, TTL-pruned). We add NO server routes — just a new mailbox
// namespace + an encrypted payload:
//
//   • MAILBOX id is derived from the recipient's PUBLIC receive address, so the
//     sender (who is paying that address) and the recipient (who owns it) both
//     compute the same id with zero coordination and zero hub dependency.
//   • PAYLOAD is a hint sealed to the recipient's X25519 key (see seamlessCrypto)
//     — the relay only ever sees ciphertext.
//
// The hint lets the receiver credit an optimistic balance the instant the sender
// broadcasts, before its own RPC scan sees the tx. It is a UX accelerator only;
// correctness is still enforced by pendingBalanceStore reconciling every delta
// against the confirmed on-chain balance.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { STEALTH_RELAY_URL } from './hubConfig';
import { sealTo, openSealed, type EncIdentity } from './seamlessCrypto';

/** The decrypted hint a sender relays to a recipient about an incoming tx. */
export interface ReceiveHint {
  v: 1;
  chain: 'evm' | 'btc' | 'sol';
  /** EVM chain id (decimal string); absent for BTC/SOL. */
  chainId?: string;
  txHash: string;
  from: string;
  to: string;
  /** Human display amount (already scaled by decimals). */
  amount: number;
  symbol: string;
  decimals: number;
  coingeckoId: string;
  colorHex: string;
  /** EVM ERC-20 contract (native transfer if absent). */
  tokenContract?: string;
  /** SPL mint. */
  tokenMint?: string;
  name?: string;
  imageUrl?: string;
  networkName?: string;
  /** Sender timestamp (ms). */
  ts: number;
}

interface WirePending {
  announcement_id: string;
  announcement_bytes: string; // base64
  received_at: number;
}

/** Normalize an address for mailbox derivation: EVM is case-insensitive
 *  (checksum casing varies), BTC/SOL are case-sensitive. */
function normalizeAddress(address: string): string {
  const a = address.trim();
  return a.startsWith('0x') || a.startsWith('0X') ? a.toLowerCase() : a;
}

/** The relay mailbox id both parties derive from a public receive address. */
export function mailboxIdForAddress(address: string): string {
  return bytesToHex(sha256(utf8ToBytes(`SEAMLESS/v0/mailbox|${normalizeAddress(address)}`)));
}

function base() {
  return STEALTH_RELAY_URL.endsWith('/') ? STEALTH_RELAY_URL : `${STEALTH_RELAY_URL}/`;
}

// Minimal, dependency-free UTF-8 decode (Hermes lacks a guaranteed TextDecoder).
function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b0 < 0xf0)
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

/** Submit a receive hint to the recipient's mailbox. If `recipientEncPubHex` is
 *  given the hint is sealed (encrypted) to that key; otherwise it's sent as a
 *  plaintext base64 JSON blob so instant-receive still works before the hub can
 *  distribute encryption keys. A plaintext blob only exposes data that's already
 *  public on-chain (amount / tx hash / addresses) to whoever knows the recipient's
 *  address. Best-effort — resolves false (never throws) so a relay outage never
 *  blocks or fails the actual send. */
export async function submitReceiveHint(
  recipientEncPubHex: string | null,
  hint: ReceiveHint,
): Promise<boolean> {
  try {
    const json = utf8ToBytes(JSON.stringify(hint));
    const bytes = recipientEncPubHex ? sealTo(recipientEncPubHex, json) : base64.encode(json);
    const res = await fetch(`${base()}v1/announce/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient_mailbox_id: mailboxIdForAddress(hint.to), announcement_bytes: bytes }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Decode a mailbox blob into a hint: try to open it as a sealed box for us,
 *  else parse it as a plaintext base64 JSON hint. Returns null if neither. */
function decodeHint(identity: EncIdentity, b64: string): ReceiveHint | null {
  const opened = openSealed(identity.sk, b64);
  const raw = opened ?? tryPlaintext(b64);
  if (!raw) return null;
  try {
    const hint = JSON.parse(bytesToUtf8(raw)) as ReceiveHint;
    return hint && hint.v === 1 && hint.txHash && hint.to ? hint : null;
  } catch {
    return null;
  }
}

function tryPlaintext(b64: string): Uint8Array | null {
  try {
    const bytes = base64.decode(b64);
    // Plaintext hints are JSON → first byte '{'. A sealed box starts with its
    // version byte (0x01), so this never mistakes ciphertext for plaintext.
    return bytes[0] === 0x7b ? bytes : null;
  } catch {
    return null;
  }
}

export interface FetchedHint {
  hint: ReceiveHint;
  announcementId: string;
}

/** Poll the mailboxes for `addresses`, decrypt any hints addressed to us with
 *  `identity`, and return them with their announcement ids (for ack). Blobs that
 *  aren't ours / aren't valid hints are silently skipped. Never throws. */
export async function fetchReceiveHints(
  addresses: string[],
  identity: EncIdentity,
): Promise<FetchedHint[]> {
  const out: FetchedHint[] = [];
  const seenMailboxes = new Set<string>();
  await Promise.all(
    addresses
      .filter(Boolean)
      .map((addr) => {
        const id = mailboxIdForAddress(addr);
        if (seenMailboxes.has(id)) return null; // two chains, same mailbox id? dedupe the GET
        seenMailboxes.add(id);
        return id;
      })
      .filter((id): id is string => !!id)
      .map(async (mailboxId) => {
        try {
          const res = await fetch(`${base()}v1/announce/fetch/${mailboxId}`);
          if (!res.ok) return;
          const pending = (await res.json()) as WirePending[];
          for (const p of pending) {
            const hint = decodeHint(identity, p.announcement_bytes);
            if (hint) out.push({ hint, announcementId: p.announcement_id });
          }
        } catch {
          // relay/network error — skip this mailbox this round
        }
      }),
  );
  return out;
}

/** ACK processed announcements (soft-delete on the relay). Best-effort. */
export async function ackReceiveHints(announcementIds: string[]): Promise<void> {
  if (!announcementIds.length) return;
  try {
    await fetch(`${base()}v1/announce/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ announcement_ids: announcementIds }),
    });
  } catch {
    // if ack fails the blob re-appears next poll; our ledger dedupes by txHash
  }
}
