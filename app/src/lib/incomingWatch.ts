// Tell the user when money arrives, while the app is closed.
//
// A LOCAL notification fired from a background task, not a remote push. Remote
// push needs the `aps-environment` entitlement, which a free Apple team cannot
// have (see `plugins/withoutPush.js`) — so there is no APNs token to push to.
// The trade is latency, not correctness: iOS decides when a background task
// runs, so this is "you find out reasonably soon", never "instantly". The
// notification itself is indistinguishable from a pushed one.
//
// Everything here reads only an ADDRESS. The background task runs in a headless
// JS context with no open wallet and no keys, so the watched address is cached
// to disk when the session is ready and read back from there.
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { graphActivity } from '../bridge/graph';
import {
  INCOMING_TASK,
  INTERVAL_MINUTES,
  MAX_BANNERS,
  bannerFor,
  selectNewReceipts,
  summaryFor,
  type WatchState,
} from './incomingNotify';

export { INCOMING_TASK } from './incomingNotify';

const FILENAME = 'incoming-watch.v1.json';

// ── state on disk ───────────────────────────────────────────────────────────

function file(): File {
  return new File(Paths.document, FILENAME);
}

export async function readWatch(): Promise<WatchState | null> {
  try {
    const f = file();
    if (!f.exists) return null;
    const s = JSON.parse(await f.text()) as Partial<WatchState>;
    if (!s.address || !s.chainId) return null;
    return {
      address: s.address,
      chainId: s.chainId,
      sinceTs: s.sinceTs ?? 0,
      notified: s.notified ?? [],
    };
  } catch {
    // A corrupt watch file is a dropped notification, not a lost payment.
    return null;
  }
}

function writeWatch(s: WatchState): void {
  try {
    file().write(JSON.stringify(s));
  } catch {}
}

/**
 * Point the watch at an address, and register the task if it is not already.
 *
 * Idempotent, and cheap enough to call on every launch. Re-arming for the SAME
 * address keeps the watermark — otherwise every launch would re-seed to `now`
 * and a payment that arrived while the app was closed would never be
 * announced. A different address (account switch, re-import) starts fresh.
 */
export async function armIncomingWatch(address: string, chainId: bigint): Promise<void> {
  if (!address) return;
  const prev = await readWatch();
  const same = prev?.address.toLowerCase() === address.toLowerCase() && prev?.chainId === chainId.toString();
  writeWatch(
    same
      ? { ...prev!, address, chainId: chainId.toString() }
      : {
          address,
          chainId: chainId.toString(),
          // Nothing already in history is news.
          sinceTs: Math.floor(Date.now() / 1000),
          notified: [],
        },
  );

  try {
    if (!(await TaskManager.isTaskRegisteredAsync(INCOMING_TASK))) {
      await BackgroundTask.registerTaskAsync(INCOMING_TASK, { minimumInterval: INTERVAL_MINUTES });
    }
  } catch {
    // Registration fails on a simulator without background execution, and on a
    // device with Low Power Mode on. Neither is worth surfacing: the wallet
    // works, it just will not volunteer news.
  }
}

/** Stop watching. Leaves the file so re-enabling keeps the dedupe window. */
export async function disarmIncomingWatch(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(INCOMING_TASK)) {
      await BackgroundTask.unregisterTaskAsync(INCOMING_TASK);
    }
  } catch {}
}

export async function isIncomingWatchArmed(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(INCOMING_TASK);
  } catch {
    return false;
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * One pass: read the watch, ask the subgraph what arrived, announce what is new.
 *
 * Returns the number of notifications presented, so the task can report
 * Success/Failed honestly and so a caller can assert on it.
 */
export async function checkIncoming(): Promise<number> {
  const state = await readWatch();
  if (!state) return 0;

  // Checked BEFORE anything else. Presenting is a no-op without permission, so
  // going further would advance the watermark and consume receipts that were
  // never announced — the user would then never hear about them, even after
  // granting permission later.
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  if (perm?.status !== 'granted') return 0;

  // `graphActivity` takes an address and nothing else — no wallet, no keys — so
  // it is safe in a headless context. Prices are not needed: the banner quotes
  // the token amount, not a fiat figure that would be stale by the time it is
  // read anyway.
  const items = await graphActivity(state.address, BigInt(state.chainId), () => 0);
  const { fresh, next } = selectNewReceipts(items, state);
  if (fresh.length === 0) return 0;

  // Persist BEFORE presenting. A crash between the two costs a missed banner;
  // the other order costs a duplicate every wake-up until it succeeds.
  writeWatch(next);

  // One banner per receipt up to the cap, then a single collapsed line. The
  // summary carries no `txId` because it does not point at one transaction.
  const banners =
    fresh.length > MAX_BANNERS
      ? [{ ...summaryFor(fresh.length), txId: undefined as string | undefined }]
      : fresh.map((i) => ({ ...bannerFor(i), txId: i.id }));

  for (const b of banners) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: b.title,
        body: b.body,
        sound: 'default',
        // Carried so tapping the banner can open that transaction.
        data: b.txId ? { txId: b.txId } : {},
      },
      trigger: null, // present now
    });
  }
  return banners.length;
}

// ── the task ────────────────────────────────────────────────────────────────

// Defined at module scope: the OS re-launches the app into a headless JS
// context and looks the task up by name, so the definition has to run as a
// side effect of loading the bundle rather than from inside a component.
TaskManager.defineTask(INCOMING_TASK, async () => {
  try {
    await checkIncoming();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
