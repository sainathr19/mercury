import { create } from 'zustand';
import type { WalletInterface } from 'mercury-wallet-core';

// 'locked' = a wallet exists on disk but it isn't unlocked yet (Face ID/passcode
// not yet satisfied, or cancelled). Distinct from 'onboarding' (no wallet at all)
// so a failed unlock shows the lock screen, never the create/import flow.
export type SessionStatus = 'loading' | 'onboarding' | 'locked' | 'ready';

export interface Addresses {
  btc: string;
  eth: string;
  sol: string;
}

/** The slice of the bridge the session store depends on (keeps it mockable). */
export interface WalletBridge {
  walletExists: () => boolean;
  createWallet: () => Promise<{ wallet: WalletInterface; mnemonic: string[] }>;
  importWallet: (words: string[]) => Promise<WalletInterface>;
  openWallet: () => Promise<WalletInterface>;
  deleteWallet: () => Promise<void>;
  getAddresses: (wallet: WalletInterface) => Promise<Addresses>;
}

export interface SessionState {
  status: SessionStatus;
  wallet: WalletInterface | null;
  addresses: Addresses | null;
  /** Held in memory only immediately after create, for the backup flow. */
  mnemonic: string[] | null;
  error: string | null;

  bootstrap: () => Promise<void>;
  /** Retry unlocking an existing wallet from the lock screen. */
  unlock: () => Promise<void>;
  create: () => Promise<void>;
  importPhrase: (words: string[]) => Promise<void>;
  clearMnemonic: () => void;
  reset: () => Promise<void>;
  /** Re-derive addresses for the active account (after an account switch). */
  refreshAddresses: () => Promise<void>;
  /** Adopt an already-opened wallet handle (after switching/adding a wallet). */
  adopt: (wallet: WalletInterface, addresses: Addresses) => void;
}

/** Factory takes the bridge so the store is unit-testable with mocks. */
export function createSessionStore(bridge: WalletBridge) {
  return create<SessionState>((set, get) => {
    // Open the active wallet — unwrapping the seed from the Secure Enclave is the
    // biometric/passcode gate (it throws on cancel/failure).
    const openActive = async () => {
      const wallet = await bridge.openWallet();
      set({ wallet, addresses: await bridge.getAddresses(wallet), status: 'ready', error: null });
    };

    return {
      status: 'loading',
      wallet: null,
      addresses: null,
      mnemonic: null,
      error: null,

      bootstrap: async () => {
      if (!bridge.walletExists()) {
        set({ status: 'onboarding' });
        return;
      }
      try {
        await openActive();
      } catch (e) {
        // A wallet exists but unlock failed/was cancelled → show the lock screen,
        // NOT onboarding (which would imply the wallet is gone).
        console.warn('[session] bootstrap openWallet failed:', String(e));
        set({ status: 'locked', error: String(e) });
      }
    },

    unlock: async () => {
      if (!bridge.walletExists()) {
        set({ status: 'onboarding' });
        return;
      }
      set({ error: null });
      try {
        await openActive();
      } catch (e) {
        console.warn('[session] unlock openWallet failed:', String(e));
        set({ status: 'locked', error: String(e) });
      }
    },

    create: async () => {
      const { wallet, mnemonic } = await bridge.createWallet();
      set({
        wallet,
        mnemonic,
        addresses: await bridge.getAddresses(wallet),
        status: 'ready',
        error: null,
      });
    },

    importPhrase: async (words) => {
      const wallet = await bridge.importWallet(words);
      set({ wallet, addresses: await bridge.getAddresses(wallet), status: 'ready', error: null });
    },

    clearMnemonic: () => set({ mnemonic: null }),

    reset: async () => {
      await bridge.deleteWallet();
      set({ wallet: null, addresses: null, mnemonic: null, status: 'onboarding', error: null });
    },

    refreshAddresses: async () => {
      const wallet = get().wallet;
      if (!wallet) return;
      set({ addresses: await bridge.getAddresses(wallet) });
    },

    adopt: (wallet, addresses) => {
      set({ wallet, addresses, status: 'ready', mnemonic: null, error: null });
    },
    };
  });
}
