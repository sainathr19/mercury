//! Shared state for the multi-step Send flow.
//
// The Send flow is a nested native stack (pick → address → amount → confirm),
// so the in-progress transfer can't live in a single screen's useState anymore.
// This store holds it across the step screens. `reset` is called once when the
// flow opens (Send index mounts), optionally seeding a scanned address.

import { create } from 'zustand';
import type { PortfolioAsset } from '../bridge/portfolio';
import type { StealthPayment } from '../bridge/stealth';

export type BtcSpeed = 'fast' | 'medium' | 'slow';

/** Which private flow the Send sheet is running, if any:
 *  - `pay`   → pay someone privately (main balance → their stealth address)
 *  - `spend` → spend funds received privately (a stealth payment → normal address)
 *  - `null`  → an ordinary (public) send / self-shield */
export type PrivateFlow = 'pay' | 'spend' | null;

interface SendDraftState {
  asset: PortfolioAsset | null;
  address: string;
  amount: string;
  usdMode: boolean;
  fee: number | null;
  sending: boolean;
  /** Shield (private) send: the recipient is a stealth meta-address and the
   *  transfer goes through the private stealth path instead of a normal send. */
  shield: boolean;
  /** When the recipient was entered as an @username (resolved to their
   *  meta-address in `address`), the display handle — for the review row + recents. */
  recipientHandle: string | null;
  /** Active private flow (pay / spend / null). Drives the address step's input
   *  kind and confirm's final action. */
  privateFlow: PrivateFlow;
  /** For a single-source `spend` (BTC/EVM): the one received payment being spent. */
  spendSource: StealthPayment | null;
  /** For an aggregate `spend` (SOL): all of the asset's received payments, so
   *  confirm can auto-select across them to cover the amount (fires one tx each). */
  spendSources: StealthPayment[] | null;
  /** Sweep / MAX: send the ENTIRE spendable balance. Set when MAX is tapped;
   *  cleared on any manual amount edit. When set, an aggregate spend drains every
   *  source fully in exact atomic units (no coin-selection round-trip → no dust,
   *  no off-by-rounding failure at the ceiling). */
  sweep: boolean;
  // BTC-only: chosen confirmation speed and its sat/vB rate (null → use the
  // default 6-block estimate at send time). Set from the Transaction Speed sheet.
  btcSpeed: BtcSpeed;
  btcSatPerVb: number | null;
  patch: (p: Partial<Omit<SendDraftState, 'patch' | 'reset'>>) => void;
  reset: (seedAddress?: string) => void;
}

const initial = {
  asset: null,
  address: '',
  amount: '0',
  usdMode: false,
  fee: null,
  sending: false,
  shield: false,
  recipientHandle: null,
  privateFlow: null as PrivateFlow,
  spendSource: null as StealthPayment | null,
  spendSources: null as StealthPayment[] | null,
  sweep: false,
  btcSpeed: 'medium' as BtcSpeed,
  btcSatPerVb: null,
} as const;

export const useSendDraft = create<SendDraftState>((set) => ({
  ...initial,
  patch: (p) => set(p),
  reset: (seedAddress = '') => set({ ...initial, address: seedAddress }),
}));
