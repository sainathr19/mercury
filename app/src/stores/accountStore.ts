import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { setActiveAccount } from '../bridge/account';
import { useSession } from './session';
import { usePortfolio } from './portfolioStore';
import { useActivity } from './activityStore';

// Derived accounts within a wallet (same seed, different BIP account index),
// scoped per wallet alias. Mirrors the iOS WalletSession accounts model. The
// active index is threaded into every bridge call via bridge/account.
export interface Account {
  index: number;
  name: string;
}
interface Persisted {
  accounts: Account[];
  hidden: number[];
  active: number;
}

function defaultName(index: number): string {
  return `Account ${index + 1}`;
}
const DEFAULT_ACCOUNTS: Account[] = [{ index: 0, name: defaultName(0) }];

// Primary keeps the legacy filename so existing installs are untouched.
function fileFor(alias: string): File {
  return new File(Paths.document, alias === 'primary' ? 'accounts.v1.json' : `accounts.${alias}.json`);
}

interface AccountState {
  alias: string;
  accounts: Account[];
  hidden: number[];
  active: number;
  /** Load the accounts for a wallet alias + apply its active index. */
  loadFor: (alias: string) => Promise<void>;
  addAccount: () => Promise<void>;
  switchAccount: (index: number) => Promise<void>;
  renameAccount: (index: number, name: string) => void;
  hideAccount: (index: number) => void;
  unhideAccount: (index: number) => void;
}

export const useAccounts = create<AccountState>((set, get) => {
  const persist = () => {
    const s = get();
    try {
      fileFor(s.alias).write(JSON.stringify({ accounts: s.accounts, hidden: s.hidden, active: s.active } satisfies Persisted));
    } catch {}
  };
  const applyActive = async (index: number) => {
    setActiveAccount(index);
    // Refresh the portfolio immediately (before the async address re-derivation)
    // so the previous account's balances are swapped out at once — loadPortfolio
    // reads the active account index, not the session addresses. Activity needs
    // the re-derived addresses, so it runs after.
    usePortfolio.getState().refresh();
    await useSession.getState().refreshAddresses();
    useActivity.getState().refresh();
  };

  return {
    alias: 'primary',
    accounts: DEFAULT_ACCOUNTS,
    hidden: [],
    active: 0,

    loadFor: async (alias) => {
      let accounts = DEFAULT_ACCOUNTS;
      let hidden: number[] = [];
      let active = 0;
      try {
        const f = fileFor(alias);
        if (f.exists) {
          const d = JSON.parse(await f.text()) as Partial<Persisted>;
          accounts = d.accounts?.length ? d.accounts : DEFAULT_ACCOUNTS;
          hidden = d.hidden ?? [];
          active = typeof d.active === 'number' ? d.active : 0;
        }
      } catch {}
      set({ alias, accounts, hidden, active });
      setActiveAccount(active);
    },

    addAccount: async () => {
      const next = Math.max(-1, ...get().accounts.map((a) => a.index)) + 1;
      set({ accounts: [...get().accounts, { index: next, name: defaultName(next) }] });
      persist();
      await get().switchAccount(next);
    },

    switchAccount: async (index) => {
      if (!get().accounts.some((a) => a.index === index)) return;
      set({ active: index });
      persist();
      await applyActive(index);
    },

    renameAccount: (index, name) => {
      const trimmed = name.trim() || defaultName(index);
      set({ accounts: get().accounts.map((a) => (a.index === index ? { ...a, name: trimmed } : a)) });
      persist();
    },

    hideAccount: (index) => {
      const visible = get().accounts.filter((a) => !get().hidden.includes(a.index));
      if (visible.length <= 1) return; // never hide the last visible account
      const hidden = [...new Set([...get().hidden, index])];
      set({ hidden });
      persist();
      if (get().active === index) {
        const fallback = get().accounts.find((a) => !hidden.includes(a.index));
        if (fallback) void get().switchAccount(fallback.index);
      }
    },

    unhideAccount: (index) => {
      set({ hidden: get().hidden.filter((i) => i !== index) });
      persist();
    },
  };
});
