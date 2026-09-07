import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import seed from '../../assets/registry.seed.json';
import {
  isValidRegistry,
  tokensForChain,
  nativeForChain,
  type Registry,
  type RegistryAsset,
  type ResolvedRegistryToken,
} from '../lib/registry';
import { withTempoNetworks } from '../lib/tempoRegistry';

// ===========================================================================
// REGISTRY SOURCE OF TRUTH — set EXPO_PUBLIC_REGISTRY_URL to your CDN URL.
// Upload `dist/registry.json` (produced by `npm run registry:build`) to a CDN
// and point this at it. The app fetches with an ETag and caches on device.
// Unset is a supported configuration, not a broken one: the app runs from the
// bundled seed plus whatever it has already cached, so tokens still resolve —
// they simply stop picking up additions until a URL is configured.
// ===========================================================================
const REGISTRY_URL = process.env.EXPO_PUBLIC_REGISTRY_URL || '';
const CACHE = 'registry.v1.json';

interface Cached {
  etag: string | null;
  registry: Registry;
}
function cacheFile(): File {
  return new File(Paths.document, CACHE);
}

interface RegistryState {
  registry: Registry;
  hydrated: boolean;
  /** Load the on-disk cache (falls back to the bundled seed already in state). */
  hydrate: () => Promise<void>;
  /** Refresh from the CDN with an ETag; merge-safe, never throws. */
  refresh: () => Promise<void>;
  tokensForChain: (chainId: bigint) => ResolvedRegistryToken[];
  nativeForChain: (chainId: bigint) => RegistryAsset | undefined;
}

export const useRegistry = create<RegistryState>((set, get) => ({
  // Bundled seed = instant first paint. Tempo networks are always overlaid (the
  // remote registry CDN doesn't know about Tempo, and refresh() replaces the
  // whole registry — see withTempoNetworks).
  registry: withTempoNetworks(seed as Registry),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const f = cacheFile();
      if (f.exists) {
        const c = JSON.parse(await f.text()) as Partial<Cached>;
        if (c.registry && isValidRegistry(c.registry))
          set({ registry: withTempoNetworks(c.registry) });
      }
    } catch {
      // corrupt cache → keep the seed
    }
    set({ hydrated: true });
  },

  refresh: async () => {
    if (!REGISTRY_URL) return;
    let etag: string | null = null;
    try {
      const f = cacheFile();
      if (f.exists) etag = (JSON.parse(await f.text()) as Partial<Cached>).etag ?? null;
    } catch {}
    try {
      const res = await fetch(REGISTRY_URL, { headers: etag ? { 'If-None-Match': etag } : {} });
      if (res.status === 304 || !res.ok) return;
      const data = (await res.json()) as unknown;
      if (!isValidRegistry(data)) return;
      set({ registry: withTempoNetworks(data) });
      try {
        cacheFile().write(
          JSON.stringify({ etag: res.headers.get('etag'), registry: data } satisfies Cached),
        );
      } catch {}
    } catch {
      // offline / CDN down → keep current
    }
  },

  tokensForChain: (chainId) => tokensForChain(get().registry, chainId),
  nativeForChain: (chainId) => nativeForChain(get().registry, chainId),
}));
