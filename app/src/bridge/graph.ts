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
import { chainHasOwnSubgraph, chainTokenApiNetwork, chainName, isGatewayContract } from '../lib/chains';

/**
 * Both index sources go through the hub.
 *
 * The provider key used to live in `EXPO_PUBLIC_TOKEN_API_JWT`, which is inlined
 * into the bundle at build time and recoverable from the app package — a
 * credential handed to anyone who downloads the app, billed to us. It is now
 * server-side only, and the app carries nothing worth extracting.
 */
const INDEX_API = `${process.env.EXPO_PUBLIC_RELAYER_URL ?? ''}/index`;
const INDEX_CONFIGURED = !!process.env.EXPO_PUBLIC_RELAYER_URL;

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

/** `kind` selects a fixed upstream path on the hub — the app never names one. */
async function tokenApi<T>(kind: string, params: Record<string, string>): Promise<T[]> {
  if (!INDEX_CONFIGURED) return [];
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${INDEX_API}/token/${kind}?${qs}`);
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
  return tokenApi<TokenBalance>('balances', {
    network, address, limit: String(MAX_PAGE),
  });
}

/** Native-coin balance in human units, or null when unavailable. */
export async function nativeBalance(address: string, chainId: bigint): Promise<number | null> {
  const network = tokenApiNetworkFor(chainId);
  if (!network || !address) return null;
  const rows = await tokenApi<{ value: number }>('balances-native', { network, address });
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
    const batch = await tokenApi<TokenApiTransfer>('transfers', {
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
    ...(price > 0 ? { usd: sent ? -(r.value * price) : r.value * price } : {}),
    usdText: price > 0 ? `${sign}$${(r.value * price).toFixed(2)}` : '',
    timestamp: r.timestamp,
    status: 'confirmed',
    explorerUrl: evmExplorerTxUrl(chainId, r.transaction_id),
    network: evmNetworkName(chainId),
  };
}

// ── Arc subgraph ─────────────────────────────────────────────────────────────

// The query itself now lives in the hub (hub/src/indexProxy.ts) so this app
// cannot be used to run arbitrary GraphQL against our subgraph. The response
// shape it returns is `ArcTransfer` below — the two must change together.

interface ArcTransfer {
  id: string; txHash: string; from: string; to: string;
  symbol: string; amount: string; timestamp: string;
}

/**
 * Arc history from our own subgraph. Amounts are already 6dp minor units — the
 * subgraph normalises the native emitter's 18dp before storing, so there is no
 * scaling to redo here.
 */
export async function arcTransfers(
  address: string,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
  first = 40,
): Promise<ActivityItem[]> {
  if (!INDEX_CONFIGURED || !address) return [];
  try {
    // The query lives on the hub, not here: an endpoint that forwards arbitrary
    // GraphQL is an open door to our own deployment.
    const qs = new URLSearchParams({ address: address.toLowerCase(), first: String(first) });
    const res = await fetch(`${INDEX_API}/arc/transfers?${qs}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { transfers?: ArcTransfer[] } };
    const rows = json.data?.transfers ?? [];
    const addr = address.toLowerCase();

    // One transaction can move more than one token — a swap moves two. Group by
    // transaction first, because the rows are only meaningful together.
    const byTx = new Map<string, ArcTransfer[]>();
    for (const t of rows) {
      const legs = byTx.get(t.txHash);
      if (legs) legs.push(t); else byTx.set(t.txHash, [t]);
    }

    const out: ActivityItem[] = [];
    for (const [txHash, legs] of byTx) {
      const paid = legs.filter((l) => l.from.toLowerCase() === addr);
      const got = legs.filter((l) => l.to.toLowerCase() === addr);

      // A swap: exactly one token out and a different one back, in one tx. It is
      // ONE event to the user, and rendering it as two rows (or, as this did
      // before, silently dropping a leg to an id collision on the shared tx
      // hash) misrepresents what happened.
      if (legs.length === 2 && paid.length === 1 && got.length === 1 && paid[0].symbol !== got[0].symbol) {
        out.push(swapRow(txHash, paid[0], got[0], chainId, priceOf));
        continue;
      }

      // Anything else stays per-leg. A multi-leg transaction needs the
      // subgraph's own id to stay unique; a lone transfer keeps the tx hash so
      // an optimistic just-sent row still reconciles onto it.
      const unique = legs.length > 1;
      for (const l of legs) out.push(transferRow(l, addr, chainId, unique ? l.id : txHash, priceOf));
    }
    return out;
  } catch {
    return [];
  }
}

const cgFor = (symbol: string): string => (symbol === 'EURC' ? 'euro-coin' : 'usd-coin');
const colorFor = (symbol: string): string => (symbol === 'EURC' ? '#1AA68C' : '#2980D9');
const amt = (t: ArcTransfer): number => Number(t.amount) / 1e6; // already 6dp minor units

function transferRow(
  t: ArcTransfer,
  addr: string,
  chainId: bigint,
  id: string,
  priceOf: (coingeckoId: string) => number,
): ActivityItem {
  const sent = t.from.toLowerCase() === addr;
  const sign = sent ? '-' : '+';
  const amount = amt(t);
  return {
    id,
    symbol: t.symbol,
    coingeckoId: cgFor(t.symbol),
    colorHex: colorFor(t.symbol),
    type: sent ? 'sent' : 'received',
    ...gatewayTitle(sent, sent ? t.to : t.from),
    label: sent ? 'Sent' : 'Received',
    amountText: `${sign}${amount.toFixed(2)} ${t.symbol}`,
    // USDC is a dollar; EURC is NOT, so it has to be priced rather than assumed.
    // Falls back to 1:1 only when the price feed has nothing for the symbol.
    usd: (sent ? -amount : amount) * (priceOf(cgFor(t.symbol)) || 1),
    usdText: `${sign}$${(amount * (priceOf(cgFor(t.symbol)) || 1)).toFixed(2)}`,
    timestamp: Number(t.timestamp),
    status: 'confirmed',
    explorerUrl: evmExplorerTxUrl(chainId, t.txHash),
    network: chainName(chainId),
  };
}

/** One row for a swap: the token received on top, the token paid beneath. */
function swapRow(
  txHash: string,
  paid: ArcTransfer,
  got: ArcTransfer,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
): ActivityItem {
  return {
    id: txHash,
    symbol: got.symbol,
    coingeckoId: cgFor(got.symbol),
    colorHex: colorFor(got.symbol),
    type: 'swapped',
    label: 'Swapped',
    amountText: `+${amt(got).toFixed(2)} ${got.symbol}`,
    secondaryAmountText: `-${amt(paid).toFixed(2)} ${paid.symbol}`,
    fromSymbol: paid.symbol,
    fromCoingeckoId: cgFor(paid.symbol),
    fromColorHex: colorFor(paid.symbol),
    // The swap row shows both token legs; a dollar figure would have to pick a
    // side, and on a testnet pool the two sides disagree.
    usdText: '',
    timestamp: Number(got.timestamp),
    status: 'confirmed',
    explorerUrl: evmExplorerTxUrl(chainId, txHash),
    network: chainName(chainId),
  };
}

/** A heading for a move in or out of the unified balance, or nothing. */
export function gatewayTitle(sent: boolean, other: string): { title?: string } {
  if (!isGatewayContract(other)) return {};
  return { title: sent ? 'Added to spendable' : 'Moved to wallet' };
}

/** Graph-backed history for any chain it covers. Empty when it doesn't. */
export async function graphActivity(
  address: string,
  chainId: bigint,
  priceOf: (coingeckoId: string) => number,
): Promise<ActivityItem[]> {
  if (isArcChainId(chainId)) return arcTransfers(address, chainId, priceOf);
  return tokenTransfers(address, chainId, priceOf);
}
