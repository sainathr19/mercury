// ─────────────────────────────────────────────────────────────────────────────
//  Block-explorer history — the fallback under Blockscout.
//
//  Blockscout is the app's first choice and stays that way: keyless, unmetered,
//  and it covers chains Etherscan does not (Ink, Scroll, Gnosis Chiado). What it
//  is not is dependable. Of the 22 testnets this wallet supports, a survey found
//  only 5 with a reachable history source — four Blockscout instances answering
//  503/429/404 and thirteen chains with no explorer configured at all.
//
//  Arbitrum Sepolia was one of the dead ones, and it is a Circle domain: a
//  Gateway send can deliver real money there. The balance came from RPC and
//  showed correctly while the matching "Received" row never appeared, because a
//  NATIVE transfer emits no logs — there is nothing for `eth_getLogs` to find,
//  so an indexer is the only way to see it. A wallet that shows a number it
//  cannot account for is worse than one that shows neither.
//
//  The key lives on the hub, never here. `EXPO_PUBLIC_*` is inlined into the
//  bundle at build time and recoverable from the app package, which is why the
//  Token API JWT was moved server-side too — see the note atop bridge/graph.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { RawEvmTx, RawEvmTokenTx } from '../lib/evm-activity';

/** Read at call time, not at import. Metro inlines `EXPO_PUBLIC_*` as a string
 *  literal at build time so this costs nothing in the app, and it keeps the
 *  value from being frozen by whatever the environment happened to be when this
 *  module was first imported. */
const hubUrl = (): string => process.env.EXPO_PUBLIC_RELAYER_URL ?? '';
const explorerApi = (): string => `${hubUrl()}/index/explorer`;

/**
 * Chain ids Etherscan's V2 multichain API indexes, intersected with the app's
 * registry. Verified against https://api.etherscan.io/v2/chainlist; the hub
 * enforces the same set, so a drift here costs a 400 rather than a wrong answer.
 *
 * Kept as a literal instead of discovered at runtime because the alternative is
 * a network round trip before we can decide whether to make a network round
 * trip — and a chain list is not something that changes under a running app.
 */
const ETHERSCAN_CHAINS = new Set<bigint>([
  // mainnet
  1n, 10n, 56n, 137n, 8453n, 42161n, 43114n,
  // testnet
  97n, 1301n, 1328n, 4801n, 5003n, 10143n, 14601n, 43113n, 59141n, 80002n, 84532n,
  421614n, 11155111n, 11155420n, 168587773n,
]);

/**
 * Set once the hub answers 503 "not configured".
 *
 * Without it, a hub with no ETHERSCAN_API_KEY costs two doomed requests per
 * covered chain on every single history scan — roughly thirty per refresh, all
 * of them certain to fail. One 503 is enough to know.
 */
let retired = false;

/** Exposed for tests; also lets a pull-to-refresh re-check after the operator
 *  sets the key, rather than requiring an app restart. */
export function resetExplorerAvailability(): void {
  retired = false;
}

/**
 * Whether Etherscan indexes this chain at all — a fact about the provider,
 * independent of whether this deployment can reach it. Separated from
 * `explorerCoversChain` so a test can assert the structural coverage gap
 * without depending on which env vars happen to be set while it runs.
 */
export function etherscanIndexes(chainId: bigint): boolean {
  return ETHERSCAN_CHAINS.has(chainId);
}

/** True when this chain could be served by the explorer fallback HERE: the
 *  provider indexes it, a hub is configured, and the hub has not already told
 *  us it has no key. Does not promise an answer — `explorerHistory` reports
 *  that by returning null, and remembers a 503. */
export function explorerCoversChain(chainId: bigint): boolean {
  return !!hubUrl() && !retired && etherscanIndexes(chainId);
}

interface Envelope {
  status?: string;
  message?: string;
  result?: unknown;
}

async function query<T>(action: 'txlist' | 'tokentx', address: string, chainId: bigint): Promise<T[] | null> {
  try {
    const url = `${explorerApi()}/${action}?chainId=${chainId.toString()}&address=${address}&offset=25`;
    const res = await fetch(url);
    if (res.status === 503) {
      retired = true; // no key on the hub — stop asking for the rest of the session
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as Envelope;
    // The hub normalises "no transactions found" to an empty array, so a
    // non-array here is a genuine fault rather than an empty history.
    return Array.isArray(json.result) ? (json.result as T[]) : null;
  } catch {
    return null;
  }
}

/**
 * Native + ERC-20 history for one address on one chain.
 *
 * Returns null when the source could not answer at all, which the caller needs
 * to distinguish from an empty history: the first means "try something else or
 * say nothing", the second means "this address really has no transactions".
 * Collapsing the two is what makes a broken indexer look like an empty wallet.
 */
export async function explorerHistory(
  address: string,
  chainId: bigint,
): Promise<{ native: RawEvmTx[]; tokens: RawEvmTokenTx[] } | null> {
  if (!explorerCoversChain(chainId)) return null;
  const [native, tokens] = await Promise.all([
    query<RawEvmTx>('txlist', address, chainId),
    query<RawEvmTokenTx>('tokentx', address, chainId),
  ]);
  // One leg failing is still a usable answer — a chain with native activity and
  // no tokens is the common case, and vice versa. Both failing is not.
  if (native === null && tokens === null) return null;
  return { native: native ?? [], tokens: tokens ?? [] };
}
