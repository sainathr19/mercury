import { create } from 'zustand';
import type { WalletInterface } from 'standard-rn';
import {
  settleUsdcToGateway,
  usdcHoldings,
  type SettleOutcome,
  type UsdcHoldings,
} from '../bridge/gateway';
import { getActiveEnvironment } from '../bridge/activeEnv';

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
  perDomain: [],
  perChain: [],
  address: null,
  loading: false,
  settling: false,
  loadedAt: null,
  stuck: [],
  inFlightSent: 0,
  inFlightAt: 0,
};

/** How long to keep discounting a sent amount. Circle settles burns on-chain
 *  well inside this; past it, holding the discount would understate instead. */
const IN_FLIGHT_TTL_MS = 10 * 60_000;

export const useGateway = create<GatewayState>((set, get) => ({
  ...EMPTY,

  noteSent(amount) {
    set({ inFlightSent: get().inFlightSent + amount, inFlightAt: Date.now() });
  },

  async refresh(address) {
    if (!address || get().loading) return;
    const expired = Date.now() - get().inFlightAt > IN_FLIGHT_TTL_MS;
    const inFlightSent = expired ? 0 : get().inFlightSent;
    set({ loading: true, address, inFlightSent });
    try {
      const h = await usdcHoldings(address, getActiveEnvironment(), inFlightSent);
      set({ ...h, loadedAt: Date.now() });
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
