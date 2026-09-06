// Asset/token/chain metadata model. Pure (no native imports) so it is
// unit-testable in isolation. Chain-centric and multi-family: tokens are grouped
// under their network, each network has a `family` (evm | solana | bitcoin) and
// its native coin. Operational chain config (RPC/explorer) is NOT here — the Rust
// core owns that (evmListChains); this registry is token/asset metadata only.
//
// Icons come from each asset's `imageUrl` (may be empty → the app falls back to
// the price-feed image / a derived-color chip). There is no stored colorHex.

/** The chain families the wallet supports. Enum-like const object: use
 *  `ChainType.Evm` in code; the union type is the JSON/serialized form. */
export const ChainType = {
  Evm: 'evm',
  Solana: 'solana',
  Bitcoin: 'bitcoin',
} as const;
export type ChainType = (typeof ChainType)[keyof typeof ChainType];

export interface RegistryAsset {
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId: string;
  /** Icon URL. May be '' or absent → the app derives a placeholder. */
  imageUrl?: string;
  /** EVM contract / SPL mint on this network. Absent for the native coin. */
  address?: string;
}

export interface RegistryNetwork {
  /** Stable key: EVM = decimal chainId ("1"); else "solana" / "bitcoin". */
  id: string;
  chainType: ChainType;
  name: string;
  /** EVM chain id (EVM family only). */
  chainId?: number;
  /** Network icon. May be '' or absent. */
  imageUrl?: string;
  native: RegistryAsset;
  tokens: RegistryAsset[];
}

export interface Registry {
  version: string;
  updatedAt: string;
  /** Keyed by network id (chainId string for EVM, "solana"/"bitcoin" otherwise). */
  networks: Record<string, RegistryNetwork>;
}

/** A token with its contract/mint resolved — consumers read `.contract`. */
export type ResolvedRegistryToken = RegistryAsset & { contract: string };

function resolve(tokens: RegistryAsset[]): ResolvedRegistryToken[] {
  const out: ResolvedRegistryToken[] = [];
  for (const t of tokens) if (t.address) out.push({ ...t, contract: t.address });
  return out;
}

/** A network by its key ("1", "solana", "bitcoin"). */
export function networkByKey(reg: Registry, key: string): RegistryNetwork | undefined {
  return reg.networks[key];
}

/** EVM tokens on `chainId`, each with its contract resolved. */
export function tokensForChain(reg: Registry, chainId: bigint): ResolvedRegistryToken[] {
  const net = reg.networks[chainId.toString()];
  return net ? resolve(net.tokens) : [];
}

/** EVM native coin metadata for `chainId`. */
export function nativeForChain(reg: Registry, chainId: bigint): RegistryAsset | undefined {
  return reg.networks[chainId.toString()]?.native;
}

/** SPL tokens on Solana mainnet, each with its mint resolved. */
export function solanaTokens(reg: Registry): ResolvedRegistryToken[] {
  const net = reg.networks.solana;
  return net ? resolve(net.tokens) : [];
}

/** mint (base58, exact) → asset, across every Solana-family network (mainnet +
 *  devnet). Used to enrich + allowlist the SPL balances returned by the core. */
export function solanaMints(reg: Registry): Map<string, RegistryAsset> {
  const m = new Map<string, RegistryAsset>();
  for (const net of Object.values(reg.networks)) {
    if (net.chainType !== ChainType.Solana) continue;
    for (const t of net.tokens) if (t.address) m.set(t.address, t);
  }
  return m;
}

/** Defensive shape check for an untrusted JSON payload (CDN/cache). */
export function isValidRegistry(x: unknown): x is Registry {
  if (!x || typeof x !== 'object') return false;
  const r = x as Registry;
  if (typeof r.version !== 'string') return false;
  if (!r.networks || typeof r.networks !== 'object' || Array.isArray(r.networks)) return false;
  const types = Object.values(ChainType) as string[];
  return Object.values(r.networks).every(
    (n) => n && types.includes(n.chainType) && !!n.native && Array.isArray(n.tokens),
  );
}

/** Built-in token rows for the Tokens screen, aggregated by symbol across the
 *  networks they appear on (e.g. USDC → ["Ethereum", "Polygon", …]). The
 *  coingeckoId is the stable hide/show key (shared across chains). */
export function builtinDisplay(
  reg: Registry,
): { name: string; symbol: string; coingeckoId: string; imageUrl: string; networks: string[] }[] {
  const bySymbol = new Map<string, { name: string; symbol: string; coingeckoId: string; imageUrl: string; networks: string[] }>();
  for (const net of Object.values(reg.networks)) {
    for (const t of net.tokens) {
      const existing = bySymbol.get(t.symbol);
      if (existing) existing.networks.push(net.name);
      else bySymbol.set(t.symbol, { name: t.name, symbol: t.symbol, coingeckoId: t.coingeckoId, imageUrl: t.imageUrl ?? '', networks: [net.name] });
    }
  }
  return [...bySymbol.values()];
}
