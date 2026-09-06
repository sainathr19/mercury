import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';

export interface RecentAddress {
  address: string;
  ts: number; // epoch ms
}

const CACHE_FILENAME = 'recent-addresses.v1.json';
const MAX = 20;

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILENAME);
}
function persist(list: RecentAddress[]): void {
  try {
    cacheFile().write(JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

interface RecentAddressState {
  list: RecentAddress[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (address: string) => void;
}

export const useRecentAddresses = create<RecentAddressState>((set, get) => ({
  list: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) set({ list: JSON.parse(await f.text()) as RecentAddress[] });
    } catch {}
    set({ hydrated: true });
  },
  record: (address) => {
    const a = address.trim();
    if (!a) return;
    const list = [{ address: a, ts: Date.now() }, ...get().list.filter((x) => x.address !== a)].slice(0, MAX);
    set({ list });
    persist(list);
  },
}));
