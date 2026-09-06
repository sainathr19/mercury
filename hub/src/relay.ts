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
//  waste our gas. That is a rate-limiting problem, not a custody one.
// ─────────────────────────────────────────────────────────────────────────────
import { createWalletClient, createPublicClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_BY_DOMAIN, GATEWAY_MINTER, GATEWAY_MINTER_ABI } from './chains.js';

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
}): Promise<RelayResult> {
  const t0 = Date.now();
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

    const hash = await wallet.writeContract({
      address: GATEWAY_MINTER,
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [args.attestation, args.signature],
      gas: MINT_GAS,
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });
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
  }
}
