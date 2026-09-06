import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import type { PortfolioAsset } from '../bridge/portfolio';
import { activeScopeKey } from '../bridge/wallet';
import { checkTxOutcome } from '../bridge/receipts';
import {
  assetFullySettled,
  type PendingDelta,
  type ChainKind,
  type DeltaStatus,
  type DeltaMeta,
} from '../lib/pendingBalance';

// Re-export the pure types so existing importers keep one import site.
export type { PendingDelta, ChainKind, DeltaStatus, DeltaMeta };

// ---------------------------------------------------------------------------
// Optimistic balance ledger — the "instant send/receive" reconciliation engine.
//
// THE INVARIANT (why it can never double-count):
//   The confirmed balance (straight from RPC / the stealth scan) is NEVER mutated
//   here. Optimism lives ONLY as signed deltas, each anchored to the confirmed
//   balance at the moment the tx was made (`baseline`). The display fold
//   (lib/pendingBalance.optimisticAmount) shrinks the optimistic top-up by exactly
//   however much the real balance has caught up — so displayed stays a flat
//   `baseline + amount` until the tx settles, then equals confirmed. There is no
//   separate timer, so there's no window where both the delta and the confirmed
//   balance count the same funds.
//
//   A delta is DROPPED (cleanup only, invisible) once the confirmed balance has
//   fully caught up (assetFullySettled). A tx that never confirms is reversed
//   after a TTL; a `failed` tx is reversed immediately.
//
// Deltas are deduped by tx hash against a persistent `seen` set, partitioned by
// wallet scope + persisted. The store is a FACTORY so the normal portfolio and
// the stealth (private) balance each get an independent ledger + cache file.
// ---------------------------------------------------------------------------

const PENDING_TTL_MS = 6 * 60 * 1000;

/** Chain family for receipt polling (0=BTC, 1=EVM, 2=SOL). */
function familyOf(kind: ChainKind): number {
  return kind === 'btc' ? 0 : kind === 'sol' ? 2 : 1;
}

const SEEN_CAP = 500;

interface Persisted {
  deltas: PendingDelta[];
  seen: string[];
}

function cacheFile(namespace: string, scope: string): File {
  return new File(Paths.document, `${namespace}-${scope}.json`);
}
function persist(namespace: string, scope: string, deltas: PendingDelta[], seen: string[]): void {
  try {
    cacheFile(namespace, scope).write(JSON.stringify({ deltas, seen } satisfies Persisted));
  } catch {}
}
async function loadFromDisk(namespace: string, scope: string): Promise<Persisted> {
  try {
    const f = cacheFile(namespace, scope);
    if (f.exists) {
      const parsed = JSON.parse(await f.text());
      if (Array.isArray(parsed)) return { deltas: parsed as PendingDelta[], seen: [] };
      return { deltas: parsed.deltas ?? [], seen: parsed.seen ?? [] };
    }
  } catch {}
  return { deltas: [], seen: [] };
}

export interface PendingBalanceState {
  deltas: PendingDelta[];
  seen: string[];
  loadedScope: string | null;
  hasSeen: (key: string) => boolean;
  /** Record keys as already-processed WITHOUT crediting a delta — used to
   *  baseline pre-existing relay hints silently (so a later poll doesn't re-credit
   *  them) without touching the balance. */
  markSeen: (keys: string[]) => void;
  ensureScope: () => Promise<void>;
  addSend: (d: Omit<PendingDelta, 'direction' | 'status' | 'createdAt' | 'delta'> & { amount: number }) => void;
  addReceive: (d: Omit<PendingDelta, 'direction' | 'status' | 'createdAt' | 'delta'> & { amount: number }) => void;
  markFailed: (key: string) => void;
  reconcile: (confirmed: PortfolioAsset[]) => void;
  watch: () => Promise<void>;
  clear: () => void;
}

/** Options controlling how a ledger settles its optimistic deltas. */
interface PendingBalanceOptions {
  /** Drop a RECEIVE delta the instant its tx confirms on-chain (default true).
   *  Correct when the confirmed balance is an RPC read of the SAME address the
   *  tx lands in (the seamless/normal ledger) — a confirmed tx means the funds
   *  are in the real balance, so keeping the credit would double-count.
   *  MUST be false for the stealth ledger: there the "confirmed" balance is the
   *  announcement SCAN, not an RPC read, so a shield's funding tx confirming
   *  does NOT mean the scan has surfaced the shielded funds yet. Dropping on
   *  confirm there leaves a gap where the balance dips back to its previous
   *  value until the (much slower) scan discovers the payment. Instead the
   *  stealth ledger settles via reconcile (assetFullySettled) once the scan
   *  catches up, or the TTL. `failed` handling stays on regardless. */
  dropReceiveOnConfirm?: boolean;
}

/** Build an optimistic-balance store bound to its own `namespace` cache file. */
export function createPendingBalanceStore(namespace: string, opts: PendingBalanceOptions = {}) {
  const dropReceiveOnConfirm = opts.dropReceiveOnConfirm ?? true;
  let watching = false;
  return create<PendingBalanceState>((set, get) => {
    const commit = (next: PendingDelta[]) => {
      const scope = get().loadedScope ?? activeScopeKey();
      set({ deltas: next });
      persist(namespace, scope, next, get().seen);
    };
    const upsert = (delta: PendingDelta) => {
      if (get().seen.includes(delta.key) || get().deltas.some((d) => d.key === delta.key)) return;
      const scope = get().loadedScope ?? activeScopeKey();
      const seen = [...get().seen, delta.key].slice(-SEEN_CAP);
      const deltas = [...get().deltas, delta];
      set({ deltas, seen });
      persist(namespace, scope, deltas, seen);
      void get().watch();
    };

    return {
      deltas: [],
      seen: [],
      loadedScope: null,

      hasSeen: (key) => get().seen.includes(key),

      markSeen: (keys) => {
        const fresh = keys.filter((k) => !get().seen.includes(k));
        if (!fresh.length) return;
        const scope = get().loadedScope ?? activeScopeKey();
        const seen = [...get().seen, ...fresh].slice(-SEEN_CAP);
        set({ seen });
        persist(namespace, scope, get().deltas, seen);
      },

      ensureScope: async () => {
        const scope = activeScopeKey();
        if (scope === get().loadedScope) return;
        const { deltas, seen } = await loadFromDisk(namespace, scope);
        const mergedSeen = [...new Set([...seen, ...deltas.map((d) => d.key)])].slice(-SEEN_CAP);
        set({ deltas, seen: mergedSeen, loadedScope: scope });
        void get().watch();
      },

      addSend: ({ amount, ...rest }) =>
        upsert({ ...rest, direction: 'send', delta: -Math.abs(amount), status: 'pending', createdAt: Date.now() }),

      addReceive: ({ amount, ...rest }) =>
        upsert({ ...rest, direction: 'receive', delta: Math.abs(amount), status: 'pending', createdAt: Date.now() }),

      markFailed: (key) => commit(get().deltas.map((x) => (x.key === key ? { ...x, status: 'failed' } : x))),

      reconcile: (confirmed) => {
        const now = Date.now();
        const amountById = new Map(confirmed.map((a) => [a.id, a.amount]));
        const byAsset = new Map<string, PendingDelta[]>();
        for (const d of get().deltas) {
          if (d.status === 'failed') continue;
          const arr = byAsset.get(d.assetId);
          if (arr) arr.push(d);
          else byAsset.set(d.assetId, [d]);
        }
        const settled = new Set<string>();
        for (const [assetId, ds] of byAsset) {
          if (assetFullySettled(amountById.get(assetId) ?? 0, ds)) settled.add(assetId);
        }
        const next = get().deltas.filter((d) => {
          if (d.status === 'failed') return false;
          if (settled.has(d.assetId)) return false;
          if (now - d.createdAt > PENDING_TTL_MS) return false;
          return true;
        });
        if (next.length !== get().deltas.length) commit(next);
      },

      watch: async () => {
        if (watching) return;
        watching = true;
        try {
          for (let i = 0; i < 24; i++) {
            const pending = get().deltas.filter((d) => d.status === 'pending');
            if (!pending.length) break;
            await new Promise((r) => setTimeout(r, 5000));
            for (const d of pending) {
              const chainId = d.chainId ? BigInt(d.chainId) : undefined;
              const outcome = await checkTxOutcome(familyOf(d.chainKind), d.txHash, chainId);
              if (outcome === 'failed') {
                get().markFailed(d.key);
              } else if (dropReceiveOnConfirm && outcome === 'confirmed' && d.direction === 'receive') {
                // A confirmed RECEIVE is already in (or imminently in) the real
                // balance, so drop the optimistic credit immediately — otherwise a
                // credit whose baseline already included the funds (the scan beat
                // the hint) double-counts until the TTL. Sends stay until the
                // confirmed balance catches up (assetFullySettled in reconcile),
                // since dropping a send early would briefly show unsent funds.
                commit(get().deltas.filter((x) => x.key !== d.key));
              }
            }
          }
        } finally {
          watching = false;
        }
      },

      clear: () => {
        const scope = get().loadedScope ?? activeScopeKey();
        try {
          const f = cacheFile(namespace, scope);
          if (f.exists) f.delete();
        } catch {}
        set({ deltas: [], seen: [] });
      },
    };
  });
}

/** The normal portfolio's optimistic ledger (unchanged behavior + cache file). */
export const usePendingBalance = createPendingBalanceStore('pending-deltas');

/** The stealth (private) balance's optimistic ledger — a separate instance so a
 *  shield/private-spend feels instant, reconciled against the stealth scan.
 *  `dropReceiveOnConfirm: false` because the confirmed side here is the scan, not
 *  an RPC read — a shield's funding tx confirms long before the scan surfaces the
 *  shielded funds, so the credit must persist until the scan catches up (else the
 *  balance dips back to its previous value for the whole scan lag). */
export const usePendingStealth = createPendingBalanceStore('pending-stealth-deltas', {
  dropReceiveOnConfirm: false,
});
