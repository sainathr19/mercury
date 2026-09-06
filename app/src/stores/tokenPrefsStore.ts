import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';

// User token-visibility preferences: which tokens are hidden from the portfolio.
// Keyed by coingeckoId (built-in tokens aggregate by it across chains, so hiding
// "USDC" hides it everywhere). Global, not per-wallet — token curation is an
// app-level preference. Native coins (BTC/ETH/SOL) can't be hidden.
const CACHE = 'token-prefs.v1.json';

function cacheFile(): File {
  return new File(Paths.document, CACHE);
}

interface TokenPrefsState {
  hidden: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  isHidden: (coingeckoId: string) => boolean;
  toggle: (coingeckoId: string) => void;
}

export const useTokenPrefs = create<TokenPrefsState>((set, get) => ({
  hidden: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as { hidden?: string[] };
        if (Array.isArray(d.hidden)) set({ hidden: d.hidden });
      }
    } catch {}
    set({ hydrated: true });
  },

  isHidden: (coingeckoId) => get().hidden.includes(coingeckoId),

  toggle: (coingeckoId) => {
    const cur = get().hidden;
    const hidden = cur.includes(coingeckoId) ? cur.filter((x) => x !== coingeckoId) : [...cur, coingeckoId];
    set({ hidden });
    try {
      cacheFile().write(JSON.stringify({ hidden }));
    } catch {}
  },
}));
