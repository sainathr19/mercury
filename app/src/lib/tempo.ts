import { chainHasNativeAsset } from './chains';
// Tempo network identity. Tempo is an EVM-compatible stablecoin payments chain
// with a crucial quirk: it has NO native gas token. `eth_getBalance` returns a
// large placeholder value, fees are denominated in USD and paid in a stablecoin
// (a TIP-20 token), and there is nothing to "send natively". Wallet behaviours
// that assume a native coin (native balance rows, native-denominated fees) must
// be suppressed for Tempo chains — this module is the single source of truth for
// detecting them.
//
// Pure module (no native imports) so the chain identity stays unit-testable.

/** Tempo Mainnet chain id (currency: USD, RPC https://rpc.tempo.xyz). */
export const TEMPO_MAINNET_CHAIN_ID = 4217n;

/** Tempo Testnet "Moderato" chain id (RPC https://rpc.moderato.tempo.xyz). */
export const TEMPO_TESTNET_CHAIN_ID = 42431n;

/** Fees on Tempo are denominated in USD (there is no native gas coin). */
export const TEMPO_CURRENCY_SYMBOL = 'USD';

const TEMPO_CHAIN_IDS = new Set([
  TEMPO_MAINNET_CHAIN_ID.toString(),
  TEMPO_TESTNET_CHAIN_ID.toString(),
]);

/** True if `chainId` is a Tempo network (mainnet or testnet). */
export function isTempoChainId(chainId: bigint): boolean {
  return TEMPO_CHAIN_IDS.has(chainId.toString());
}

/**
 * Whether an EVM chain has a native gas coin worth surfacing as a balance row.
 * False for Tempo (no native token — `eth_getBalance` returns a placeholder that
 * would otherwise render as a bogus balance); true for every other EVM chain.
 */
export function evmChainHasNativeAsset(chainId: bigint): boolean {
  // Registry-driven: a chain declares whether it has a native gas coin worth
  // showing. Tempo does not; Arc does (its native coin is USDC).
  return chainHasNativeAsset(chainId);
}
