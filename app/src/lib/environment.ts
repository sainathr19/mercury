// The global network environment. The whole app runs in exactly ONE of these:
// either all-testnet (Sepolia / Devnet / Testnet4 + test L2s) or all-mainnet
// (the production chains). A user flips between them with a single toggle.
//
// Pure module (no native imports) so the chain classification stays unit-testable.
// `networks.ts` owns the operational config (RPCs, managed chain list, applying
// the environment to the wallet); this file owns only the environment concept.

export type Environment = 'mainnet' | 'testnet';

// ─────────────────────────────────────────────────────────────────────────────
//  THE SINGLE GLOBAL NETWORK SWITCH
//
//  Change THIS ONE VALUE to flip the entire app between testnet and mainnet.
//  Every default in the app derives from it: the network store's default env,
//  the pre-hydrate active-environment mirror, and the default EVM chain id. BTC
//  network, Solana RPC, EVM chain, explorers, fees, swaps and activity all follow
//  the resolved environment automatically.
//
//  It can also be overridden at build time WITHOUT editing code by setting
//  `EXPO_PUBLIC_ENVIRONMENT=mainnet` (or `testnet`) in .env.local — handy for
//  shipping a mainnet build from the same source. The env var wins when set;
//  otherwise the literal below is the one place to change.
// ─────────────────────────────────────────────────────────────────────────────

/** Edit this literal to change the whole app's default network. */
const DEFAULT_APP_ENVIRONMENT: Environment = 'mainnet';

/** The app's baked-in environment (env var override → literal default). */
export const APP_ENVIRONMENT: Environment =
  process.env.EXPO_PUBLIC_ENVIRONMENT === 'mainnet'
    ? 'mainnet'
    : process.env.EXPO_PUBLIC_ENVIRONMENT === 'testnet'
      ? 'testnet'
      : DEFAULT_APP_ENVIRONMENT;

/** Default active EVM chain id for {@link APP_ENVIRONMENT} (Ethereum vs Sepolia).
 *  Used as the pre-hydrate default before the network store resolves the full
 *  per-chain choices. */
export const DEFAULT_EVM_CHAIN_ID: bigint = APP_ENVIRONMENT === 'mainnet' ? 1n : 11155111n;

/** Well-known EVM testnet chain ids. Everything else is treated as mainnet. */
export const TESTNET_EVM_CHAIN_IDS: bigint[] = [
  11155111n, // Ethereum Sepolia
  421614n, // Arbitrum Sepolia
  84532n, // Base Sepolia
  11155420n, // Optimism Sepolia
  80002n, // Polygon Amoy
  97n, // BNB Smart Chain Testnet
  43113n, // Avalanche Fuji
  42431n, // Tempo Testnet (Moderato)
];

const TESTNET_SET = new Set(TESTNET_EVM_CHAIN_IDS.map((id) => id.toString()));

/** True if `chainId` is a known EVM testnet. */
export function isTestnetChainId(chainId: bigint): boolean {
  return TESTNET_SET.has(chainId.toString());
}

/** Which environment an EVM chain belongs to. */
export function environmentOfChainId(chainId: bigint): Environment {
  return isTestnetChainId(chainId) ? 'testnet' : 'mainnet';
}

/** Does this EVM chain belong to the given environment? */
export function chainInEnvironment(chainId: bigint, env: Environment): boolean {
  return environmentOfChainId(chainId) === env;
}

/** Human label for the environment (UI). */
export function environmentLabel(env: Environment): string {
  return env === 'testnet' ? 'Testnet' : 'Mainnet';
}
