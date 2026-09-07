// ─────────────────────────────────────────────────────────────────────────────
//  Sponsored name registration.
//
//  ENS lives on Ethereum, so claiming a name is an Ethereum transaction — the
//  one place a wallet built on "you never hold a gas token" runs out of road.
//  This pays that gas so the user does not have to.
//
//  ── How this differs from the mint relayer, and why it matters ──
//
//  relayMint is safe to expose to anyone because Circle signs the attestation
//  and names the recipient INSIDE the signed payload: the relayer's only power
//  is whether to submit. Here there is no third party vouching for anything. We
//  are choosing what to write into a name registry, and a name is a payment
//  instruction. So every protection has to come from this file:
//
//    • The caller signs a message naming the label and every address in it, and
//      the registration is made out to the RECOVERED signer — never to an
//      address taken from the request body. A forged body cannot redirect a name
//      because the body is not trusted for anything that matters.
//    • We only sponsor a name pointing at the signer's own address. Paying to
//      publish an address nobody proved they hold is how you fund a phishing
//      campaign.
//    • One sponsored name per address, and a daily ceiling. Gas is real money
//      and an open faucet is drained by the first script that finds it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  verifyMessage,
  type Chain,
  type Hex,
} from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'to', type: 'address' },
      { name: 'evm', type: 'address' },
      { name: 'solana', type: 'string' },
      { name: 'bitcoin', type: 'string' },
      { name: 'prefer', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** How far out of date a claim signature may be. */
const NONCE_WINDOW_MS = 10 * 60_000;

/** Registration is ~211k gas at the very most; this is headroom, not a target. */
const REGISTER_GAS = 320_000n;

const LEDGER = resolvePath(process.env.SPONSOR_LEDGER ?? 'data/sponsored.json');

/** Names paid for per address, and how many today. Abuse accounting only —
 *  the chain is the registry, this is just the bill. */
interface Ledger {
  byAddress: Record<string, string[]>;
  day: string;
  today: number;
}

let cache: Ledger | null = null;

function load(): Ledger {
  if (cache) return cache;
  try {
    cache = existsSync(LEDGER)
      ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger)
      : { byAddress: {}, day: '', today: 0 };
  } catch {
    // Losing the ledger costs accounting, not names — but silently starting
    // from zero would reopen the faucet, so say so loudly instead.
    throw new Error(`sponsor ledger at ${LEDGER} is unreadable`);
  }
  return cache;
}

function persist(l: Ledger): void {
  mkdirSync(dirname(LEDGER), { recursive: true });
  const tmp = `${LEDGER}.tmp`;
  writeFileSync(tmp, JSON.stringify(l, null, 2));
  renameSync(tmp, LEDGER);
  cache = l;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The message a claimant signs.
 *
 * Every record being published is inside it. Signing only the label would let
 * the signature be lifted onto a different set of addresses — what is being
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

export interface SponsorConfig {
  relayerKey: Hex;
  registry: Hex;
  parent: string;
  mainnet: boolean;
  /** Sponsored names allowed per address. */
  perAddress: number;
  /** Sponsored names allowed per day, across everyone. */
  perDay: number;
  rpcUrl?: string;
}

export type SponsorResult =
  | { ok: true; name: string; txHash: string; owner: string; ms: number }
  | { ok: false; status: 400 | 401 | 403 | 409 | 429 | 502 | 503; error: string; ms: number };

/** Labels in flight, so two simultaneous requests cannot both pay to register
 *  one name — the second would revert and the gas would be gone. */
const inFlight = new Set<string>();

export async function sponsorRegister(
  input: {
    label: string;
    evm: string;
    solana?: string;
    bitcoin?: string;
    prefer?: number;
    nonce: number;
    signature: string;
  },
  cfg: SponsorConfig,
): Promise<SponsorResult> {
  const t0 = Date.now();
  const fail = (status: 400 | 401 | 403 | 409 | 429 | 502 | 503, error: string): SponsorResult => ({
    ok: false, status, error, ms: Date.now() - t0,
  });

  const label = input.label.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(label)) return fail(400, 'Invalid label');
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.evm)) return fail(400, 'evm must be a 0x address');
  if (Math.abs(Date.now() - input.nonce) > NONCE_WINDOW_MS) {
    return fail(400, 'Claim expired — sign again');
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  // Everything below uses the address we VERIFIED, never the one we were told.
  const message = claimMessage({ ...input, label, parent: cfg.parent });
  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.evm as Hex,
      message,
      signature: normalizeSignature(input.signature) as Hex,
    });
  } catch {
    valid = false;
  }
  if (!valid) return fail(401, 'Signature does not match that address');
  const owner = input.evm.toLowerCase();

  // ── Ration ────────────────────────────────────────────────────────────────
  const ledger = load();
  if (ledger.day !== today()) {
    ledger.day = today();
    ledger.today = 0;
  }
  const already = ledger.byAddress[owner] ?? [];
  if (already.length >= cfg.perAddress) {
    return fail(403, `Already sponsored ${already.length} name(s) for this wallet.`);
  }
  if (ledger.today >= cfg.perDay) {
    return fail(429, 'Daily sponsorship limit reached. Try again tomorrow.');
  }
  if (inFlight.has(label)) return fail(409, 'That name is already being registered');

  const chain: Chain = cfg.mainnet ? mainnet : sepolia;
  const transport = http(cfg.rpcUrl);
  const account = privateKeyToAccount(cfg.relayerKey);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  inFlight.add(label);
  try {
    // Refuse rather than broadcast a transaction we know cannot pay for itself.
    if ((await pub.getBalance({ address: account.address })) === 0n) {
      return fail(503, `Sponsor wallet has no gas on ${chain.name}`);
    }

    // Check before paying. Registering a taken name reverts, and a reverted
    // transaction costs exactly as much gas as a successful one.
    const free = await pub.readContract({
      address: cfg.registry, abi: REGISTRY_ABI, functionName: 'available', args: [label],
    });
    if (!free) return fail(409, 'That name is taken');

    const hash = await wallet.writeContract({
      address: cfg.registry,
      abi: REGISTRY_ABI,
      functionName: 'register',
      // `to` and `evm` are the RECOVERED signer. This is the line that stops a
      // forged request from pointing a sponsored name anywhere it likes.
      args: [
        label,
        owner as Hex,
        owner as Hex,
        input.solana ?? '',
        input.bitcoin ?? '',
        BigInt(input.prefer ?? 0),
      ],
      gas: REGISTER_GAS,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      return { ok: false, status: 502, error: 'Registration reverted on chain', ms: Date.now() - t0 };
    }

    // Bill it only once it is real. Counting on broadcast would burn a user's
    // allowance on a transaction that never landed.
    persist({
      ...ledger,
      byAddress: { ...ledger.byAddress, [owner]: [...already, label] },
      today: ledger.today + 1,
    });

    return { ok: true, name: `${label}.${cfg.parent}`, txHash: hash, owner, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sponsorship failed';
    if (/name taken/i.test(msg)) return fail(409, 'That name is taken');
    if (/insufficient funds/i.test(msg)) return fail(503, 'Sponsor wallet is out of gas');
    return fail(502, msg.slice(0, 200));
  } finally {
    inFlight.delete(label);
  }
}

/**
 * Accept a 64-byte EIP-2098 compact signature, or one whose `v` is 0/1.
 *
 * Wallet cores differ here and a rejected-but-valid signature reads to the user
 * as "your wallet is wrong", which is both unhelpful and untrue.
 */
export function normalizeSignature(sig: string): string {
  const h = sig.replace(/^0x/, '');
  if (h.length === 128) {
    const r = h.slice(0, 64);
    const vs = BigInt(`0x${h.slice(64)}`);
    const v = 27 + Number(vs >> 255n);
    const s = (vs & ((1n << 255n) - 1n)).toString(16).padStart(64, '0');
    return `0x${r}${s}${v.toString(16).padStart(2, '0')}`;
  }
  if (h.length === 130) {
    const v = parseInt(h.slice(128), 16);
    if (v === 0 || v === 1) return `0x${h.slice(0, 128)}${(v + 27).toString(16).padStart(2, '0')}`;
  }
  return sig;
}

/** Test seam — drops the in-memory ledger so a fresh file is read. */
export function _resetLedger(): void {
  cache = null;
}
