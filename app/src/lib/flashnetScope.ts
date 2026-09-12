//! Which Flashnet Orchestra routes this wallet can actually take.
//
// Orchestra routes between 23 chains, but a route is only usable here if we can
// do our half of it. Orchestra never holds the user's keys: it hands back a
// deposit address, and the SOURCE leg is an ordinary transfer that this wallet
// signs and broadcasts itself. So the scope is set by our own capabilities, not
// by theirs:
//
//  • A SOURCE chain needs a key we can sign with AND a deposit proof `submit`
//    accepts. That is every EVM chain we support, plus Solana.
//  • A DESTINATION chain needs nothing but an address to be paid at, since no
//    signing happens on that side. That adds Bitcoin.
//
// Bitcoin is deliberately absent as a SOURCE. `submit` wants `bitcoinTxid` AND
// `bitcoinVout` for a Bitcoin deposit, and `sendBtc` returns only a txid — the
// vout would have to be recovered by re-fetching the transaction and matching
// the output that pays the deposit address. Guessing it would strand the
// deposit, so the pair is left out until that lookup exists.
//
// Lightning and Spark are absent for the simpler reason that this wallet cannot
// pay or receive on them at all.
import type { PortfolioAsset } from '../bridge/portfolio';

/** A Flashnet chain we can sign a deposit on, and how it maps onto our wallet. */
export const SOURCE_CHAINS: Record<string, { family: 'evm' | 'sol'; evmChainId?: bigint }> = {
  ethereum: { family: 'evm', evmChainId: 1n },
  base: { family: 'evm', evmChainId: 8453n },
  arbitrum: { family: 'evm', evmChainId: 42161n },
  optimism: { family: 'evm', evmChainId: 10n },
  polygon: { family: 'evm', evmChainId: 137n },
  bsc: { family: 'evm', evmChainId: 56n },
  avalanche: { family: 'evm', evmChainId: 43114n },
  solana: { family: 'sol' },
};

/** Chains we hold a receive address for. Signing is not required to be paid. */
export const DEST_CHAINS: Record<string, 'evm' | 'sol' | 'btc'> = {
  ...Object.fromEntries(Object.entries(SOURCE_CHAINS).map(([k, v]) => [k, v.family])),
  bitcoin: 'btc',
};

/** One end of a route: a chain, an asset, and what it takes to move it. */
export interface SwapAsset {
  /** Orchestra's chain identifier — the string the API expects. */
  chain: string;
  /** Orchestra's asset identifier — the string the API expects. */
  asset: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Token contract / mint, or null for a chain's native coin. */
  contractAddress: string | null;
  chainName: string;
}

export interface SwapRoute {
  source: SwapAsset;
  destination: SwapAsset;
  /** Whether the destination amount can be named instead of estimated. */
  exactOutEligible: boolean;
}

/** The API's own route shape, narrowed to the fields we read. */
export interface RawRouteSide {
  chain: string;
  asset: string;
  assetDisplaySymbol?: string;
  assetDisplayName?: string;
  chainDisplayName?: string;
  decimals: number;
  contractAddress: string | null;
}
export interface RawRoute {
  sourceChain: string;
  destinationChain: string;
  exactOutEligible?: boolean;
  source: RawRouteSide;
  destination: RawRouteSide;
}

/** `base:USDC` — stable across a re-fetch, so it keys a dropdown selection. */
export function assetKey(a: { chain: string; asset: string }): string {
  return `${a.chain}:${a.asset}`;
}

function side(s: RawRouteSide): SwapAsset {
  return {
    chain: s.chain,
    asset: s.asset,
    symbol: s.assetDisplaySymbol || s.asset,
    name: s.assetDisplayName || s.asset,
    decimals: s.decimals,
    contractAddress: s.contractAddress,
    chainName: s.chainDisplayName || s.chain,
  };
}

/**
 * The routes we can take, out of everything the API offers.
 *
 * `/routes` is ~3MB and grows as Flashnet adds chains, so it is narrowed here
 * and only the narrowed set is cached — the docs are explicit that the table
 * must be read at runtime rather than copied into the app, and this keeps that
 * true without carrying the other 3,800 routes around on a phone.
 */
export function inScope(raw: RawRoute[]): SwapRoute[] {
  const out: SwapRoute[] = [];
  for (const r of raw) {
    if (!SOURCE_CHAINS[r.sourceChain] || !DEST_CHAINS[r.destinationChain]) continue;
    if (!r.source || !r.destination) continue;
    out.push({
      source: side(r.source),
      destination: side(r.destination),
      exactOutEligible: !!r.exactOutEligible,
    });
  }
  return out;
}

/** Distinct source assets, ordered by chain then symbol. */
export function sourceAssets(routes: SwapRoute[]): SwapAsset[] {
  return distinct(routes.map((r) => r.source));
}

/** Where a given source can go. Empty means the pair is not offered. */
export function destinationsFor(routes: SwapRoute[], source: SwapAsset | null): SwapAsset[] {
  if (!source) return [];
  const k = assetKey(source);
  return distinct(routes.filter((r) => assetKey(r.source) === k).map((r) => r.destination));
}

export function findRoute(
  routes: SwapRoute[],
  source: SwapAsset | null,
  destination: SwapAsset | null,
): SwapRoute | undefined {
  if (!source || !destination) return undefined;
  const s = assetKey(source);
  const d = assetKey(destination);
  return routes.find((r) => assetKey(r.source) === s && assetKey(r.destination) === d);
}

function distinct(list: SwapAsset[]): SwapAsset[] {
  const by = new Map<string, SwapAsset>();
  for (const a of list) if (!by.has(assetKey(a))) by.set(assetKey(a), a);
  return Array.from(by.values()).sort(
    (a, b) => a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol),
  );
}

/** The address of ours that receives on a destination chain. */
export function recipientFor(
  chain: string,
  addresses: { btc: string; eth: string; sol: string } | null,
): string | undefined {
  if (!addresses) return undefined;
  const fam = DEST_CHAINS[chain];
  if (fam === 'btc') return addresses.btc;
  if (fam === 'sol') return addresses.sol;
  if (fam === 'evm') return addresses.eth;
  return undefined;
}

/**
 * The holding that funds a source asset, so the composer can show a balance and
 * refuse a swap the wallet cannot cover.
 *
 * Matched on CONTRACT (or mint), never on symbol: a symbol is attacker-chosen
 * text and several chains carry more than one thing calling itself USDC.
 */
export function holdingFor(a: SwapAsset, assets: PortfolioAsset[]): PortfolioAsset | undefined {
  const spec = SOURCE_CHAINS[a.chain];
  if (!spec) return undefined;
  const want = a.contractAddress?.toLowerCase();

  if (spec.family === 'sol') {
    return assets.find((x) =>
      x.chain === 'solana' && (want ? x.tokenMint?.toLowerCase() === want : !x.tokenMint),
    );
  }
  return assets.find(
    (x) =>
      x.chain === 'ethereum' &&
      x.evmChainId === spec.evmChainId &&
      (want ? x.tokenContract?.toLowerCase() === want : !x.tokenContract),
  );
}
