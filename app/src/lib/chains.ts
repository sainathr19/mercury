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

export interface TokenDef {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  coingeckoId: string;
  colorHex: string;
}

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
  /** Uniswap V2-compatible deployment, where this chain has one. */
  uniswap?: { router: `0x${string}`; factory: `0x${string}` };
  /** ERC-20s this wallet can trade on this chain. The native coin is described
   *  by the `native*` fields above; this is everything else. */
  tokens?: TokenDef[];
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

  // Added after verifying each one against the chain itself: the RPC answers,
  // eth_chainId matches the id claimed here, and where a Circle domain is set
  // the USDC contract was read on-chain and reports symbol USDC at 6 decimals.
  //
  // A Circle domain is set ONLY alongside a verified USDC. Sonic (13), Sei (16)
  // and HyperEVM (19) are Gateway domains whose token could not be verified from
  // here, so they are listed as ordinary chains: a domain without a token is a
  // destination the app would offer and then fail to deliver to, which is the
  // bug that made Arbitrum Sepolia undeliverable for a day.
  //
  // Celo Alfajores is absent because no RPC answered — a chain we cannot read is
  // not a chain we can add.

  { chainId: 998n, name: 'HyperEVM Testnet', environment: 'testnet',
    rpcUrl: 'https://rpc.hyperliquid-testnet.xyz/evm', explorerUrl: 'https://testnet.purrsec.com',
    nativeSymbol: 'HYPE', nativeDecimals: 18, nativeColorHex: '#97FCE4', hasNativeAsset: true },

  { chainId: 1328n, name: 'Sei Atlantic', environment: 'testnet',
    rpcUrl: 'https://evm-rpc-testnet.sei-apis.com', explorerUrl: 'https://seitrace.com',
    nativeSymbol: 'SEI', nativeDecimals: 18, nativeCoingeckoId: 'sei-network', nativeColorHex: '#9C1C1C', hasNativeAsset: true },

  { chainId: 4801n, name: 'World Chain Sepolia', environment: 'testnet',
    rpcUrl: 'https://worldchain-sepolia.g.alchemy.com/public', explorerUrl: 'https://worldchain-sepolia.explorer.alchemy.com',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    circleDomain: 14, usdc: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88' },

  { chainId: 14601n, name: 'Sonic Testnet', environment: 'testnet',
    rpcUrl: 'https://rpc.testnet.soniclabs.com', explorerUrl: 'https://testnet.sonicscan.org',
    nativeSymbol: 'S', nativeDecimals: 18, nativeCoingeckoId: 'sonic-3', nativeColorHex: '#FE9A4C', hasNativeAsset: true },

  { chainId: 1301n, name: 'Unichain Sepolia', environment: 'testnet',
    rpcUrl: 'https://unichain-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.uniscan.xyz',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://unichain-sepolia.blockscout.com',
    circleDomain: 10, usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F' },

  { chainId: 80002n, name: 'Polygon Amoy', environment: 'testnet',
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com', explorerUrl: 'https://amoy.polygonscan.com',
    nativeSymbol: 'POL', nativeDecimals: 18, nativeCoingeckoId: 'matic-network', nativeColorHex: '#8247E5', hasNativeAsset: true,
    circleDomain: 7, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' },

  { chainId: 11155420n, name: 'OP Sepolia', environment: 'testnet',
    rpcUrl: 'https://optimism-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia-optimism.etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://testnet-explorer.optimism.io',
    circleDomain: 2, usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' },

  { chainId: 43113n, name: 'Avalanche Fuji', environment: 'testnet',
    rpcUrl: 'https://avalanche-fuji-c-chain-rpc.publicnode.com', explorerUrl: 'https://testnet.snowtrace.io',
    nativeSymbol: 'AVAX', nativeDecimals: 18, nativeCoingeckoId: 'avalanche-2', nativeColorHex: '#E84142', hasNativeAsset: true,
    circleDomain: 1, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' },

  { chainId: 168587773n, name: 'Blast Sepolia', environment: 'testnet',
    rpcUrl: 'https://sepolia.blast.io', explorerUrl: 'https://testnet.blastscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://blast-sepolia.blockscout.com' },

  { chainId: 97n, name: 'BNB Testnet', environment: 'testnet',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com', explorerUrl: 'https://testnet.bscscan.com',
    nativeSymbol: 'tBNB', nativeDecimals: 18, nativeCoingeckoId: 'binancecoin', nativeColorHex: '#F3BA2F', hasNativeAsset: true },

  { chainId: 10200n, name: 'Gnosis Chiado', environment: 'testnet',
    rpcUrl: 'https://gnosis-chiado-rpc.publicnode.com', explorerUrl: 'https://gnosis-chiado.blockscout.com',
    nativeSymbol: 'XDAI', nativeDecimals: 18, nativeCoingeckoId: 'xdai', nativeColorHex: '#04795B', hasNativeAsset: true,
    blockscoutBase: 'https://gnosis-chiado.blockscout.com' },

  { chainId: 763373n, name: 'Ink Sepolia', environment: 'testnet',
    rpcUrl: 'https://rpc-gel-sepolia.inkonchain.com', explorerUrl: 'https://explorer-sepolia.inkonchain.com',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://explorer-sepolia.inkonchain.com' },

  { chainId: 59141n, name: 'Linea Sepolia', environment: 'testnet',
    rpcUrl: 'https://linea-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.lineascan.build',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true },

  { chainId: 5003n, name: 'Mantle Sepolia', environment: 'testnet',
    rpcUrl: 'https://rpc.sepolia.mantle.xyz', explorerUrl: 'https://sepolia.mantlescan.xyz',
    nativeSymbol: 'MNT', nativeDecimals: 18, nativeCoingeckoId: 'mantle', nativeColorHex: '#65B3AE', hasNativeAsset: true },

  { chainId: 10143n, name: 'Monad Testnet', environment: 'testnet',
    rpcUrl: 'https://testnet-rpc.monad.xyz', explorerUrl: 'https://testnet.monadexplorer.com',
    nativeSymbol: 'MON', nativeDecimals: 18, nativeColorHex: '#836EF9', hasNativeAsset: true },

  { chainId: 534351n, name: 'Scroll Sepolia', environment: 'testnet',
    rpcUrl: 'https://scroll-sepolia-rpc.publicnode.com', explorerUrl: 'https://sepolia.scrollscan.com',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true,
    blockscoutBase: 'https://scroll-sepolia.blockscout.com' },

  { chainId: 300n, name: 'zkSync Sepolia', environment: 'testnet',
    rpcUrl: 'https://sepolia.era.zksync.dev', explorerUrl: 'https://sepolia.explorer.zksync.io',
    nativeSymbol: 'ETH', nativeDecimals: 18, ...ETH, hasNativeAsset: true },

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
    circleDomain: 26, usdc: '0x3600000000000000000000000000000000000000',
    // Uniswap V2 on Arc testnet. Re-verified on-chain: the router reports this
    // factory, and factory.getPair(USDC, EURC) resolves to a funded pool.
    // NOTE: router.WETH() points at an address with NO CODE, so every ETH-path
    // helper (swapExactETHForTokens et al) reverts here — token-to-token only.
    uniswap: {
      router: '0xe27d5d256b370604f1ff060fb489c6a8e3f8a6d9',
      factory: '0x7483847d46db2920dd64efa676cf72dcf765814f',
    },
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: '0x3600000000000000000000000000000000000000',
        decimals: 6, coingeckoId: 'usd-coin', colorHex: '#2775CA' },
      { symbol: 'EURC', name: 'Euro Coin', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
        decimals: 6, coingeckoId: 'euro-coin', colorHex: '#1AA68C' },
    ] },

  { chainId: 42431n, name: 'Tempo Testnet', environment: 'testnet',
    rpcUrl: 'https://rpc.moderato.tempo.xyz', explorerUrl: 'https://explore.testnet.tempo.xyz',
    nativeSymbol: 'USD', nativeDecimals: 18, hasNativeAsset: false },
];

/**
 * Circle Gateway contracts, per environment.
 *
 * The same address on every domain WITHIN an environment — but mainnet and
 * testnet are different deployments, which is not obvious and was wrong here
 * for a while: this file asserted one global pair (the testnet one) as a "chain
 * fact". Nothing failed loudly, because a call to an address with no code
 * succeeds as a no-op and `waitForReceipt` only checks `status === '0x1'`. So on
 * mainnet the wallet approved USDC to a dead address, sent a deposit that moved
 * nothing, and reported it settled.
 *
 * Read from GET /v1/info on each Gateway API and verified with `eth_getCode`:
 * the mainnet pair has code on all 11 EVM domains, the testnet pair on all 12.
 * Kept here (not in the Gateway client) so the activity mapper can recognise a
 * deposit without importing the bridge.
 */
const GATEWAY_CONTRACTS: Record<ChainEnvironment, { wallet: `0x${string}`; minter: `0x${string}` }> = {
  mainnet: {
    wallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
    minter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205',
  },
  testnet: {
    wallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    minter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
  },
};

/** GatewayWallet — where a deposit goes, and what holds the unified balance. */
export const gatewayWallet = (env: ChainEnvironment): `0x${string}` => GATEWAY_CONTRACTS[env].wallet;

/** GatewayMinter — where an attestation is claimed on the destination. */
export const gatewayMinter = (env: ChainEnvironment): `0x${string}` => GATEWAY_CONTRACTS[env].minter;

/** Every Gateway address, both environments, lowercased. */
const GATEWAY_ADDRESSES = new Set(
  Object.values(GATEWAY_CONTRACTS).flatMap((c) => [c.wallet.toLowerCase(), c.minter.toLowerCase()]),
);

/**
 * True when `addr` is a Gateway contract — i.e. a transfer to/from it is the
 * user moving their OWN money in or out of the unified balance, not a payment.
 *
 * Checks both environments deliberately. This classifies history, which can
 * outlive an environment switch, and the four addresses are distinct enough that
 * matching all of them cannot produce a false positive.
 */
export const isGatewayContract = (addr: string): boolean =>
  GATEWAY_ADDRESSES.has(addr.toLowerCase());

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

/** Chains in this environment with a Uniswap V2-compatible DEX. */
export const swapChainsForEnvironment = (env: ChainEnvironment): ChainDef[] =>
  chainsForEnvironment(env).filter((c) => c.uniswap && (c.tokens?.length ?? 0) >= 2);

/** The ERC-20s tradeable on a chain. Empty where we have no DEX for it. */
export const tokensForChain = (chainId: bigint): TokenDef[] =>
  chainById(chainId)?.tokens ?? [];

export const tokenOnChain = (chainId: bigint, address: string): TokenDef | undefined =>
  tokensForChain(chainId).find((t) => t.address.toLowerCase() === address.toLowerCase());

/** Uniswap V2 router/factory for a chain, when it has one. */
export const uniswapFor = (chainId: bigint): ChainDef['uniswap'] => chainById(chainId)?.uniswap;

/** The chain behind a Circle domain id, within an environment. */
export const chainForDomain = (domain: number, env: ChainEnvironment): ChainDef | undefined =>
  chainsForEnvironment(env).find((c) => c.circleDomain === domain);
