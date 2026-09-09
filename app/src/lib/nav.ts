import { useRouter } from 'expo-router';
import { router } from 'expo-router';

let lastKey = '';
let lastAt = 0;

/** Push a route, ignoring a duplicate push of the SAME target within 1s. Rapid
 *  double-taps on a list row / header otherwise stack the same screen multiple
 *  times (e.g. opening the Activity page two or three times in a row). Different
 *  targets are never blocked. */
export function pushOnce(href: Parameters<typeof router.push>[0]): void {
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (key === lastKey && now - lastAt < 1000) return;
  lastKey = key;
  lastAt = now;
  router.push(href);
}

/**
 * Close a screen that was pushed on top of something.
 *
 * `router.back()` alone throws "The action 'GO_BACK' was not handled by any
 * navigator" whenever there is no history to pop — which happens when the app
 * RESTORES directly onto a screen rather than navigating to it: a dev reload
 * with a modal open, or a deep link that lands deeper than the tab root. The
 * user-visible symptom is worse than the log line: the close button does
 * nothing at all, with no way out of the screen.
 */
export function dismiss(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(app)/(tabs)/wallet');
}
