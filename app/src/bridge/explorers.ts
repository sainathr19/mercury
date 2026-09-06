// Block-explorer + chain-endpoint URLs that depend on the active environment
// (testnet vs mainnet). Centralized here so no caller hardcodes "testnet4" or
// "?cluster=devnet". The EVM explorer lives in evmChain.ts (keyed by chain id).

import { getActiveEnvironment } from './activeEnv';
import type { Environment } from '../lib/environment';

/** mempool.space base for the active BTC network. */
export function btcMempoolBase(env: Environment = getActiveEnvironment()): string {
  return env === 'testnet' ? 'https://mempool.space/testnet4' : 'https://mempool.space';
}

/** Explorer tx URL for a Bitcoin txid on the active network. */
export function btcExplorerTxUrl(txid: string, env: Environment = getActiveEnvironment()): string {
  return `${btcMempoolBase(env)}/tx/${txid}`;
}

/** Explorer tx URL for a Solana signature on the active cluster. mainnet-beta is
 *  the explorer's default cluster, so we omit the query param there. */
export function solExplorerTxUrl(sig: string, env: Environment = getActiveEnvironment()): string {
  return env === 'testnet'
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : `https://explorer.solana.com/tx/${sig}`;
}
