//! Burnt, attested, not yet delivered.
//
// A Gateway send is two irreversible-in-sequence steps: Circle debits the
// unified balance and hands back a signed attestation, then somebody submits
// that attestation on the destination chain. Between those two moments the money
// exists only as the attestation — it has left the source and arrived nowhere.
//
// The app used to hold that payload in a local variable. If the relay failed it
// went out of scope, and the send screen said "funds are safe" while the one
// artefact capable of delivering them had just been discarded. Circle's
// attestation does not expire on its own and can be submitted by anyone, so what
// was missing was never a recovery mechanism — only a place to keep the ticket.
//
// This is that place. It is written to disk before the relay is attempted, so a
// crash, a force-quit or a dead relayer all leave the same recoverable state.
//
// Safe to persist: the payload names its own recipient inside Circle's
// signature, so a copy of it grants no power to redirect or skim the funds. The
// only thing it can do is deliver them to the person they were always for.
import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { relayMint } from '../bridge/gateway';
import type { ChainEnvironment } from '../lib/chains';

const FILENAME = 'gateway-claims.v1.json';

/** Small by nature — anything here is a failure awaiting a retry, not history. */
const MAX = 20;

export interface PendingClaim {
  /** Circle's transfer id when it gave us one, else a local id. Stable key. */
  id: string;
  attestation: string;
  signature: string;
  destinationDomain: number;
  /** Domain ids repeat across environments, so the claim has to remember which
   *  one it belongs to or a retry could mint on the wrong network. */
  environment: ChainEnvironment;
  /** Human USDC units, copied in so a row renders without any lookup. */
  amount: number;
  /** Destination chain id, as a string — `bigint` does not survive JSON. */
  chainId: string;
  chainName: string;
  recipient?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function file(): File {
  return new File(Paths.document, FILENAME);
}

interface PendingClaimState {
  claims: PendingClaim[];
  hydrated: boolean;
  /** Claim ids currently being retried, so a row cannot be double-submitted. */
  retrying: string[];
  hydrate: () => Promise<void>;
  /** Persist a claim. Called BEFORE the first relay attempt, not after it fails. */
  record: (c: Omit<PendingClaim, 'attempts' | 'createdAt'> & { createdAt?: number }) => void;
  /** Resubmit one claim. Removes it on success — including "already claimed",
   *  which means someone else delivered it and the money has arrived. */
  retry: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Drop a claim that has been delivered. */
  settle: (id: string) => void;
  reset: () => void;
}

function persist(claims: PendingClaim[]): void {
  try {
    file().write(JSON.stringify({ claims: claims.slice(0, MAX) }));
  } catch {
    // Worst case the claim is only in memory for this session — still better
    // than the previous behaviour, where it was in neither.
  }
}

export const usePendingClaims = create<PendingClaimState>((set, get) => ({
  claims: [],
  hydrated: false,
  retrying: [],

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = file();
      if (f.exists) {
        const d = JSON.parse(await f.text()) as { claims?: PendingClaim[] };
        if (Array.isArray(d.claims)) set({ claims: d.claims });
      }
    } catch {
      // Unreadable file: nothing to do but carry on. Do NOT delete it — a
      // half-written claim is still evidence a send happened, and a human can
      // read the JSON even if this parser cannot.
    }
    set({ hydrated: true });
  },

  record: (c) => {
    const claim: PendingClaim = { ...c, createdAt: c.createdAt ?? Date.now(), attempts: 0 };
    const claims = [claim, ...get().claims.filter((x) => x.id !== claim.id)].slice(0, MAX);
    set({ claims });
    persist(claims);
  },

  retry: async (id) => {
    const claim = get().claims.find((c) => c.id === id);
    if (!claim) return { ok: false, error: 'That claim is no longer pending.' };
    if (get().retrying.includes(id)) return { ok: false, error: 'Already retrying.' };

    set({ retrying: [...get().retrying, id] });
    try {
      const r = await relayMint(
        claim.attestation,
        claim.signature,
        claim.destinationDomain,
        claim.environment,
      );
      if (r.ok) {
        get().settle(id);
        return { ok: true };
      }
      const claims = get().claims.map((c) =>
        c.id === id ? { ...c, attempts: c.attempts + 1, lastError: r.error } : c,
      );
      set({ claims });
      persist(claims);
      return { ok: false, error: r.error };
    } finally {
      set({ retrying: get().retrying.filter((r) => r !== id) });
    }
  },

  settle: (id) => {
    const claims = get().claims.filter((c) => c.id !== id);
    set({ claims });
    persist(claims);
  },

  reset: () => {
    set({ claims: [], retrying: [] });
    persist([]);
  },
}));
