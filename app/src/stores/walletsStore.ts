import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import {
  PRIMARY_ALIAS,
  createByAlias,
  importByAlias,
  openByAlias,
  deleteByAlias,
  getAddressesFor,
  setActiveAlias,
} from '../bridge/wallet';
import { getActiveAccount } from '../bridge/account';
import { useSession } from './session';
import { useAccounts } from './accountStore';
import { usePortfolio } from './portfolioStore';
import { useActivity } from './activityStore';
import { useNetworks } from './networkStore';
import { useWalletName } from './walletNameStore';
import { clearMnemonic } from '../bridge/seedVault';
import { useGateway } from './gatewayStore';
import { usePendingBalance } from './pendingBalanceStore';

// Registry of wallets on this device (each = a separate seed / keystore alias /
// DB file). Mirrors the iOS WalletSession wallets registry. The primary wallet
// keeps its original files so existing installs are never disturbed.
const CACHE = 'wallets.v1.json';

export interface WalletEntry {
  alias: string;
  name: string;
  createdAt: number;
}
interface Persisted {
  wallets: WalletEntry[];
  activeAlias: string;
}

function file(): File {
  return new File(Paths.document, CACHE);
}
function accountsFileFor(alias: string): File {
  return new File(Paths.document, alias === PRIMARY_ALIAS ? 'accounts.v1.json' : `accounts.${alias}.json`);
}
function genAlias(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

interface WalletsState {
  wallets: WalletEntry[];
  activeAlias: string;
  hydrated: boolean;
  busy: boolean;
  error: string | null;
  /** Set after a NEW wallet is created in-app — drives the forced backup screen.
   *  Held in memory only until the user confirms they've saved the phrase. */
  pendingBackup: { alias: string; words: string[] } | null;
  /** Load the registry + apply the active alias/account (runs before bootstrap). */
  hydrate: () => Promise<void>;
  /** Ensure the primary wallet is in the registry after onboarding create/import
   *  (the session creates it under the primary alias but doesn't register it). */
  ensurePrimary: (name?: string) => Promise<void>;
  addWallet: (name: string) => Promise<string | null>;
  importWallet: (name: string, words: string[]) => Promise<string | null>;
  switchWallet: (alias: string) => Promise<void>;
  renameWallet: (alias: string, name: string) => void;
  deleteWallet: (alias: string) => Promise<void>;
  /**
   * Wipe EVERY wallet on this device and return to onboarding.
   *
   * Destructive and irreversible: the keystore, its database and the stored
   * recovery phrase all go. Anyone who has not written their phrase down cannot
   * get the funds back, so the caller must confirm first.
   */
  logout: () => Promise<void>;
  clearPendingBackup: () => void;
}

export const useWallets = create<WalletsState>((set, get) => {
  const persist = () => {
    try {
      file().write(JSON.stringify({ wallets: get().wallets, activeAlias: get().activeAlias } satisfies Persisted));
    } catch {}
  };

  /** Open `alias`, adopt it as the session wallet, load its accounts, refresh. */
  const activate = async (alias: string) => {
    await useNetworks.getState().hydrate(); // ensure the env is known before opening
    const wallet = await openByAlias(alias); // Face ID on device (applies the env)
    setActiveAlias(alias);
    await useAccounts.getState().loadFor(alias); // sets the active account index
    const addresses = await getAddressesFor(wallet, alias, getActiveAccount());
    useSession.getState().adopt(wallet, addresses);
    set({ activeAlias: alias });
    persist();
    const entry = get().wallets.find((w) => w.alias === alias);
    if (entry) useWalletName.setState({ name: entry.name });
    useNetworks.getState().apply();
    usePortfolio.getState().refresh();
    useActivity.getState().refresh();
  };

  return {
    wallets: [],
    activeAlias: PRIMARY_ALIAS,
    hydrated: false,
    busy: false,
    error: null,
    pendingBackup: null,

    hydrate: async () => {
      if (get().hydrated) return;
      let wallets: WalletEntry[] = [];
      let activeAlias = PRIMARY_ALIAS;
      try {
        const f = file();
        if (f.exists) {
          const d = JSON.parse(await f.text()) as Partial<Persisted>;
          wallets = d.wallets ?? [];
          activeAlias = d.activeAlias ?? PRIMARY_ALIAS;
        }
      } catch {}
      // Existing/first install: seed the registry with the primary wallet using
      // the previously-saved wallet name.
      if (wallets.length === 0) {
        await useWalletName.getState().hydrate();
        wallets = [{ alias: PRIMARY_ALIAS, name: useWalletName.getState().name, createdAt: Date.now() }];
        activeAlias = PRIMARY_ALIAS;
      }
      if (!wallets.some((w) => w.alias === activeAlias)) activeAlias = wallets[0].alias;
      setActiveAlias(activeAlias);
      await useAccounts.getState().loadFor(activeAlias); // apply active account before bootstrap opens the wallet
      const entry = wallets.find((w) => w.alias === activeAlias);
      if (entry) useWalletName.setState({ name: entry.name });
      set({ wallets, activeAlias, hydrated: true });
    },

    ensurePrimary: async (name) => {
      // Re-seed the primary entry if the registry lost it (e.g. sign-out emptied
      // it, then the user re-onboarded via create/import in the same session).
      if (get().wallets.some((w) => w.alias === PRIMARY_ALIAS)) return;
      await useWalletName.getState().hydrate();
      const entry: WalletEntry = {
        alias: PRIMARY_ALIAS,
        name: name?.trim() || useWalletName.getState().name,
        createdAt: Date.now(),
      };
      setActiveAlias(PRIMARY_ALIAS);
      useWalletName.setState({ name: entry.name });
      set({ wallets: [...get().wallets.filter((w) => w.alias !== PRIMARY_ALIAS), entry], activeAlias: PRIMARY_ALIAS });
      persist();
      await useAccounts.getState().loadFor(PRIMARY_ALIAS);
    },

    addWallet: async (name) => {
      set({ busy: true, error: null });
      try {
        const alias = genAlias();
        const { mnemonic } = await createByAlias(alias); // saves the new seed to the keychain
        const entry: WalletEntry = { alias, name: name.trim() || `Wallet ${get().wallets.length + 1}`, createdAt: Date.now() };
        set({ wallets: [...get().wallets, entry] });
        persist();
        await activate(alias);
        // Force the user through a one-shot backup of the new phrase (the UI
        // routes to the backup screen while this is set). Created wallets only —
        // imported wallets already have their phrase saved by the owner.
        if (mnemonic.length) set({ pendingBackup: { alias, words: mnemonic } });
        return null;
      } catch (e) {
        return String(e);
      } finally {
        set({ busy: false });
      }
    },

    importWallet: async (name, words) => {
      set({ busy: true, error: null });
      try {
        const alias = genAlias();
        await importByAlias(alias, words);
        const entry: WalletEntry = { alias, name: name.trim() || 'Imported Wallet', createdAt: Date.now() };
        set({ wallets: [...get().wallets, entry] });
        persist();
        await activate(alias);
        return null;
      } catch (e) {
        return String(e);
      } finally {
        set({ busy: false });
      }
    },

    switchWallet: async (alias) => {
      if (alias === get().activeAlias || get().busy) return;
      set({ busy: true, error: null });
      try {
        await activate(alias);
      } catch (e) {
        set({ error: String(e) });
      } finally {
        set({ busy: false });
      }
    },

    renameWallet: (alias, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      set({ wallets: get().wallets.map((w) => (w.alias === alias ? { ...w, name: trimmed } : w)) });
      persist();
      if (alias === get().activeAlias) useWalletName.getState().setName(trimmed);
    },

    deleteWallet: async (alias) => {
      set({ busy: true });
      try {
        await deleteByAlias(alias);
        try {
          const af = accountsFileFor(alias);
          if (af.exists) af.delete();
        } catch {}
        const remaining = get().wallets.filter((w) => w.alias !== alias);
        set({ wallets: remaining });
        persist();
        if (alias === get().activeAlias) {
          if (remaining.length > 0) {
            await activate(remaining[0].alias);
          } else {
            // No wallets left → back to onboarding.
            setActiveAlias(PRIMARY_ALIAS);
            useActivity.getState().clear();
            useSession.setState({ wallet: null, addresses: null, mnemonic: null, status: 'onboarding', error: null });
            set({ activeAlias: PRIMARY_ALIAS });
            persist();
          }
        }
      } finally {
        set({ busy: false });
      }
    },

    logout: async () => {
      set({ busy: true });
      try {
        // Every wallet, not just the active one — a "log out" that left the
        // other seeds on disk would not be one.
        for (const w of get().wallets) {
          try {
            await deleteByAlias(w.alias);
          } catch {}
          try {
            const af = accountsFileFor(w.alias);
            if (af.exists) af.delete();
          } catch {}
          // The phrase lives in SecureStore, NOT in the wallet database, so
          // wiping the DB alone would leave it behind in the keychain.
          try {
            await clearMnemonic(w.alias);
          } catch {}
        }
        // Belt and braces: clear the primary alias too, in case the registry
        // was empty or out of step with what is actually on disk.
        try {
          await deleteByAlias(PRIMARY_ALIAS);
        } catch {}
        try {
          await clearMnemonic(PRIMARY_ALIAS);
        } catch {}
        try {
          const f = file();
          if (f.exists) f.delete();
        } catch {}

        // Drop everything derived from the wallet, so a new or re-imported
        // wallet never shows the previous one's balances or history.
        useActivity.getState().clear();
        useGateway.getState().reset();
        usePendingBalance.getState().clear();
        usePortfolio.setState({ assets: [] });

        setActiveAlias(PRIMARY_ALIAS);
        set({ wallets: [], activeAlias: PRIMARY_ALIAS, pendingBackup: null });
        useSession.setState({
          wallet: null,
          addresses: null,
          mnemonic: null,
          status: 'onboarding',
          error: null,
        });
      } finally {
        set({ busy: false });
      }
    },

    clearPendingBackup: () => set({ pendingBackup: null }),
  };
});
