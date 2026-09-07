// ─────────────────────────────────────────────────────────────────────────────
//  Claiming a Mercury name.
//
//  `alice.mercurywallet.eth` is a real ENS name that any wallet, explorer or
//  dapp can resolve. Records live in a contract on Ethereum, so once a name is
//  registered it resolves forever — no server, no signing key, nothing of ours
//  that has to stay running. If Mercury disappeared tomorrow the name would
//  still work in MetaMask.
//
//  The cost of that independence is a transaction. The alternative (offchain
//  names via CCIP-Read) is free but puts an HTTP service on the critical path of
//  every lookup, permanently — a dependency that outlives the company.
//
//  Two things worth being precise about:
//
//  • Registration happens on ETHEREUM, because that is where ENS lives — the one
//    action in this wallet that needs a gas token. So we ask the relayer to pay
//    it, and only fall back to spending the user's own ETH if it declines. The
//    contract takes the owner as a parameter, so a sponsored name belongs to the
//    user exactly as much as one they paid for; the sponsor is the payer, never
//    the owner.
//
//  • A name is a convenience, never a guarantee. Registering proves you control
//    an address; it proves nothing about deserving a word. The send screen still
//    shows the resolved address before anything moves.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalletInterface } from 'standard-rn';
import { keccak_256 } from '@noble/hashes/sha3';
import { ethCall, sendCall, uint, waitForReceipt, word } from './evmTx';
import { getActiveEnvironment } from './activeEnv';
import { chainById } from '../lib/chains';

/** The relayer that pays registration gas. Same service as the Gateway relay. */
const SPONSOR_URL = process.env.EXPO_PUBLIC_RELAYER_URL ?? '';

/** The deployed MercuryNameRegistry, which is also the resolver on the parent. */
const REGISTRY = process.env.EXPO_PUBLIC_ENS_REGISTRY ?? '';

/** The 2LD our subnames sit under. */
export const NAME_PARENT = process.env.EXPO_PUBLIC_ENS_PARENT || 'mercurywallet.eth';

/** ENS lives on Ethereum. Sepolia while Arc is testnet-only. */
const ensChainId = (): bigint => (getActiveEnvironment() === 'mainnet' ? 1n : 11155111n);

const SEL_REGISTER = '0xfd3b28e0'; // register(string,address,address,string,string,uint64)
const SEL_AVAILABLE = '0xaeb8ce9b'; // available(string)
const SEL_RECORDS_OF = '0x13f8bc29'; // recordsOf(string)
const SEL_RESERVED = '0x92698814'; // reserved(bytes32)

export const namesConfigured = (): boolean => !!REGISTRY;

/** `alice` -> `alice.mercurywallet.eth` */
export const fullName = (label: string): string => `${label}.${NAME_PARENT}`;

/** Mirrors the contract's own rule, so the obvious mistakes cost no gas. */
export function validateLabel(label: string): string | null {
  if (label.length < 3) return 'At least 3 characters.';
  if (label.length > 30) return 'At most 30 characters.';
  if (!/^[a-z0-9-]+$/.test(label)) return 'Letters, numbers and hyphens only.';
  if (label.startsWith('-') || label.endsWith('-')) return 'Cannot start or end with a hyphen.';
  return null;
}

// ── ABI encoding ─────────────────────────────────────────────────────────────

const pad = (h: string): string => h + '0'.repeat((64 - (h.length % 64)) % 64);

const utf8Hex = (s: string): string =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

/** keccak256 of the label — how the contract keys its `reserved` mapping. */
export const labelHash = (label: string): string =>
  Array.from(keccak_256(new TextEncoder().encode(label)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A dynamic `string` as length + padded data. */
const strTail = (s: string): string => {
  const h = utf8Hex(s);
  return uint(BigInt(h.length / 2)) + pad(h);
};

/**
 * `register(string label, address to, address evm, string solana, string bitcoin, uint64 prefer)`
 *
 * Hand-rolled because the wallet has no ABI encoder — the head holds an offset
 * for each dynamic argument, measured from the start of the arguments, and the
 * tails follow in order. Unit-tested against viem byte for byte: a wrong offset
 * does not error, it registers a name nobody asked for.
 */
export function encodeRegister(a: {
  label: string;
  to: string;
  evm: string;
  solana: string;
  bitcoin: string;
  prefer: bigint;
}): string {
  const tails = [strTail(a.label), strTail(a.solana), strTail(a.bitcoin)];
  const HEAD = 6 * 32;
  const labelAt = BigInt(HEAD);
  const solanaAt = labelAt + BigInt(tails[0].length / 2);
  const bitcoinAt = solanaAt + BigInt(tails[1].length / 2);
  return (
    SEL_REGISTER +
    uint(labelAt) +
    word(a.to) +
    word(a.evm) +
    uint(solanaAt) +
    uint(bitcoinAt) +
    uint(a.prefer) +
    tails.join('')
  );
}

/** `available(string label)` / `recordsOf(string label)` — one dynamic argument. */
const encodeOneString = (selector: string, s: string): string =>
  selector + uint(32n) + strTail(s);

// ── Reads ────────────────────────────────────────────────────────────────────

export type Availability =
  | { state: 'available'; name: string }
  | { state: 'taken'; reason: string }
  | { state: 'unknown' };

function rpcUrl(): string | undefined {
  return chainById(ensChainId())?.rpcUrl;
}

/**
 * Is this name free?
 *
 * "Unknown" is a distinct answer from "taken" and the two must not be merged —
 * telling someone a name is gone because an RPC hiccuped sends them off to pick
 * a worse one for no reason.
 */
export async function checkName(label: string): Promise<Availability> {
  const url = rpcUrl();
  if (!REGISTRY || !url) return { state: 'unknown' };
  const local = validateLabel(label);
  if (local) return { state: 'taken', reason: local };
  try {
    const raw = await ethCall(url, REGISTRY, encodeOneString(SEL_AVAILABLE, label));
    if (!raw || raw === '0x') return { state: 'unknown' };
    if (BigInt(raw) === 1n) return { state: 'available', name: fullName(label) };
    // `available` is false for taken AND reserved. Telling someone a name they
    // can never have is "taken" invites them to wait for it.
    return { state: 'taken', reason: (await isReserved(url, label)) ? 'That name is reserved' : 'That name is taken' };
  } catch {
    return { state: 'unknown' };
  }
}

/** Reserved labels are ones that read as us — `support`, `admin`, `refunds`. */
async function isReserved(url: string, label: string): Promise<boolean> {
  try {
    const raw = await ethCall(url, REGISTRY, SEL_RESERVED + labelHash(label));
    return !!raw && raw !== '0x' && BigInt(raw) === 1n;
  } catch {
    return false;
  }
}

/** The name a wallet already owns, if any — read back from the chain. */
export async function ownedRecords(
  label: string,
): Promise<{ owner: string; evm: string } | null> {
  const url = rpcUrl();
  if (!REGISTRY || !url) return null;
  try {
    const raw = await ethCall(url, REGISTRY, encodeOneString(SEL_RECORDS_OF, label));
    const h = raw.replace(/^0x/, '');
    if (h.length < 128) return null;
    const owner = `0x${h.slice(24, 64)}`;
    if (/^0x0+$/.test(owner)) return null;
    return { owner, evm: `0x${h.slice(88, 128)}` };
  } catch {
    return null;
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

export type ClaimOutcome =
  | { ok: true; name: string; txHash: string; sponsored: boolean }
  | { ok: false; error: string };

const utf8 = (s: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * Ask the relayer to register the name and pay for it.
 *
 * Returns null when sponsorship is simply unavailable — not configured, out of
 * gas, rate-limited — so the caller can fall back to paying. A string is a
 * reason to STOP: the name is taken, or the claim was refused, and paying would
 * fail the same way for the same reason.
 */
/** The sponsor is a convenience, not a dependency. If it does not answer
 *  promptly we pay for ourselves rather than leaving the user on a spinner. */
const SPONSOR_TIMEOUT_MS = 20_000;

async function withTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function trySponsor(opts: {
  wallet: WalletInterface;
  account: number;
  label: string;
  evm: string;
  solana?: string | null;
  bitcoin?: string | null;
  prefer?: number;
}): Promise<{ outcome: ClaimOutcome } | { unavailable: true } | null> {
  if (!SPONSOR_URL) return { unavailable: true };
  const body = {
    label: opts.label,
    evm: opts.evm,
    solana: opts.solana ?? undefined,
    bitcoin: opts.bitcoin ?? undefined,
  };
  try {
    const prep = await withTimeout(
      `${SPONSOR_URL}/names/claim-message`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      SPONSOR_TIMEOUT_MS,
    );
    if (!prep.ok) return { unavailable: true };
    const { message, nonce } = (await prep.json()) as { message: string; nonce: number };

    // The wallet signs for itself. This is what proves the address being
    // published is the user's, and it is the only reason paying for a stranger's
    // registration is safe.
    const signature = await opts.wallet.evmPersonalSign(opts.account, utf8(message));

    // The registration itself is mined before the sponsor replies, so this one
    // waits considerably longer than the handshake above.
    const res = await withTimeout(
      `${SPONSOR_URL}/names/sponsor`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, prefer: opts.prefer, nonce, signature }),
      },
      90_000,
    );
    const json = (await res.json()) as { ok?: boolean; name?: string; txHash?: string; error?: string };
    if (res.ok && json.ok && json.name && json.txHash) {
      return { outcome: { ok: true, name: json.name, txHash: json.txHash, sponsored: true } };
    }
    // 409 means the name is gone — paying our own gas would revert identically.
    if (res.status === 409) return { outcome: { ok: false, error: json.error ?? 'That name is taken' } };
    return { unavailable: true };
  } catch {
    return { unavailable: true };
  }
}

/**
 * Register a name and publish every address in one transaction.
 *
 * Tries the sponsor first, so the common path costs the user nothing and needs
 * no gas token. Falls back to paying directly — a name the user paid for and a
 * sponsored one are the same name, owned the same way.
 *
 * All three address families go up together. A name that resolves on some
 * chains and not others is worse than no name, because the sender cannot tell
 * which case they are in.
 */
export async function claimName(opts: {
  wallet: WalletInterface;
  account: number;
  label: string;
  evm: string;
  solana?: string | null;
  bitcoin?: string | null;
  prefer?: number;
}): Promise<ClaimOutcome> {
  const url = rpcUrl();
  if (!REGISTRY || !url) return { ok: false, error: 'Names are not configured for this build.' };

  const sponsored = await trySponsor(opts);
  if (sponsored && 'outcome' in sponsored) return sponsored.outcome;

  const data = encodeRegister({
    label: opts.label,
    to: opts.evm,
    evm: opts.evm,
    solana: opts.solana ?? '',
    bitcoin: opts.bitcoin ?? '',
    prefer: BigInt(opts.prefer ?? 0),
  });

  try {
    const tx = await sendCall(
      opts.wallet, opts.account, ensChainId(), url, opts.evm, REGISTRY, data,
    );
    // A name is not claimed until it is mined. Reporting success on broadcast
    // would show the user a name that may never exist.
    const mined = await waitForReceipt(url, tx);
    return mined
      ? { ok: true, name: fullName(opts.label), txHash: tx, sponsored: false }
      : { ok: false, error: 'The registration did not confirm. Nothing was claimed.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The one predictable failure for a wallet whose users hold no gas token.
    if (/insufficient funds|gas required|balance/i.test(msg)) {
      // Both routes are shut: the sponsor declined and the wallet cannot pay.
      // Say which, or the user has no idea what to do about it.
      return {
        ok: false,
        error: `Name sponsorship is unavailable right now, and claiming one directly is an Ethereum transaction that needs ${
          getActiveEnvironment() === 'mainnet' ? 'ETH' : 'Sepolia ETH'
        } for gas.`,
      };
    }
    return { ok: false, error: msg };
  }
}
