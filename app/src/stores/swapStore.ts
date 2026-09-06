import { create } from 'zustand';
import {
  fetchGardenAssets,
  fetchGardenQuote,
  friendlyQuoteError,
  type GardenAsset,
  type GardenQuote,
} from '../bridge/swap';

export type SwapPhase = 'idle' | 'quoting' | 'swapping';

interface SwapState {
  assets: GardenAsset[];
  assetsLoaded: boolean;
  loadingAssets: boolean;
  phase: SwapPhase;
  quotes: GardenQuote[];
  quoteError: string | null;
  /** Monotonic token so a slow in-flight quote can't overwrite a newer one. */
  _quoteSeq: number;

  loadAssets: () => Promise<void>;
  requestQuote: (
    fromId: string,
    toId: string,
    atomicAmount: string,
    srcMeta?: { decimals: number; symbol: string },
  ) => Promise<void>;
  clearQuote: () => void;
  setPhase: (p: SwapPhase) => void;
  reset: () => void;
}

export const useSwap = create<SwapState>((set, get) => ({
  assets: [],
  assetsLoaded: false,
  loadingAssets: false,
  phase: 'idle',
  quotes: [],
  quoteError: null,
  _quoteSeq: 0,

  loadAssets: async () => {
    if (get().assetsLoaded || get().loadingAssets) return;
    set({ loadingAssets: true });
    try {
      const assets = await fetchGardenAssets();
      set({ assets, assetsLoaded: true, loadingAssets: false });
    } catch {
      // leave assets empty; the screen shows an empty picker / inline state
      set({ loadingAssets: false });
    }
  },

  requestQuote: async (fromId, toId, atomicAmount, srcMeta) => {
    const seq = get()._quoteSeq + 1;
    set({ _quoteSeq: seq, phase: 'quoting', quotes: [], quoteError: null });
    try {
      const quotes = await fetchGardenQuote(fromId, toId, atomicAmount);
      if (get()._quoteSeq !== seq) return; // a newer request superseded this one
      set({ quotes, quoteError: null, phase: 'idle' });
    } catch (e) {
      if (get()._quoteSeq !== seq) return;
      const quoteError = friendlyQuoteError(String(e), {
        atomicAmount,
        decimals: srcMeta?.decimals,
        symbol: srcMeta?.symbol,
      });
      set({ quotes: [], quoteError, phase: 'idle' });
    }
  },

  clearQuote: () => set((s) => ({ quotes: [], quoteError: null, _quoteSeq: s._quoteSeq + 1 })),
  setPhase: (phase) => set({ phase }),
  reset: () =>
    set((s) => ({ phase: 'idle', quotes: [], quoteError: null, _quoteSeq: s._quoteSeq + 1 })),
}));

/** The quote the UI uses (Garden returns them best-first). */
export function selectedQuote(quotes: GardenQuote[]): GardenQuote | undefined {
  return quotes[0];
}
