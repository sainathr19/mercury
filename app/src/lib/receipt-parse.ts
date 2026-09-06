// Pure receipt/status parsers — no native or network imports, so they're
// unit-testable in isolation (mirrors src/lib/evm-activity.ts). The network
// fetch lives in src/bridge/receipts.ts, which calls into here.

export type TxOutcome = 'pending' | 'confirmed' | 'failed';

/** Parse an `eth_getTransactionReceipt` result. null (not mined yet) → pending;
 *  status 0x1 → confirmed; status 0x0 (reverted / out-of-gas) → failed. */
export function parseEvmReceipt(receipt: unknown): TxOutcome {
  if (!receipt || typeof receipt !== 'object') return 'pending';
  const status = (receipt as { status?: unknown }).status;
  if (typeof status !== 'string') return 'pending';
  const n = status.toLowerCase();
  return n === '0x1' || n === '0x01' ? 'confirmed' : 'failed';
}

/** Parse one entry of `getSignatureStatuses`. null (unknown to the cluster) →
 *  pending; `err` set → failed; confirmed/finalized commitment → confirmed. */
export function parseSolStatus(value: unknown): TxOutcome {
  if (!value || typeof value !== 'object') return 'pending';
  const v = value as { err?: unknown; confirmationStatus?: unknown };
  if (v.err != null) return 'failed';
  return v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized'
    ? 'confirmed'
    : 'pending';
}

/** Map an ActivityItem's native symbol to its chain family (private sends are
 *  native BTC/ETH/SOL only). Returns undefined for anything else. */
export function familyForSymbol(symbol: string): number | undefined {
  switch (symbol.toUpperCase()) {
    case 'BTC':
      return 0;
    case 'ETH':
      return 1;
    case 'SOL':
      return 2;
    default:
      return undefined;
  }
}
