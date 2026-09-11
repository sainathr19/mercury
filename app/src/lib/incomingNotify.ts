// What counts as news, and how to word it.
//
// Deliberately free of native imports so it is unit-testable: a notification is
// an interruption, and the rule that decides to send one should be checkable
// without a simulator. The I/O — the file, the OS task, presenting the banner —
// lives in `incomingWatch.ts`, which imports this.
import type { ActivityItem } from '../bridge/activity';

/** Registered with the OS; must be stable across launches. */
export const INCOMING_TASK = 'mercury-incoming-payments';

/** iOS treats this as a floor and ignores anything shorter. 15 is the minimum
 *  the platform honours at all. */
export const INTERVAL_MINUTES = 15;

/** Notifications fired in one wake-up before they collapse into a summary.
 *  Five separate banners for one batch of receipts is worse than one line. */
export const MAX_BANNERS = 3;

/** Ids we remember so a re-scan cannot announce the same payment twice. Capped:
 *  this is a dedupe window, not a history. */
const REMEMBER = 60;

export interface WatchState {
  /** The EVM address to watch. Empty means the watch is not armed. */
  address: string;
  /** Decimal chain id, as a string — the file is JSON and this is a bigint. */
  chainId: string;
  /**
   * Only receipts NEWER than this are announced.
   *
   * Seeded to the moment the watch is armed, which is what stops the first
   * background run from firing a banner for every payment already in history.
   */
  sinceTs: number;
  /** Recently announced ids, newest first. */
  notified: string[];
}

// ── the decision, as a pure function ────────────────────────────────────────

/**
 * Which of `items` deserve a notification, and the state to persist after.
 *
 * Separated from the I/O so the rule that decides whether to interrupt someone
 * is directly testable. Three guards, and all three matter: only receipts (a
 * send is something you just did), only newer than the watermark, and never an
 * id already announced.
 */
export function selectNewReceipts(
  items: ActivityItem[],
  state: WatchState,
): { fresh: ActivityItem[]; next: WatchState } {
  const seen = new Set(state.notified);
  const fresh = items
    .filter((i) => i.type === 'received' && i.timestamp > state.sinceTs && !seen.has(i.id))
    // Oldest first, so a batch of banners reads in the order things happened.
    .sort((a, b) => a.timestamp - b.timestamp);

  if (fresh.length === 0) return { fresh, next: state };

  const highest = fresh.reduce((m, i) => Math.max(m, i.timestamp), state.sinceTs);
  return {
    fresh,
    next: {
      ...state,
      sinceTs: highest,
      // Newest first: the list is capped and sliced from the front, so
      // prepending a batch oldest-first would evict the MOST recent ids soonest
      // — exactly backwards for a dedupe window.
      notified: [...fresh.map((i) => i.id).reverse(), ...state.notified].slice(0, REMEMBER),
    },
  };
}

/** One banner's title and body. `amountText` already carries the sign, amount
 *  and symbol, so the row and the notification cannot disagree. */
export function bannerFor(item: ActivityItem): { title: string; body: string } {
  const amount = item.amountText.replace(/^\+\s*/, '');
  return {
    title: `Received ${amount}`,
    body: item.peerName ? `From ${item.peerName}` : (item.network ?? 'Arrived in your wallet'),
  };
}

/** The collapsed form, when one wake-up found more than `MAX_BANNERS`. */
export function summaryFor(count: number): { title: string; body: string } {
  return {
    title: `${count} payments received`,
    body: 'Open Mercury to see them.',
  };
}
