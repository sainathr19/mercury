//! Garden orders in flight, and the ones that finished.
//
// Kept separate from `swapStore` (Orchestra) rather than shared, for the same
// reason the two clients are separate: the records have different identities and
// different terminal conditions. An Orchestra order is keyed by quote id and
// settles on a status string; a Garden order is keyed by its own id and is done
// only when `destination_swap.redeem_tx_hash` exists. One table pretending to
// hold both would need a discriminant on every field that differs, which is
// most of them.
//
// Self-contained by design: symbols, decimals and amounts are copied in at
// creation, so a history row still renders correctly for a route Garden has
// since stopped offering.
import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { isComplete, isRefunded, orderStatus, type GardenOrder } from '../bridge/garden';
import type { ChainEnvironment } from '../lib/chains';

const FILENAME = 'garden-swaps.v1.json';
const MAX = 50;

/** Local states that exist before Garden has anything to report. */
export type GardenSwapStatus =
  | 'creating'
  | 'funding'
  | 'fund_failed'
  | 'pending'
  | 'complete'
  | 'refunded';

export interface GardenLeg {
  /** Garden's asset id, e.g. `base_sepolia:wbtc`. */
  id: string;
  symbol: string;
  chainName: string;
  decimals: number;
  /** Copied in at creation so a history row — and the activity feed — can draw
   *  the real mark without re-fetching a catalog that may have changed. */
  coingeckoId?: string;
}

export interface GardenSwapRecord {
  /** Garden's order id — the stable key once it exists. Before that, a local one. */
  id: string;
  /** False until Garden has assigned the id, so a local row is never polled. */
  remote: boolean;
  status: GardenSwapStatus;
  environment: ChainEnvironment;
  source: GardenLeg;
  destination: GardenLeg;
  /** Smallest units, as strings — the figures the quote agreed. */
  amountIn: string;
  amountOut: string;
  /** The address we funded, kept so a row can be explained after the fact. */
  htlcAddress?: string;
  /** Our own funding transaction. */
  fundTxHash?: string;
  /** Garden's redeem on the destination — the completion proof. */
  redeemTxHash?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export const isPending = (r: GardenSwapRecord): boolean =>
  r.status !== 'complete' && r.status !== 'refunded';

function file(): File {
  return new File(Paths.document, FILENAME);
}

interface State {
  swaps: GardenSwapRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (r: GardenSwapRecord) => void;
  patch: (id: string, p: Partial<GardenSwapRecord>) => void;
  /** Re-key a local row once Garden assigns the real order id. */
  adopt: (localId: string, orderId: string) => void;
  /** Reconcile every unfinished order. Sequential, and safe to call often. */
  refresh: () => Promise<void>;
  byId: (id: string) => GardenSwapRecord | undefined;
  reset: () => void;
}

function persist(swaps: GardenSwapRecord[]): void {
  try {
    file().write(JSON.stringify({ swaps: swaps.slice(0, MAX) }));
  } catch {
    // A lost history file costs a list, never an order: Garden holds the order
    // and it is recoverable by id.
  }
}

/** What Garden's order shape says about where the swap has got to. */
export function statusOf(o: GardenOrder, fallback: GardenSwapStatus): GardenSwapStatus {
  if (isComplete(o)) return 'complete';
  if (isRefunded(o)) return 'refunded';
  return fallback === 'complete' || fallback === 'refunded' ? 'pending' : fallback;
}

export const useGardenSwaps = create<State>((set, get) => ({
  swaps: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = file();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as { swaps?: GardenSwapRecord[] };
        if (Array.isArray(d.swaps)) set({ swaps: d.swaps });
      }
    } catch {
      // Unreadable file: carry on with an empty list rather than deleting it.
    }
    set({ hydrated: true });
  },

  record: (r) => {
    const swaps = [r, ...get().swaps.filter((x) => x.id !== r.id)].slice(0, MAX);
    set({ swaps });
    persist(swaps);
  },

  patch: (id, p) => {
    const swaps = get().swaps.map((s) =>
      s.id === id ? { ...s, ...p, updatedAt: Date.now() } : s,
    );
    set({ swaps });
    persist(swaps);
  },

  adopt: (localId, orderId) => {
    const swaps = get().swaps.map((s) =>
      s.id === localId ? { ...s, id: orderId, remote: true, updatedAt: Date.now() } : s,
    );
    set({ swaps });
    persist(swaps);
  },

  refresh: async () => {
    // Sequential on purpose. Garden's edge answers 403 to a burst — a parallel
    // fan-out of 306 quote requests came back entirely 403 — so polling a
    // history list concurrently would get the whole list rate-limited.
    for (const s of get().swaps.filter((x) => isPending(x) && x.remote)) {
      try {
        const o = await orderStatus(s.environment, s.id);
        get().patch(s.id, {
          status: statusOf(o, s.status),
          redeemTxHash: o.destination_swap?.redeem_tx_hash,
        });
      } catch {
        // A failed poll leaves the row where it was. Garden is the authority on
        // the order, so a network blip must not move it to a terminal state.
      }
    }
  },

  byId: (id) => get().swaps.find((s) => s.id === id),

  reset: () => {
    set({ swaps: [] });
    persist([]);
  },
}));
