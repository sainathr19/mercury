import type { WalletInterface } from 'standard-rn';
import type { ActivityItem } from './activity';
import { toBaseUnits } from '../lib/format';
import { getActiveAccount } from './account';
import { getActiveEnvironment } from './activeEnv';
import { useSession } from '../stores/session';
import type { Environment } from '../lib/environment';

// Garden Finance v2 API. Follows the app environment: testnet on the test
// networks, mainnet (api.garden.finance) otherwise — the app-id is shared.
// Reads go over fetch() — iOS deliberately avoids the Rust reqwest client for
// Garden because its gzip decompression fails in the compiled binary; fetch
// handles gzip transparently. Execution goes through wallet.gardenSwap.
const GARDEN_APP_ID = '79702d04cb63391922f2e1471afe4743b0e3ba71f260e3c2117aa36e7fb74a9c';

/** Garden v2 API base for an environment (defaults to the active one). */
function gardenBase(env: Environment = getActiveEnvironment()): string {
  return env === 'testnet'
    ? 'https://testnet.api.garden.finance/v2'
    : 'https://api.garden.finance/v2';
}

/** Configure the Rust wallet's Garden client for an environment. Must run once
 *  per wallet instance before any swap execution (`wallet.gardenSwap`); without
 *  it the core throws "garden not configured". Reads (assets/quotes) go over
 *  fetch() and don't need this, which is why only execution fails when missing. */
export function configureGarden(wallet: WalletInterface, env: Environment): void {
  wallet.setGardenConfig(gardenBase(env), GARDEN_APP_ID);
}

function headers(): Record<string, string> {
  return { 'garden-app-id': GARDEN_APP_ID };
}

// ---- Types -----------------------------------------------------------------

/** A swappable asset from Garden's /chains endpoint, flattened per (chain,token). */
export interface GardenAsset {
  id: string; // e.g. "bitcoin_testnet:btc" / "arbitrum_sepolia:wbtc"
  symbol: string;
  displayName: string;
  chain: string; // "bitcoin", "evm:421614", "solana", …
  chainName: string | null;
  decimals: number;
  price: number | null;
  tokenIcon: string | null;
  chainIcon: string | null;
  coingeckoId: string;
  colorHex: string;
  /** 'btc' | 'eth' | 'sol' — which address we derive for this asset's chain. */
  chainKind: 'btc' | 'eth' | 'sol';
  /** On-chain token address (EVM contract / SPL mint); null for native coins.
   *  Used to match a held balance to this exact asset (never by coingeckoId,
   *  which collapses e.g. every BTC-flavoured chain onto one balance). */
  tokenAddress: string | null;
}

export interface GardenQuoteLeg {
  asset: string;
  amount: string; // atomic units
  displayAmount: string; // human-readable
  usdValue: string; // "$1234.56"
}

export interface GardenQuote {
  solverId: string;
  estimatedTime: number; // ms
  source: GardenQuoteLeg;
  destination: GardenQuoteLeg;
  fee: number;
  fixedFee: string;
  slippage: number;
}

export interface SwapResult {
  orderId: string;
  txHash?: string;
}

// ---- Pure helpers (unit-tested) -------------------------------------------

/** Parse the trading symbol from Garden's "AssetName:SYMBOL" name field. */
export function parseSymbol(name: string, fallbackId: string): string {
  const parts = name.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : fallbackId;
}

/** Parse a clean display name from "AssetName:SYMBOL". */
export function parseDisplayName(name: string): string {
  const parts = name.split(':');
  return parts.length > 1 ? parts.slice(0, -1).join(':') : name;
}

/** CoinGecko id for price lookup (mirrors GardenAsset.coingeckoId on iOS). */
export function coingeckoIdFor(symbol: string, id: string): string {
  switch (symbol.toUpperCase()) {
    case 'BTC':
    case 'SBTC':
    case 'CBTC':
      return 'bitcoin';
    case 'WBTC':
    case 'CBBTC':
      return 'wrapped-bitcoin';
    case 'ETH':
      return 'ethereum';
    case 'SOL':
      return 'solana';
    case 'USDC':
    case 'USDC2':
      return 'usd-coin';
    case 'USDT':
      return 'tether';
    case 'PATHUSD':
      return 'pathusd';
    default:
      return id.toLowerCase();
  }
}

/** Brand tint per asset symbol (mirrors GardenAsset.iconColor on iOS). */
export function colorFor(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case 'BTC':
    case 'WBTC':
    case 'CBBTC':
    case 'SBTC':
    case 'CBTC':
      return '#FF991A';
    case 'ETH':
      return '#7380BF';
    case 'SOL':
      return '#7333D9';
    case 'USDC':
    case 'USDC2':
      return '#2980D9';
    case 'USDT':
      return '#1AA68C';
    case 'ARB':
      return '#268CD1';
    case 'OP':
      return '#FA2626';
    default:
      return '#70707A';
  }
}

// Garden's v2 API identifies chains by NAME ("arbitrum", "base_sepolia",
// "bitcoin_testnet", "solana_testnet") — NOT the "evm:<chainId>" form the rest
// of this app matches against the portfolio (which keys EVM assets by their
// numeric chain id). Map each Garden EVM chain name → its numeric id so we can
// normalize to the canonical "evm:<id>" form. Covers both environments (mainnet
// bare names + testnet *_sepolia/_testnet). Chains the app doesn't support are
// intentionally absent — they normalize to themselves and match no balance.
const GARDEN_EVM_CHAIN_IDS: Record<string, string> = {
  // mainnet
  ethereum: '1',
  arbitrum: '42161',
  optimism: '10',
  base: '8453',
  polygon: '137',
  bnbchain: '56',
  tempo: '4217',
  // testnet
  ethereum_sepolia: '11155111',
  arbitrum_sepolia: '421614',
  base_sepolia: '84532',
  tempo_testnet: '42431',
};

/**
 * Normalize a Garden chain name to the canonical chain string the app matches
 * on: "bitcoin" for any Bitcoin-family chain, "solana" for any Solana-family
 * chain, "evm:<chainId>" for a known EVM chain, else the name unchanged. This is
 * what lets held-balance matching, chain classification, and address derivation
 * work against the portfolio (keyed by numeric EVM chain id).
 */
export function canonicalGardenChain(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'bitcoin' || c.startsWith('bitcoin')) return 'bitcoin';
  if (c === 'solana' || c.startsWith('solana')) return 'solana';
  const id = GARDEN_EVM_CHAIN_IDS[c];
  return id ? `evm:${id}` : chain;
}

/** Which chain's receive address this asset settles to. Accepts either the
 *  canonical "evm:<id>"/"bitcoin"/"solana" form or a raw Garden chain name. */
export function chainKindFor(chain: string): 'btc' | 'eth' | 'sol' {
  const c = canonicalGardenChain(chain);
  if (c.startsWith('evm:')) return 'eth';
  if (c === 'solana' || c.startsWith('solana')) return 'sol';
  return 'btc'; // bitcoin / bitcoin_testnet
}

/** True when the asset is the native coin of its chain (no chain badge needed). */
export function isNativeOnChain(a: GardenAsset): boolean {
  const s = a.symbol.toUpperCase();
  if (a.chain === 'bitcoin' || a.chain.startsWith('bitcoin')) return s === 'BTC' || s === 'SBTC' || s === 'CBTC';
  if (a.chain === 'solana' || a.chain.startsWith('solana')) return s === 'SOL';
  if (a.chain.startsWith('evm:')) return s === 'ETH';
  return false;
}

/** The small chain badge for an asset's token icon (bottom-right overlay), or
 *  null when it shouldn't show one. Shared by the token picker rows and the
 *  selected-token card so they match. Mirrors the Send picker rule: non-native
 *  tokens always show their chain; a native coin shows none on its HOME chain
 *  (BTC on Bitcoin, SOL on Solana, ETH on Ethereum) — but ETH is native gas on
 *  several chains, so ETH off Ethereum (Arbitrum/Base/Optimism) still shows it. */
export function chainBadgeFor(a: GardenAsset): { uri: string; fallbackColor: string } | null {
  if (!a.chainIcon || a.chainIcon === a.tokenIcon) return null;
  if (isNativeOnChain(a)) {
    const ethOffMainnet = a.symbol.toUpperCase() === 'ETH' && a.chain !== 'evm:1';
    if (!ethOffMainnet) return null;
  }
  return { uri: a.chainIcon, fallbackColor: a.colorHex };
}

/**
 * Resolve the Garden asset for a portfolio asset the user tapped "Swap" on.
 * Garden assets are keyed per (chain, token) — the same coingeckoId (e.g. USDC)
 * exists on several chains — so we prefer an exact (coingeckoId + EVM chain)
 * match and only fall back to coingeckoId alone when the asset's chain isn't a
 * Garden EVM chain (BTC/SOL) or Garden doesn't list it.
 */
export function findGardenAsset(
  assets: GardenAsset[],
  coingeckoId: string,
  evmChainId?: string,
): GardenAsset | undefined {
  if (evmChainId) {
    const exact = assets.find(
      (a) => a.coingeckoId === coingeckoId && a.chain === `evm:${evmChainId}`,
    );
    if (exact) return exact;
  }
  return assets.find((a) => a.coingeckoId === coingeckoId);
}

/** Map a raw Garden/wallet error string to a short, user-facing quote message. */
/** Atomic base-units → a trimmed human amount string (e.g. 50000 @ 8dp → "0.0005"). */
function humanizeAtomic(atomic: number, decimals?: number): string | null {
  if (!Number.isFinite(atomic) || decimals == null) return null;
  const v = atomic / Math.pow(10, decimals);
  return v.toFixed(Math.min(decimals, 8)).replace(/\.?0+$/, '') || '0';
}

export function friendlyQuoteError(
  raw: string,
  ctx?: { atomicAmount?: string; decimals?: number; symbol?: string },
): string {
  const s = raw.toLowerCase();
  // Garden reports amount bounds as e.g. "expected amount to be within the range
  // of 50000 to 1000000" (source base units), returned as a 400. Classify which
  // bound was crossed (using the entered amount) and humanize it — the generic
  // 400 branch below would otherwise mask this as "pair isn't available".
  const range = raw.match(/range of\s+(\d+)\s+to\s+(\d+)/i);
  if (range) {
    const minA = Number(range[1]);
    const maxA = Number(range[2]);
    const amt = ctx?.atomicAmount ? Number(ctx.atomicAmount) : NaN;
    const overMax = Number.isFinite(amt) && amt > maxA;
    const human = humanizeAtomic(overMax ? maxA : minA, ctx?.decimals);
    const sym = ctx?.symbol ? ` ${ctx.symbol}` : '';
    if (human) return overMax ? `Maximum is ${human}${sym}` : `Minimum is ${human}${sym}`;
    return overMax ? 'Amount exceeds the maximum' : 'Amount is below the minimum';
  }
  // Fallbacks for other phrasings.
  if (s.includes('minimum') || s.includes('min_amount') || s.includes('too low') || s.includes('too small'))
    return 'Amount is below the minimum';
  if (s.includes('maximum') || s.includes('max_amount') || s.includes('exceed') || s.includes('too high') || s.includes('too large'))
    return 'Amount exceeds the maximum';
  if (s.includes('network') || s.includes('timeout') || s.includes('fetch'))
    return 'Network error — check your connection';
  // Garden lists many assets, but only certain PAIRS have a solver/liquidity
  // route (esp. on testnet). A 400 with no min/max reason = no route for this
  // pair → "Route Unavailable" (accurate: the assets exist, the route doesn't).
  if (s.includes('400') || s.includes('bad request')) return 'Route Unavailable';
  return 'Route Unavailable';
}

/** Map a raw gardenSwap error to a friendly execution message. Only a few known
 *  cases get a specific message; EVERYTHING else (Garden/wallet/API/config/RPC
 *  errors) collapses to a generic network message — the raw Garden error is
 *  never surfaced to the user. */
export function friendlySwapError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('calldata')) return 'Route Unavailable';
  if (s.includes('quote expired')) return 'Quote expired — please try again.';
  if (s.includes('insufficient')) return 'Insufficient funds for this swap.';
  return 'Network issue — please try again.';
}

// ---- Network reads ---------------------------------------------------------

interface ChainsEnvelope {
  status: string;
  error?: string;
  result?: Array<{
    chain: string;
    name: string;
    icon?: string;
    is_active: boolean;
    assets: Array<{
      id: string;
      name: string;
      chain: string;
      icon?: string;
      decimals: number;
      price?: number;
      is_active: boolean;
      token?: { address?: string | null } | null;
    }>;
  }>;
}

/** Fetch + flatten all active swappable assets (one entry per chain/token). */
export async function fetchGardenAssets(): Promise<GardenAsset[]> {
  const res = await fetch(`${gardenBase()}/chains`, { headers: headers() });
  if (!res.ok) throw new Error(`Garden /chains HTTP ${res.status}`);
  const env = (await res.json()) as ChainsEnvelope;
  if (env.status !== 'Ok' || !env.result) throw new Error(env.error ?? 'Garden assets error');

  const seen = new Set<string>();
  const out: GardenAsset[] = [];
  for (const chain of env.result) {
    if (!chain.is_active) continue;
    for (const a of chain.assets) {
      if (!a.is_active || seen.has(a.id)) continue;
      seen.add(a.id);
      const symbol = parseSymbol(a.name, a.id);
      // Normalize Garden's chain name (e.g. "arbitrum_sepolia") to the canonical
      // "evm:<id>"/"bitcoin"/"solana" form the app matches on. The asset `id`
      // stays as Garden's original (it's what /quote + gardenSwap require).
      const canonicalChain = canonicalGardenChain(a.chain);
      out.push({
        id: a.id,
        symbol,
        displayName: parseDisplayName(a.name),
        chain: canonicalChain,
        chainName: chain.name ?? null,
        decimals: a.decimals,
        price: a.price ?? null,
        tokenIcon: a.icon ?? null,
        chainIcon: chain.icon ?? null,
        coingeckoId: coingeckoIdFor(symbol, a.id),
        colorHex: colorFor(symbol),
        chainKind: chainKindFor(canonicalChain),
        tokenAddress: a.token?.address ?? null,
      });
    }
  }
  return out;
}

interface QuoteEnvelope {
  status: string;
  error?: string;
  result?: Array<{
    solver_id: string;
    estimated_time: number;
    source: { asset: string; amount: string; display?: string; value?: string };
    destination: { asset: string; amount: string; display?: string; value?: string };
    fee: number;
    fixed_fee: string;
    slippage?: number;
  }>;
}

/** Fetch quotes for `from → to` of `atomicAmount` (source-asset base units). */
export async function fetchGardenQuote(
  fromId: string,
  toId: string,
  atomicAmount: string,
): Promise<GardenQuote[]> {
  const url = `${gardenBase()}/quote?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(
    toId,
  )}&from_amount=${encodeURIComponent(atomicAmount)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    // Keep the response body — Garden reports min/max amount violations as a
    // 400 whose body carries the reason; without it friendlyQuoteError can't
    // tell a min/max error apart from an unsupported pair.
    const body = await res.text().catch(() => '');
    throw new Error(`Garden /quote HTTP ${res.status} ${body}`);
  }
  const env = (await res.json()) as QuoteEnvelope;
  if (env.status !== 'Ok' || !env.result) throw new Error(env.error ?? 'Garden quote error');
  return env.result.map((q) => ({
    solverId: q.solver_id,
    estimatedTime: q.estimated_time,
    source: {
      asset: q.source.asset,
      amount: q.source.amount,
      displayAmount: q.source.display ?? '',
      usdValue: q.source.value ?? '',
    },
    destination: {
      asset: q.destination.asset,
      amount: q.destination.amount,
      displayAmount: q.destination.display ?? '',
      usdValue: q.destination.value ?? '',
    },
    fee: q.fee,
    fixedFee: q.fixed_fee,
    slippage: q.slippage ?? 0,
  }));
}

// ---- Execution (through the Rust core) ------------------------------------

/** Source/destination receive addresses for the swap. Prefer the SAME address the
 *  app already displays in Receive (cached in the session) so swap output lands on
 *  the address the user sees.
 *
 *  ⚠️ Critical for BTC: `wallet.btcReceiveAddress()` ADVANCES BDK's revealed index
 *  (not idempotent) — calling it here would mint a fresh address different from the
 *  one shown in Receive, so a swap's BTC would land on an unexpected (though still
 *  wallet-owned) address. We reuse the cached receive address instead, and fall
 *  back to `btcPeekAddress(account, 0)` which derives index 0 WITHOUT advancing. */
export async function addressFor(
  wallet: WalletInterface,
  kind: 'btc' | 'eth' | 'sol',
): Promise<string> {
  const account = getActiveAccount();
  const cached = useSession.getState().addresses;
  if (kind === 'btc') return cached?.btc ?? (await wallet.btcPeekAddress(account, 0));
  if (kind === 'eth') return cached?.eth ?? (await wallet.evmAddress(account));
  return cached?.sol ?? (await wallet.solAddress(account));
}

/** Execute a swap: derives addresses, signs + submits via the Rust core. */
export async function executeSwap(
  wallet: WalletInterface,
  args: { from: GardenAsset; to: GardenAsset; amountHuman: string; quote: GardenQuote },
): Promise<SwapResult> {
  const atomicSend = toBaseUnits(args.amountHuman, args.from.decimals).toString();
  const [sourceAddress, destinationAddress] = await Promise.all([
    addressFor(wallet, args.from.chainKind),
    addressFor(wallet, args.to.chainKind),
  ]);
  const result = await wallet.gardenSwap(
    args.from.id,
    args.to.id,
    atomicSend,
    args.quote.destination.amount, // already atomic
    args.quote.solverId,
    sourceAddress,
    destinationAddress,
  );
  return { orderId: result.orderId, txHash: result.txHash ?? undefined };
}

/** Garden order-explorer URL for a swap order, on the active environment. */
export function gardenOrderUrl(orderId: string): string {
  const base =
    getActiveEnvironment() === 'testnet'
      ? 'https://testnet-explorer.garden.finance'
      : 'https://explorer.garden.finance';
  return `${base}/order/${orderId}`;
}

/** Build a pending `swapped` Activity item from a completed swap submission. */
export function swapActivityItem(args: {
  orderId: string;
  from: GardenAsset;
  to: GardenAsset;
  quote: GardenQuote;
  /** Human amount paid (the source side the user entered). */
  amountHuman: string;
  /** On-chain hash of the source-leg transfer — used to hide the duplicate
   *  "sent" row the chain scan would otherwise produce for it. */
  sourceTxId?: string;
}): ActivityItem {
  const recv = args.quote.destination.displayAmount || '0';
  const usd = args.quote.destination.usdValue || '';
  const paid = args.amountHuman || '0';
  return {
    id: args.orderId,
    // Primary = destination (the +received asset); its icon sits in front.
    symbol: args.to.symbol,
    coingeckoId: args.to.coingeckoId,
    colorHex: args.to.colorHex,
    type: 'swapped',
    label: 'via Garden Finance',
    amountText: `+${recv} ${args.to.symbol}`, // destination (+)
    usdText: usd ? (usd.startsWith('$') ? `+${usd}` : usd) : '',
    // Source (the −paid asset) → second line + the icon behind the destination.
    secondaryAmountText: `-${paid} ${args.from.symbol}`,
    fromSymbol: args.from.symbol,
    fromCoingeckoId: args.from.coingeckoId,
    fromColorHex: args.from.colorHex,
    sourceTxId: args.sourceTxId,
    timestamp: Math.floor(Date.now() / 1000),
    status: 'pending',
    explorerUrl: gardenOrderUrl(args.orderId),
    network: args.to.chainName ?? undefined,
  };
}

/** Human amount → source-asset atomic string (reuses the tested format helper). */
export function toAtomic(amountHuman: string, decimals: number): string {
  try {
    return toBaseUnits(amountHuman, decimals).toString();
  } catch {
    return '';
  }
}
