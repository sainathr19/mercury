import { btcEsploraForEnv, solRpcForEnv } from './networks';
import { getActiveEnvironment } from './activeEnv';
import { btcExplorerTxUrl, solExplorerTxUrl } from './explorers';
import { BLOCKSCOUT_BASES, mapEvmActivity, type RawEvmTx, type RawEvmTokenTx } from '../lib/evm-activity';
import { graphActivity, graphCoversChain } from './graph';
import { chainsForEnvironment } from '../lib/chains';

export type TxType = 'sent' | 'received' | 'swapped';
export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface ActivityItem {
  id: string; // txid / signature
  symbol: string;
  coingeckoId: string;
  colorHex: string;
  type: TxType;
  label: string;
  amountText: string;
  usdText: string;
  /** Swaps only: the SOURCE ("you paid") side. `amountText` is the destination
   *  (+received); this is the source (−paid), shown on the row's second line,
   *  and the source-asset icon renders behind the destination. */
  secondaryAmountText?: string;
  fromSymbol?: string;
  fromCoingeckoId?: string;
  fromColorHex?: string;
  /** Swaps only: the on-chain hash of the source-leg transfer. The chain scan
   *  would otherwise surface that transfer as a separate "sent" row, so activity
   *  hides any scanned item whose id matches a swap's sourceTxId. */
  sourceTxId?: string;
  timestamp: number; // seconds
  status: TxStatus;
  explorerUrl: string;
  /** Human network name the tx happened on (e.g. "Ethereum", "Arbitrum Sepolia"). */
  network?: string;
  /** Network fee paid (sender-side only). Shown on the tx detail's "Fees" row. */
  feeText?: string;
  feeUsdText?: string;
  /** Estimated time to confirmation for a pending tx (detail's "ETA" row). */
  etaText?: string;
  /** Stealth send/spend — drives the "Private" tag. Preserved across on-chain
   *  reconciliation (a private pay's funding tx is surfaced by the normal scan). */
  private?: boolean;
  /** True for a SHIELD tx (funds moved into privacy via a stealth send) — the row
   *  reads "Shielded" instead of "Private send". Spends/un-shields stay "Private send". */
  shielded?: boolean;
  /** EVM chain id this tx is on (number for JSON persistence). Set on private
   *  EVM spends so pending-outcome polling hits the right chain. */
  chainId?: number;
}

/** Display name for the BTC network on the active environment. */
function btcNetworkName(): string {
  return getActiveEnvironment() === 'testnet' ? 'Bitcoin Testnet' : 'Bitcoin';
}
/** Display name for the SOL cluster on the active environment. */
function solNetworkName(): string {
  return getActiveEnvironment() === 'testnet' ? 'Solana Devnet' : 'Solana';
}

function fmt(v: number, dec: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
function usd(v: number, sign: string): string {
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Shorten an address/id for a "To …"/"From …" row label (6 + 6). */
function counterparty(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

const BTC_COLOR = '#FF991A';
const ETH_COLOR = '#627EEA';
const SOL_COLOR = '#7333D9';

/** Per-chain display metadata, mirrored from the iOS CryptoAsset samples. */
const CHAIN_META = {
  btc: { symbol: 'BTC', coingeckoId: 'bitcoin', colorHex: BTC_COLOR, decimals: 8 },
  eth: { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: ETH_COLOR, decimals: 18 },
  sol: { symbol: 'SOL', coingeckoId: 'solana', colorHex: SOL_COLOR, decimals: 9 },
} as const;
export type ActivityChain = keyof typeof CHAIN_META;

/** Bitcoin history via Esplora /address/{addr}/txs (ported from ActivityStore). */
export async function loadBtcActivity(address: string, btcPrice: number): Promise<ActivityItem[]> {
  if (!address || address === '—') return [];
  const out: ActivityItem[] = [];
  try {
    const res = await fetch(`${btcEsploraForEnv(getActiveEnvironment())}/address/${address}/txs`);
    if (!res.ok) return [];
    const txs = (await res.json()) as any[];
    for (const tx of txs) {
      const txid: string = tx.txid;
      const vouts: any[] = tx.vout ?? [];
      const vins: any[] = tx.vin ?? [];
      const receivedSat = vouts
        .filter((v) => v.scriptpubkey_address === address)
        .reduce((s, v) => s + (v.value ?? 0), 0);
      const isSent = vins.some((v) => v.prevout?.scriptpubkey_address === address);
      const confirmed = tx.status?.confirmed ?? false;
      const status: TxStatus = confirmed ? 'confirmed' : 'pending';
      const timestamp = tx.status?.block_time ?? Math.floor(Date.now() / 1000);
      const explorerUrl = btcExplorerTxUrl(txid);

      // Any tx spending our inputs is a SEND — even with a change output back to
      // us (receivedSat > 0), which is the normal case. Checking receivedSat === 0
      // here misclassified every change-bearing send as "received".
      if (isSent) {
        const spent = vins
          .filter((v) => v.prevout?.scriptpubkey_address === address)
          .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
        const change = vouts
          .filter((v) => v.scriptpubkey_address === address)
          .reduce((s, v) => s + (v.value ?? 0), 0);
        const feeSat = typeof tx.fee === 'number' ? tx.fee : 0;
        // Amount to the recipient = inputs − change − fee (fee shown separately).
        const sentSat = Math.max(0, spent - change - feeSat);
        if (sentSat <= 0) continue; // self-send / consolidation → nothing to show
        const amt = sentSat / 1e8;
        const feeBtc = feeSat > 0 ? feeSat / 1e8 : null;
        // The recipient is the first output NOT going back to us.
        const recipient = vouts.map((v) => v.scriptpubkey_address).find((a) => a && a !== address);
        const label = recipient
          ? `To ${recipient.slice(0, 6)}…${recipient.slice(-6)}`
          : `To ${txid.slice(0, 6)}…${txid.slice(-6)}`;
        out.push({
          id: txid, symbol: 'BTC', coingeckoId: 'bitcoin', colorHex: BTC_COLOR,
          type: 'sent', label,
          amountText: `-${fmt(amt, 8)} BTC`, usdText: usd(amt * btcPrice, '-'),
          timestamp, status, explorerUrl, network: btcNetworkName(),
          ...(feeBtc != null ? { feeText: `${fmt(feeBtc, 8)} BTC`, feeUsdText: usd(feeBtc * btcPrice, '') } : {}),
        });
      } else if (receivedSat > 0) {
        const amt = receivedSat / 1e8;
        const sender = vins.map((v) => v.prevout?.scriptpubkey_address).find((a) => a && a !== address);
        const label = sender ? `From ${sender.slice(0, 6)}…${sender.slice(-6)}` : `From ${txid.slice(0, 6)}…`;
        out.push({
          id: txid, symbol: 'BTC', coingeckoId: 'bitcoin', colorHex: BTC_COLOR,
          type: 'received', label,
          amountText: `+${fmt(amt, 8)} BTC`, usdText: usd(amt * btcPrice, '+'),
          timestamp, status, explorerUrl, network: btcNetworkName(),
        });
      }
    }
  } catch {}
  return out;
}

/** Solana history via getSignaturesForAddress + getTransaction (ported). */
export async function loadSolActivity(address: string, solPrice: number): Promise<ActivityItem[]> {
  if (!address || address === '—') return [];
  const out: ActivityItem[] = [];
  const rpc = solRpcForEnv(getActiveEnvironment());
  async function rpcCall(method: string, params: unknown): Promise<any> {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await res.json()).result;
  }
  try {
    const sigs = (await rpcCall('getSignaturesForAddress', [address, { limit: 20, commitment: 'confirmed' }])) as any[];
    if (!Array.isArray(sigs)) return [];
    for (const entry of sigs.slice(0, 15)) {
      const sig: string = entry.signature;
      if (entry.err) continue;
      const timestamp = entry.blockTime ?? Math.floor(Date.now() / 1000);
      const tx = await rpcCall('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0 }]);
      const meta = tx?.meta;
      const keys: string[] = tx?.transaction?.message?.accountKeys ?? [];
      const idx = keys.indexOf(address);
      if (!meta || idx < 0 || idx >= meta.preBalances.length) continue;
      const delta = meta.postBalances[idx] - meta.preBalances[idx];
      if (Math.abs(delta) <= 5000) continue;
      const amt = Math.abs(delta) / 1e9;
      const received = delta > 0;
      // Counterparty = the other account with the biggest opposite-sign balance
      // change (recipient gained on a send; sender lost on a receive). Falls back
      // to the signature only if we can't identify it.
      let peer = '';
      let best = 0;
      for (let i = 0; i < keys.length; i++) {
        if (i === idx) continue;
        const d = (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0);
        if (received ? d < best : d > best) { best = d; peer = keys[i]; }
      }
      const other = peer || sig;
      // Fee (lamports) is paid by the sender — only surface it on sends.
      const feeSol = !received && typeof meta.fee === 'number' ? meta.fee / 1e9 : null;
      out.push({
        id: sig, symbol: 'SOL', coingeckoId: 'solana', colorHex: SOL_COLOR,
        type: received ? 'received' : 'sent',
        label: received ? `From ${counterparty(other)}` : `To ${counterparty(other)}`,
        amountText: `${received ? '+' : '-'}${fmt(amt, 4)} SOL`,
        usdText: usd(amt * solPrice, received ? '+' : '-'),
        timestamp, status: 'confirmed',
        explorerUrl: solExplorerTxUrl(sig), network: solNetworkName(),
        ...(feeSol != null ? { feeText: `${fmt(feeSol, 9)} SOL`, feeUsdText: usd(feeSol * solPrice, '') } : {}),
      });
    }
  } catch {}
  return out;
}

/**
 * EVM history (native + ERC-20) via Blockscout's keyless Etherscan-compatible
 * API for the active chain. Returns [] when the chain has no known Blockscout
 * instance or on any network error. Items are keyed by the bare tx hash so a
 * just-broadcast EVM send (prepended via `pendingSendItem`) reconciles to
 * confirmed on the next scan.
 */
export async function loadEvmActivity(
  address: string,
  chainId: bigint,
  ethPrice: number,
  priceOf: (coingeckoId: string) => number,
): Promise<ActivityItem[]> {
  if (!address || !address.startsWith('0x')) return [];

  // The Graph first, where it covers the chain: Token API for the major EVM
  // networks, our own subgraph for Arc. Arc has NO Blockscout instance, so the
  // subgraph is the only source there — without this branch Arc history is
  // silently empty. Blockscout stays as the fallback for chains The Graph
  // doesn't index, and for a transient Graph failure.
  if (graphCoversChain(chainId)) {
    const viaGraph = await graphActivity(address, chainId, priceOf);
    if (viaGraph.length) return viaGraph;
  }

  const base = BLOCKSCOUT_BASES[chainId.toString()];
  if (!base) return [];
  async function query<T>(action: 'txlist' | 'tokentx'): Promise<T[]> {
    try {
      const url = `${base}/api?module=account&action=${action}&address=${address}&sort=desc&page=1&offset=25`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = (await res.json()) as { result?: unknown };
      return Array.isArray(json.result) ? (json.result as T[]) : [];
    } catch {
      return [];
    }
  }
  const [native, tokens] = await Promise.all([query<RawEvmTx>('txlist'), query<RawEvmTokenTx>('tokentx')]);
  return mapEvmActivity({ address, chainId, native, tokens, ethPrice, priceOf });
}

/** Prices needed to value historical transactions (current spot, best-effort). */
export interface ActivityPrices {
  bitcoin: number;
  solana: number;
  ethereum: number;
}

/**
 * The EVM chains a history scan covers: the active one, plus every chain in this
 * environment that we index ourselves.
 *
 * Those extra chains are not a convenience. The unified balance can hold money
 * on Arc, but Arc is not selectable as the active network, so scanning only the
 * active chain makes that history unreachable from the UI — the feed reads
 * "no recent activity" over a wallet that has been spending all day. They cost
 * one Graph query each, not an RPC scan.
 */
function evmChainsToScan(activeChainId: bigint): bigint[] {
  const extra = chainsForEnvironment(getActiveEnvironment())
    .filter((c) => c.subgraphEnv && c.chainId !== activeChainId)
    .map((c) => c.chainId);
  return [activeChainId, ...extra];
}

/**
 * One-shot historical scan across chains. Runs BTC + SOL + EVM scans in parallel
 * and concatenates them (the store dedupes + sorts). EVM history goes beyond iOS
 * (which only scans BTC + SOL) by reading the active chain via Blockscout, plus
 * our own indexed chains via The Graph.
 * Never throws — each loader swallows its own errors and returns [].
 */
export async function loadActivity(
  addresses: { btc: string; eth: string; sol: string },
  chainId: bigint,
  prices: ActivityPrices,
  priceOf: (coingeckoId: string) => number,
): Promise<ActivityItem[]> {
  const [btc, sol, evm] = await Promise.all([
    loadBtcActivity(addresses.btc, prices.bitcoin),
    loadSolActivity(addresses.sol, prices.solana),
    Promise.all(
      evmChainsToScan(chainId).map((id) =>
        loadEvmActivity(addresses.eth, id, prices.ethereum, priceOf),
      ),
    ).then((r) => r.flat()),
  ]);
  return [...btc, ...sol, ...evm];
}



/**
 * Build an optimistic `pending`/`sent` item for a transaction we just broadcast,
 * so it shows in Activity immediately (before any chain scan sees it). The next
 * `refresh()` reconciles it with the on-chain record (same id → fresh wins).
 */
export function pendingSendItem(args: {
  chain: ActivityChain;
  id: string;
  /** The RECIPIENT address — shown as "To 0x1234…5678". Falls back to the tx id
   *  only if absent (never the intended display). */
  to?: string;
  amount: number;
  usd: number;
  explorerUrl: string;
  /** Token overrides — set for ERC-20/SPL sends so the row shows the token. */
  token?: { symbol: string; coingeckoId: string; colorHex: string };
  /** Human network name (from the sent asset) for the row's subtitle. */
  network?: string;
  /** A SHIELD (public → your own privacy) — the row reads "Shielded". Stays in
   *  the NORMAL feed (not private); the incoming private "Received" is surfaced
   *  separately by the stealth scan. */
  shielded?: boolean;
}): ActivityItem {
  const meta = CHAIN_META[args.chain];
  const symbol = args.token?.symbol ?? meta.symbol;
  return {
    id: args.id,
    symbol,
    coingeckoId: args.token?.coingeckoId ?? meta.coingeckoId,
    colorHex: args.token?.colorHex ?? meta.colorHex,
    type: 'sent',
    label: args.shielded ? 'Shielded' : `To ${counterparty(args.to ?? args.id)}`,
    amountText: `-${fmt(args.amount, Math.min(meta.decimals, 6))} ${symbol}`,
    usdText: usd(args.usd, '-'),
    timestamp: Math.floor(Date.now() / 1000),
    status: 'pending',
    explorerUrl: args.explorerUrl,
    network: args.network,
    shielded: args.shielded,
  };
}

/**
 * Optimistic `received` row for an incoming tx we learned about via the seamless
 * relay hint (before our own RPC scan sees it). `id` is the tx hash so the later
 * on-chain scan reconciles it (same id → fresh wins), exactly like pendingSendItem.
 */
export function incomingHintItem(args: {
  id: string;
  symbol: string;
  coingeckoId: string;
  colorHex: string;
  amount: number;
  usd: number;
  decimals: number;
  from?: string;
  explorerUrl?: string;
  network?: string;
}): ActivityItem {
  return {
    id: args.id,
    symbol: args.symbol,
    coingeckoId: args.coingeckoId,
    colorHex: args.colorHex,
    type: 'received',
    label: args.from ? `From ${args.from.slice(0, 6)}…` : 'Received',
    amountText: `+${fmt(args.amount, Math.min(args.decimals, 6))} ${args.symbol}`,
    usdText: usd(args.usd, '+'),
    timestamp: Math.floor(Date.now() / 1000),
    status: 'pending',
    explorerUrl: args.explorerUrl ?? '',
    network: args.network,
  };
}

/**
 * Convert a received stealth payment into a private `received` ActivityItem so
 * it flows through the shared ActivityRow / transaction-detail / activity list.
 * `usdValue` is the current value; `nowSec` seeds the timestamp only on first
 * sighting (the store preserves it across re-syncs). `amount` reflects the
 * current stored balance (the stealth store refreshes it), not the original
 * received amount.
 */
export function stealthReceiveItem(
  p: {
    ephemeralPub: ArrayBufferLike;
    chainFamily: number;
    stealthAddress: string;
    amount?: string;
    foundTxid?: string;
    tokenContract?: string;
    tokenDecimals?: number;
    tokenSymbol?: string;
  },
  usdValue: number,
  nowSec: number,
  // Resolved token identity (from stealthPaymentAsset) so an ERC-20 receive shows
  // the TOKEN's coingecko icon + color — not an empty id that renders as a letter.
  tokenMeta?: { coingeckoId?: string; colorHex?: string },
): ActivityItem {
  const chain: ActivityChain = p.chainFamily === 0 ? 'btc' : p.chainFamily === 1 ? 'eth' : 'sol';
  const chainMeta = CHAIN_META[chain];
  // ERC-20 receive: show the token's symbol/decimals; native: the chain asset.
  const isToken = !!p.tokenContract && p.tokenSymbol != null;
  const symbol = isToken ? (p.tokenSymbol as string) : chainMeta.symbol;
  const decimals = isToken ? (p.tokenDecimals ?? 0) : chainMeta.decimals;
  const amt = p.amount ? Number(p.amount) / 10 ** decimals : 0;
  const ephHex = Array.from(new Uint8Array(p.ephemeralPub)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    id: `stealth-recv-${ephHex}`,
    symbol,
    coingeckoId: isToken ? (tokenMeta?.coingeckoId ?? '') : chainMeta.coingeckoId,
    colorHex: (isToken ? tokenMeta?.colorHex : undefined) ?? chainMeta.colorHex,
    type: 'received',
    label: 'Private receive',
    amountText: `+${fmt(amt, Math.min(decimals, 6))} ${symbol}`,
    usdText: usd(usdValue, '+'),
    timestamp: nowSec,
    status: p.amount ? 'confirmed' : 'pending',
    explorerUrl: p.foundTxid
      ? chain === 'btc'
        ? btcExplorerTxUrl(p.foundTxid)
        : chain === 'sol'
          ? solExplorerTxUrl(p.foundTxid)
          : ''
      : '',
    private: true,
  };
}

/**
 * Optimistic Activity row for a stealth send/spend, tagged `private`. Pays fund
 * from the main account so the chain scan reconciles them (pass `status:
 * 'pending'`); spends are signed by the one-time stealth address and never
 * appear in the main-account scan, so they must record here as `'confirmed'`.
 */
export function privateSendItem(args: {
  chain: ActivityChain;
  id: string;
  amount: number;
  usd: number;
  explorerUrl: string;
  status?: TxStatus;
  label?: string;
  /** Mark a SHIELD tx (into privacy) so the row reads "Shielded". */
  shielded?: boolean;
  /** EVM chain id (for pending-outcome polling on the correct chain). */
  chainId?: number;
  /** ERC-20 pay override so the row reads the token (e.g. USDC), not the chain's
   *  native symbol. Decimals fall back to the chain's for display precision. */
  token?: { symbol: string; coingeckoId: string; colorHex: string };
}): ActivityItem {
  const meta = CHAIN_META[args.chain];
  const symbol = args.token?.symbol ?? meta.symbol;
  return {
    id: args.id,
    symbol,
    coingeckoId: args.token?.coingeckoId ?? meta.coingeckoId,
    colorHex: args.token?.colorHex ?? meta.colorHex,
    type: 'sent',
    label: args.label ?? 'Private payment',
    amountText: `-${fmt(args.amount, Math.min(meta.decimals, 6))} ${symbol}`,
    usdText: usd(args.usd, '-'),
    timestamp: Math.floor(Date.now() / 1000),
    status: args.status ?? 'confirmed',
    explorerUrl: args.explorerUrl,
    private: true,
    shielded: args.shielded,
    chainId: args.chainId,
  };
}
