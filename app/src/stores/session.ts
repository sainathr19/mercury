import { create } from 'zustand';
import { Vault } from '../bridge/vault';
import { secureStorage } from '../bridge/secureStorage';
import { generatePhrase } from '../bridge/keys';
import { routeFor, type Route } from '../bridge/route';

interface SessionState {
  ready: boolean;
  vault: Vault | null;
  hasSeed: boolean;
  hasLock: boolean;
  hasName: boolean;
  address: string | null;
  route: Route;
  init(vault?: Vault): Promise<void>;
  createWallet(): Promise<string>;
  importWallet(phrase: string): Promise<void>;
  enableLock(): Promise<void>;
  reset(): void;
}

const EMPTY = {
  ready: false, vault: null, hasSeed: false, hasLock: false,
  hasName: false, address: null, route: 'welcome' as Route,
};

export const useSession = create<SessionState>((set, get) => ({
  ...EMPTY,

  async init(vault) {
    const v = vault ?? new Vault(secureStorage());
    set({ vault: v });
    await refresh(set, v);
    set({ ready: true });
  },

  async createWallet() {
    const v = get().vault!;
    const phrase = generatePhrase();
    await v.savePhrase(phrase);
    await refresh(set, v);
    return phrase;
  },

  async importWallet(phrase) {
    const v = get().vault!;
    await v.savePhrase(phrase);   // throws before any state change
    await refresh(set, v);
  },

  async enableLock() {
    const v = get().vault!;
    await v.setLockEnabled(true);
    await refresh(set, v);
  },

  reset() { set({ ...EMPTY }); },
}));

/** Single place that recomputes derived state from the vault. */
async function refresh(set: (p: Partial<SessionState>) => void, v: Vault) {
  const [hasSeed, hasLock, address] = await Promise.all([v.hasSeed(), v.hasLock(), v.address()]);
  const hasName = false; // name claim is a later plan
  set({ hasSeed, hasLock, hasName, address, route: routeFor({ hasSeed, hasLock, hasName }) });
}
