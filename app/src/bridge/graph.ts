// ─────────────────────────────────────────────────────────────────────────────
//  The Graph — the app's history/balance source, composed from TWO products.
//
//  Token API  → the 8 chains it indexes (Ethereum, Base, Arbitrum, Optimism,
//               Polygon, BNB, Avalanche, Solana). Balances AND transfers.
//  Subgraph   → Arc, because nothing else indexes it. Our own deployment.
//
//  The split isn't a preference: Token API rejects `network=arc-testnet`
//  outright, and Arc has no Blockscout instance either, so a subgraph is the
//  only way to see Arc history at all.
// ─────────────────────────────────────────────────────────────────────────────
import type { ActivityItem } from './activity';
import { evmExplorerTxUrl } from './evmChain';
import { evmNetworkName } from '../lib/evm-activity';
import { chainHasOwnSubgraph, chainTokenApiNetwork, chainName } from '../lib/chains';

const TOKEN_API = 'https://api.pinax.network/v1';
const TOKEN_API_JWT = process.env.EXPO_PUBLIC_TOKEN_API_JWT ?? '';
const ARC_SUBGRAPH = process.env.EXPO_PUBLIC_ARC_SUBGRAPH_URL ?? '';

/**
 * The free tier returns EMPTY for limit > 10 — it does not clamp. Asking for 25
 * yields zero rows, which reads as "no transactions" rather than an error, so
 * every request MUST stay at or below this and paginate instead.
 */
const MAX_PAGE = 10;



/** True when we index this chain with our own subgraph (registry-driven). */
export function isArcChainId(chainId: bigint): boolean {
  return chainHasOwnSubgraph(chainId);
}

export function tokenApiNetworkFor(chainId: bigint): string | undefined {
  return chainTokenApiNetwork(chainId);
}

/** True when The Graph can serve this chain at all (either product). */
export function graphCoversChain(chainId: bigint): boolean {
  return isArcChainId(chainId) || tokenApiNetworkFor(chainId) !== undefined;
}

// ── Token API ────────────────────────────────────────────────────────────────

interface TokenApiTransfer {
  block_num: number;
  timestamp: number;
  transaction_id: string;
  contract: string;
  from: string;
  to: string;
  symbol: string;
  decimals: number;
  value: number;
  network: string;
}

export interface TokenBalance {
  contract: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Human units (the API's own `value`). */
  value: number;
  network: string;
}

async function tokenApi<T>(path: string, params: Record<string, string>): Promise<T[]> {
  if (!TOKEN_API_JWT) return [];
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${TOKEN_API}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN_API_JWT}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown };
    return Array.isArray(json.data) ? (json.data as T[]) : [];
  } catch {
    return [];
  }
}

/** ERC-20 balances for an address. Never throws. */
export async function tokenBalances(address: string, chainId: bigint): Promise<TokenBalance[]> {
  const network = tokenApiNetworkFor(chainId);
  if (!network || !address) return [];
  return tokenApi<TokenBalance>('/evm/balances', {
    network, address, limit: String(MAX_PAGE),
  });
}

/** Native-coin balance in human units, or null when unavailable. */
export async function nativeBalance(address: string, chainId: bigint): Promise<number | null> {
  const network = tokenApiNetworkFor(chainId);
  if (!network || !address) return null;
  const rows = await tokenApi<{ value: number }>('/evm/balances/native', { network, address });
  return rows.length ? rows[0].value : null;
}

/**
 * Transfer history via Token API, paged because of the 10-item cap.
 * `pages` is bounded so a wallet refresh can't spend the whole rate limit.
 */
export async function tokenTransfers(
  address: string,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
  pages = 3,
): Promise<ActivityItem[]> {
  const network = tokenApiNetworkFor(chainId);
  if (!network || !address) return [];
  const addr = address.toLowerCase();
  const rows: TokenApiTransfer[] = [];
  for (let page = 1; page <= pages; page++) {
    const batch = await tokenApi<TokenApiTransfer>('/evm/transfers', {
      network, address, limit: String(MAX_PAGE), page: String(page),
    });
    rows.push(...batch);
    if (batch.length < MAX_PAGE) break; // last page
  }
  return rows.map((r) => toActivityItem(r, addr, chainId, priceOf)).filter((x): x is ActivityItem => x !== null);
}

function toActivityItem(
  r: TokenApiTransfer,
  addr: string,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
): ActivityItem | null {
  const from = (r.from ?? '').toLowerCase();
  const to = (r.to ?? '').toLowerCase();
  if (from !== addr && to !== addr) return null;
  if (from === addr && to === addr) return null; // self-send
  const sent = from === addr;
  const sign = sent ? '-' : '+';
  const coingeckoId = (r.symbol ?? '').toLowerCase();
  const price = priceOf(coingeckoId);
  return {
    id: r.transaction_id,
    symbol: r.symbol ?? '?',
    coingeckoId,
    colorHex: '#70707A',
    type: sent ? 'sent' : 'received',
    label: sent ? 'Sent' : 'Received',
    amountText: `${sign}${r.value} ${r.symbol ?? ''}`.trim(),
    usdText: price > 0 ? `${sign}$${(r.value * price).toFixed(2)}` : '',
    timestamp: r.timestamp,
    status: 'confirmed',
    explorerUrl: evmExplorerTxUrl(chainId, r.transaction_id),
    network: evmNetworkName(chainId),
  };
}

// ── Arc subgraph ─────────────────────────────────────────────────────────────

const ARC_QUERY = `
  query Transfers($me: Bytes!, $first: Int!) {
    transfers(
      first: $first
      orderBy: blockNumber
      orderDirection: desc
      where: { or: [{ from: $me }, { to: $me }] }
    ) { id txHash from to symbol amount timestamp }
  }`;

interface ArcTransfer {
  id: string; txHash: string; from: string; to: string;
  symbol: string; amount: string; timestamp: string;
}

/**
 * Arc history from our own subgraph. Amounts are already 6dp minor units — the
 * subgraph normalises the native emitter's 18dp before storing, so there is no
 * scaling to redo here.
 */
export async function arcTransfers(address: string, first = 40): Promise<ActivityItem[]> {
  if (!ARC_SUBGRAPH || !address) return [];
  try {
    const res = await fetch(ARC_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: ARC_QUERY, variables: { me: address.toLowerCase(), first } }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { transfers?: ArcTransfer[] } };
    const rows = json.data?.transfers ?? [];
    const addr = address.toLowerCase();
    return rows.map((t) => {
      const sent = t.from.toLowerCase() === addr;
      const sign = sent ? '-' : '+';
      const amount = Number(t.amount) / 1e6; // 6dp minor units
      return {
        id: t.txHash,
        symbol: t.symbol,
        coingeckoId: t.symbol === 'EURC' ? 'euro-coin' : 'usd-coin',
        colorHex: t.symbol === 'EURC' ? '#1AA68C' : '#2980D9',
        type: sent ? 'sent' : 'received',
        label: sent ? 'Sent' : 'Received',
        amountText: `${sign}${amount.toFixed(2)} ${t.symbol}`,
        // USDC/EURC are dollar-denominated, so the amount IS the USD figure.
        usdText: `${sign}$${amount.toFixed(2)}`,
        timestamp: Number(t.timestamp),
        status: 'confirmed' as const,
        explorerUrl: `https://testnet.arcscan.app/tx/${t.txHash}`,
        network: chainName(5042002n),
      };
    });
  } catch {
    return [];
  }
}

/** Graph-backed history for any chain it covers. Empty when it doesn't. */
export async function graphActivity(
  address: string,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
): Promise<ActivityItem[]> {
  if (isArcChainId(chainId)) return arcTransfers(address);
  return tokenTransfers(address, chainId, priceOf);
}
