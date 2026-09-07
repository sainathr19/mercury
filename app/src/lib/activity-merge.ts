import type { ActivityItem } from '../bridge/activity';

/**
 * Recency comparator: purely newest-first by timestamp — pending and confirmed
 * txs are interleaved by time, not bucketed. A just-sent/received tx carries a
 * "now" timestamp so it naturally lands at the top without any pending-first
 * special-casing (which would visually separate in-flight from settled).
 */
export function byRecency(a: ActivityItem, b: ActivityItem): number {
  return b.timestamp - a.timestamp;
}

/**
 * Merge freshly-scanned chain items with the persisted/in-memory list.
 *
 * Dedupe by id (txid / signature). A freshly-scanned item wins over an existing
 * one of the same id so confirmation status is kept current; existing items not
 * present in the scan (e.g. a just-sent pending tx the indexer hasn't seen yet)
 * are preserved. Result is sorted pending-first, then newest-first.
 *
 * Pure — no native imports — so it is unit-testable in isolation.
 */
export function mergeActivity(existing: ActivityItem[], fetched: ActivityItem[]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const it of existing) byId.set(it.id, it);
  for (const it of fetched) {
    const prev = byId.get(it.id);
    if (!prev) {
      byId.set(it.id, it);
      continue;
    }
    // Fresh scan updates status/label, BUT must NOT overwrite the ORIGINAL
    // timestamp: for a send we recorded WHEN THE USER SENT IT (optimistic), and
    // the scan's block/confirmation time would otherwise replace it (making an
    // old tx look recent, and losing the real send time). Keep the first-seen
    // timestamp. Also carry a private pay's tag + label over (the funding tx
    // shows up in the normal scan as a plain send).
    byId.set(it.id, {
      ...it,
      timestamp: prev.timestamp,
      ...(prev.private ? { private: true, label: prev.label } : {}),
      // A scan only knows addresses, so it cannot re-derive a name we resolved
      // at send time. Carry it over or it is lost on the first refresh.
      ...(prev.peerName ? { peerName: prev.peerName } : {}),
      ...(prev.shielded ? { shielded: true } : {}),
    });
  }
  return [...byId.values()].sort(byRecency);
}
