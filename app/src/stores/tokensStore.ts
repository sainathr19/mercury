import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import type { CustomToken } from '../bridge/tokens';

const CACHE_FILENAME = 'custom-tokens.v1.json';

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(tokens: CustomToken[]): void {
  try {
    cacheFile().write(JSON.stringify(tokens));
  } catch {}
}

interface TokensState {
  tokens: CustomToken[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (t: CustomToken) => void;
  remove: (id: string) => void;
}

export const useTokens = create<TokensState>((set, get) => ({
  tokens: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) set({ tokens: JSON.parse(await f.text()) as CustomToken[] });
    } catch {}
    set({ hydrated: true });
  },
  add: (t) => {
    if (get().tokens.some((x) => x.id === t.id)) return;
    const tokens = [...get().tokens, t];
    set({ tokens });
    persist(tokens);
  },
  remove: (id) => {
    const tokens = get().tokens.filter((t) => t.id !== id);
    set({ tokens });
    persist(tokens);
  },
}));
