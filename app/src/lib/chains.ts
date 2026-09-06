// ─────────────────────────────────────────────────────────────────────────────
//  THE chain registry — one entry per EVM chain, one source of truth.
//
//  Before this file the same chain was declared in EIGHT places: the managed
//  chain configs, the testnet-id set, display names, native-coin metadata,
//  explorers, Blockscout bases, and the Token API slug map. Arc was added to
//  four of them and silently disabled by the fifth, because the environment
//  classifier didn't know about it. Everything below is DERIVED from this list,
//  so adding a chain is one entry and cannot half-land.
//
//  Pure module — no native imports — so it stays unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export type ChainEnvironment = 'testnet' | 'mainnet';

export interface ChainDef {
  chainId: bigint;
  /** Display name, shown on activity rows and the networks screen. */
  name: string;
  environment: ChainEnvironment;
  rpcUrl: string;
  explorerUrl: string;
  /** Native gas coin. On Arc this is USDC; on Tempo there is no native coin. */
  nativeSymbol: string;
  nativeDecimals: number;
  /** Coingecko id + colour for the native coin, when it has a tracked price. */
  nativeCoingeckoId?: string;
  /** Display name of the native coin, when it differs from the chain's own name
   *  (Arc's native coin IS USDC, so its asset row should read "USD Coin", not
   *  "Arc Testnet"). */
  nativeName?: string;
  nativeColorHex?: string;
  /** False when the chain has no native gas coin worth showing (Tempo). */
  hasNativeAsset: boolean;
  /** The Graph Token API network slug, when it indexes this chain. */
  tokenApiNetwork?: string;
  /** Our own subgraph, when we index this chain ourselves (Arc). */
  subgraphEnv?: 'arc';
  /** Blockscout Etherscan-compatible API base, when one exists. */
  blockscoutBase?: string;
  /** CoinGecko "asset platform" slug, for resolving an ERC-20 by contract. */
  coingeckoPlatform?: string;
  /**
   * Circle domain id — shared by CCTP and Gateway. Present only where Circle
   * supports the chain; absent means no unified balance and no cross-chain
   * settlement. Verified against GET /v1/info on the Gateway API.
   */
  circleDomain?: number;
  /** USDC contract, where Circle issues it natively. */
  usdc?: `0x${string}`;
}

const ETH = { nativeCoingeckoId: 'ethereum', nativeColorHex: '#627EEA' } as const;

export const CHAINS: ChainDef[] = [
  // ── Mainnets ───────────────────────────────────────────────────────────────
  { chainId: 1n, name: 'Ethereum', environment: 'mainnet',
    rpcUrl: 'https://ethereum-rpc.publicnode.com', explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    tokenApiNetwork: 'mainnet', blockscoutBase: 'https://eth.blockscout.com',
    coingeckoPlatform: 'ethereum',
    circleDomain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },

  { chainId: 42161n, name: 'Arbitrum One', environment: 'mainnet',
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com', explorerUrl: 'https://arbiscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    tokenApiNetwork: 'arbitrum-one', blockscoutBase: 'https://arbitrum.blockscout.com',
    coingeckoPlatform: 'arbitrum-one',
    circleDomain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },

  { chainId: 10n, name: 'Optimism', environment: 'mainnet',
    rpcUrl: 'https://optimism-rpc.publicnode.com', explorerUrl: 'https://optimistic.etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    tokenApiNetwork: 'optimism', blockscoutBase: 'https://optimism.blockscout.com',
    coingeckoPlatform: 'optimistic-ethereum',
    circleDomain: 2, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },

  { chainId: 8453n, name: 'Base', environment: 'mainnet',
    rpcUrl: 'https://base-rpc.publicnode.com', explorerUrl: 'https://basescan.org',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    tokenApiNetwork: 'base', blockscoutBase: 'https://base.blockscout.com',
    coingeckoPlatform: 'base',
    circleDomain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },

  { chainId: 137n, name: 'Polygon', environment: 'mainnet',
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com', explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'POL', nativeDecimals: 18, nativeCoingeckoId: 'matic-network',
    nativeColorHex: '#8247E5', hasNativeAsset: true,
    tokenApiNetwork: 'polygon', blockscoutBase: 'https://polygon.blockscout.com',
    coingeckoPlatform: 'polygon-pos',
    circleDomain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },

  { chainId: 56n, name: 'BNB Smart Chain', environment: 'mainnet',
    rpcUrl: 'https://bsc-rpc.publicnode.com', explorerUrl: 'https://bscscan.com',
    nativeSymbol: 'BNB', nativeDecimals: 18, nativeCoingeckoId: 'binancecoin',
    nativeColorHex: '#F3BA2F', hasNativeAsset: true, tokenApiNetwork: 'bsc',
    coingeckoPlatform: 'binance-smart-chain' },

  { chainId: 43114n, name: 'Avalanche C-Chain', environment: 'mainnet',
    rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com', explorerUrl: 'https://snowtrace.io',
    nativeSymbol: 'AVAX', nativeDecimals: 18, nativeCoingeckoId: 'avalanche-2',
    nativeColorHex: '#E84142', hasNativeAsset: true, tokenApiNetwork: 'avalanche',
    coingeckoPlatform: 'avalanche',
    circleDomain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },

  // Tempo: stablecoin payments chain with NO native gas coin. eth_getBalance
  // returns a placeholder, so its native row must stay hidden.
  { chainId: 4217n, name: 'Tempo', environment: 'mainnet',
    rpcUrl: 'https://rpc.tempo.xyz', explorerUrl: 'https://explore.tempo.xyz',
    nativeSymbol: 'USD', nativeDecimals: 18, hasNativeAsset: false },

  // ── Testnets ───────────────────────────────────────────────────────────────
  { chainId: 11155111n, name: 'Sepolia', environment: 'testnet',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://eth-sepolia.blockscout.com',
    circleDomain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },

  { chainId: 421614n, name: 'Arbitrum Sepolia', environment: 'testnet',
    rpcUrl: 'https://arbitrum-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.arbiscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://arbitrum-sepolia.blockscout.com',
    circleDomain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },

  { chainId: 84532n, name: 'Base Sepolia', environment: 'testnet',
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.basescan.org',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://base-sepolia.blockscout.com',
    circleDomain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },

  // Arc: like Tempo it's a stablecoin chain, but UNLIKE Tempo its native coin is
  // real — USDC itself, at 18dp, which is also the gas token. Native rows are
  // correct here. The Graph's Token API does not index Arc, so history comes
  // from our own subgraph.
  { chainId: 5042002n, name: 'Arc Testnet', environment: 'testnet',
    rpcUrl: 'https://rpc.testnet.arc.io', explorerUrl: 'https://testnet.arcscan.app',
    nativeSymbol: 'USDC', nativeDecimals: 18, nativeCoingeckoId: 'usd-coin',
    nativeName: 'USD Coin',
    nativeColorHex: '#2980D9', hasNativeAsset: true, subgraphEnv: 'arc',
    circleDomain: 26, usdc: '0x3600000000000000000000000000000000000000' },

  { chainId: 42431n, name: 'Tempo Testnet', environment: 'testnet',
    rpcUrl: 'https://rpc.moderato.tempo.xyz', explorerUrl: 'https://explore.testnet.tempo.xyz',
    nativeSymbol: 'USD', nativeDecimals: 18, hasNativeAsset: false },
];

// ── Derived lookups. Nothing below is hand-maintained. ───────────────────────

const BY_ID = new Map(CHAINS.map((c) => [c.chainId.toString(), c]));

export const chainById = (chainId: bigint): ChainDef | undefined => BY_ID.get(chainId.toString());
export const chainsForEnvironment = (env: ChainEnvironment): ChainDef[] =>
  CHAINS.filter((c) => c.environment === env);
export const chainIdsForEnvironment = (env: ChainEnvironment): bigint[] =>
  chainsForEnvironment(env).map((c) => c.chainId);

export const chainName = (chainId: bigint): string =>
  chainById(chainId)?.name ?? `Chain ${chainId.toString()}`;
export const chainExplorer = (chainId: bigint): string =>
  chainById(chainId)?.explorerUrl ?? 'https://etherscan.io';
export const chainBlockscout = (chainId: bigint): string | undefined =>
  chainById(chainId)?.blockscoutBase;
export const chainTokenApiNetwork = (chainId: bigint): string | undefined =>
  chainById(chainId)?.tokenApiNetwork;
export const chainHasOwnSubgraph = (chainId: bigint): boolean =>
  chainById(chainId)?.subgraphEnv !== undefined;
export const chainHasNativeAsset = (chainId: bigint): boolean =>
  chainById(chainId)?.hasNativeAsset ?? true;
export const chainCoingeckoPlatform = (chainId: bigint): string | undefined =>
  chainById(chainId)?.coingeckoPlatform;
export const chainCircleDomain = (chainId: bigint): number | undefined =>
  chainById(chainId)?.circleDomain;
export const chainUsdc = (chainId: bigint): `0x${string}` | undefined =>
  chainById(chainId)?.usdc;
/** Chains in this environment that Circle supports (unified balance + CCTP). */
export const circleChainsForEnvironment = (env: ChainEnvironment): ChainDef[] =>
  chainsForEnvironment(env).filter((c) => c.circleDomain !== undefined && c.usdc);

/** Native-coin display metadata, falling back to ETH for an unknown chain. */
export function chainNativeMeta(chainId: bigint): { symbol: string; coingeckoId: string; colorHex: string } {
  const c = chainById(chainId);
  return {
    symbol: c?.nativeSymbol ?? 'ETH',
    coingeckoId: c?.nativeCoingeckoId ?? 'ethereum',
    colorHex: c?.nativeColorHex ?? '#627EEA',
  };
}
