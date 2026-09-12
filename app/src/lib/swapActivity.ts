//! Swaps, as activity rows.
//
// A swap IS a transaction the wallet made, so it belongs in the one feed the
// user already reads rather than behind a tab on the screen that started it.
// Activity has carried the shape for this all along — `TxType` includes
// `'swapped'`, `ActivityRow` draws the paired source/destination icons, and the
// detail screen labels the counterparty "Via" — but nothing had produced one
// since the original Garden integration was removed.
//
// DERIVED, never persisted into the activity store. The two swap stores already
// own these records and write them to disk; copying them into a third place
// would mean two sources of truth for one row and a reconciliation problem
// nobody asked for. The feed merges them at render time instead.
import type { ActivityItem } from '../bridge/activity';
import { coingeckoId } from '../bridge/portfolio';
import { colorForSymbol } from './asset-color';
import { formatUnits } from './format';

/**
 * A swap leg, sized for a row without misstating it.
 *
 * `formatUnits` is exact, and exact on an 18-decimal asset is
 * "0.005870704924500982" — nineteen characters that run past the edge of the
 * card and push the symbol off it.
 *
 * `formatCrypto` is the app's usual bound, but it is wrong HERE: it rounds to
 * four decimals, which turns a 0.00025 BTC swap into "0.0003 BTC". A balance
 * may round, because the exact figure is a tap away. An amount received may
 * not — this row is the record of what the swap actually paid out.
 *
 * So: cap the decimals at the asset's own precision or eight, whichever is
 * smaller, and trim the zeros that leaves. Long amounts get shorter, short ones
 * are untouched, and nothing is rounded up into a number the user did not get.
 */
const legAmount = (units: string, decimals: number): string => {
  const n = Number(formatUnits(units, decimals));
  if (!Number.isFinite(n)) return '0';
  if (n === Math.floor(n)) return String(n);
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const capped = n.toFixed(Math.min(decimals, 8)).replace(/0+$/, '').replace(/\.$/, '');
  // Below the cap entirely — say so rather than showing a zero for money that
  // moved.
  return capped === '0' ? '<0.00000001' : capped;
};
import { isPending as flashnetPending, type SwapRecord } from '../stores/swapStore';
import { type GardenSwapRecord } from '../stores/gardenSwapStore';

/**
 * Ids are namespaced so a swap can never collide with a chain transaction.
 *
 * The feed keys rows by id and hides any scanned item whose id matches a swap's
 * `sourceTxId`; an unprefixed quote id colliding with a txid would make one row
 * hide the other.
 */
const FLASHNET_PREFIX = 'swap:flashnet:';
const GARDEN_PREFIX = 'swap:garden:';

export const isSwapActivityId = (id: string): boolean =>
  id.startsWith(FLASHNET_PREFIX) || id.startsWith(GARDEN_PREFIX);

/** Activity timestamps are SECONDS; both swap stores record milliseconds. */
const seconds = (ms: number): number => Math.floor(ms / 1000);

function icons(symbol: string, explicitId?: string) {
  return {
    coingeckoId: explicitId ?? coingeckoId(symbol, symbol),
    colorHex: colorForSymbol(symbol),
  };
}

/** One Orchestra swap as a feed row. */
export function flashnetSwapActivity(r: SwapRecord): ActivityItem {
  const src = icons(r.source.symbol);
  const dst = icons(r.destination.symbol);
  const failed = r.status === 'failed' || r.status === 'expired' || r.status === 'unfulfilled';
  return {
    id: `${FLASHNET_PREFIX}${r.quoteId}`,
    type: 'swapped',
    symbol: r.destination.symbol,
    coingeckoId: dst.coingeckoId,
    colorHex: dst.colorHex,
    fromSymbol: r.source.symbol,
    fromCoingeckoId: src.coingeckoId,
    fromColorHex: src.colorHex,
    label: `${r.source.chainName} → ${r.destination.chainName}`,
    amountText: `+${legAmount(r.estimatedOut, r.destination.decimals)} ${r.destination.symbol}`,
    secondaryAmountText: `−${legAmount(r.amountIn, r.source.decimals)} ${r.source.symbol}`,
    // Deliberately blank: we do not price either leg at swap time, and a "$0.00"
    // would read as a worthless transaction rather than an unpriced one.
    usdText: '',
    // Hides the chain scan's own row for the deposit transfer, which would
    // otherwise appear beside this one as an unexplained "Sent".
    sourceTxId: r.txHash,
    timestamp: seconds(r.createdAt),
    status: failed ? 'failed' : flashnetPending(r) ? 'pending' : 'confirmed',
    explorerUrl: '',
    network: r.source.chainName,
  };
}

/** One Garden swap as a feed row. */
export function gardenSwapActivity(r: GardenSwapRecord): ActivityItem {
  const src = icons(r.source.symbol, r.source.coingeckoId);
  const dst = icons(r.destination.symbol, r.destination.coingeckoId);
  const failed = r.status === 'fund_failed' || r.status === 'refunded';
  return {
    id: `${GARDEN_PREFIX}${r.id}`,
    type: 'swapped',
    symbol: r.destination.symbol,
    coingeckoId: dst.coingeckoId,
    colorHex: dst.colorHex,
    fromSymbol: r.source.symbol,
    fromCoingeckoId: src.coingeckoId,
    fromColorHex: src.colorHex,
    label: `${r.source.chainName} → ${r.destination.chainName}`,
    amountText: `+${legAmount(r.amountOut, r.destination.decimals)} ${r.destination.symbol}`,
    secondaryAmountText: `−${legAmount(r.amountIn, r.source.decimals)} ${r.source.symbol}`,
    usdText: '',
    sourceTxId: r.fundTxHash,
    timestamp: seconds(r.createdAt),
    status: failed ? 'failed' : r.status === 'complete' ? 'confirmed' : 'pending',
    explorerUrl: '',
    network: r.source.chainName,
  };
}

/**
 * The activity feed with both providers' swaps folded in.
 *
 * Also drops any scanned row that is a swap's own source transfer: the chain
 * sees that transfer and has no idea it was one leg of a swap, so without this
 * the user gets a "Sent 0.001 BTC" beside the swap that spent it.
 */
export function withSwaps(
  items: ActivityItem[],
  swaps: { flashnet?: SwapRecord[]; garden?: GardenSwapRecord[] },
): ActivityItem[] {
  const rows = [
    ...(swaps.flashnet ?? []).map(flashnetSwapActivity),
    ...(swaps.garden ?? []).map(gardenSwapActivity),
  ];
  if (rows.length === 0) return items;

  const hidden = new Set(
    rows.map((r) => r.sourceTxId?.toLowerCase()).filter((x): x is string => !!x),
  );
  // A swap row already present in `items` wins from the store, not the scan —
  // but nothing writes these into the store today, so this only guards a future
  // where something does.
  const seen = new Set(rows.map((r) => r.id));
  const kept = items.filter(
    (i) => !seen.has(i.id) && !hidden.has(i.id.toLowerCase()),
  );
  return [...rows, ...kept];
}

/**
 * Resolve a swap row by its feed id.
 *
 * The transaction detail looks items up in the activity store, and these rows
 * are deliberately not in it — so without this a tap on a swap opened the "not
 * found" screen. Resolving from the swap stores instead keeps one detail screen
 * for every kind of transaction rather than growing a second one per provider.
 */
export function findSwapActivity(
  id: string,
  swaps: { flashnet?: SwapRecord[]; garden?: GardenSwapRecord[] },
): ActivityItem | undefined {
  if (id.startsWith(FLASHNET_PREFIX)) {
    const quoteId = id.slice(FLASHNET_PREFIX.length);
    const r = swaps.flashnet?.find((s) => s.quoteId === quoteId);
    return r ? flashnetSwapActivity(r) : undefined;
  }
  if (id.startsWith(GARDEN_PREFIX)) {
    const orderId = id.slice(GARDEN_PREFIX.length);
    const r = swaps.garden?.find((s) => s.id === orderId);
    return r ? gardenSwapActivity(r) : undefined;
  }
  return undefined;
}
