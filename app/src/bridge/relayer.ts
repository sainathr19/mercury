//! The mint relayer — a service, not a chain.
//
// A Gateway send has a second half the wallet cannot do for itself. Circle
// attests the burn instantly, but the funds only appear once someone submits
// that attestation to GatewayMinter on the DESTINATION chain — an ordinary
// transaction, needing gas there. Making the recipient do it would break the
// wallet's "no gas token" promise at the worst possible moment.
//
// So the hub does it. Handing over the payload is safe: Circle signs it and the
// recipient is named INSIDE the signature, so a relayer cannot redirect, alter
// or skim anything. Its only power is whether to submit.
//
// Split out of `gateway.ts` because it is a different thing with a different
// failure mode — Circle being up says nothing about our hub being funded — and
// because the pending-claim store needs to resubmit without importing the whole
// Gateway client back into itself.
import { chainForDomain, type ChainEnvironment } from '../lib/chains';

// Its OWN service, not the identity/registry hub — different lifetimes,
// different keys, different failure modes, so a different URL.
const RELAYER_URL = process.env.EXPO_PUBLIC_RELAYER_URL ?? '';

export const relayerConfigured = (): boolean => !!RELAYER_URL;

/** How long to wait for the mint before reporting it undelivered. */
const RELAY_TIMEOUT_MS = 90_000;

export interface RelayResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  ms: number;
}

export interface DeliveryStatus {
  /** Safe to burn for this destination. */
  ok: boolean;
  /** Why not, phrased for a person rather than a log. */
  reason?: string;
  /**
   * The domain is served and the relayer is configured, but its funding could
   * not be confirmed — an older hub that does not publish balances. Proceeding
   * is reasonable (it is the bar the app used to apply unconditionally) but the
   * caller should say so rather than promise delivery.
   */
  unverified?: boolean;
  /** Relayer address, when published — so an empty one can be topped up. */
  relayer?: string;
}

interface DomainsResponse {
  environment?: string;
  relayer?: string | null;
  relayerConfigured?: boolean;
  domains?: { domain: number; chain: string; chainId: number; gasWei?: string | null; ready?: boolean | null }[];
}

/**
 * Can a burn for `destinationDomain` actually be delivered right now?
 *
 * Asked BEFORE signing anything. Circle debits the unified balance the moment a
 * burn intent is accepted, so every check that happens after that point is a
 * post-mortem: the money has moved and the only question left is whether it can
 * be claimed. Everything answerable in advance is answered here.
 *
 * Fails CLOSED. An unreachable hub means unknown, and burning into unknown is
 * exactly the mistake this exists to prevent — a send that cannot happen is a
 * disabled button, while a burn that cannot be delivered is someone's money.
 */
export async function deliveryStatus(
  destinationDomain: number,
  env: ChainEnvironment,
): Promise<DeliveryStatus> {
  if (!RELAYER_URL) {
    return { ok: false, reason: 'Instant sends are not configured in this build.' };
  }
  let json: DomainsResponse;
  try {
    const res = await fetch(`${RELAYER_URL}/gateway/domains?environment=${env}`);
    if (!res.ok) return { ok: false, reason: 'The delivery service is not responding.' };
    json = (await res.json()) as DomainsResponse;
  } catch {
    return { ok: false, reason: 'Could not reach the delivery service.' };
  }

  if (json.relayerConfigured === false) {
    return { ok: false, reason: 'The delivery service has no signing key configured.' };
  }

  const row = json.domains?.find((d) => d.domain === destinationDomain);
  if (!row) {
    // Name the chain if we know it. A domain number in an error message tells
    // the user nothing, but there is no guarantee we have the chain either.
    const name = chainForDomain(destinationDomain, env)?.name;
    return {
      ok: false,
      reason: name
        ? `Instant delivery is not available on ${name}.`
        : 'Instant delivery is not available on that network.',
    };
  }

  const relayer = json.relayer ?? undefined;
  // `null` is unknown and `undefined` is an older hub. Neither is a refusal:
  // both mean the funding question could not be answered, which is where the
  // app was before this endpoint existed.
  if (row.ready === false) {
    return { ok: false, reason: `The delivery service is out of gas on ${row.chain}.`, relayer };
  }
  if (row.ready === null || row.ready === undefined) {
    return { ok: true, unverified: true, relayer };
  }
  return { ok: true, relayer };
}

// ── Submitting ───────────────────────────────────────────────────────────────

/**
 * Ask the hub to submit an attestation on the destination chain.
 *
 * `env` is not optional. Circle reuses domain ids across environments — domain 6
 * is Base on mainnet and Base Sepolia on testnet — so a domain alone would let
 * the hub mint on the wrong network.
 */
export async function relayMint(
  attestation: string,
  signature: string,
  destinationDomain: number,
  env: ChainEnvironment,
): Promise<RelayResult> {
  const t0 = Date.now();
  if (!RELAYER_URL) return { ok: false, error: 'Relayer is not configured', ms: 0 };
  // Bounded, because this call is made AFTER the burn. Without a deadline a
  // stalled connection leaves the promise pending for as long as the OS will
  // hold it, and the send screen sits on "Sending" forever — for money that has
  // already left the balance. Giving up is not losing it: the claim was
  // recorded before this ran, so failing here produces the `unclaimed` outcome,
  // which tells the truth and lets delivery retry.
  //
  // Generous on purpose. The relayer mints on the destination chain and waits
  // for the receipt, which is ~5s on Arc but a couple of blocks on Ethereum, so
  // this has to outlast a slow chain rather than a slow request.
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(`${RELAYER_URL}/gateway/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attestation, signature, destinationDomain, environment: env }),
      signal: abort.signal,
    });
    const json = (await res.json()) as RelayResult;
    return { ...json, ms: Date.now() - t0 };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: timedOut
        ? 'The delivery service did not answer in time.'
        : e instanceof Error
          ? e.message
          : 'Relay failed',
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(deadline);
  }
}
