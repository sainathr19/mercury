import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import type { WalletInterface } from 'mercury-wallet-core';
import {
  settleUsdcToGateway,
  usdcHoldings,
  type SettleOutcome,
  type UsdcHoldings,
} from '../bridge/gateway';
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
  noteEvent(e: Omit<SettlementEvent, 'at'>): void;
  /** Record a completed send so the balance stops counting it immediately. */
  noteSent(amount: number): void;
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
  events: [],
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
