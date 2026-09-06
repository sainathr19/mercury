//! UI state for claiming / editing the Standard username.
//
// Owns the create-sheet's input + debounced availability check, the save
// (handle → hub registration, keyed to the wallet's stealth meta-address), and
// the "Use X username" claim. Reads the wallet from the session store and writes
// the updated user back to the auth store so the whole app sees the new handle.

import { create } from 'zustand';
import { authClient, type HandleStatus } from '../bridge/auth';
import { validateHandle } from '../bridge/username';
import { authorizeTwitter } from '../bridge/twitterAuth';
import { loadMetaAddress } from '../bridge/stealth';
import { syncAddressesToHub } from '../bridge/hubAddresses';
import { useAuth } from './authStore';
import { useSession } from './session';

// chain_mask bits (match the hub): BTC=1, EVM=2, SOL=4.
const BTC = 1, EVM = 2, SOL = 4;

export interface UsernameState {
  input: string;
  /** The user's currently-set handle (their own name reads as "available"). */
  current: string | null;
  checking: boolean;
  /** Availability of `input`: null = not yet checked / empty. `reserved` means
   *  it matches a big X account and can only be claimed via "Use X username". */
  status: HandleStatus | null;
  /** When status === 'reserved', the X @handle that reserves it (for messaging). */
  reservedXHandle: string | null;
  formatError: string | null;
  saving: boolean;
  claiming: boolean;
  error: string | null;

  /** Seed the sheet (edit mode passes the existing handle). */
  begin: (current: string | null) => void;
  setInput: (v: string) => void;
  save: () => Promise<boolean>;
  claimViaX: () => Promise<boolean>;
}

let debounce: ReturnType<typeof setTimeout> | null = null;

export const useUsername = create<UsernameState>((set, get) => ({
  input: '',
  current: null,
  checking: false,
  status: null,
  reservedXHandle: null,
  formatError: null,
  saving: false,
  claiming: false,
  error: null,

  begin: (current) => {
    if (debounce) clearTimeout(debounce);
    set({ input: '', current, checking: false, status: null, reservedXHandle: null, formatError: null, saving: false, error: null });
  },

  setInput: (raw) => {
    // Normalize the way the hub stores handles: no leading @, lowercase, trimmed.
    const input = raw.replace(/^@+/, '').toLowerCase().trim();
    set({ input, error: null });

    if (debounce) clearTimeout(debounce);

    if (!input) {
      set({ status: null, reservedXHandle: null, formatError: null, checking: false });
      return;
    }
    // Typing your own current handle is always "available" (it's yours).
    if (input === get().current) {
      set({ status: 'available', reservedXHandle: null, formatError: null, checking: false });
      return;
    }
    const formatError = validateHandle(input);
    if (formatError) {
      set({ status: null, reservedXHandle: null, formatError, checking: false });
      return;
    }
    set({ formatError: null, checking: true, status: null, reservedXHandle: null });
    debounce = setTimeout(async () => {
      try {
        const r = await authClient.checkHandle(input);
        if (get().input === input) {
          set({ status: r.status, reservedXHandle: r.status === 'reserved' ? r.xHandle ?? null : null, checking: false });
        }
      } catch {
        if (get().input === input) set({ status: null, reservedXHandle: null, checking: false });
      }
    }, 400);
  },

  save: async () => {
    const handle = get().input;
    if (!handle || get().formatError || get().status !== 'available') return false;
    set({ saving: true, error: null });
    try {
      const wallet = useSession.getState().wallet;
      const addresses = useSession.getState().addresses;
      if (!wallet || !addresses) throw new Error('Wallet not ready.');
      const meta = await loadMetaAddress(wallet).catch(() => '');
      if (!meta) throw new Error('Could not load your stealth address. Try again.');
      let mask = 0;
      if (addresses.btc) mask |= BTC;
      if (addresses.eth) mask |= EVM;
      if (addresses.sol) mask |= SOL;
      const user = await authClient.putRegistration(handle, meta, mask);
      useAuth.getState().setUser(user);
      // Registration only stores the handle + meta-address + chain_mask. Publish
      // the PUBLIC btc/evm/sol receive addresses now too, so others can send to
      // @handle immediately — instead of waiting for the next launch's sync (the
      // gap that left some accounts with a chain_mask but no published address).
      await syncAddressesToHub(wallet, addresses).catch((e) => console.warn('[hub] address sync at claim failed:', e));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not save username.' });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  claimViaX: async () => {
    set({ claiming: true, error: null });
    try {
      const res = await authorizeTwitter();
      if (!res) return false; // cancelled
      const user = await authClient.claimTwitter(res.code, res.codeVerifier, res.redirectUri);
      useAuth.getState().setUser(user);
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not connect your X account.' });
      return false;
    } finally {
      set({ claiming: false });
    }
  },
}));
