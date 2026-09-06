import { chainsForEnvironment, type ChainDef } from '../lib/chains';
import { BtcNetwork, type EvmChainConfig, type WalletInterface } from 'standard-rn';
import { setActiveEvmChainId } from './evmChain';
import { setStealthEvmChains } from './stealth';
import { APP_ENVIRONMENT, chainInEnvironment, type Environment } from '../lib/environment';

export const SEPOLIA_CHAIN_ID = 11155111n;

/** USDC contract per environment (used for card-native ERC-20 transfers on the
 *  Ethereum chain). Sepolia test-USDC vs Ethereum-mainnet USDC. */
export const USDC_SEPOLIA = '0xadDD620EA6D20f4f9c24fff3BC039E497ceBEDc2';
export const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export function usdcAddressForEnv(env: Environment): string {
  return env === 'mainnet' ? USDC_MAINNET : USDC_SEPOLIA;
}

// BTC balances + activity are read from an Esplora REST indexer. Overridable per
// build via env — testnet4 defaults to the self-hosted dealpulley indexer, which
// is far more reliable than mempool.space's public API (rate-limited / slow, the
// cause of the long "loading" balance hangs). Plain `process.env.EXPO_PUBLIC_*`
// member access so Metro can inline the value at build time.
const BTC_ESPLORA_TESTNET =
  process.env.EXPO_PUBLIC_BTC_ESPLORA_TESTNET || 'https://beta4indexer.dealpulley.com';
// Mainnet BTC indexer: Blockstream primary (its reads are far more reliable —
// mempool.space's public API rate-limits balance scans, so the balance silently
// fails to load), mempool.space as the send failover. Both public Esploras 429
// under load; the failover wrapper in transfer.ts retries a send on the other.
// The BALANCE read uses the primary only, so the primary MUST be the reliable one.
// Both overridable per build via env.
const BTC_ESPLORA_MAINNET =
  process.env.EXPO_PUBLIC_BTC_ESPLORA_MAINNET || 'https://blockstream.info/api';
const BTC_ESPLORA_MAINNET_FALLBACK =
  process.env.EXPO_PUBLIC_BTC_ESPLORA_MAINNET_FALLBACK || 'https://mempool.space/api';

// Mainnet Solana RPC. The free public `api.mainnet-beta.solana.com` is
// unreliable from a device (Cloudflare/rate-limit rejects the reqwest path used
// by the Rust core → shields fail to broadcast, and stealth discovery reads 0),
// so this is overridable per build. Point it at a dedicated provider (Helius,
// QuickNode, Triton, …) via EXPO_PUBLIC_SOLANA_RPC_URL to make SOL send +
// stealth discovery reliable. Both the JS balance path and the Rust core
// (via solSetRpcEndpoint) use this value.
const SOL_RPC_MAINNET =
  process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Legacy default endpoints — kept for the few callers that need a last-resort
// fallback. Follows APP_ENVIRONMENT so a mainnet build never falls back to a
// testnet node. (Live per-chain endpoints come from the per-env helpers below.)
export const ENDPOINTS = {
  btcEsplora: APP_ENVIRONMENT === 'mainnet' ? BTC_ESPLORA_MAINNET : BTC_ESPLORA_TESTNET,
  solRpc: APP_ENVIRONMENT === 'mainnet' ? SOL_RPC_MAINNET : 'https://api.devnet.solana.com',
  evmRpc: APP_ENVIRONMENT === 'mainnet' ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com',
} as const;

// ---- Selectable networks (mirror the iOS *NetworkChoice enums) -------------

export type BtcChoice = 'testnet4' | 'mainnet';
export type SolChoice = 'devnet' | 'mainnet';
export type EvmChoice = 'sepolia' | 'mainnet';

export const BTC_NETWORKS: Record<BtcChoice, { label: string; esplora: string; net: BtcNetwork }> = {
  testnet4: { label: 'Testnet4', esplora: BTC_ESPLORA_TESTNET, net: BtcNetwork.Testnet4 },
  mainnet: { label: 'Mainnet', esplora: BTC_ESPLORA_MAINNET, net: BtcNetwork.Mainnet },
};

export const SOL_NETWORKS: Record<SolChoice, { label: string; rpc: string }> = {
  devnet: { label: 'Devnet', rpc: 'https://api.devnet.solana.com' },
  mainnet: { label: 'Mainnet Beta', rpc: SOL_RPC_MAINNET },
};

export const EVM_NETWORKS: Record<EvmChoice, { label: string; chainId: bigint; rpc: string }> = {
  sepolia: { label: 'Sepolia', chainId: 11155111n, rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  mainnet: { label: 'Ethereum', chainId: 1n, rpc: 'https://ethereum-rpc.publicnode.com' },
};

export interface NetworkChoices {
  btc: BtcChoice;
  sol: SolChoice;
  evm: EvmChoice;
}

/** JSON-RPC URL for a given EVM chain id, across both environments' managed
 *  chains (used by receipt polling, which must hit the chain the tx is on).
 *  Falls back to the selectable Sepolia/Ethereum RPCs, then undefined. */
export function evmRpcForChainId(chainId: bigint): string | undefined {
  const managed = [...TESTNET_EVM_CHAINS, ...MAINNET_EVM_CHAINS].find((c) => c.chainId === chainId);
  if (managed) return managed.rpcUrl;
  return Object.values(EVM_NETWORKS).find((n) => n.chainId === chainId)?.rpc;
}

export const DEFAULT_CHOICES: NetworkChoices = { btc: 'testnet4', sol: 'devnet', evm: 'sepolia' };

/** Apply the selected networks to the wallet + the shared active-EVM-chain. */
export function applyNetworks(wallet: WalletInterface, choices: NetworkChoices): void {
  const btc = BTC_NETWORKS[choices.btc];
  wallet.setBtcNetwork(btc.net);
  wallet.setBtcEsploraEndpoint(btc.esplora);
  wallet.solSetRpcEndpoint(SOL_NETWORKS[choices.sol].rpc);
  setActiveEvmChainId(EVM_NETWORKS[choices.evm].chainId);
}

// ---- Environment (all-testnet vs all-mainnet) -----------------------------

/** The per-family network selection implied by an environment. */
export function choicesForEnv(env: Environment): NetworkChoices {
  return env === 'testnet'
    ? { btc: 'testnet4', sol: 'devnet', evm: 'sepolia' }
    : { btc: 'mainnet', sol: 'mainnet', evm: 'mainnet' };
}

/** Esplora REST base for the active environment (BTC balance + activity). */
export function btcEsploraForEnv(env: Environment): string {
  return BTC_NETWORKS[choicesForEnv(env).btc].esplora;
}

/** Failover Esplora base for the active environment, if one is configured. Used
 *  by the BTC send path to retry on a rate-limited (429) primary indexer. */
export function btcEsploraFallbackForEnv(env: Environment): string | undefined {
  return env === 'mainnet' ? BTC_ESPLORA_MAINNET_FALLBACK : undefined;
}

/** Solana RPC for the active environment (used by activity scans). */
export function solRpcForEnv(env: Environment): string {
  return SOL_NETWORKS[choicesForEnv(env).sol].rpc;
}


/** Managed EVM chains per environment — DERIVED from the registry in
 *  lib/chains.ts. Add a chain there and it appears here automatically. */
function toEvmChainConfig(c: ChainDef): EvmChainConfig {
  return {
    chainId: c.chainId,
    name: c.name,
    rpcUrl: c.rpcUrl,
    explorerUrl: c.explorerUrl,
    nativeSymbol: c.nativeSymbol,
    nativeDecimals: c.nativeDecimals,
    eip7702Delegate: undefined,
    eip1559Supported: true,
    enabled: true,
  };
}

export const TESTNET_EVM_CHAINS: EvmChainConfig[] = chainsForEnvironment('testnet').map(toEvmChainConfig);

export const MAINNET_EVM_CHAINS: EvmChainConfig[] = chainsForEnvironment('mainnet').map(toEvmChainConfig);

/** Ensure the env's EVM chains exist + are enabled, and disable the other env's.
 *  Idempotent and preserves any user-customized RPC for chains already present. */
async function syncEnvChains(wallet: WalletInterface, env: Environment): Promise<void> {
  const wanted = env === 'testnet' ? TESTNET_EVM_CHAINS : MAINNET_EVM_CHAINS;
  const existing = await wallet.evmListChains().catch(() => [] as EvmChainConfig[]);
  const byId = new Map(existing.map((c) => [c.chainId, c]));

  // Ensure this env's chains exist + are enabled (keep a user's custom RPC).
  for (const c of wanted) {
    const cur = byId.get(c.chainId);
    if (cur) {
      if (!cur.enabled) await wallet.evmAddChain({ ...cur, enabled: true });
    } else {
      await wallet.evmAddChain(c);
    }
  }
  // Disable every chain that belongs to the other environment.
  for (const c of existing) {
    if (!chainInEnvironment(c.chainId, env) && c.enabled) {
      await wallet.evmAddChain({ ...c, enabled: false });
    }
  }
  // Mirror this env's EVM chains into the stealth registry so private payments
  // offer the same chains as the normal view (excludes no-native-gas chains).
  setStealthEvmChains(wanted);
}

/** Apply a whole environment to the wallet: BTC/SOL networks, the active EVM
 *  chain, and the enabled-chain set. */
export async function applyEnvironment(wallet: WalletInterface, env: Environment): Promise<void> {
  applyNetworks(wallet, choicesForEnv(env));
  await syncEnvChains(wallet, env);
}
