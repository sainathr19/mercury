// ─────────────────────────────────────────────────────────────────────────────
//  Claiming a Mercury name.
//
//  `alice.mercurywallet.eth` is a real ENS name that any wallet, explorer or dapp
//  can resolve — and it costs nothing, because it lives offchain behind a
//  CCIP-Read resolver rather than in the registry. That is what makes it possible
//  to hand one to every user at signup instead of asking them to buy one.
//
//  Two things worth being precise about:
//
//  • The claim is authenticated by the WALLET, not by a login. The user signs a
//    message with the same key that holds their money, which proves the address
//    they are publishing is actually theirs. No account, no session, no server
//    that can hand somebody's name to somebody else.
//
//  • The name is a convenience, never a guarantee. Owning an address proves
//    nothing about deserving a word, which is why the send screen still shows the
//    resolved address before anything moves.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalletInterface } from 'standard-rn';

/** The names service rides on the same hub as the Gateway relayer. */
const HUB_URL = process.env.EXPO_PUBLIC_RELAYER_URL ?? '';

/** The 2LD our subnames sit under. */
export const NAME_PARENT = process.env.EXPO_PUBLIC_ENS_PARENT || 'mercurywallet.eth';

export const namesConfigured = (): boolean => !!HUB_URL;

/** `alice` -> `alice.mercurywallet.eth` */
export const fullName = (label: string): string => `${label}.${NAME_PARENT}`;

/** Mirrors the hub's rule so the obvious mistakes are caught before a round trip. */
export function validateLabel(label: string): string | null {
  if (label.length < 3) return 'At least 3 characters.';
  if (label.length > 30) return 'At most 30 characters.';
  if (!/^[a-z0-9-]+$/.test(label)) return 'Letters, numbers and hyphens only.';
  if (label.startsWith('-') || label.endsWith('-')) return 'Cannot start or end with a hyphen.';
  return null;
}

export type Availability =
  | { state: 'available'; name: string }
  | { state: 'taken'; reason: string }
  | { state: 'unknown' };

/**
 * Is this name free?
 *
 * "Unknown" is a distinct answer from "taken" and the two must not be merged —
 * telling someone a name is gone because the network hiccuped sends them off to
 * pick a worse one for no reason.
 */
export async function checkName(label: string, signal?: AbortSignal): Promise<Availability> {
  if (!HUB_URL) return { state: 'unknown' };
  try {
    const res = await fetch(`${HUB_URL}/ens/available/${encodeURIComponent(label)}`, { signal });
    if (!res.ok) return { state: 'unknown' };
    const json = (await res.json()) as { available?: boolean; reason?: string; name?: string };
    if (json.available) return { state: 'available', name: json.name ?? fullName(label) };
    return { state: 'taken', reason: json.reason ?? 'That name is taken' };
  } catch {
    return { state: 'unknown' };
  }
}

export type ClaimOutcome =
  | { ok: true; name: string }
  | { ok: false; error: string };

const utf8 = (s: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * Claim a name and publish every address the wallet holds under it.
 *
 * All three address families go up together: the 0x address (which covers Arc,
 * Base, Arbitrum and every other EVM chain at once, since they share one key),
 * Solana, and Bitcoin. One name, everything the user can be paid at.
 *
 * The exact message to sign comes FROM the hub rather than being rebuilt here.
 * Two implementations of one string format drift, and when they drift the
 * signature check fails with nothing to say why.
 */
export async function claimName(opts: {
  wallet: WalletInterface;
  account: number;
  label: string;
  evm: string;
  solana?: string | null;
  bitcoin?: string | null;
  /** The chain the user actually watches, published as an ENSIP-11 hint. */
  prefer?: number;
}): Promise<ClaimOutcome> {
  if (!HUB_URL) return { ok: false, error: 'Names are not configured for this build.' };

  const body = {
    label: opts.label,
    evm: opts.evm,
    solana: opts.solana ?? undefined,
    bitcoin: opts.bitcoin ?? undefined,
  };

  try {
    const prep = await fetch(`${HUB_URL}/ens/claim/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!prep.ok) return { ok: false, error: 'Could not reach the names service.' };
    const { message, nonce } = (await prep.json()) as { message: string; nonce: number };

    const signature = await opts.wallet.evmPersonalSign(opts.account, utf8(message));

    const res = await fetch(`${HUB_URL}/ens/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, prefer: opts.prefer, nonce, signature }),
    });
    const json = (await res.json()) as { ok?: boolean; name?: string; error?: string };
    if (res.ok && json.ok && json.name) return { ok: true, name: json.name };
    return { ok: false, error: json.error ?? 'Could not claim that name.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not claim that name.' };
  }
}
