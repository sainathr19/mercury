/** Format a base-unit integer amount into a decimal string by `decimals`. */
export function formatUnits(raw: bigint | string, decimals: number): string {
  const s = String(raw);
  const neg = s.startsWith('-');
  const digits = (neg ? s.slice(1) : s).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${whole}.${frac}` : whole);
}

/** Parse a human decimal string into a base-unit bigint by `decimals`. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const [w, f = ''] = amount.trim().split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((w || '0') + frac);
}

/** Truncate a long hash/address to `head…tail`. */
export function shortenAddress(a: string, head = 10, tail = 8): string {
  return a.length > head + tail ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

/** Format a USD amount: $1,234.56 (2 dp, grouped). */
// Prices are fetched in USD. The display currency applies a symbol AND a live
// USD→currency exchange rate (see lib/currency.ts) so values are actually
// converted, not just relabelled. Rate is 1 for USD (and until rates load).
let currencySymbol = '$';
let currencyRate = 1;
export function setCurrencySymbol(symbol: string): void {
  currencySymbol = symbol;
}
export function getCurrencySymbol(): string {
  return currencySymbol;
}
/** Set the USD→display-currency multiplier (e.g. 0.92 for EUR). */
export function setCurrencyRate(rate: number): void {
  currencyRate = isFinite(rate) && rate > 0 ? rate : 1;
}
export function getCurrencyRate(): number {
  return currencyRate;
}

/** Compact "x ago" label from an epoch-ms timestamp (e.g. "2 days ago"). */
export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** today | yesterday | older bucket for a tx (ts in seconds), plus the Date. */
function dayKind(ts: number): { kind: 'today' | 'yesterday' | 'older'; d: Date } {
  const d = new Date(ts * 1000);
  const todayStart = startOfDay(new Date());
  const yesterdayStart = startOfDay(new Date(todayStart - 86_400_000));
  const dayStart = startOfDay(d);
  if (dayStart === todayStart) return { kind: 'today', d };
  if (dayStart === yesterdayStart) return { kind: 'yesterday', d };
  return { kind: 'older', d };
}

/** 12-hour clock like "2:21 pm". */
function clock(d: Date): string {
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const h = d.getHours() % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Transaction time for a row subtitle: "2:21 pm" today, "Yesterday, 6:14 pm",
 *  else "Jun 12, 6:14 pm". ts in seconds. */
export function txTime(ts: number): string {
  const { kind, d } = dayKind(ts);
  if (kind === 'today') return clock(d);
  if (kind === 'yesterday') return `Yesterday, ${clock(d)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock(d)}`;
}

/** Section bucket label for the Activity page: "Today", "Yesterday", "Jun 12". */
export function dayLabel(ts: number): string {
  const { kind, d } = dayKind(ts);
  if (kind === 'today') return 'Today';
  if (kind === 'yesterday') return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Split a USD amount into the `$1,234` whole part and the `.56` fraction so the
 *  cents can be rendered in a lighter color (mirrors iOS CurrencyText). */
export function currencyParts(amount: number): { whole: string; fraction: string } {
  const safe = (isFinite(amount) ? amount : 0) * currencyRate;
  const s = Math.abs(safe).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dot = s.lastIndexOf('.');
  const neg = safe < 0 ? '-' : '';
  return { whole: `${neg}${currencySymbol}${s.slice(0, dot)}`, fraction: s.slice(dot) };
}

export function formatUsd(amount: number): string {
  if (!isFinite(amount)) return `${currencySymbol}0.00`;
  return (
    currencySymbol +
    (amount * currencyRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Format a crypto amount for display (mirrors DashboardView.formatCryptoAmount):
 *  whole numbers → no decimals, ≥100 → 2dp grouped, else → up to 4dp. */
export function formatCrypto(amount: number): string {
  if (!isFinite(amount)) return '0';
  if (amount === Math.floor(amount)) return String(amount);
  if (amount >= 100)
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const four = amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  // A HELD balance must never render as "0". Four decimals collapses small
  // holdings of an expensive asset (0.00003 WBTC → "0"), which reads as owning
  // nothing while the row beside it shows a dollar value.
  if (four !== '0' || amount === 0) return four;
  if (amount < 0.00000001) return '<0.00000001';
  return amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

/** Format a network fee / gas amount. Unlike formatCrypto, this keeps tiny
 *  values visible (L2 gas can be far below 0.0001) instead of collapsing to "0". */
export function formatFee(amount: number): string {
  if (!isFinite(amount) || amount <= 0) return '0';
  if (amount < 0.000001) return '<0.000001';
  return amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A total that actually shows what was added to it.
 *
 * `formatCrypto` rounds to 4dp, so `amount + fee` on any chain with a cheap fee
 * renders as the amount itself — a row whose only job is to say "the fee comes
 * out of this too" showing it not coming out (0.0001 + 0.000045 ETH → "0.0001").
 * Keeps the readable format whenever it is faithful and reaches for more digits
 * only when it would otherwise lie.
 */
export function formatTotal(total: number, part: number): string {
  const coarse = formatCrypto(total);
  if (coarse !== formatCrypto(part)) return coarse;
  // A difference below 8dp is not displayable at any sane precision, so the
  // two reading the same is then the honest answer.
  return total.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

/** Signed percent: +2.41% / -1.12%. */
export function formatPercent(pct: number): string {
  const sign = pct >= 0 ? '+' : '-';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}
