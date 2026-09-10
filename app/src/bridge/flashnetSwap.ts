//! Running a swap end to end: quote, sign, submit.
//
// The signing is the interesting half. Orchestra takes no custody of the source
// funds and holds no key of ours — it allocates a deposit address and waits. So
// the middle step is an ORDINARY transfer that this wallet signs and broadcasts
// itself, through exactly the same `bridge/transfer` functions the Send flow
// uses. There is no Flashnet-specific signature anywhere: their API authorises
// with a bearer key, and the chain authorises with our own key.
//
// Which means the failure modes are ours to get right:
//
//  • The deposit must be for EXACTLY `quote.amountIn`, not for what the user
//    typed. The quote can demand a different figure, and the docs are explicit.
//  • The record is written BEFORE the transfer is signed. If the app dies
//    between broadcasting and submitting, the money is on its way to a deposit
//    address with no order attached — recoverable only if we kept the quote id.
//  • `submit` failing is NOT the swap failing. The funds are already moving, so
//    the row goes to `submit_failed` and stays retryable, rather than being
//    reported as a failure that never happened.
import type { WalletInterface } from 'mercury-wallet-core';
import { quote, submit, FlashnetError } from './flashnet';
import { sendEvm, sendErc20, sendSol, sendSpl } from './transfer';
import { SOURCE_CHAINS, recipientFor, type SwapAsset } from '../lib/flashnetScope';
import { formatUnits, toBaseUnits } from '../lib/format';
import { requireAuth, authFailureMessage } from '../lib/biometrics';
import { useSwaps, type SwapLeg, type SwapRecord } from '../stores/swapStore';
import type { Addresses } from '../stores/sessionStore';

/** Orchestra's own example uses 50; a cross-chain stable route needs no more. */
export const DEFAULT_SLIPPAGE_BPS = 50;

function leg(a: SwapAsset): SwapLeg {
  return { chain: a.chain, asset: a.asset, symbol: a.symbol, chainName: a.chainName, decimals: a.decimals };
}

/** Unique per attempt. A retry after a failure is a NEW request, not a replay:
 *  reusing a key with a different body is a 409, and the amount may have moved. */
function idemKey(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export interface SwapRequest {
  wallet: WalletInterface;
  addresses: Addresses;
  source: SwapAsset;
  destination: SwapAsset;
  /** What the user typed, in whole units of the source asset. */
  amountHuman: string;
  slippageBps?: number;
}

/**
 * Quote, sign the deposit, submit the proof.
 *
 * Returns once the order exists (or once we know it does not). Delivery happens
 * afterwards and is followed by `useSwaps.refresh`.
 */
export async function createSwap(req: SwapRequest): Promise<SwapRecord> {
  const { wallet, addresses, source, destination, amountHuman } = req;
  const spec = SOURCE_CHAINS[source.chain];
  if (!spec) throw new Error(`Cannot sign a deposit on ${source.chainName}.`);

  const recipientAddress = recipientFor(destination.chain, addresses);
  if (!recipientAddress) throw new Error(`No address to receive on ${destination.chainName}.`);
  // A refund goes back where the money came from, on the chain it came from.
  const refundAddress = spec.family === 'sol' ? addresses.sol : addresses.eth;

  // Confirmed BEFORE the quote: a quote holds a deposit address for two minutes,
  // and burning that window on a Face ID prompt the user then cancels wastes it.
  const auth = await requireAuth(`Confirm to swap ${amountHuman} ${source.symbol}`);
  if (!auth.ok) throw new Error(authFailureMessage(auth.reason));

  const q = await quote({
    sourceChain: source.chain,
    sourceAsset: source.asset,
    destinationChain: destination.chain,
    destinationAsset: destination.asset,
    amount: toBaseUnits(amountHuman, source.decimals).toString(),
    recipientAddress,
    refundAddress,
    refundChain: source.chain,
    slippageBps: req.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    idempotencyKey: idemKey('swap:quote'),
  });

  const store = useSwaps.getState();
  const now = Date.now();
  const record: SwapRecord = {
    quoteId: q.quoteId,
    status: 'signing',
    source: leg(source),
    destination: leg(destination),
    amountIn: q.amountIn,
    estimatedOut: q.estimatedOut,
    feeAmount: q.totalFeeAmount ?? q.feeAmount,
    feeAsset: q.feeAsset,
    depositAddress: q.depositAddress,
    // Captured HERE or never: the quote is the only response that carries it,
    // and without it this order can never be polled again.
    readToken: q.readToken,
    recipientAddress,
    sourceAddress: refundAddress,
    createdAt: now,
    updatedAt: now,
  };
  // Persisted before anything irreversible happens, so a crash mid-transfer
  // leaves a row to recover from rather than an untracked deposit.
  store.record(record);

  // EXACTLY what the quote asked for, converted back to whole units for the
  // transfer helpers. `formatUnits` is exact string arithmetic, so this is the
  // same integer the API named — never a re-rounded version of it.
  const sendAmount = formatUnits(q.amountIn, source.decimals);

  let txHash: string;
  try {
    const res =
      spec.family === 'sol'
        ? source.contractAddress
          ? await sendSpl(wallet, source.contractAddress, source.decimals, q.depositAddress, sendAmount)
          : await sendSol(wallet, q.depositAddress, sendAmount)
        : source.contractAddress
          ? await sendErc20(
              wallet,
              source.contractAddress,
              source.decimals,
              q.depositAddress,
              sendAmount,
              spec.evmChainId,
            )
          : await sendEvm(wallet, q.depositAddress, sendAmount, spec.evmChainId);
    txHash = res.id;
  } catch (e) {
    // Nothing moved: the deposit never broadcast, so the quote simply expires.
    store.patch(q.quoteId, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  store.patch(q.quoteId, { status: 'submitting', txHash });

  try {
    const { orderId, status } = await submit({
      quoteId: q.quoteId,
      txHash,
      sourceAddress: refundAddress,
      idempotencyKey: idemKey('swap:submit'),
    });
    store.patch(q.quoteId, { orderId, status: status as SwapRecord['status'] });
  } catch (e) {
    // The deposit is ALREADY on-chain. Calling this a failure would be wrong —
    // Orchestra also detects deposits on its own, and the proof can be resent.
    store.patch(q.quoteId, {
      status: 'submit_failed',
      error:
        e instanceof FlashnetError
          ? `Deposit sent, but Flashnet did not accept the proof: ${e.message}`
          : 'Deposit sent, but the proof could not be delivered. Retry from the swap details.',
    });
  }

  return useSwaps.getState().byQuote(q.quoteId) ?? record;
}

/**
 * Resend the deposit proof for a swap whose `submit` failed.
 *
 * Separate from `createSwap` because the money has already moved: this must
 * never re-quote or re-send, only re-tell.
 */
export async function retrySubmit(quoteId: string): Promise<void> {
  const rec = useSwaps.getState().byQuote(quoteId);
  if (!rec?.txHash) throw new Error('Nothing to resubmit — no deposit was broadcast.');
  const { orderId, status } = await submit({
    quoteId,
    txHash: rec.txHash,
    // The address the deposit came FROM. Reading the destination here (an easy
    // slip, since both are on the record) would hand Flashnet the wrong sender.
    sourceAddress: rec.sourceAddress,
    idempotencyKey: idemKey('swap:submit'),
  });
  useSwaps.getState().patch(quoteId, { orderId, status: status as SwapRecord['status'], error: undefined });
}
