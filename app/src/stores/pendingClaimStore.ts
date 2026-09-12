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
//
// One correction to the paragraph above, learned the hard way: a claim is not
// retryable forever. A mint that is MINED AND REVERTS is deterministic — the
// same calldata against the same contract reverts identically — and Circle
// returns the debited amount to the unified balance afterwards. Observed: a
// 0.50 transfer reverted, and 1.50 (the amount plus its fee) reappeared in the
// balance. A claim in that state is not money waiting to be rescued, and
// offering "Retry" on it invites the user to keep failing at something that has
// already resolved itself. Those are marked dead — see `reverted`.
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
  /**
   * The mint was mined and reverted, so this payload can never be delivered.
   *
   * Distinguished from an ordinary failure by the relayer returning a
   * transaction hash: it only has one once the mint reached the chain. A
   * network error, an unfunded relayer or an unreachable hub produce no hash
   * and stay retryable, which is the case this store was built for.
   */
  reverted?: { at: number; txHash?: string };
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
  /** Record that this claim's mint was mined and reverted. */
  markReverted: (id: string, txHash?: string) => void;
  /** Forget a claim whose mint reverted; refuses to touch a live one. */
  dismiss: (id: string) => void;
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
    if (claim.reverted) {
      return { ok: false, error: 'That mint reverted on chain and cannot be resubmitted.' };
    }
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
      // A hash means the mint reached the chain and came back reverted. Retrying
      // identical calldata against the same contract cannot end differently, and
      // Circle returns the amount to the unified balance on its own.
      const reverted = r.txHash ? { at: Date.now(), txHash: r.txHash } : undefined;
      const claims = get().claims.map((c) =>
        c.id === id
          ? { ...c, attempts: c.attempts + 1, lastError: r.error, ...(reverted ? { reverted } : {}) }
          : c,
      );
      set({ claims });
      persist(claims);
      return { ok: false, error: r.error };
    } finally {
      set({ retrying: get().retrying.filter((r) => r !== id) });
    }
  },

  markReverted: (id, txHash) => {
    const claims = get().claims.map((c) =>
      c.id === id
        ? { ...c, reverted: { at: Date.now(), txHash }, lastError: c.lastError ?? 'Mint reverted on chain' }
        : c,
    );
    set({ claims });
    persist(claims);
  },

  dismiss: (id) => {
    // Only a dead claim can be dismissed. A pending one is the sole record of
    // undelivered money, and letting it be swiped away would lose it.
    const c = get().claims.find((x) => x.id === id);
    if (!c?.reverted) return;
    const claims = get().claims.filter((x) => x.id !== id);
    set({ claims });
    persist(claims);
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
