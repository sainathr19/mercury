import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import {
  loadPortfolioChains,
  loadMarket,
  type PortfolioAsset,
  type PortfolioChunk,
  type MarketSnapshot,
} from '../bridge/portfolio';
import { lightningBalance, claimDeposits } from '../bridge/lightning';
import { useSession } from './session';
import { useTokens } from './tokensStore';
import { useRegistry } from './registryStore';

/** Synthetic BTC asset representing the custodial Lightning (Spark) balance. */
function lightningAsset(sats: number): PortfolioAsset {
  return {
    id: 'lightning-btc',
    name: 'Bitcoin',
    symbol: 'BTC',
    amount: sats / 1e8,
    decimals: 8,
    coingeckoId: 'bitcoin',
    chain: 'bitcoin',
    colorHex: '#F7931A',
    networkName: 'Lightning',
    lightning: true,
  };
}
import { activeScopeKey } from '../bridge/wallet';
import { usePendingBalance } from './pendingBalanceStore';
import { applyDeltas, type PendingDelta } from '../lib/pendingBalance';

const STABLE_IDS = new Set(['usd-coin', 'tether', 'dai', 'frax', 'usdc', 'pathusd']);

/** True if a coin is a USD stablecoin (counts toward "Cash" rather than
 *  "Investments"). Shared by the normal + private dashboards. */
export function isStableCoin(coingeckoId: string): boolean {
  return STABLE_IDS.has(coingeckoId);
}

// Cap each chain's balance fetch so one slow/hung endpoint (e.g. a rate-limited
// public RPC, or a stalled mempool.space BTC sync) can't leave the dashboard
// spinning forever. On timeout that chain contributes nothing this round and the
// merge keeps its last-known balances; the next refresh retries.
const CHAIN_TIMEOUT_MS = 15000;
const MARKET_TIMEOUT_MS = 12000;

/** Resolve to `fallback` if `p` hasn't settled within `ms` (never rejects). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

// Persist the last-known prices + balances so a cold start (and every refresh)
// renders real values instead of flashing $0 while the feed loads — mirrors the
// iOS PriceStore/PortfolioStore disk caches. Balances are partitioned per
// (wallet, account, environment); prices are global (the same coin price applies
// everywhere), so the market cache stays a single file.
const MARKET_CACHE = 'market.v1.json';
function assetsCacheName(): string {
  return `assets-${activeScopeKey()}.json`;
}
// Lightning (Spark) balance cache — keyed by scope (alias) so a switched wallet
// never shows the wrong last-known balance. Cached like any other asset so it
// paints its last value on open instead of 0 while Breez reconnects.
function lightningCacheName(): string {
  return `lightning-${activeScopeKey()}.json`;
}
function file(name: string): File {
  return new File(Paths.document, name);
}
// PortfolioAsset.evmChainId is a `bigint`, which plain JSON.stringify throws on
// ("Do not know how to serialize a BigInt") — silently killing the whole assets
// write. Tag bigints on the way out and revive them on the way in so the assets
// cache actually persists (and evmChainId stays a real bigint for consumers).
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { __bigint: value.toString() } : value;
}
function bigintReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { __bigint?: unknown }).__bigint === 'string') {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}
function persist(name: string, data: unknown): void {
  try {
    file(name).write(JSON.stringify(data, bigintReplacer));
  } catch {}
}
/** The balance source an asset belongs to — matches the keys loadPortfolio puts
 *  in its `synced` set ("bitcoin" | "solana" | `evm:<chainId>`). */
function assetSource(a: PortfolioAsset): string {
  return a.evmChainId != null ? `evm:${a.evmChainId}` : a.chain;
}

/** Upsert freshly-fetched assets over the current list (same scope): update
 *  matching ids in place, append new ones. An existing asset absent from `next`
 *  is DROPPED only if its source synced cleanly this round (`synced`) — i.e. the
 *  balance genuinely drained to 0; if its source failed to fetch, it's KEPT at
 *  its last-known value. This is why a row never flashes out of "Your Assets" on
 *  a transient RPC miss, yet a token you fully spend does disappear. Order is
 *  preserved (Map keeps insertion order), so nothing reshuffles. */
function mergeAssets(prev: PortfolioAsset[], next: PortfolioAsset[], synced: Set<string>): PortfolioAsset[] {
  if (!prev.length) return next;
  const nextIds = new Set(next.map((a) => a.id));
  const byId = new Map<string, PortfolioAsset>();
  for (const a of prev) {
    if (!nextIds.has(a.id) && synced.has(assetSource(a))) continue; // drained → drop
    byId.set(a.id, a); // keep last-known (a failed source); `next` may overwrite below
  }
  for (const a of next) byId.set(a.id, a);
  return Array.from(byId.values());
}
/** Active-scope deltas, or [] if the ledger is on a different scope (guards a
 *  mid-switch race so we never fold another scope's deltas onto these balances). */
function scopedDeltas(scope: string | null): PendingDelta[] {
  const pb = usePendingBalance.getState();
  return pb.loadedScope === scope ? pb.deltas : [];
}

async function readCache<T>(name: string): Promise<T | null> {
  try {
    const f = file(name);
    if (f.exists) return JSON.parse(await f.text(), bigintReviver) as T;
  } catch {}
  return null;
}

export type PortfolioStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PortfolioState {
  /** DISPLAY balances = confirmed + optimistic deltas. This is what the UI reads.
   *  Never persisted or fed back into a fetch — it's derived, recomputed whenever
   *  the confirmed balances, snapshot heights, or pending deltas change. */
  assets: PortfolioAsset[];
  /** AUTHORITATIVE balances straight from RPC. The optimistic layer never mutates
   *  these; persisted + used for merge/reconcile. `assets` is derived from them. */
  confirmedAssets: PortfolioAsset[];
  market: Record<string, MarketSnapshot>;
  status: PortfolioStatus;
  error: string | null;
  hydrated: boolean;
  /** The (wallet, account, environment) scope the current balances belong to. */
  loadedScope: string | null;
  /** CoinGecko ids to price beyond the portfolio's own assets — e.g. tokens
   *  received privately (stealth), whose coins aren't in the normal balance.
   *  Kept so every refresh re-prices them (and their icon URL stays cached). */
  extraPriceIds: string[];
  /** Load cached assets + prices from disk (so the first paint isn't all zeros). */
  hydrate: () => Promise<void>;
  /** Reload assets + market data from the Rust core. Best-effort, never throws. */
  refresh: () => Promise<void>;
  /** Recompute `assets` (display) from confirmed balances + current deltas. Cheap;
   *  called on every refresh chunk and whenever the pending-delta ledger changes. */
  recomputeDisplay: () => void;
  /** The custodial Lightning (Spark) balance in sats, surfaced as a BTC asset. */
  lightningSats: number;
  /** Fetch the Lightning balance from the Breez SDK and fold it into `assets`. */
  refreshLightning: () => Promise<void>;
  /** Ensure `ids` are priced now (targeted fetch for any missing from `market`)
   *  and tracked for future refreshes. Populates both price AND icon URL, so a
   *  privately-received token isn't stuck on a blank icon / $0 until a full
   *  refresh happens to include it. Never throws. */
  ensurePriced: (ids: string[]) => Promise<void>;
}

export const usePortfolio = create<PortfolioState>((set, get) => ({
  assets: [],
  confirmedAssets: [],
  market: {},
  status: 'idle',
  error: null,
  hydrated: false,
  loadedScope: null,
  extraPriceIds: [],
  recomputeDisplay: () => {
    const { confirmedAssets, loadedScope, lightningSats } = get();
    const base = applyDeltas(confirmedAssets, scopedDeltas(loadedScope));
    // Append the custodial Lightning (Spark) balance as its own BTC-priced asset.
    set({ assets: [...base, lightningAsset(lightningSats)] });
  },
  lightningSats: 0,
  refreshLightning: async () => {
    try {
      void get().ensurePriced(['bitcoin']); // so the LN asset shows a USD value
      // Claim any confirmed on-chain deposits first, then read the balance.
      try {
        await claimDeposits();
      } catch (e) {
        console.warn('[lightning] claimDeposits failed:', String(e));
      }
      const sats = await lightningBalance();
      set({ lightningSats: sats });
      persist(lightningCacheName(), sats); // cache so next open paints it instantly
      get().recomputeDisplay();
    } catch {
      // best-effort — Lightning may be offline / not yet connected
    }
  },
  hydrate: async () => {
    if (get().hydrated) return;
    const scope = activeScopeKey();
    const [cachedMarket, cachedAssets, cachedLightning] = await Promise.all([
      readCache<Record<string, MarketSnapshot>>(MARKET_CACHE),
      readCache<PortfolioAsset[]>(assetsCacheName()),
      readCache<number>(lightningCacheName()),
    ]);
    // Load this scope's persisted deltas so a mid-flight restart resumes with the
    // right optimistic balance (and folds them into the first paint below).
    await usePendingBalance.getState().ensureScope();
    set((s) => ({
      market: cachedMarket && Object.keys(cachedMarket).length ? { ...cachedMarket, ...s.market } : s.market,
      confirmedAssets: s.confirmedAssets.length ? s.confirmedAssets : cachedAssets ?? s.confirmedAssets,
      lightningSats: s.lightningSats || cachedLightning || 0,
      loadedScope: scope,
      hydrated: true,
    }));
    // Reconcile the just-loaded optimistic deltas against the cached (last-known)
    // confirmed balances BEFORE the first paint. Without this, a stale delta from
    // a prior session — a receive/swap that already posted, or one past its TTL —
    // gets folded on top of the cached balance, so the opening total shows too
    // high and then visibly ticks DOWN to the real value as each chain reloads
    // and reconciles a few seconds later. Reconciling here drops those settled /
    // expired deltas up front (genuine in-flight ones are kept), so the first
    // paint is already correct.
    usePendingBalance.getState().reconcile(get().confirmedAssets);
    get().recomputeDisplay();
  },
  refresh: async () => {
    const wallet = useSession.getState().wallet;
    if (!wallet) return;
    await get().hydrate(); // ensure cached prices are in place before first paint
    // If the wallet/account/environment changed, immediately swap to THAT scope's
    // cached balances (or clear) so we never show another scope's stale balances.
    const scope = activeScopeKey();
    if (scope !== get().loadedScope) {
      // Scope changed (account / wallet / environment switch): synchronously drop
      // the previous scope's balances so they NEVER linger on screen, then load
      // THIS scope's own cache. Guard the async cache read against a rapid
      // re-switch resolving late (only apply if we're still on `scope`).
      set({ assets: [], confirmedAssets: [], loadedScope: scope, status: 'loading' });
      // Swap the delta ledger to this scope too, then re-derive the display.
      await usePendingBalance.getState().ensureScope();
      const cached = await readCache<PortfolioAsset[]>(assetsCacheName());
      if (get().loadedScope === scope && cached && cached.length) {
        set({ confirmedAssets: cached, status: 'ready' });
      }
      get().recomputeDisplay();
    } else {
      set((s) => ({ status: s.confirmedAssets.length ? s.status : 'loading' }));
    }
    try {
      await useTokens.getState().hydrate();
      await useRegistry.getState().hydrate();
      const loaders = loadPortfolioChains(wallet, useTokens.getState().tokens, useRegistry.getState().registry);
      const EMPTY: PortfolioChunk = { assets: [], synced: new Set() };
      // Apply each chain's chunk the moment it resolves — a fast chain renders
      // immediately instead of waiting on the slowest one, and a hung chain (it
      // resolves to EMPTY at the timeout) never blocks the others or the loading
      // state. Each merge is per-source. After updating the confirmed balances we
      // reconcile the pending-delta ledger against THOSE balances (dropping any
      // whose funds have fully posted — invisibly, since the optimistic amount
      // already equals confirmed at that point) and re-derive the display.
      const applyChunk = (chunk: PortfolioChunk) => {
        if (activeScopeKey() !== scope || get().loadedScope !== scope) return;
        const merged = mergeAssets(get().confirmedAssets, chunk.assets, chunk.synced);
        set({ confirmedAssets: merged, status: 'ready', error: null });
        persist(assetsCacheName(), merged);
        usePendingBalance.getState().reconcile(merged); // drop fully-posted/expired deltas
        get().recomputeDisplay();
      };
      await Promise.all([
        withTimeout(loaders.btc, CHAIN_TIMEOUT_MS, EMPTY).then(applyChunk),
        withTimeout(loaders.sol, CHAIN_TIMEOUT_MS, EMPTY).then(applyChunk),
        withTimeout(loaders.evm, CHAIN_TIMEOUT_MS, EMPTY).then(applyChunk),
      ]);
      // A stale scope switched in while chains were loading → don't fetch prices
      // for the wrong scope's assets.
      if (activeScopeKey() !== scope) return;
      // Prices last so balances render immediately even if the feed is slow.
      // Include each asset's fee coin so the send screen can price gas in USD.
      const merged = get().confirmedAssets;
      const priceIds = [
        ...new Set([
          'bitcoin', // always priced — the Lightning (Spark) asset is BTC-denominated
          ...merged.flatMap((a) => (a.feeCoingeckoId ? [a.coingeckoId, a.feeCoingeckoId] : [a.coingeckoId])),
          ...get().extraPriceIds, // stealth-received tokens etc.
        ]),
      ].filter(Boolean);
      const market = await withTimeout<Record<string, MarketSnapshot> | null>(
        loadMarket(wallet, priceIds),
        MARKET_TIMEOUT_MS,
        null,
      );
      // MERGE (don't replace): a partial/empty feed must never zero out good prices.
      if (market && Object.keys(market).length) {
        set((s) => ({ market: { ...s.market, ...market } }));
        persist(MARKET_CACHE, get().market);
      }
    } catch (e) {
      set({ status: 'error', error: String(e) });
    }
  },

  ensurePriced: async (ids) => {
    const clean = [...new Set(ids.filter(Boolean))];
    if (!clean.length) return;
    // Track for future full refreshes (so these stay priced), then targeted-fetch
    // just the ones we don't already have priced.
    set((s) => ({ extraPriceIds: [...new Set([...s.extraPriceIds, ...clean])] }));
    const have = get().market;
    const need = clean.filter((id) => !have[id]?.price);
    const wallet = useSession.getState().wallet;
    if (!need.length || !wallet) return;
    try {
      const market = await withTimeout<Record<string, MarketSnapshot> | null>(
        loadMarket(wallet, need),
        MARKET_TIMEOUT_MS,
        null,
      );
      if (market && Object.keys(market).length) {
        set((s) => ({ market: { ...s.market, ...market } }));
        persist(MARKET_CACHE, get().market);
      }
    } catch {
      // best-effort; the next full refresh re-prices via extraPriceIds
    }
  },
}));

// Re-derive the DISPLAY balances whenever the optimistic-delta ledger changes
// (a send debit added, a relayed receive credited, a delta absorbed/reversed).
// One-directional: the portfolio depends on the ledger, never the reverse.
usePendingBalance.subscribe(() => usePortfolio.getState().recomputeDisplay());

// ---- Pure selectors (operate on store data) -------------------------------

export function liveValue(a: PortfolioAsset, market: Record<string, MarketSnapshot>): number {
  return a.amount * (market[a.coingeckoId]?.price ?? 0);
}

export function totalValue(assets: PortfolioAsset[], market: Record<string, MarketSnapshot>): number {
  return assets.reduce((sum, a) => sum + liveValue(a, market), 0);
}

export function weightedChange24h(
  assets: PortfolioAsset[],
  market: Record<string, MarketSnapshot>,
): number {
  const total = totalValue(assets, market);
  if (total <= 0) return 0;
  const weighted = assets.reduce((acc, a) => {
    const value = liveValue(a, market);
    const change = market[a.coingeckoId]?.change24h ?? 0;
    return acc + value * change;
  }, 0);
  return weighted / total;
}

export function cashValue(assets: PortfolioAsset[], market: Record<string, MarketSnapshot>): number {
  return assets
    .filter((a) => STABLE_IDS.has(a.coingeckoId))
    .reduce((sum, a) => sum + liveValue(a, market), 0);
}

export function investmentsValue(
  assets: PortfolioAsset[],
  market: Record<string, MarketSnapshot>,
): number {
  return assets
    .filter((a) => !STABLE_IDS.has(a.coingeckoId))
    .reduce((sum, a) => sum + liveValue(a, market), 0);
}

/** Assets to show: only those the user actually holds (`amount > 0`). Native
 *  coins with a $0.00 balance (e.g. BTC/SOL with no funds) are NOT listed — an
 *  empty wallet shows the "nothing here yet" state instead of a row of zeros.
 *  `hidden` is a set of asset ids the user disabled in Manage Tokens (per chain). */
export function displayAssets(assets: PortfolioAsset[], hidden: string[] = []): PortfolioAsset[] {
  const hideSet = new Set(hidden);
  // Every asset — Lightning included — shows only when actually held (amount > 0),
  // so an empty Lightning balance isn't listed as a $0.00 row.
  return assets.filter((a) => a.amount > 0 && !hideSet.has(a.id));
}

/** Display list with the same token held across multiple chains merged into a
 *  single row — amounts (and unconfirmed) summed per `coingeckoId`. The first
 *  holding is kept as the representative for name/symbol/icon. Used by the "Your
 *  Assets" list + cluster so ETH on Ethereum/Arbitrum/Base, or USDC on several
 *  chains, shows one combined row instead of duplicates. Per-chain granularity
 *  is intentionally preserved elsewhere (Send, Manage Tokens) where the specific
 *  chain matters. Value/cash/investment totals use the raw per-chain assets, so
 *  grouping here doesn't change any totals. */
export function groupedAssets(assets: PortfolioAsset[], hidden: string[] = []): PortfolioAsset[] {
  const byCoin = new Map<string, PortfolioAsset>();
  for (const a of displayAssets(assets, hidden)) {
    // Keep the Lightning BTC balance as its own row (don't merge it into on-chain BTC).
    const key = a.lightning ? `${a.coingeckoId}|ln` : a.coingeckoId;
    const g = byCoin.get(key);
    if (!g) {
      byCoin.set(key, { ...a });
    } else {
      g.amount += a.amount;
      if (a.unconfirmedAmount) g.unconfirmedAmount = (g.unconfirmedAmount ?? 0) + a.unconfirmedAmount;
    }
  }
  return Array.from(byCoin.values());
}
