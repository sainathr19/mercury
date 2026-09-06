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
