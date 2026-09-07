import type { EvmChainConfig, WalletInterface } from 'mercury-wallet-core';

export type { EvmChainConfig } from 'mercury-wallet-core';

/** Mask API-key path segments before showing an RPC URL (mirrors iOS rpcDisplay). */
export function rpcDisplay(raw: string): string {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length && parts[parts.length - 1].length >= 16) parts[parts.length - 1] = '****';
    return parts.length ? `${u.protocol}//${u.host}/${parts.join('/')}` : `${u.protocol}//${u.host}`;
  } catch {
    return raw;
  }
}

export function listChains(wallet: WalletInterface): Promise<EvmChainConfig[]> {
  return wallet.evmListChains();
}

/** Persist an edited RPC/explorer/enabled for a chain. */
export async function saveChain(
  wallet: WalletInterface,
  original: EvmChainConfig,
  patch: { rpcUrl?: string; explorerUrl?: string; enabled?: boolean },
): Promise<EvmChainConfig> {
  const updated: EvmChainConfig = {
    ...original,
    rpcUrl: patch.rpcUrl?.trim() || original.rpcUrl,
    explorerUrl: patch.explorerUrl?.trim() ? patch.explorerUrl.trim() : original.explorerUrl,
    enabled: patch.enabled ?? original.enabled,
  };
  await wallet.evmAddChain(updated);
  return updated;
}

/** Restore a chain's built-in default RPC/explorer (if one exists). */
export async function resetChain(
  wallet: WalletInterface,
  chainId: bigint,
): Promise<EvmChainConfig | null> {
  const def = wallet.evmDefaultChains().find((c) => c.chainId === chainId);
  if (!def) return null;
  await wallet.evmAddChain(def);
  return def;
}

/** Confirm a user-supplied RPC really speaks the chain it claims (eth_chainId). */
export async function probeChainId(rpcUrl: string): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'RPC error');
  return BigInt(json.result);
}

export interface ChainListEntry {
  chainId: bigint;
  name: string;
  symbol: string;
  rpc: string;
  explorerUrl?: string;
}

/** Fetch the public ChainList registry (chainid.network) for "Add Network". */
export async function fetchChainList(): Promise<ChainListEntry[]> {
  const res = await fetch('https://chainid.network/chains.json');
  if (!res.ok) throw new Error(`ChainList HTTP ${res.status}`);
  const arr = (await res.json()) as any[];
  const out: ChainListEntry[] = [];
  for (const o of arr) {
    const rpcs: string[] = o.rpc ?? [];
    const rpc = rpcs.find((r) => !r.includes('${') && r.startsWith('https://'));
    const symbol = o.nativeCurrency?.symbol;
    if (!rpc || !symbol || typeof o.chainId !== 'number' || !o.name) continue;
    out.push({
      chainId: BigInt(o.chainId),
      name: o.name,
      symbol,
      rpc,
      explorerUrl: (o.explorers ?? [])[0]?.url,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addChainFromList(wallet: WalletInterface, e: ChainListEntry): Promise<EvmChainConfig> {
  const cfg: EvmChainConfig = {
    chainId: e.chainId,
    name: e.name,
    rpcUrl: e.rpc,
    explorerUrl: e.explorerUrl,
    nativeSymbol: e.symbol,
    nativeDecimals: 18,
    eip7702Delegate: undefined,
    eip1559Supported: true,
    enabled: true,
  };
  await wallet.evmAddChain(cfg);
  return cfg;
}
