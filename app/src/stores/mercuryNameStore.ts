//! The user's Mercury name — `alice.mercurywallet.eth`.
//
// Replaces the hub handle, which lived behind a hub login this fork has no
// account on. A Mercury name needs no login and no server at all — it is a row
// in a contract, registered by the same key that will receive at it.
//
// Cached locally as well as on-chain. The chain is authoritative; this only
// spares the user a round trip to Ethereum before their own name paints.

import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import {
  checkName,
  claimName,
  fullName,
  namesConfigured,
  validateLabel,
} from '../bridge/mercuryName';
import { getActiveAccount } from '../bridge/account';
import { useSession } from './session';

const FILENAME = 'mercury-name.v1.json';

/** Arc is where Mercury settles, so it is what we publish as the routing hint. */
const PREFERRED_CHAIN = 5042002;

export type NameStatus = 'available' | 'taken' | 'unknown';

export interface MercuryNameState {
  /** The claimed full name, e.g. `alice.mercurywallet.eth`. */
  name: string | null;
  hydrated: boolean;

  input: string;
  checking: boolean;
  status: NameStatus | null;
  /** Why `input` is unusable, decided locally before any request. */
  formatError: string | null;
  /** Why the name is taken — the hub's own wording, e.g. reserved names. */
  statusReason: string | null;
  saving: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  begin: () => void;
  setInput: (v: string) => void;
  save: () => Promise<boolean>;
}

let debounce: ReturnType<typeof setTimeout> | null = null;

export const useMercuryName = create<MercuryNameState>((set, get) => ({
  name: null,
  hydrated: false,
  input: '',
  checking: false,
  status: null,
  formatError: null,
  statusReason: null,
  saving: false,
  error: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = new File(Paths.document, FILENAME);
      if (f.exists) {
        const data = JSON.parse(await f.text()) as { name?: string };
        if (data?.name) set({ name: data.name });
      }
    } catch {
      // A missing or unreadable file just means no name yet.
    }
    set({ hydrated: true });
  },

  begin: () => {
    if (debounce) clearTimeout(debounce);
    set({ input: '', checking: false, status: null, formatError: null, statusReason: null, saving: false, error: null });
  },

  setInput: (raw) => {
    const input = raw.replace(/^@+/, '').toLowerCase().trim();
    set({ input, error: null });

    if (debounce) clearTimeout(debounce);

    if (!input) {
      set({ status: null, formatError: null, statusReason: null, checking: false });
      return;
    }
    // Their own name always reads as free — it is theirs, and re-saving it is
    // how records get refreshed.
    if (fullName(input) === get().name) {
      set({ status: 'available', formatError: null, statusReason: null, checking: false });
      return;
    }
    const formatError = validateLabel(input);
    if (formatError) {
      set({ status: null, formatError, statusReason: null, checking: false });
      return;
    }
    set({ formatError: null, checking: true, status: null, statusReason: null });

    // Debounced: this fires on every keystroke, and the answer for a prefix of
    // what they are typing is worth nothing.
    debounce = setTimeout(async () => {
      const r = await checkName(input);
      // Ignore a late answer for a name they have already typed past.
      if (get().input !== input) return;
      set({
        checking: false,
        status: r.state === 'available' ? 'available' : r.state === 'taken' ? 'taken' : 'unknown',
        statusReason: r.state === 'taken' ? r.reason : null,
      });
    }, 400);
  },

  save: async () => {
    const label = get().input;
    if (!label || get().formatError || get().status !== 'available') return false;
    if (!namesConfigured()) {
      set({ error: 'Names are not configured for this build.' });
      return false;
    }
    set({ saving: true, error: null });
    try {
      const { wallet, addresses } = useSession.getState();
      if (!wallet || !addresses?.eth) throw new Error('Wallet not ready.');

      // Every address family goes up together. One name that resolves on some
      // chains and not others is worse than no name — the sender cannot tell
      // which case they are in.
      const outcome = await claimName({
        wallet,
        account: getActiveAccount(),
        label,
        evm: addresses.eth,
        solana: addresses.sol,
        bitcoin: addresses.btc,
        prefer: PREFERRED_CHAIN,
      });
      if (!outcome.ok) {
        set({ error: outcome.error });
        return false;
      }
      set({ name: outcome.name });
      try {
        new File(Paths.document, FILENAME).write(JSON.stringify({ name: outcome.name }));
      } catch {
        // The hub has it; a failed local write costs a launch-time round trip.
      }
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not claim that name.' });
      return false;
    } finally {
      set({ saving: false });
    }
  },
}));
