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
// UPDATE: the order response HAS now been observed. With a valid app id and a
// route that quotes (arbitrum_sepolia:usdc -> ethereum_sepolia:eth), POST
// /v2/orders returns 200 with `order_id`, `approval_transaction`,
// `initiate_transaction` and a `typed_data` payload for Garden's gasless path.
// The calls come ready to broadcast, so EVM funding needs no ABI encoding and is
// no longer a guess. Solana is still unobserved and still refused.
//
// `fundingPlan` still reads the response DEFENSIVELY and refuses whenever it
// cannot find what it needs, or when the pieces disagree with each other. A swap
// that declines to start costs the user nothing; one that funds the wrong
// address costs them the swap.
import type { WalletInterface } from 'mercury-wallet-core';
import { createOrder, quote, GardenError, gardenErrorMessage, type GardenOrder } from './garden';
import { sendBtc } from './transfer';
import { rpcUrlFor, sendCall, waitForReceipt } from './evmTx';
import { getActiveAccount } from './account';
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

/** One call to broadcast, taken verbatim from Garden's order response. */
export interface EvmCall {
  to: string;
  data: string;
}

/** How the source side gets funded, or why it cannot be. */
export type FundingPlan =
  | { kind: 'transfer'; family: 'btc'; to: string; amountHuman: string }
  | { kind: 'evm'; chainId: bigint; approval?: EvmCall; initiate: EvmCall }
  | { kind: 'refused'; reason: string };

const HEX = /^0x[0-9a-fA-F]*$/;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** `approve(address,uint256)` — the spender is the first word of the calldata. */
const APPROVE_SELECTOR = '0x095ea7b3';
function approveSpender(data: string): string | null {
  // selector (10 chars incl. 0x) + a 32-byte word, of which the last 20 bytes
  // are the address.
  if (data.length < 74 || !data.toLowerCase().startsWith(APPROVE_SELECTOR)) return null;
  return `0x${data.slice(34, 74)}`;
}

function evmCall(tx: unknown): EvmCall | null {
  if (!tx || typeof tx !== 'object') return null;
  const t = tx as { to?: unknown; data?: unknown };
  if (typeof t.to !== 'string' || typeof t.data !== 'string') return null;
  if (!HEX.test(t.to) || t.to.length !== 42 || !HEX.test(t.data)) return null;
  return { to: t.to, data: t.data };
}

/**
 * Where to send the source funds, read out of Garden's order response.
 *
 * UTXO sources are fundable with an ordinary transfer: Garden allocates a
 * per-order HTLC address and the swap begins when it is paid. That is a shape
 * this wallet already implements and can reason about.
 *
 * EVM sources are funded by calling an HTLC contract with a secret hash and a
 * timelock. Nothing here encodes that call: Garden returns `approval_transaction`
 * and `initiate_transaction` ready to broadcast, so this only has to check them
 * and pass them on. That is the whole reason it can be attempted — an earlier
 * build refused precisely because this response could not be observed, and
 * encoding an HTLC from documentation is how funds reach the wrong contract.
 *
 * Checked, because "Garden said so" is not a reason to approve a contract:
 *
 *   • the initiate call is on the chain the source asset actually lives on;
 *   • the approval spends the token we think we are spending;
 *   • the approval's SPENDER is the very contract the initiate call goes to.
 *
 * The last one is the load-bearing check. An approval is the only step here that
 * hands a third party ongoing authority over a balance, and a response that
 * approved one address while calling another would be doing something other than
 * what it claimed. Any mismatch refuses, which costs a swap and nothing else.
 *
 * Solana sources remain refused: its funding instruction is not an EVM call and
 * none of this applies.
 */
export function fundingPlan(order: GardenOrder, source: SwapAsset, amountIn: string): FundingPlan {
  if (source.family === 'evm') {
    const initiate = evmCall(order.initiate_transaction);
    if (!initiate) {
      return { kind: 'refused', reason: 'Garden did not return an initiate transaction for this order.' };
    }
    const chainId = source.evmChainId;
    if (chainId === undefined) {
      return { kind: 'refused', reason: `No chain id is known for ${source.chainName}.` };
    }
    const said = order.initiate_transaction?.chain_id;
    if (said !== undefined && BigInt(said) !== chainId) {
      return {
        kind: 'refused',
        reason: `Garden returned a transaction for chain ${said}, not ${source.chainName}.`,
      };
    }

    const approval = evmCall(order.approval_transaction);
    if (approval) {
      // A native coin has no token to approve, so an approval for one is a
      // contradiction rather than a spare step.
      if (!source.tokenAddress) {
        return { kind: 'refused', reason: `${source.symbol} needs no approval, but Garden returned one.` };
      }
      if (!same(approval.to, source.tokenAddress)) {
        return {
          kind: 'refused',
          reason: `Garden asked to approve a contract that is not ${source.symbol}.`,
        };
      }
      const spender = approveSpender(approval.data);
      if (!spender || !same(spender, initiate.to)) {
        return {
          kind: 'refused',
          reason: 'Garden asked to approve a different contract than the one it wants called.',
        };
      }
    }

    return { kind: 'evm', chainId, approval: approval ?? undefined, initiate };
  }

  if (source.family !== 'btc') {
    return {
      kind: 'refused',
      reason:
        `Funding a ${source.chainName} swap needs Garden's initiate instruction, which this ` +
        `build does not yet encode. Swaps out of Bitcoin and EVM chains work; ` +
        `swaps out of ${source.symbol} do not.`,
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

/**
 * Broadcast Garden's two calls, in order.
 *
 * The approval must be MINED before the initiate is sent, not merely broadcast:
 * the HTLC pulls the tokens during initiate, and a node that has not yet seen
 * the approval reverts the transfer. Waiting costs a block; not waiting costs
 * the gas of a failed initiate and leaves the order unfunded.
 *
 * Returns the initiate hash — the transaction that actually funds the swap and
 * the one worth showing.
 */
async function fundEvm(
  wallet: WalletInterface,
  plan: Extract<FundingPlan, { kind: 'evm' }>,
  owner: string,
): Promise<string> {
  const url = rpcUrlFor(plan.chainId);
  if (!url) throw new Error('No RPC is configured for that network.');
  const account = getActiveAccount();

  if (plan.approval) {
    const hash = await sendCall(wallet, account, plan.chainId, url, owner, plan.approval.to, plan.approval.data);
    if (!(await waitForReceipt(url, hash))) {
      throw new Error('The token approval did not confirm, so the swap was not funded.');
    }
  }
  return sendCall(wallet, account, plan.chainId, url, owner, plan.initiate.to, plan.initiate.data);
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

  store.patch(id, {
    status: 'funding',
    htlcAddress: plan.kind === 'transfer' ? plan.to : plan.initiate.to,
  });

  try {
    if (plan.kind === 'transfer') {
      const res = await sendBtc(wallet, plan.to, plan.amountHuman);
      store.patch(id, { status: 'pending', fundTxHash: res.id });
    } else {
      const fundTxHash = await fundEvm(wallet, plan, owner);
      store.patch(id, { status: 'pending', fundTxHash });
    }
  } catch (e) {
    // Nothing broadcast, or the approval did and the initiate did not — either
    // way the HTLC is unfunded and the order expires. An approval left standing
    // grants the HTLC an allowance it never draws on, which is the same position
    // every approve-then-act flow leaves behind.
    store.patch(id, {
      status: 'fund_failed',
      error: e instanceof Error ? e.message : 'Could not fund the swap.',
    });
    throw e;
  }

  return useGardenSwaps.getState().byId(id) ?? record;
}
