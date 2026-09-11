import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import type { WalletInterface } from 'mercury-wallet-core';
import {
  settleUsdcToGateway,
  usdcHoldings,
  type SettleOutcome,
  type UsdcHoldings,
} from '../bridge/gateway';
import { withdrawalsInProgress, type ChainWithdrawal } from '../bridge/gatewayWithdraw';
import { getActiveEnvironment } from '../bridge/activeEnv';

/**
 * One completed settlement operation, with the time it actually took.
 *
 * The durations are measured, not estimated — every deposit and every send
 * already returns its own wall-clock and the app was throwing it away after the
 * toast. Keeping the last few is what lets the settlement view state a number
 * instead of a claim.
 */
export interface SettlementEvent {
  /** `settled` = wallet USDC deposited into Gateway on this chain.
   *  `delivered` = spent out of the unified balance onto this chain. */
  kind: 'settled' | 'delivered';
  amount: number;
  chainId: bigint;
  ms: number;
  at: number;
}

/** Session-scoped, and deliberately short: this is evidence of how the rail
 *  behaves right now, not a second transaction history. */
const MAX_EVENTS = 8;

const IN_FLIGHT_FILE = 'gateway-inflight.v1.json';
const LAST_FEE_FILE = 'gateway-lastfee.v1.json';
const WITHDRAWALS_FILE = 'gateway-withdrawals.v1.json';

/**
 * Persist the in-flight deduction across launches.
 *
 * It must outlive the process. A Gateway burn debits Circle's ledger straight
 * away but leaves the money in GatewayWallet until the batch settles on-chain,
 * and the balance takes the LARGER of the two so a fresh deposit is not
 * momentarily shown as lost. That makes this deduction the only thing telling
 * the two cases apart — and while it lived in memory, relaunching the app after
 * a send brought the spent money back on screen and kept it there.
 */
function persistInFlight(v: { inFlightSent: number; inFlightAt: number }): void {
  try {
    new File(Paths.document, IN_FLIGHT_FILE).write(JSON.stringify(v));
  } catch {
    // Worst case we are back to the in-memory behaviour.
  }
}

/**
 * When each chain's trustless withdrawal was started, keyed by chain id.
 *
 * Persisted because the whole point is a wait measured in days: the process
 * this was started in will not be running when it matters. It is only ever an
 * ESTIMATE — the contract's own clock decides, and `claimable` is what gates the
 * button — so a missing entry (started on another device, or straight on chain)
 * degrades to "not ready yet" rather than to a wrong date.
 */
function persistStarted(v: Record<string, number>): void {
  try {
    new File(Paths.document, WITHDRAWALS_FILE).write(JSON.stringify(v));
  } catch {
    // Only the countdown is lost; `claimable` still answers the real question.
  }
}

function loadStarted(): Record<string, number> {
  try {
    const f = new File(Paths.document, WITHDRAWALS_FILE);
    if (!f.exists) return {};
    const v = JSON.parse(f.textSync()) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (Number(n) > 0) out[k] = Number(n);
    return out;
  } catch {
    return {};
  }
}

/**
 * The last fee Circle actually charged.
 *
 * Kept because the fee is not knowable in advance — Circle quotes a minimum
 * only in answer to a SIGNED burn intent, so asking costs a signature and there
 * is nothing to show a user deciding whether to send. The previous charge is
 * the only honest estimate available, which is enough for the two things that
 * need one: telling the user a fee exists before they commit, and leaving room
 * for it when they tap Max.
 *
 * Always an estimate, never a quote. The exact figure is reported afterwards
 * from what the transfer actually paid.
 */
function persistLastFee(v: number): void {
  try {
    new File(Paths.document, LAST_FEE_FILE).write(JSON.stringify({ lastFeeUsdc: v }));
  } catch {
    // Costs an unestimated Max next launch, nothing more.
  }
}

function loadLastFee(): number {
  try {
    const f = new File(Paths.document, LAST_FEE_FILE);
    if (!f.exists) return 0;
    const v = JSON.parse(f.textSync()) as { lastFeeUsdc?: number };
    const n = Number(v.lastFeeUsdc);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function loadInFlight(): { inFlightSent: number; inFlightAt: number } {
  try {
    const f = new File(Paths.document, IN_FLIGHT_FILE);
    if (!f.exists) return { inFlightSent: 0, inFlightAt: 0 };
    const v = JSON.parse(f.textSync()) as { inFlightSent?: number; inFlightAt?: number };
    return { inFlightSent: Number(v.inFlightSent) || 0, inFlightAt: Number(v.inFlightAt) || 0 };
  } catch {
    return { inFlightSent: 0, inFlightAt: 0 };
  }
}

/**
 * The wallet's USDC, wherever it sits.
 *
 * `total` is what the user owns and is what the balance UI shows. `spendable` is
 * the subset already settled into Gateway — the only part a cross-chain send can
 * draw on, so the send screen validates against THAT, never against `total`.
 */
interface GatewayState extends UsdcHoldings {
  address: string | null;
  loading: boolean;
  settling: boolean;
  /** Null until the first successful load, so the UI can tell "unknown" from "zero". */
  loadedAt: number | null;
  /** Chains whose USDC could not be settled for want of gas. Still the user's
   *  money — counted in `total` — but not spendable on other chains yet. */
  stuck: SettleOutcome[];
  /** Burnt through Gateway but not yet reflected on-chain. Subtracted from the
   *  owned total so a sent amount is not counted twice while it settles. */
  inFlightSent: number;
  inFlightAt: number;
  /** Recent settlement operations, newest first. */
  events: SettlementEvent[];
  /**
   * Trustless withdrawals with the clock running, per chain.
   *
   * Lives here rather than on the withdraw screen because that is not where the
   * user comes back to it. A trustless withdrawal takes a week; whoever started
   * one has long since left that screen, and the only place they can be relied
   * on to look again is the Gateway page. So the page reads it on mount.
   */
  withdrawals: ChainWithdrawal[];
  /** Null until the first scan, so "none" can be told from "not looked yet". */
  withdrawalsAt: number | null;
  /** chainId -> epoch ms the withdrawal was started, for the estimate only. */
  withdrawalStartedAt: Record<string, number>;
  refreshWithdrawals(address: string): Promise<void>;
  /** Record that a trustless withdrawal just began on this chain. */
  noteWithdrawalStarted(chainId: bigint): void;
  noteEvent(e: Omit<SettlementEvent, 'at'>): void;
  /** Record a completed send so the balance stops counting it immediately. */
  noteSent(amount: number): void;
  /**
   * Circle's fee on the most recent send, in human USDC. 0 until one has been
   * made. An ESTIMATE for the next send — see persistLastFee.
   */
  lastFeeUsdc: number;
  /** Remember what a completed transfer was actually charged. */
  noteFee(feeUsdc: number): void;
  refresh(address: string): Promise<void>;
  /** Sweep wallet-held USDC into Gateway, then re-read. Best-effort. */
  settle(wallet: WalletInterface, account: number, address: string): Promise<void>;
  reset(): void;
}

const EMPTY = {
  total: 0,
  spendable: 0,
  pending: 0,
  inWallet: 0,
  onchainSurplus: 0,
  perDomain: [],
  perChain: [],
  address: null,
  loading: false,
  settling: false,
  loadedAt: null,
  stuck: [],
  ...loadInFlight(),
  lastFeeUsdc: loadLastFee(),
  events: [],
  withdrawals: [],
  withdrawalsAt: null,
  withdrawalStartedAt: loadStarted(),
};

/** How long to keep discounting a sent amount. Circle settles burns on-chain
 *  well inside this; past it, holding the discount would understate instead. */
const IN_FLIGHT_TTL_MS = 10 * 60_000;

export const useGateway = create<GatewayState>((set, get) => ({
  ...EMPTY,

  noteEvent(e) {
    set({ events: [{ ...e, at: Date.now() }, ...get().events].slice(0, MAX_EVENTS) });
  },

  noteSent(amount) {
    const next = { inFlightSent: get().inFlightSent + amount, inFlightAt: Date.now() };
    set(next);
    persistInFlight(next);
  },

  noteFee(feeUsdc) {
    // A zero is not evidence of a free rail, it is a transfer that never got as
    // far as being priced. Keeping the previous figure beats replacing a real
    // estimate with a misleading one.
    if (!Number.isFinite(feeUsdc) || feeUsdc <= 0) return;
    set({ lastFeeUsdc: feeUsdc });
    persistLastFee(feeUsdc);
  },

  async refresh(address) {
    if (!address || get().loading) return;
    const expired = Date.now() - get().inFlightAt > IN_FLIGHT_TTL_MS;
    const inFlightSent = expired ? 0 : get().inFlightSent;
    set({ loading: true, address, inFlightSent });
    try {
      const h = await usdcHoldings(address, getActiveEnvironment(), inFlightSent);
      set({ ...h, loadedAt: Date.now() });
      // Drop the deduction once the chain agrees with Circle again. Until the
      // burn settles on-chain, GatewayWallet still holds the money and the
      // balance would count it twice; after it settles, keeping the deduction
      // would under-report instead. Self-correcting beats waiting out a timer.
      if (inFlightSent > 0 && h.onchainSurplus <= 0) {
        set({ inFlightSent: 0, inFlightAt: 0 });
        persistInFlight({ inFlightSent: 0, inFlightAt: 0 });
      }
    } finally {
      set({ loading: false });
    }
  },

  noteWithdrawalStarted(chainId) {
    const next = { ...get().withdrawalStartedAt, [chainId.toString()]: Date.now() };
    set({ withdrawalStartedAt: next });
    persistStarted(next);
  },

  async refreshWithdrawals(address) {
    if (!address) return;
    try {
      const withdrawals = await withdrawalsInProgress(address, getActiveEnvironment());
      set({ withdrawals, withdrawalsAt: Date.now() });
      // A chain that is no longer withdrawing has been claimed. Keeping its
      // start time would date the NEXT withdrawal from the last one and show a
      // countdown that had already expired.
      const live = new Set(withdrawals.map((w) => w.chainId.toString()));
      const started = get().withdrawalStartedAt;
      const kept = Object.fromEntries(Object.entries(started).filter(([k]) => live.has(k)));
      if (Object.keys(kept).length !== Object.keys(started).length) {
        set({ withdrawalStartedAt: kept });
        persistStarted(kept);
      }
    } catch {
      // A failed scan must not blank a list the user is looking at: an RPC that
      // did not answer is not evidence that a withdrawal went away, and clearing
      // it would hide a claim that is ready.
    }
  },

  async settle(wallet, account, address) {
    if (!address || get().settling) return;
    set({ settling: true });
    try {
      const outcomes = await settleUsdcToGateway({
        wallet,
        account,
        address,
        env: getActiveEnvironment(),
      });
      set({ stuck: outcomes.filter((o) => o.skipped === 'no-gas') });
      for (const o of outcomes) {
        if (o.ok && o.ms) get().noteEvent({ kind: 'settled', amount: o.amount, chainId: o.chainId, ms: o.ms });
      }
      // A deposit lands in `pendingBatch` before it is spendable, so re-reading
      // here is what moves the money from "in wallet" to "arriving" on screen.
      await get().refresh(address);
    } catch {
      // Settling is opportunistic — a failure leaves the money where it is, and
      // it is still counted. Never surface this as a balance error.
    } finally {
      set({ settling: false });
    }
  },

  reset() {
    set({ ...EMPTY });
  },
}));
