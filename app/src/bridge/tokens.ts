// Custom + built-in ERC-20 token support (mirrors iOS TokensView / KnownEvmToken).
// Custom tokens are stored locally; metadata is fetched from the chain by contract.

export interface CustomToken {
  id: string; // `${chainId}:${contract}`
  name: string;
  symbol: string;
  decimals: number;
  chainId: number;
  contractAddress: string;
  colorHex: string;
  /** Resolved via CoinGecko's contract lookup → enables real price + icon. */
  coingeckoId?: string;
  imageUrl?: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
  421614: 'Arb Sepolia',
  84532: 'Base Sepolia',
};

export const SUPPORTED_TOKEN_CHAINS: { id: number; name: string }[] = Object.entries(CHAIN_NAMES).map(
  ([id, name]) => ({ id: Number(id), name }),
);

export function chainNames(ids: number[]): string {
  return ids.map((id) => CHAIN_NAMES[id] ?? `Chain ${id}`).join(', ');
}

const RPCS: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  10: 'https://mainnet.optimism.io',
  137: 'https://polygon-rpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  84532: 'https://sepolia.base.org',
};

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  /** From CoinGecko (best-effort) → real price + icon. Empty if not listed. */
  coingeckoId?: string;
  imageUrl?: string;
}

// chainId → CoinGecko asset-platform id (for the contract lookup). Testnets are
// omitted (CoinGecko doesn't index them → custom tokens there keep the chip).
const CG_PLATFORM: Record<number, string> = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  137: 'polygon-pos',
  8453: 'base',
  42161: 'arbitrum-one',
  56: 'binance-smart-chain',
  43114: 'avalanche',
};

/** Resolve an ERC-20 contract to its CoinGecko coin (id + icon). Best-effort:
 *  returns null on unknown token, unsupported chain, rate-limit, or network error. */
export async function fetchCoingeckoByContract(
  contract: string,
  chainId: number,
): Promise<{ coingeckoId: string; imageUrl: string } | null> {
  const platform = CG_PLATFORM[chainId];
  if (!platform) return null;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contract.trim().toLowerCase()}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: string; image?: { large?: string; small?: string; thumb?: string } };
    if (!j.id) return null;
    return { coingeckoId: j.id, imageUrl: j.image?.large || j.image?.small || j.image?.thumb || '' };
  } catch {
    return null;
  }
}

/** Decode an ABI-encoded string return (dynamic string or bytes32). */
export function decodeAbiString(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length < 64) return '';
  const bytesToStr = (h: string) => {
    let s = '';
    for (let i = 0; i + 1 < h.length; i += 2) {
      const code = parseInt(h.slice(i, i + 2), 16);
      if (code === 0) break;
      if (code >= 32 && code < 127) s += String.fromCharCode(code);
    }
    return s.trim();
  };
  // Dynamic string: [offset][length][data]
  if (clean.length >= 128) {
    const len = parseInt(clean.slice(64, 128), 16);
    if (len > 0 && len < 256 && clean.length >= 128 + len * 2) {
      const data = clean.slice(128, 128 + len * 2);
      const s = bytesToStr(data);
      if (s) return s;
    }
  }
  // bytes32 fixed
  return bytesToStr(clean.slice(0, 64));
}

async function ethCall(rpc: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'eth_call failed');
  return json.result as string;
}

/** Fetch name/symbol/decimals for an ERC-20 contract on a chain. */
export async function fetchTokenMetadata(contract: string, chainId: number): Promise<TokenMetadata> {
  const rpc = RPCS[chainId];
  if (!rpc) throw new Error('No RPC for this chain');
  // On-chain name/symbol/decimals are authoritative; the CoinGecko lookup (icon +
  // id) runs alongside and is best-effort (never blocks or fails the add).
  const [nameHex, symbolHex, decHex, cg] = await Promise.all([
    ethCall(rpc, contract, '0x06fdde03'), // name()
    ethCall(rpc, contract, '0x95d89b41'), // symbol()
    ethCall(rpc, contract, '0x313ce567'), // decimals()
    fetchCoingeckoByContract(contract, chainId),
  ]);
  const name = decodeAbiString(nameHex);
  const symbol = decodeAbiString(symbolHex);
  const decimals = decHex && decHex !== '0x' ? Number(BigInt(decHex)) : 18;
  if (!name || !symbol) throw new Error("Contract doesn't look like an ERC-20 token");
  return { name, symbol, decimals, coingeckoId: cg?.coingeckoId, imageUrl: cg?.imageUrl };
}
