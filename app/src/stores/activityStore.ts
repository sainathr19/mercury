import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { loadActivity, type ActivityItem, type TxStatus } from '../bridge/activity';
import { checkTxOutcome, familyForSymbol } from '../bridge/receipts';
import { mergeActivity } from '../lib/activity-merge';
import { activityMatchesEnv } from '../lib/activity-env';
import { getActiveEvmChainId } from '../bridge/evmChain';
import { getActiveEnvironment } from '../bridge/activeEnv';
import { activeScopeKey } from '../bridge/wallet';
import { useSession } from './session';
import { usePortfolio } from './portfolioStore';

// Persisted so history survives app restarts (mirrors iOS ActivityStore DiskCache).
// Partitioned per (wallet, account, environment) so a switch never shows another
// scope's history.
const MAX_PERSISTED = 100;

function cacheFile(): File {
  return new File(Paths.document, `activity-${activeScopeKey()}.json`);
}

function persist(items: ActivityItem[]): void {
  try {
    cacheFile().write(JSON.stringify(items.slice(0, MAX_PERSISTED)));
  } catch {
    // best-effort; losing the cache only means a re-scan on next launch
  }
}

async function loadFromDisk(): Promise<ActivityItem[]> {
  try {
    const f = cacheFile();
    if (f.exists) return JSON.parse(await f.text()) as ActivityItem[];
  } catch {
    // corrupt/missing cache → start empty
  }
  return [];
}

/** Keep only rows belonging to the active environment. The persisted cache can
 *  hold stale testnet rows from an earlier session (older builds cached before
 *  the scope key was environment-partitioned); without this they flash into the
 *  mainnet feed on hydrate until the live scan replaces them. Applied on every
 *  read AND before persist, so the cache itself self-heals to mainnet-only. */
function inActiveEnv(items: ActivityItem[]): ActivityItem[] {
  const env = getActiveEnvironment();
  return items.filter((i) => activityMatchesEnv(i, env));
}

export type ActivityStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ActivityState {
  items: ActivityItem[];
  status: ActivityStatus;
  hydrated: boolean;
  error: string | null;
  /** The (wallet, account, environment) scope the current `items` belong to. */
  loadedScope: string | null;
  /** Load the persisted list once (fast paint before the network scan). */
  hydrate: () => Promise<void>;
  /** Scan chains for history, merge with what we have, persist. Never throws. */
  refresh: () => Promise<void>;
  /** Optimistically add a just-broadcast tx so it shows immediately. */
  prepend: (item: ActivityItem) => void;
  /** Upsert received-private items (from the stealth store) by id, preserving
   *  each one's first-seen timestamp so they sort/label stably. */
  syncPrivateReceipts: (receipts: ActivityItem[]) => void;
  /** Swap an item's txid in place after an RBF fee bump (keeps it pending). */
  replaceTx: (oldId: string, newTxid: string, explorerUrl: string) => void;
  /** Poll the chain for any pending private send/spend and flip it to
   *  confirmed/failed. Private spends never appear in the address scan, so this
   *  is the only thing that resolves their status. Never throws. */
  reconcilePrivate: () => Promise<void>;
  /** Poll `reconcilePrivate` on a short backoff until no pending private send
   *  remains (or a cap). Kicked off after broadcasting a private send/spend. */
  watchPrivatePending: () => Promise<void>;
  /** Drop all history (used on wallet reset/import). */
  clear: () => void;
}

/** A private send/spend whose on-chain outcome we still need to resolve. */
function isUnresolvedPrivateSend(i: ActivityItem): boolean {
  return (
    !!i.private &&
    i.type === 'sent' &&
    i.status === 'pending' &&
    !!i.id &&
    !i.id.startsWith('stealth-')
  );
}

// Guards a single in-flight watch loop (module-level so re-entrant sends don't
// stack overlapping pollers).
let watching = false;

export const useActivity = create<ActivityState>((set, get) => ({
  items: [],
  status: 'idle',
  hydrated: false,
  error: null,
  loadedScope: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const items = inActiveEnv(await loadFromDisk());
    set({ items, loadedScope: activeScopeKey(), hydrated: true });
  },

  refresh: async () => {
    const addresses = useSession.getState().addresses;
    if (!addresses) return;
    if (!get().hydrated) await get().hydrate();
    // Switched wallet/account/environment → load THAT scope's history (or clear)
    // before merging, so we never show or merge into another scope's items.
    const scope = activeScopeKey();
    if (scope !== get().loadedScope) {
      const cached = inActiveEnv(await loadFromDisk());
      set({ items: cached, loadedScope: scope, status: cached.length ? 'ready' : 'loading' });
    } else {
      set((s) => ({ status: s.items.length ? s.status : 'loading' }));
    }
    try {
      const market = usePortfolio.getState().market;
      const priceOf = (cg: string) => market[cg]?.price ?? 0;
      const fetched = await loadActivity(
        { btc: addresses.btc, eth: addresses.eth, sol: addresses.sol },
        getActiveEvmChainId(),
        {
          bitcoin: market['bitcoin']?.price ?? 0,
          solana: market['solana']?.price ?? 0,
          ethereum: market['ethereum']?.price ?? 0,
        },
        priceOf,
      );
      // Hide the source-leg "sent" rows that swaps produce on-chain — the scan
      // surfaces them as separate sends, but we already show one "Swapped" row.
      const hideIds = new Set(
        get()
          .items.filter((i) => i.sourceTxId)
          .map((i) => i.sourceTxId!.toLowerCase()),
      );
      const items = inActiveEnv(
        mergeActivity(get().items, fetched).filter((i) => !hideIds.has(i.id.toLowerCase())),
      );
      set({ items, status: 'ready', error: null });
      persist(items);
      // Resolve any lingering private send/spend the scan can't see.
      void get().reconcilePrivate();
    } catch (e) {
      set({ status: 'error', error: String(e) });
    }
  },

  prepend: (item) => {
    const items = mergeActivity([item, ...get().items], []);
    set({ items });
    persist(items);
  },

  syncPrivateReceipts: (receipts) => {
    const incoming = new Map(receipts.map((r) => [r.id, r]));
    // The scan is the source of truth for RECEIVED private payments: drop any
    // previously-persisted stealth receipt (stealth-recv-*) that's no longer in
    // it, so a payment we now filter out (e.g. a native placeholder) or one
    // that was spent away disappears instead of lingering with a stale amount.
    // Sends/spends (different id shape) are untouched.
    const byId = new Map(
      get()
        .items.filter((i) => !(i.id.startsWith('stealth-recv-') && !incoming.has(i.id)))
        .map((i) => [i.id, i]),
    );
    for (const r of receipts) {
      const prev = byId.get(r.id);
      // Keep the original first-seen timestamp (received payments carry none);
      // refresh amount/status/value from the latest scan.
      byId.set(r.id, prev ? { ...r, timestamp: prev.timestamp } : r);
    }
    const items = mergeActivity([...byId.values()], []);
    set({ items });
    persist(items);
  },

  replaceTx: (oldId, newTxid, explorerUrl) => {
    const items = get().items.map((it) =>
      it.id === oldId ? { ...it, id: newTxid, explorerUrl, status: 'pending' as const } : it,
    );
    set({ items });
    persist(items);
  },

  reconcilePrivate: async () => {
    const pending = get().items.filter(isUnresolvedPrivateSend);
    if (!pending.length) return;
    const resolved = await Promise.all(
      pending.map(async (i) => {
        const family = familyForSymbol(i.symbol);
        if (family === undefined) return null;
        const outcome = await checkTxOutcome(family, i.id, i.chainId != null ? BigInt(i.chainId) : undefined);
        return outcome === 'pending' ? null : { id: i.id, status: outcome as TxStatus };
      }),
    );
    const updates = new Map(resolved.filter((r): r is { id: string; status: TxStatus } => r !== null).map((r) => [r.id, r.status]));
    if (!updates.size) return;
    const items = get().items.map((i) => (updates.has(i.id) ? { ...i, status: updates.get(i.id)! } : i));
    set({ items });
    persist(items);
  },

  watchPrivatePending: async () => {
    if (watching) return;
    watching = true;
    try {
      // ~60s of coverage (12 × 5s). A block on Sepolia/Solana/testnet BTC lands
      // well within that; anything still pending after resolves on next refresh.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await get().reconcilePrivate();
        if (!get().items.some(isUnresolvedPrivateSend)) break;
      }
    } finally {
      watching = false;
    }
  },

  clear: () => {
    try {
      const f = cacheFile();
      if (f.exists) f.delete();
    } catch {}
    set({ items: [], status: 'idle', hydrated: true, error: null });
  },
}));
