//! Getting money INTO the unified balance.
//
// Two paths, and the difference is whether a swap has to happen first:
//
//   USDC  →  deposit                          (one approve, one deposit)
//   token →  swap to USDC on the same chain  →  deposit
//
// Everything here is same-chain by design. Circle credits a deposit made on ANY
// supported domain to the one unified balance, so there is no reason to move
// funds across chains before depositing them — the money is spendable everywhere
// either way. What the chain choice changes is only how long the deposit takes
// to finalise, which the planner reports rather than hides.
//
// The cross-chain case (holding ETH on Ethereum, wanting USDC in Gateway without
// a DEX on that chain) needs Flashnet, which is mainnet-only and asynchronous —
// its orders outlive the screen. That is a separate adapter and is deliberately
// not pretended at here: `planDeposit` says no route rather than inventing one.
import type { WalletInterface } from 'mercury-wallet-core';
import { gatewayDeposit, GAS_RESERVE_USDC } from './gateway';
import { executeSwap, quoteSwap, type Quote } from './uniswap';
import { erc20BalanceOf, rpc } from './evmTx';
import { chainById, chainUsdc, type ChainDef, type TokenDef } from '../lib/chains';
import { depositReadySeconds, gasIsUsdc, readyLabel } from '../lib/gatewayHub';
import { requireAuth, authFailureMessage } from '../lib/biometrics';

/** Matches the app's other DEX call sites, and Arc's pools are deep enough. */
const SLIPPAGE_BPS = 50;

/** What the user picked to deposit. */
export interface DepositSource {
  chainId: bigint;
  /**
   * The token being spent. Omitted means the chain's USDC, which needs no swap.
   * A token equal to the chain's USDC is normalised to that case.
   */
  token?: TokenDef;
}

export interface DepositPlan {
  ok: true;
  chain: ChainDef;
  domain: number;
  /** USDC that will land in Gateway, human units. An estimate when swapping. */
  usdc: number;
  /** Present only when a swap runs first. */
  swap?: { from: TokenDef; to: TokenDef; quote: Quote };
  readySeconds: number;
  /** "about 8 seconds" — already phrased, so no screen has to format it. */
  ready: string;
  /**
   * The deposit needs this chain's native coin for gas and the wallet has none.
   *
   * Not an error: the plan is still correct and the money is still the user's.
   * It just cannot be executed yet, and saying so up front beats a revert.
   */
  needsGas: boolean;
  /** Native gas symbol, for the message when `needsGas`. */
  gasSymbol: string;
}

export type DepositPlanResult = DepositPlan | { ok: false; reason: string };

/**
 * Work out exactly what depositing `amount` from `source` would do.
 *
 * Priced before anything is signed, so the screen can state the USDC figure, the
 * wait and the gas problem before the user commits rather than after.
 */
export async function planDeposit(opts: {
  source: DepositSource;
  /** Human units of the source asset. */
  amount: number;
  /** The signer's EVM address, for the gas check. */
  address: string;
}): Promise<DepositPlanResult> {
  const { source, amount, address } = opts;
  if (!(amount > 0)) return { ok: false, reason: 'Enter an amount.' };

  const chain = chainById(source.chainId);
  if (!chain) return { ok: false, reason: 'Unknown network.' };
  if (chain.circleDomain === undefined || !chain.usdc) {
    return { ok: false, reason: `${chain.name} is not a Gateway network.` };
  }
  const usdcAddress = chain.usdc;
  const domain = chain.circleDomain;

  // Gas first: it applies to both paths and is the most common blocker.
  //
  // Checked on EVERY chain, Arc included. Arc's gas token is its own USDC, which
  // makes depositing USDC self-funding — but swapping EURC there still needs
  // USDC to pay for the swap, so skipping the check on that basis would let a
  // EURC-only wallet reach a transaction it cannot afford. `gasSymbol` carries
  // the distinction into the message instead ("needs USDC" rather than "ETH").
  let needsGas = false;
  try {
    const hex = await rpc<string>(chain.rpcUrl, 'eth_getBalance', [address, 'latest']);
    needsGas = BigInt(hex || '0x0') === 0n;
  } catch {
    // Unknown is not empty. Blocking on a failed RPC read would disable a
    // deposit that would have worked.
    needsGas = false;
  }

  const common = {
    ok: true as const,
    chain,
    domain,
    readySeconds: depositReadySeconds(domain),
    ready: readyLabel(domain),
    needsGas,
    gasSymbol: chain.nativeSymbol,
  };

  // ── Already USDC ──────────────────────────────────────────────────────────
  const isUsdc =
    !source.token || source.token.address.toLowerCase() === usdcAddress.toLowerCase();
  if (isUsdc) return { ...common, usdc: amount };

  // ── Needs a swap ──────────────────────────────────────────────────────────
  const from = source.token!;
  if (!chain.uniswap) {
    return {
      ok: false,
      reason: `${from.symbol} has to be swapped to USDC first, and there is no exchange on ${chain.name}.`,
    };
  }
  const to = (chain.tokens ?? []).find(
    (t) => t.address.toLowerCase() === usdcAddress.toLowerCase(),
  );
  if (!to) return { ok: false, reason: `No USDC token entry for ${chain.name}.` };

  const quote = await quoteSwap({ chainId: chain.chainId, from, to, amount });
  if (!quote) {
    return { ok: false, reason: `No ${from.symbol} → USDC pool on ${chain.name}.` };
  }
  return { ...common, usdc: quote.out, swap: { from, to, quote } };
}

/** Where a deposit has got to. Drives the stepper, so the names are the labels. */
export type DepositStep = 'swapping' | 'depositing' | 'finalising' | 'done';

export interface DepositOutcome {
  ok: boolean;
  /** Which step failed, when one did. */
  failedAt?: DepositStep;
  error?: string;
  swapTxHash?: string;
  depositTxHash?: string;
  /** Measured, per step — so the UI can report time instead of asserting speed. */
  swapMs?: number;
  depositMs?: number;
}

/**
 * Execute a plan.
 *
 * Ordered so that the only irreversible steps happen after the user has been
 * asked, and so a failure between them leaves the money somewhere the wallet can
 * still see it:
 *
 *  1. Authenticate. Nothing has moved.
 *  2. Swap, if the plan needs one. On failure the source asset is untouched.
 *  3. Deposit. On failure the USDC is sitting in the user's own address on a
 *     chain the wallet already displays — visible and re-depositable, not lost.
 *
 * There is no step that can strand funds anywhere the wallet cannot show them,
 * which is why this needs no equivalent of the send path's pending-claim store.
 */
export async function runDeposit(opts: {
  wallet: WalletInterface;
  account: number;
  plan: DepositPlan;
  /** Human units of the source asset. Only used for the auth prompt's wording. */
  amount: number;
  onStep?: (step: DepositStep) => void;
}): Promise<DepositOutcome> {
  const { wallet, account, plan, amount, onStep } = opts;

  const label = plan.swap ? `${amount} ${plan.swap.from.symbol}` : `${amount} USDC`;
  const auth = await requireAuth(`Confirm to deposit ${label} to Gateway`);
  if (!auth.ok) return { ok: false, failedAt: 'swapping', error: authFailureMessage(auth.reason) };

  const address = await wallet.evmAddress(account);
  let usdc = plan.usdc;
  let swapTxHash: string | undefined;
  let swapMs: number | undefined;

  if (plan.swap) {
    // Read BEFORE, so the swap's output can be measured as a delta.
    //
    // The alternative — reading the balance afterwards and depositing all of it
    // — would sweep USDC the user already held and had not asked to deposit.
    const before = await usdcBalance(plan.chain, address);

    onStep?.('swapping');
    const r = await executeSwap({
      wallet,
      account,
      chainId: plan.chain.chainId,
      from: plan.swap.from,
      to: plan.swap.to,
      quote: plan.swap.quote,
      slippageBps: SLIPPAGE_BPS,
    });
    swapTxHash = r.txHash;
    swapMs = r.ms;
    if (!r.ok) return { ok: false, failedAt: 'swapping', error: r.error, swapTxHash, swapMs };

    // Deposit what the swap ACTUALLY produced, not what it was quoted.
    //
    // A quote is a price at a moment and the pool moves under it. Depositing the
    // quoted figure would leave dust behind when the swap underfilled, or — the
    // dangerous direction — ask for more USDC than arrived and revert the
    // deposit AFTER the swap had already happened, leaving the user holding
    // USDC they did not want.
    const after = await usdcBalance(plan.chain, address);
    if (before !== null && after !== null) usdc = Math.max(0, after - before);
  }

  // A chain whose gas IS USDC pays for this deposit out of the very balance
  // being deposited. Sending every last cent would leave the wallet unable to
  // afford its own next transaction — including the withdrawal that would get
  // this money back out.
  if (gasIsUsdc(plan.chain)) {
    const held = await usdcBalance(plan.chain, address);
    if (held !== null) usdc = Math.min(usdc, Math.max(0, held - GAS_RESERVE_USDC));
  }

  if (!(usdc > 0)) {
    return {
      ok: false,
      failedAt: 'depositing',
      error: `Nothing left to deposit once ${plan.gasSymbol} for gas is held back.`,
      swapTxHash,
      swapMs,
    };
  }

  onStep?.('depositing');
  const d = await gatewayDeposit({
    wallet,
    account,
    chainId: plan.chain.chainId,
    amount: usdc,
  });
  if (!d.ok) {
    return {
      ok: false,
      failedAt: 'depositing',
      error: d.error,
      swapTxHash,
      swapMs,
      depositTxHash: d.txHash,
      depositMs: d.ms,
    };
  }

  onStep?.('finalising');
  return { ok: true, swapTxHash, swapMs, depositTxHash: d.txHash, depositMs: d.ms };
}

/**
 * The signer's USDC on one chain, human units. `null` when unreadable.
 *
 * `null` rather than 0 on failure, and every caller treats it as "do not
 * adjust": a dropped RPC read must never be mistaken for an empty balance, which
 * would silently deposit the quoted figure or nothing at all.
 */
async function usdcBalance(chain: ChainDef, address: string): Promise<number | null> {
  const token = chainUsdc(chain.chainId);
  if (!token) return null;
  try {
    return Number(await erc20BalanceOf(chain.rpcUrl, token, address)) / 1e6;
  } catch {
    return null;
  }
}
