// ─────────────────────────────────────────────────────────────────────────────
//  The subname registry.
//
//  Every name Mercury issues lives here and nowhere else. There is no chain
//  involved, which is exactly why a new user can have `alice.mercurywallet.eth`
//  the moment they open the app instead of being asked to buy one.
//
//  A JSON file is the right size for this. It is a wallet's name directory, not
//  a ledger: nothing here holds value, everything here is public, and losing it
//  costs the names but not a cent of anyone's money. Swap it for a database when
//  there are enough names to care.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { verifyMessage, type Hex } from 'viem';

export interface NameRecords {
  /** The 0x address. One key, so this single record covers EVERY EVM chain —
   *  Arc, Base, Arbitrum, Sepolia. */
  evm?: string;
  /** SLIP-44 501. A genuinely different key, so it needs its own record. */
  solana?: string;
  /** SLIP-44 0. */
  bitcoin?: string;
  /** The chain they actually watch, as a chain id. A routing hint, not a
   *  different address. */
  prefer?: number;
  claimedAt?: number;
}

const STORE = resolvePath(process.env.NAMES_FILE ?? 'data/names.json');

/**
 * Labels people will read off a screen and type into a send field.
 *
 * Narrow on purpose. Mixed scripts and lookalike characters are how name
 * systems get used to impersonate people, and a wallet is precisely where that
 * pays off. ASCII letters, digits and inner hyphens only.
 */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Names that must never belong to a user, because they read as us. */
const RESERVED = new Set([
  'admin', 'support', 'help', 'security', 'billing', 'refund', 'refunds',
  'mercury', 'wallet', 'team', 'official', 'verify', 'verification',
  'www', 'api', 'hub', 'app', 'mail', 'root', 'system', 'staff', 'noreply',
]);

export type LabelCheck = { ok: true } | { ok: false; reason: string };

export function checkLabel(label: string): LabelCheck {
  if (!LABEL_RE.test(label)) {
    return { ok: false, reason: '3–30 characters, a–z, 0–9 and hyphens, not starting or ending with one' };
  }
  if (RESERVED.has(label)) return { ok: false, reason: 'That name is reserved' };
  return { ok: true };
}

type Store = Record<string, NameRecords>;

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    cache = existsSync(STORE) ? (JSON.parse(readFileSync(STORE, 'utf8')) as Store) : {};
  } catch {
    // A corrupt file must not silently become an empty registry that hands out
    // names somebody already has.
    throw new Error(`names store at ${STORE} is unreadable`);
  }
  return cache;
}

function persist(store: Store): void {
  mkdirSync(dirname(STORE), { recursive: true });
  // Write-then-rename: a crash mid-write leaves the old file intact rather than
  // a truncated one that would fail to parse on the next boot.
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, STORE);
  cache = store;
}

export function recordsFor(label: string): NameRecords | null {
  return load()[label] ?? null;
}

export function isTaken(label: string): boolean {
  return !!load()[label];
}

export function count(): number {
  return Object.keys(load()).length;
}

/**
 * The message a claimant signs.
 *
 * Every record being published is inside it. Signing only the label would let
 * the signature be lifted onto a different set of addresses — the thing being
 * authorised is not "I want this name", it is "this name points HERE".
 */
export function claimMessage(c: {
  label: string;
  parent: string;
  evm: string;
  solana?: string;
  bitcoin?: string;
  nonce: number;
}): string {
  return [
    'Mercury name claim',
    `name: ${c.label}.${c.parent}`,
    `evm: ${c.evm.toLowerCase()}`,
    `solana: ${c.solana ?? ''}`,
    `bitcoin: ${c.bitcoin ?? ''}`,
    `nonce: ${c.nonce}`,
  ].join('\n');
}

/** How far out of date a claim signature may be. */
const NONCE_WINDOW_MS = 10 * 60_000;

export type ClaimResult =
  | { ok: true; name: string; records: NameRecords }
  | { ok: false; status: 400 | 401 | 409; error: string };

/**
 * Claim a subname.
 *
 * First come, first served, and the claimant must PROVE control of the address
 * they are publishing. Without that check anyone could point
 * `yourbank.mercurywallet.eth` at their own wallet and wait — a name that
 * resolves to an address is a payment instruction, so the address has to be
 * theirs to give.
 *
 * Note what this does NOT prove: that they are entitled to the word. Ownership
 * of an address says nothing about a name, which is why the reserved list
 * exists and why the send screen always shows the resolved address.
 */
export async function claim(input: {
  label: string;
  parent: string;
  evm: string;
  solana?: string;
  bitcoin?: string;
  prefer?: number;
  nonce: number;
  signature: string;
}): Promise<ClaimResult> {
  const label = input.label.trim().toLowerCase();

  const check = checkLabel(label);
  if (!check.ok) return { ok: false, status: 400, error: check.reason };

  if (!/^0x[0-9a-fA-F]{40}$/.test(input.evm)) {
    return { ok: false, status: 400, error: 'evm must be a 0x address' };
  }
  if (Math.abs(Date.now() - input.nonce) > NONCE_WINDOW_MS) {
    return { ok: false, status: 400, error: 'Claim expired — sign again' };
  }

  const store = load();
  const existing = store[label];
  // Re-claiming your own name is how a user updates their records; someone
  // else's is simply refused.
  if (existing && existing.evm?.toLowerCase() !== input.evm.toLowerCase()) {
    return { ok: false, status: 409, error: 'That name is taken' };
  }

  const message = claimMessage({ ...input, label });
  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.evm as Hex,
      message,
      signature: input.signature as Hex,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, status: 401, error: 'Signature does not match that address' };

  const records: NameRecords = {
    evm: input.evm.toLowerCase(),
    solana: input.solana || undefined,
    bitcoin: input.bitcoin || undefined,
    prefer: input.prefer,
    claimedAt: existing?.claimedAt ?? Date.now(),
  };
  persist({ ...store, [label]: records });
  return { ok: true, name: `${label}.${input.parent}`, records };
}

/** Test seam — drops the in-memory copy so a fresh file is read. */
export function _resetCache(): void {
  cache = null;
}
