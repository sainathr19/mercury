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
  /** Asset ids the user pulled back out of the spam filter (see lib/tokenSpam).
   *  Keyed by asset `id`, not coingeckoId: spam has no meaningful coingecko id,
   *  and rescuing one chain's copy should not rescue an unrelated token that
   *  happens to share a made-up symbol. */
  allowed: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  isHidden: (coingeckoId: string) => boolean;
  toggle: (coingeckoId: string) => void;
  /** Show a spam-filtered asset again, or re-hide it. */
  allow: (assetId: string, on: boolean) => void;
}

export const useTokenPrefs = create<TokenPrefsState>((set, get) => ({
  hidden: [],
  allowed: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as { hidden?: string[]; allowed?: string[] };
        if (Array.isArray(d.hidden)) set({ hidden: d.hidden });
        if (Array.isArray(d.allowed)) set({ allowed: d.allowed });
      }
    } catch {}
    set({ hydrated: true });
  },

  isHidden: (coingeckoId) => get().hidden.includes(coingeckoId),

  toggle: (coingeckoId) => {
    const cur = get().hidden;
    const hidden = cur.includes(coingeckoId) ? cur.filter((x) => x !== coingeckoId) : [...cur, coingeckoId];
    set({ hidden });
    persist(hidden, get().allowed);
  },

  allow: (assetId, on) => {
    const cur = get().allowed;
    const allowed = on ? (cur.includes(assetId) ? cur : [...cur, assetId]) : cur.filter((x) => x !== assetId);
    set({ allowed });
    persist(get().hidden, allowed);
  },
}));

function persist(hidden: string[], allowed: string[]): void {
  try {
    cacheFile().write(JSON.stringify({ hidden, allowed }));
  } catch {}
}
