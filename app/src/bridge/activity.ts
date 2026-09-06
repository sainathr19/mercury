// Interim activity source: the Arc explorer API.
// specs/subgraph.md makes The Graph the real source; this exists so the app is
// honest and useful before the subgraph is deployed. Same normalised shape, so
// swapping the source later touches only this file.
import { ARC_TESTNET } from '@shared/chains';

const API = 'https://testnet.arcscan.app/api';

export interface Activity {
  hash: string;
  direction: 'in' | 'out';
  counterparty: string;
  amountMinor: bigint;
  symbol: 'USDC' | 'EURC';
  timestamp: number;
  native: boolean;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function get(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json.result) ? json.result : [];
}

export async function fetchActivity(address: string, limit = 25): Promise<Activity[]> {
  const [tokenTx, nativeTx] = await Promise.all([
    get({ module: 'account', action: 'tokentx', address, page: '1', offset: String(limit), sort: 'desc' }),
    get({ module: 'account', action: 'txlist', address, page: '1', offset: String(limit), sort: 'desc' }),
  ]);

  const out: Activity[] = [];

  for (const tx of tokenTx) {
    const isEurc = eq(tx.contractAddress ?? '', ARC_TESTNET.eurc);
    out.push({
      hash: tx.hash,
      direction: eq(tx.from, address) ? 'out' : 'in',
      counterparty: eq(tx.from, address) ? tx.to : tx.from,
      amountMinor: BigInt(tx.value ?? '0'),          // token events are already 6dp
      symbol: isEurc ? 'EURC' : 'USDC',
      timestamp: Number(tx.timeStamp ?? 0) * 1000,
      native: false,
    });
  }

  for (const tx of nativeTx) {
    const value = BigInt(tx.value ?? '0');
    if (value === 0n) continue;                       // contract calls, not payments
    out.push({
      hash: tx.hash,
      direction: eq(tx.from, address) ? 'out' : 'in',
      counterparty: eq(tx.from, address) ? tx.to : tx.from,
      amountMinor: value / 10n ** 12n,                // native events are 18dp
      symbol: 'USDC',
      timestamp: Number(tx.timeStamp ?? 0) * 1000,
      native: true,
    });
  }

  // The same payment can appear in both feeds; the tx hash is the identity.
  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.hash) ? false : (seen.add(a.hash), true)))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}


// The shape the copied ActivityRow renders. Re-exported from here because that
// component imports it from this module.
export type TxType = 'sent' | 'received' | 'swapped';
export type TxStatus = 'confirmed' | 'pending' | 'failed';

export interface ActivityItem {
  id: string;
  symbol: string;
  coingeckoId: string;
  colorHex: string;
  type: TxType;
  label: string;
  amountText: string;
  usdText: string;
  secondaryAmountText?: string;
  fromSymbol?: string;
  fromCoingeckoId?: string;
  fromColorHex?: string;
  timestamp: number;
  status: TxStatus;
  explorerUrl: string;
  network?: string;
  /** Stealth-address receipt (v2). Rendered as a shield on the row. */
  shielded?: boolean;
  private?: boolean;
}
