import { chainExplorer } from '../lib/chains';
// The active EVM chain id, shared by Send / dApp browser / WalletConnect so a
// network switch in Settings applies everywhere. Pure module (no native import)
// so it stays unit-testable; networkStore sets it on hydrate + change.

import { DEFAULT_EVM_CHAIN_ID } from '../lib/environment';

let activeEvmChainId = DEFAULT_EVM_CHAIN_ID; // follows APP_ENVIRONMENT (Ethereum / Sepolia)

export function getActiveEvmChainId(): bigint {
  return activeEvmChainId;
}

export function setActiveEvmChainId(id: bigint): void {
  activeEvmChainId = id;
}

/** Block-explorer base per EVM chain id (for tx links). */


export function evmExplorerTxUrl(chainId: bigint, txid: string): string {
  const base = chainExplorer(chainId);
  return `${base}/tx/${txid}`;
}
