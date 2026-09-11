//! The swap pairs on offer, cached.
//
// Flashnet's docs are explicit that the route table must be read at runtime
// rather than copied into the app, because it changes as chains, assets and
// provider capacity change. It is also ~3MB and 4,600 routes, so it is narrowed
// to the ~800 we can actually take (see lib/flashnetScope) and only the narrow
// set is kept.
//
// Cached to disk so the composer opens instantly and still works on a plane. A
// stale table costs a rejected quote with a clear message; an empty one costs
// the whole screen, so the cache is always preferred over nothing.
import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { fetchRoutes } from '../bridge/flashnet';
import type { SwapRoute } from '../lib/flashnetScope';

const FILENAME = 'swap-routes.v1.json';
/** Long enough that the screen is never waiting on it, short enough to notice
 *  a new chain within a day of Flashnet adding one. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function file(): File {
  return new File(Paths.document, FILENAME);
}

interface RoutesState {
  routes: SwapRoute[];
  fetchedAt: number;
  loading: boolean;
  /** Set only when we have NOTHING to show — a failure over a warm cache is not
   *  worth reporting, because the screen still works. */
  error: string | null;
  load: () => Promise<void>;
}

export const useSwapRoutes = create<RoutesState>((set, get) => ({
  routes: [],
  fetchedAt: 0,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;

    // Disk first, so the picker has something on the very first paint.
    if (get().routes.length === 0) {
      try {
        const f = file();
        if (f.exists) {
          const d = JSON.parse(await f.text()) as { routes?: SwapRoute[]; fetchedAt?: number };
          if (Array.isArray(d.routes) && d.routes.length > 0) {
            set({ routes: d.routes, fetchedAt: d.fetchedAt ?? 0 });
          }
        }
      } catch {
        // A corrupt cache is a slow first open, nothing more.
      }
    }

    const fresh = Date.now() - get().fetchedAt < MAX_AGE_MS;
    if (fresh && get().routes.length > 0) return;

    set({ loading: true, error: null });
    try {
      const routes = await fetchRoutes();
      const fetchedAt = Date.now();
      set({ routes, fetchedAt, loading: false, error: null });
      try {
        file().write(JSON.stringify({ routes, fetchedAt }));
      } catch {}
    } catch (e) {
      set({
        loading: false,
        // Only surfaced when the list is empty; see the field's note.
        error: get().routes.length === 0 ? (e instanceof Error ? e.message : 'Could not load swap routes.') : null,
      });
    }
  },
}));
