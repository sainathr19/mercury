//! Cross-chain swaps in flight, and the ones that finished.
//
// Orchestra orders are asynchronous and outlive the screen that started them —
// a bridge leg can take minutes, and the app may be closed for most of it. So
// every swap is written to disk the moment it has an id, and reconciled against
// the API on the next look rather than being held in a screen's state.
//
// The record is deliberately self-contained: symbols, decimals and amounts are
// copied in at creation. A history row has to render correctly for a route that
// Flashnet has since stopped offering, and re-deriving it from a live route
// table would make old rows blank.
import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { SETTLED, orderStatus, type OrderStatus } from '../bridge/flashnet';

const FILENAME = 'swaps.v1.json';
const MAX = 50;

/** Local states that exist before Orchestra has an order to report on. */
export type LocalStatus = 'signing' | 'submitting' | 'submit_failed';
export type SwapStatus = OrderStatus | LocalStatus;

export interface SwapLeg {
  chain: string;
  asset: string;
  symbol: string;
  chainName: string;
  decimals: number;
}

export interface SwapRecord {
  /** Present from the moment a quote exists — the stable local identity. */
  quoteId: string;
  orderId?: string;
  status: SwapStatus;
  source: SwapLeg;
  destination: SwapLeg;
  /** Smallest units. `amountIn` is what the quote demanded, not what was typed. */
  amountIn: string;
  estimatedOut: string;
  amountOut?: string;
  feeAmount?: string;
  feeAsset?: string;
  /** Our deposit transfer. The proof handed to `submit`. */
  txHash?: string;
  depositAddress: string;
  /** Per-order read token from the quote. A client key cannot read `/status`
   *  without it, so it is stored — not held in a screen's state. */
  readToken?: string;
  recipientAddress: string;
  /** The address the deposit was sent FROM — `submit` needs it, including on a
   *  retry, and it is also where a refund lands. */
  sourceAddress: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

function file(): File {
  return new File(Paths.document, FILENAME);
}

interface SwapState {
  swaps: SwapRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Add or replace by quoteId, newest first. */
  record: (r: SwapRecord) => void;
  patch: (quoteId: string, p: Partial<SwapRecord>) => void;
  /** Reconcile every unsettled order against the API. Safe to call often. */
  refresh: () => Promise<void>;
  byQuote: (quoteId: string) => SwapRecord | undefined;
}

export const useSwaps = create<SwapState>((set, get) => ({
  swaps: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = file();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as { swaps?: SwapRecord[] };
        if (Array.isArray(d.swaps)) set({ swaps: d.swaps });
      }
    } catch {
      // A corrupt history file costs a list, never a swap: the orders live on
      // Orchestra's side and are recoverable by quote id.
    }
    set({ hydrated: true });
  },

  record: (r) => {
    const swaps = [r, ...get().swaps.filter((x) => x.quoteId !== r.quoteId)].slice(0, MAX);
    set({ swaps });
    persist(swaps);
  },

  patch: (quoteId, p) => {
    const swaps = get().swaps.map((x) =>
      x.quoteId === quoteId ? { ...x, ...p, updatedAt: Date.now() } : x,
    );
    set({ swaps });
    persist(swaps);
  },

  refresh: async () => {
    const pending = get().swaps.filter(
      (s) => s.orderId && !SETTLED.has(s.status as OrderStatus),
    );
    if (pending.length === 0) return;

    // Sequential on purpose. `/status` is rate-limited per IP and a wallet with
    // a handful of in-flight swaps would otherwise burst the whole window.
    for (const s of pending) {
      try {
        const { order } = await orderStatus({ orderId: s.orderId, readToken: s.readToken });
        get().patch(s.quoteId, {
          status: order.status,
          amountOut: order.amountOut ?? undefined,
          txHash: order.sourceTxHash ?? s.txHash,
          error: order.errorMessage || undefined,
        });
      } catch {
        // Leave the row as it was. A failed poll is a network problem, not a
        // failed swap, and overwriting the status would say otherwise.
      }
    }
  },

  byQuote: (quoteId) => get().swaps.find((x) => x.quoteId === quoteId),
}));

function persist(swaps: SwapRecord[]): void {
  try {
    file().write(JSON.stringify({ swaps: swaps.slice(0, MAX) }));
  } catch {}
}

/** Whether a row is still going to change. Drives the spinner and the polling. */
export function isPending(s: SwapRecord): boolean {
  if (s.status === 'signing' || s.status === 'submitting') return true;
  if (s.status === 'submit_failed') return false;
  return !SETTLED.has(s.status as OrderStatus);
}
