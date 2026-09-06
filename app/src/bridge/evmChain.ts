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
const EXPLORERS: Record<string, string> = {
  '5042002': 'https://testnet.arcscan.app',
  // Mainnets
  '1': 'https://etherscan.io',
  '10': 'https://optimistic.etherscan.io',
  '137': 'https://polygonscan.com',
  '8453': 'https://basescan.org',
  '42161': 'https://arbiscan.io',
  '56': 'https://bscscan.com',
  '43114': 'https://snowtrace.io',
  // Testnets
  '11155111': 'https://sepolia.etherscan.io',
  '421614': 'https://sepolia.arbiscan.io',
  '84532': 'https://sepolia.basescan.org',
  '11155420': 'https://sepolia-optimism.etherscan.io',
  // Tempo (stablecoin payments chain — no native gas token)
  '4217': 'https://explore.tempo.xyz',
  '42431': 'https://explore.testnet.tempo.xyz',
};

export function evmExplorerTxUrl(chainId: bigint, txid: string): string {
  const base = EXPLORERS[chainId.toString()] ?? 'https://etherscan.io';
  return `${base}/tx/${txid}`;
}
