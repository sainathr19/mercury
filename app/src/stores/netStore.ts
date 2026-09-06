import NetInfo from '@react-native-community/netinfo';
import { useSendNotice } from './sendNoticeStore';

/**
 * Connectivity monitor. Watches NetInfo and surfaces the top notice pill when
 * the connection drops. Coming back online shows nothing (no "Back online"
 * pill). The offline warning is debounced: a transient blip — e.g. the
 * reachability probe that fires when the app returns from the background after
 * a while — resolves within the grace window, so it never flashes a false
 * "No connection". Only a sustained disconnect surfaces the pill.
 */
let started = false;
let online = true;
let unsubscribe: (() => void) | null = null;
let offlineTimer: ReturnType<typeof setTimeout> | null = null;

// How long the connection must stay down before we warn the user. Comfortably
// longer than a background-resume reachability re-check (which recovers in a
// second or two), so those never trip the pill.
const OFFLINE_GRACE_MS = 12000;

/** Best-effort current connectivity (defaults optimistic before the first event). */
export function isOnline(): boolean {
  return online;
}

/** Start the NetInfo subscription once (idempotent). Call from the root layout. */
export function startNetworkMonitor(): void {
  if (started) return;
  started = true;
  unsubscribe = NetInfo.addEventListener((state) => {
    // Treat unknown (null) reachability as online to avoid false-offline flashes;
    // only an explicit disconnect, or "connected but no internet", counts as off.
    const next = state.isConnected !== false && state.isInternetReachable !== false;
    if (next === online) return;
    online = next;
    // Any transition cancels a pending warning (recovering within the grace
    // window means we never warned; dropping again just restarts the timer).
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
    }
    if (!next) {
      offlineTimer = setTimeout(() => {
        offlineTimer = null;
        if (!online) useSendNotice.getState().show('error', 'No connection');
      }, OFFLINE_GRACE_MS);
    }
    // Coming back online: nothing to show.
  });
}

/** Tear down the subscription (rarely needed; the monitor lives for the session). */
export function stopNetworkMonitor(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (offlineTimer) {
    clearTimeout(offlineTimer);
    offlineTimer = null;
  }
  started = false;
}
