//! Range-keyed chart cache + prefetch + TTL (ports the iOS ChartCache/WarmupCoordinator).
//
// The Rust price client caches charts in a single slot per asset id
// (`chart(id)` returns whatever range was fetched last) and has no expiry or
// persistence. That makes every range switch a blocking CoinGecko round-trip
// and loses everything on app restart — the reason the chart feels slow vs the
// Swift app. This module adds the missing layer entirely on the JS side:
//
//  - in-memory cache keyed by (id, range) so revisiting a range is instant
//  - per-id serialized fetch queue, because the native slot is shared per id:
//    `fetchChart(id,range)` then `chart(id)` must run atomically, never
//    interleaved with another range's fetch for the same id
//  - per-range TTL (mirrors iOS) so fresh data is never refetched
//  - background prefetch of the other ranges when an asset opens
//  - AsyncStorage persistence so a re-opened asset renders instantly after a
//    cold launch

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WalletInterface } from 'standard-rn';
import { rangeFor, type ChartSample, type RangeKey } from './chart';

interface Entry {
  samples: ChartSample[];
  fetchedAt: number; // epoch ms
}

// id -> range -> entry
const mem = new Map<string, Map<RangeKey, Entry>>();
const hydrated = new Set<string>();

/** Per-range freshness window (ms). Matches iOS ChartCache.ttl: the body of a
 *  long-duration chart barely moves, so it's cached far longer than 1D. */
const TTL: Record<RangeKey, number> = {
  oneDay: 5 * 60_000,
  oneWeek: 30 * 60_000,
  oneMonth: 6 * 3_600_000,
  oneYear: 24 * 3_600_000,
  all: 7 * 86_400_000,
};

// One promise chain per asset id keeps fetch→read atomic against the shared
// native cache slot. Different ids run concurrently.
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // Swallow rejections on the chain so one failure doesn't poison the queue.
  queues.set(id, run.then(() => undefined, () => undefined));
  return run;
}

function isFresh(e: Entry | undefined, key: RangeKey): boolean {
  return !!e && Date.now() - e.fetchedAt < TTL[key];
}

/** Synchronous read of cached samples for a range, or null if none yet. */
export function cachedSamples(id: string, key: RangeKey): ChartSample[] | null {
  return mem.get(id)?.get(key)?.samples ?? null;
}

function store(id: string, key: RangeKey, samples: ChartSample[]): void {
  const byRange = mem.get(id) ?? new Map<RangeKey, Entry>();
  byRange.set(key, { samples, fetchedAt: Date.now() });
  mem.set(id, byRange);
  void persist(id);
}

/** Fetch one range from the native client into the cache. Serialized per id so
 *  the shared native slot isn't clobbered by a concurrent range fetch. */
function fetchInto(wallet: WalletInterface, id: string, key: RangeKey): Promise<ChartSample[]> {
  return serialize(id, async () => {
    await wallet.fetchChart(id, rangeFor(key));
    const pts = await wallet.chart(id);
    const samples = pts.map((p) => ({ timestamp: Number(p.timestampMs), value: p.price }));
    store(id, key, samples);
    return samples;
  });
}

/** Return fresh cached samples immediately, else fetch. On fetch failure, fall
 *  back to whatever stale samples we have (never throws). */
export async function ensureChart(
  wallet: WalletInterface,
  id: string,
  key: RangeKey,
): Promise<ChartSample[]> {
  const existing = mem.get(id)?.get(key);
  if (isFresh(existing, key)) return existing!.samples;
  try {
    return await fetchInto(wallet, id, key);
  } catch {
    return existing?.samples ?? [];
  }
}

/** Warm the other ranges in the background (sequential, best-effort, skips
 *  fresh entries). Mirrors iOS WarmupCoordinator.preloadOtherRanges. */
export function prefetchRanges(wallet: WalletInterface, id: string, keys: RangeKey[]): void {
  void (async () => {
    for (const key of keys) {
      if (isFresh(mem.get(id)?.get(key), key)) continue;
      try {
        await fetchInto(wallet, id, key);
      } catch {
        // best-effort warmup; ignore failures
      }
    }
  })();
}

// --- disk persistence (AsyncStorage) ---

const diskKey = (id: string) => `chart-cache:${id}`;

async function persist(id: string): Promise<void> {
  const byRange = mem.get(id);
  if (!byRange) return;
  try {
    const obj: Record<string, Entry> = {};
    for (const [k, v] of byRange) obj[k] = v;
    await AsyncStorage.setItem(diskKey(id), JSON.stringify(obj));
  } catch {
    // cache persistence is best-effort
  }
}

/** Load an asset's persisted ranges into memory (once per id per session). */
export async function hydrate(id: string): Promise<void> {
  if (hydrated.has(id) || mem.has(id)) {
    hydrated.add(id);
    return;
  }
  hydrated.add(id);
  try {
    const raw = await AsyncStorage.getItem(diskKey(id));
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Entry>;
    const byRange = mem.get(id) ?? new Map<RangeKey, Entry>();
    for (const k of Object.keys(obj)) {
      // Don't clobber anything fetched this session.
      if (!byRange.has(k as RangeKey)) byRange.set(k as RangeKey, obj[k]);
    }
    mem.set(id, byRange);
  } catch {
    // ignore corrupt/missing cache
  }
}
