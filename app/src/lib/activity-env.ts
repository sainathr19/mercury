// Classify an ActivityItem as testnet vs mainnet so the feed can show ONLY the
// active environment's history. Pure (no native imports) → unit-testable.
//
// WHY THIS EXISTS: the live chain scan only queries the active environment's
// endpoints, so freshly-scanned rows are always the right environment. But the
// persisted activity cache can still hold rows from a previous testnet session
// (older builds cached before the scope key was environment-partitioned, or a
// merge that preserved them). On hydrate those stale testnet rows flash in for a
// few seconds until the mainnet scan replaces them. Filtering the feed to the
// active environment removes the flash and guarantees mainnet-only history.
//
// Classification is by the row's human network name + explorer URL — both are
// stamped at creation for every chain family (BTC "Bitcoin Testnet", SOL "Solana
// Devnet", EVM "Sepolia"/"Base Sepolia"/…), so a testnet row is reliably
// identifiable while every mainnet row (and Lightning, which is mainnet-only)
// falls through to mainnet.

import type { Environment } from './environment';

/** The only fields needed to classify a row's environment. */
type Classifiable = { network?: string; explorerUrl?: string };

// Substrings that only ever appear in a TESTNET network name or explorer host.
// Matched case-insensitively. Kept deliberately specific so no mainnet name
// (e.g. "Arbitrum One", "Ethereum") accidentally matches.
const TESTNET_HINTS = [
  'testnet',
  'sepolia',
  'devnet',
  'goerli',
  'holesky',
  'amoy',
  'fuji',
  'moderato', // Tempo testnet
];

/** True if this activity row belongs to a testnet chain. */
export function isTestnetActivity(item: Classifiable): boolean {
  const hay = `${item.network ?? ''} ${item.explorerUrl ?? ''}`.toLowerCase();
  return TESTNET_HINTS.some((h) => hay.includes(h));
}

/** True if this row should be shown in the given environment. Testnet rows show
 *  only on testnet; everything else (mainnet + Lightning + unclassifiable) shows
 *  only on mainnet. */
export function activityMatchesEnv(item: Classifiable, env: Environment): boolean {
  return env === 'testnet' ? isTestnetActivity(item) : !isTestnetActivity(item);
}
