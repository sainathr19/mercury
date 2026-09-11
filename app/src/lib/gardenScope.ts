//! Which Garden assets this wallet can actually swap.
//
// Garden's testnet catalog lists 47 assets across 21 chains. We can sign for
// three families — EVM, Bitcoin and Solana — so most of that catalog is
// unreachable for us, and offering it would mean quoting routes the wallet
// cannot then fund. Same discipline as `flashnetScope.ts`: the scope is OUR
// signing capability, not the provider's menu.
//
// Verified against the live catalog rather than assumed, and two of those checks
// changed the answer:
//
//  • Garden's Bitcoin is TESTNET4 (`explorer_url` is mempool.space/testnet4/),
//    which is the network this wallet already uses. Had it been testnet3, every
//    BTC route would have been out of scope.
//  • Garden's chain is LABELLED "Solana Testnet" with id `solana:103`, but its
//    explorer says `cluster=devnet`. It is devnet, which is also ours. Trusting
//    the label would have wrongly excluded Solana.
import { chainById, type ChainDef, type ChainEnvironment } from './chains';
import {
  displayNameOf,
  symbolOf,
  type GardenAsset,
} from '../bridge/garden';

/** The signing families this wallet has keys and transfer code for. */
export type Family = 'evm' | 'btc' | 'sol';

export interface ParsedChain {
  family: Family;
  /** Set for EVM only. */
  chainId?: bigint;
}

/**
 * Garden's namespaced chain key → a family we can sign for.
 *
 * Formats seen live: `evm:84532`, `bitcoin`, `solana:103`, `starknet:…`,
 * `tron:…`, `spark`, `xrpl`, `litecoin`, `alpen_signet`. Anything not listed
 * here is deliberately unsupported rather than guessed at.
 */
export function parseChain(chainId: string): ParsedChain | undefined {
  if (chainId === 'bitcoin') return { family: 'btc' };
  // Garden's only Solana network on testnet is devnet (see the header note).
  if (chainId === 'solana:103') return { family: 'sol' };
  const evm = /^evm:(\d+)$/.exec(chainId);
  if (evm) return { family: 'evm', chainId: BigInt(evm[1]) };
  return undefined;
}

export interface SwapAsset {
  /** Garden's identifier, e.g. `base_sepolia:wbtc`. The API's own key. */
  id: string;
  symbol: string;
  name: string;
  family: Family;
  /** EVM only. */
  evmChainId?: bigint;
  /** Display name of the network, from OUR registry where we have one. */
  chainName: string;
  decimals: number;
  /** Smallest units. The API enforces both, so the UI states them. */
  minAmount: string;
  maxAmount: string;
  /** CoinGecko id, so `CryptoIcon` can resolve bundled art before any URL. */
  coingeckoId?: string;
  /** Garden's CDN icon — the fallback when we ship no art for the id. */
  iconUrl?: string;
  /** The contract to fund on an EVM/Solana source. Absent on UTXO chains, where
   *  the order response carries a per-order address instead. */
  htlcAddress?: string;
  htlcSchema?: string;
  /** The token contract, absent for a chain's native coin. */
  tokenAddress?: string;
}

/**
 * Can this wallet fund a swap out of this asset?
 *
 * Everything in scope can RECEIVE — a destination only needs an address. Funding
 * is the narrower question, and the honest answer today is "not the families we
 * have no HTLC path for".
 */
export function inScope(asset: GardenAsset, env: ChainEnvironment): boolean {
  if (!asset.is_active) return false;
  const parsed = parseChain(asset.chain_id);
  if (!parsed) return false;
  if (parsed.family === 'evm') {
    // The chain has to be one we know AND in the right environment: Garden's
    // testnet catalog and our mainnet registry share chain ids for nothing, but
    // relying on that coincidence rather than checking it would be careless.
    const chain = chainById(parsed.chainId!);
    return !!chain && chain.environment === env;
  }
  // BTC and SOL have one network per environment in this wallet, and Garden's
  // testnet catalog only carries the test ones.
  return env === 'testnet';
}

/** Network label, preferring our own registry so it matches the rest of the app. */
function chainLabel(asset: GardenAsset, parsed: ParsedChain): string {
  if (parsed.family === 'evm') {
    const chain: ChainDef | undefined = chainById(parsed.chainId!);
    if (chain) return chain.name;
  }
  if (parsed.family === 'btc') return 'Bitcoin Testnet4';
  if (parsed.family === 'sol') return 'Solana Devnet';
  return asset.chain;
}

/** Everything swappable, normalised for the UI. */
export function scopedAssets(assets: GardenAsset[], env: ChainEnvironment): SwapAsset[] {
  const out: SwapAsset[] = [];
  for (const a of assets) {
    if (!inScope(a, env)) continue;
    const parsed = parseChain(a.chain_id)!;
    out.push({
      id: a.id,
      symbol: symbolOf(a),
      name: displayNameOf(a),
      family: parsed.family,
      evmChainId: parsed.chainId,
      chainName: chainLabel(a, parsed),
      decimals: a.decimals,
      minAmount: a.min_amount,
      maxAmount: a.max_amount,
      coingeckoId: a.token_ids?.coingecko,
      iconUrl: a.icon,
      htlcAddress: a.htlc?.address,
      htlcSchema: a.htlc?.schema ?? undefined,
      tokenAddress: a.token?.address,
    });
  }
  // Stable, human ordering: by network, then by symbol. The catalog's own order
  // is alphabetical by id, which scatters a chain's assets across the list.
  return out.sort((x, y) => x.chainName.localeCompare(y.chainName) || x.symbol.localeCompare(y.symbol));
}

/** Which of our addresses receives this asset. */
export function recipientFor(
  asset: SwapAsset,
  addresses: { eth?: string; btc?: string; sol?: string },
): string | undefined {
  if (asset.family === 'evm') return addresses.eth;
  if (asset.family === 'btc') return addresses.btc;
  return addresses.sol;
}

/**
 * A same-asset "swap" is not a swap.
 *
 * Garden would reject it, but catching it here keeps a pointless round trip and
 * a confusing error off the screen.
 */
export const isSamePair = (a: SwapAsset, b: SwapAsset): boolean => a.id === b.id;

/** Everything that could receive `source`. Garden decides the real answer at
 *  quote time; this only removes the obviously impossible. */
export const destinationsFor = (source: SwapAsset, all: SwapAsset[]): SwapAsset[] =>
  all.filter((a) => !isSamePair(source, a));

/**
 * The Garden asset matching a holding the wallet already knows about.
 *
 * Matched on CONTRACT (or mint), never on symbol: Garden's testnet catalog
 * carries four different USDCs and three different WBTCs, and picking by ticker
 * would route a swap out of a token the user does not hold.
 */
export function matchGardenAsset(
  holding: {
    chain: 'bitcoin' | 'ethereum' | 'solana';
    evmChainId?: bigint;
    tokenContract?: string;
    tokenMint?: string;
  },
  scoped: SwapAsset[],
): SwapAsset | undefined {
  if (holding.chain === 'bitcoin') return scoped.find((a) => a.family === 'btc');
  if (holding.chain === 'solana') {
    const mint = holding.tokenMint?.toLowerCase();
    return scoped.find(
      (a) => a.family === 'sol' && (mint ? a.tokenAddress?.toLowerCase() === mint : !a.tokenAddress),
    );
  }
  if (holding.evmChainId === undefined) return undefined;
  const contract = holding.tokenContract?.toLowerCase();
  return scoped.find(
    (a) =>
      a.family === 'evm' &&
      a.evmChainId === holding.evmChainId &&
      (contract ? a.tokenAddress?.toLowerCase() === contract : !a.tokenAddress),
  );
}
