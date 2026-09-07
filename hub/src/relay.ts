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
import { CHAIN_BY_DOMAIN, GATEWAY_MINTER, GATEWAY_MINTER_ABI } from './chains.js';
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
  attestation: Hex;
  signature: Hex;
  relayerKey: Hex;
  budget: Budget;
}): Promise<RelayResult> {
  const t0 = Date.now();
  let reservation: string | null = null;
  const chain = CHAIN_BY_DOMAIN[args.destinationDomain];
  if (!chain) {
    return { ok: false, error: `Unsupported destination domain ${args.destinationDomain}`, ms: Date.now() - t0 };
  }

  try {
    const account = privateKeyToAccount(args.relayerKey);
    const pub = createPublicClient({ chain, transport: http() });
    const wallet = createWalletClient({ account, chain, transport: http() });

    // Refuse rather than broadcast a transaction we know cannot pay for itself —
    // a clear error beats an opaque RPC failure.
    const gas = await pub.getBalance({ address: account.address });
    if (gas === 0n) {
      return { ok: false, error: `Relayer has no gas on ${chain.name}`, ms: Date.now() - t0 };
    }

    // Book before broadcasting. Checking after would let concurrent callers each
    // pass a limit none of them could afford together.
    const gasPrice = await pub.getGasPrice();
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
      address: GATEWAY_MINTER,
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
