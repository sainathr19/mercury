//! Running a Garden swap: quote, order, fund.
//
// The same division of labour as the Orchestra path: Garden's API authorises
// with an app id, and the chain authorises with our own key. Garden takes no
// custody — it allocates an HTLC and waits for us to fund it — so the middle
// step is a transfer this wallet signs and broadcasts itself.
//
// ── What is verified and what is not ────────────────────────────────────────
//
// The catalog, the quote call and the error taxonomy were all read off the live
// API. The ORDER RESPONSE was not, and could not be: Garden's testnet has no
// configured order pairs at all (every quote answers "No order pair found", the
// order path answers "Invalid strategy id"), and every mainnet BTC route answers
// "insufficient liquidity". Measured with a valid app id — a bogus one returns
// 401, so the key is not the obstacle.
//
// So `fundingPlan` reads the order response DEFENSIVELY and refuses whenever it
// cannot find what it needs, rather than guessing at field names or encoding an
// HTLC call from a shape nobody has seen. A swap that declines to start costs
// the user nothing; one that funds the wrong address costs them the swap.
import type { WalletInterface } from 'mercury-wallet-core';
import { createOrder, quote, GardenError, gardenErrorMessage, type GardenOrder } from './garden';
import { sendBtc } from './transfer';
import { requireAuth, authFailureMessage } from '../lib/biometrics';
import { formatUnits, toBaseUnits } from '../lib/format';
import { recipientFor, type SwapAsset } from '../lib/gardenScope';
import { useGardenSwaps, type GardenLeg, type GardenSwapRecord } from '../stores/gardenSwapStore';
import type { ChainEnvironment } from '../lib/chains';

function leg(a: SwapAsset): GardenLeg {
  return {
    id: a.id,
    symbol: a.symbol,
    chainName: a.chainName,
    decimals: a.decimals,
    coingeckoId: a.coingeckoId,
  };
}

/** How the source side gets funded, or why it cannot be. */
export type FundingPlan =
  | { kind: 'transfer'; family: 'btc'; to: string; amountHuman: string }
  | { kind: 'refused'; reason: string };

/**
 * Where to send the source funds, read out of Garden's order response.
 *
 * UTXO sources are fundable with an ordinary transfer: Garden allocates a
 * per-order HTLC address and the swap begins when it is paid. That is a shape
 * this wallet already implements and can reason about.
 *
 * EVM and Solana sources are NOT, and deliberately are not attempted. Their
 * HTLCs are funded by calling a contract with a secret hash and a timelock, and
 * Garden returns the transactions to sign inside the order response — a shape
 * that could not be observed, because no route on either network will produce an
 * order. Encoding that call from the documentation alone would be exactly the
 * kind of unverified guess that moves money to the wrong place.
 */
export function fundingPlan(order: GardenOrder, source: SwapAsset, amountIn: string): FundingPlan {
  if (source.family !== 'btc') {
    return {
      kind: 'refused',
      reason:
        `Funding a ${source.chainName} swap needs Garden's initiate transaction, which this ` +
        `build does not yet encode. Swaps out of Bitcoin work; swaps out of ${source.symbol} do not.`,
    };
  }
  // Every plausible spelling, because the response shape is unobserved and a
  // missing field must read as "refuse", never as "send to undefined".
  const to =
    order.source_swap?.htlc_address ??
    (typeof order.source_swap?.['address'] === 'string' ? (order.source_swap['address'] as string) : undefined) ??
    (typeof order.source_swap?.['deposit_address'] === 'string'
      ? (order.source_swap['deposit_address'] as string)
      : undefined);

  if (!to) {
    return {
      kind: 'refused',
      reason: 'Garden did not return a deposit address for this order.',
    };
  }
  return { kind: 'transfer', family: 'btc', to, amountHuman: formatUnits(amountIn, source.decimals) };
}

export interface GardenSwapRequest {
  wallet: WalletInterface;
  addresses: { eth?: string; btc?: string; sol?: string };
  env: ChainEnvironment;
  source: SwapAsset;
  destination: SwapAsset;
  /** What the user typed, in whole units of the source asset. */
  amountHuman: string;
}

/** Below the catalog's own floor Garden rejects the quote, so say so first. */
export function checkAmount(source: SwapAsset, amountHuman: string): string | null {
  let units: bigint;
  try {
    units = toBaseUnits(amountHuman, source.decimals);
  } catch {
    return 'Enter a valid amount.';
  }
  if (units <= 0n) return 'Enter an amount.';
  const min = BigInt(source.minAmount);
  const max = BigInt(source.maxAmount);
  if (units < min) return `Minimum is ${formatUnits(source.minAmount, source.decimals)} ${source.symbol}.`;
  if (units > max) return `Maximum is ${formatUnits(source.maxAmount, source.decimals)} ${source.symbol}.`;
  return null;
}

/**
 * Quote, create the order, fund the source.
 *
 * Ordered so nothing irreversible happens before the user has been asked, and so
 * a failure at any step leaves a row that explains itself:
 *
 *  1. Bounds check — free, and catches the most common rejection.
 *  2. Face ID — before the quote, so a cancelled prompt does not burn the
 *     quote's window (the Orchestra path learned this the hard way).
 *  3. Quote, then order. Nothing has moved yet.
 *  4. Persist the record BEFORE funding, so a crash mid-transfer leaves an order
 *     id to recover from rather than an untracked payment.
 *  5. Fund. This is the only irreversible step.
 */
export async function createGardenSwap(req: GardenSwapRequest): Promise<GardenSwapRecord> {
  const { wallet, addresses, env, source, destination, amountHuman } = req;
  const store = useGardenSwaps.getState();

  const bad = checkAmount(source, amountHuman);
  if (bad) throw new Error(bad);

  const recipient = recipientFor(destination, addresses);
  if (!recipient) throw new Error(`No address to receive on ${destination.chainName}.`);
  const owner = recipientFor(source, addresses);
  if (!owner) throw new Error(`No ${source.chainName} address to swap from.`);

  const auth = await requireAuth(`Confirm to swap ${amountHuman} ${source.symbol}`);
  if (!auth.ok) throw new Error(authFailureMessage(auth.reason));

  const amountIn = toBaseUnits(amountHuman, source.decimals).toString();

  let q;
  try {
    q = await quote({ env, from: source.id, to: destination.id, fromAmount: amountIn });
  } catch (e) {
    // The classified message, not the raw one: a `no_pair` error is 100+
    // characters of two contract addresses.
    throw new Error(e instanceof GardenError ? gardenErrorMessage(e) : String(e));
  }

  const amountOut = q.destination?.amount ?? '0';
  const now = Date.now();
  // Local id until Garden assigns one, so the row exists even if the order call
  // fails — the user asked for something and deserves to see what happened.
  const localId = `local:${now.toString(36)}`;
  const record: GardenSwapRecord = {
    id: localId,
    remote: false,
    status: 'creating',
    environment: env,
    source: leg(source),
    destination: leg(destination),
    amountIn,
    amountOut,
    createdAt: now,
    updatedAt: now,
  };
  store.record(record);

  let order: GardenOrder;
  try {
    order = await createOrder({
      env,
      source: { asset: source.id, owner, amount: amountIn },
      // The quote's figure, never what the user typed — the solver agreed to
      // this number and will reject any other.
      destination: { asset: destination.id, owner: recipient, amount: amountOut },
    });
  } catch (e) {
    const msg = e instanceof GardenError ? gardenErrorMessage(e) : String(e);
    store.patch(localId, { status: 'fund_failed', error: msg });
    throw new Error(msg);
  }

  const orderId = order.order_id ?? order.create_id;
  if (orderId) store.adopt(localId, orderId);
  const id = orderId ?? localId;

  const plan = fundingPlan(order, source, amountIn);
  if (plan.kind === 'refused') {
    // Nothing has moved. The order will expire on Garden's side, which is the
    // correct outcome for an order we cannot fund.
    store.patch(id, { status: 'fund_failed', error: plan.reason, htlcAddress: undefined });
    throw new Error(plan.reason);
  }

  store.patch(id, { status: 'funding', htlcAddress: plan.to });

  try {
    const res = await sendBtc(wallet, plan.to, plan.amountHuman);
    store.patch(id, { status: 'pending', fundTxHash: res.id });
  } catch (e) {
    // The transfer never broadcast, so the HTLC is unfunded and the order simply
    // expires. Retryable, and nothing is stranded.
    store.patch(id, {
      status: 'fund_failed',
      error: e instanceof Error ? e.message : 'Could not fund the swap.',
    });
    throw e;
  }

  return useGardenSwaps.getState().byId(id) ?? record;
}
