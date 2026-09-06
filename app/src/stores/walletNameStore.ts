import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';

const FILENAME = 'wallet-name.v1.json';
const DEFAULT_NAME = 'My Wallet';

function file(): File {
  return new File(Paths.document, FILENAME);
}

interface WalletNameState {
  name: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setName: (n: string) => void;
}

export const useWalletName = create<WalletNameState>((set, get) => ({
  name: DEFAULT_NAME,
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = file();
      if (f.exists) {
        const data = JSON.parse(await f.text()) as { name?: string };
        if (data?.name) set({ name: data.name });
      }
    } catch {}
    set({ hydrated: true });
  },
  setName: (n) => {
    const name = n.trim().slice(0, 32) || DEFAULT_NAME;
    set({ name });
    try {
      file().write(JSON.stringify({ name }));
    } catch {}
  },
}));
