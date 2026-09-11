// ─────────────────────────────────────────────────────────────────────────────
//  Gateway mint relayer.
//
//  Circle hands back an attestation instantly, but the funds only appear once
//  someone submits it to GatewayMinter on the DESTINATION chain — a normal
//  transaction, needing gas there. Making the recipient do that breaks the
//  wallet's "no gas token" promise at exactly the wrong moment, so the relayer
//  does it for them.
//
//  Why this is safe to run for anyone: the attestation is signed by Circle and
//  names the recipient inside the signed payload. A relayer cannot redirect,
//  alter or skim it — the only power it has is whether to submit. So the worst
//  a hostile relayer can do is decline, and the worst a hostile CALLER can do is
//  waste our gas.
//
//  That last part was left as a comment for too long. Wasting our gas is cheap
//  for an attacker and expensive for us: valid attestations can be minted by
//  making one's own tiny Gateway transfers at Circle's flat fee, and each one
//  submitted here costs 400,000 gas — roughly a thousand times the attacker's
//  outlay, from `curl`, with no app involved. So every submission is now booked
//  against a spend budget before it is sent.
// ─────────────────────────────────────────────────────────────────────────────
import { createWalletClient, createPublicClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  chainFor,
  CHAINS_BY_ENV,
  gatewayMinter,
  GATEWAY_MINTER_ABI,
  type RelayEnvironment,
} from './chains.js';
import type { Budget } from './budget.js';

export interface RelayResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  ms: number;
}

/**
 * Arc's EVM quirks apply to every chain we touch here, and one of them is
 * genuinely dangerous: a receipt does NOT throw on revert. Every mint must
 * assert `status === 'success'` or a failed claim reports as a success.
 */
const MINT_GAS = 400_000n;

export async function relayMint(args: {
  destinationDomain: number;
  environment: RelayEnvironment;
  attestation: Hex;
  signature: Hex;
  relayerKey: Hex;
  budget: Budget;
}): Promise<RelayResult> {
  const t0 = Date.now();
  let reservation: string | null = null;
  const chain = chainFor(args.environment, args.destinationDomain);
  if (!chain) {
    return {
      ok: false,
      error: `Unsupported destination domain ${args.destinationDomain} on ${args.environment}`,
      ms: Date.now() - t0,
    };
  }

  try {
    const account = privateKeyToAccount(args.relayerKey);
    const pub = createPublicClient({ chain, transport: http() });
    const wallet = createWalletClient({ account, chain, transport: http() });

    // Refuse rather than broadcast a transaction we know cannot pay for itself —
    // a clear error beats an opaque RPC failure.
    //
    // Measured against the actual cost of a mint, not against zero. A balance of
    // one wei is not zero and used to pass this check, then fail at broadcast
    // having already told the caller everything was fine.
    const [gas, gasPrice] = await Promise.all([
      pub.getBalance({ address: account.address }),
      pub.getGasPrice(),
    ]);
    const cost = MINT_GAS * gasPrice;
    if (gas < cost) {
      return {
        ok: false,
        error:
          gas === 0n
            ? `Relayer has no gas on ${chain.name}`
            : `Relayer cannot afford a mint on ${chain.name}`,
        ms: Date.now() - t0,
      };
    }

    // Book before broadcasting. Checking after would let concurrent callers each
    // pass a limit none of them could afford together.
    // Global cap only, for now.
    //
    // The right key is the TransferSpec's `sourceDepositor` — the person whose
    // money is moving. NOT the recipient, which would let an attacker exhaust a
    // victim's allowance by sending them dust. Taking it from the request body
    // is worthless because the body is attacker-controlled, and reading it out
    // of the attestation means decoding Circle's payload layout, which is not
    // verified here. Guessing an offset would silently bill the wrong party.
    //
    // So: the daily ceiling and the gas-price refusal, which together bound the
    // exposure that mattered. Per-depositor limits once the layout is confirmed
    // against a real payload.
    const booked = args.budget.reserve(null, MINT_GAS, gasPrice);
    if (!booked.ok) return { ok: false, error: booked.error, ms: Date.now() - t0 };
    reservation = booked.id;

    const hash = await wallet.writeContract({
      address: gatewayMinter(args.environment),
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [args.attestation, args.signature],
      gas: MINT_GAS,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });
    // A revert burns the gas too, so it is charged either way.
    args.budget.settle(reservation, receipt.gasUsed * receipt.effectiveGasPrice);
    reservation = null;
    if (receipt.status !== 'success') {
      return { ok: false, txHash: hash, error: 'Mint reverted on chain', ms: Date.now() - t0 };
    }

    const base = chain.blockExplorers?.default.url;
    return {
      ok: true,
      txHash: hash,
      explorerUrl: base ? `${base}/tx/${hash}` : undefined,
      ms: Date.now() - t0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Relay failed';
    // An already-claimed attestation is a NORMAL race (the user or another
    // relayer got there first), not a failure worth alarming anyone about.
    if (/already used|already minted|nonce/i.test(msg)) {
      return { ok: true, error: 'Already claimed', ms: Date.now() - t0 };
    }
    return { ok: false, error: msg.slice(0, 200), ms: Date.now() - t0 };
  } finally {
    // Never broadcast → nothing owed.
    if (reservation) args.budget.release(reservation);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Readiness, published.
//
//  The app burns USDC through Circle BEFORE it calls this relayer: a burn intent
//  debits the unified balance and returns an attestation, and only then does
//  anyone submit the mint. So a relayer that is out of gas does not merely fail
//  a send — it fails one whose money has already moved.
//
//  `relayMint` refuses cleanly in that case, but by then it is too late to be
//  useful. Publishing readiness lets the app check BEFORE it signs anything,
//  which turns an unrecoverable surprise into a disabled button.
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainStatus {
  domain: number;
  chain: string;
  chainId: number;
  /** Relayer's native balance. `null` when the chain could not be reached —
   *  unknown, which is NOT the same as empty and must not read as either. */
  gasWei: string | null;
  /** Enough to pay for one mint at the current gas price. `null` = unknown. */
  ready: boolean | null;
}

export interface RelayerStatus {
  environment: RelayEnvironment;
  /** The address that pays. Published so it can be topped up without asking. */
  relayer: string;
  domains: DomainStatus[];
}

/** Balances move slowly relative to how often a screen asks. Short enough to
 *  notice a top-up, long enough that this endpoint cannot be used to amplify
 *  load onto the public RPCs. */
const STATUS_TTL_MS = 15_000;
const statusCache = new Map<RelayEnvironment, { at: number; value: RelayerStatus }>();

export async function relayerStatus(
  env: RelayEnvironment,
  relayerKey: Hex,
): Promise<RelayerStatus> {
  const hit = statusCache.get(env);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;

  const account = privateKeyToAccount(relayerKey);
  const entries = Object.entries(CHAINS_BY_ENV[env]);

  const domains = await Promise.all(
    entries.map(async ([domain, chain]): Promise<DomainStatus> => {
      const base = { domain: Number(domain), chain: chain.name, chainId: chain.id };
      try {
        const pub = createPublicClient({ chain, transport: http() });
        const [gas, gasPrice] = await Promise.all([
          pub.getBalance({ address: account.address }),
          pub.getGasPrice(),
        ]);
        return { ...base, gasWei: gas.toString(), ready: gas >= MINT_GAS * gasPrice };
      } catch {
        // An unreachable chain is unknown. Reporting `false` would tell the app
        // to disable a send that might work; reporting `true` would tell it to
        // burn into one that cannot.
        return { ...base, gasWei: null, ready: null };
      }
    }),
  );

  const value: RelayerStatus = { environment: env, relayer: account.address, domains };
  statusCache.set(env, { at: Date.now(), value });
  return value;
}
