/** Networks shown in the Receive → "Choose Network" list. Either an on-chain
 *  address (BTC / EVM / SOL), or the "username" network (receive by
 *  @username across chains). Shared by the receive chooser and the detail screen. */
export type ReceiveNetwork =
  | {
      key: string;
      name: string;
      kind: 'address';
      addrKey: 'btc' | 'eth' | 'sol';
      coingeckoId: string;
      symbol: string;
      colorHex: string;
      uriScheme: string;
      /** The chain this brand actually resolves to, per environment. Present
       *  only where the chain registry has an entry — used so a deposit warning
       *  names the REAL network ("Arc Testnet"), never a network that does not
       *  exist ("Arc Sepolia"). */
      chainIds?: { mainnet?: bigint; testnet?: bigint };
    }
  | { key: string; name: string; kind: 'username' };

// All EVM chains (Ethereum, Arbitrum, Base, Optimism, Polygon, Hyperliquid) share
// the SAME 0x receive address, so they all map to `addrKey: 'eth'` and the
// `ethereum:` URI scheme — only the display name / icon differ. `coingeckoId`
// here doubles as the bundled-icon lookup key (see icon-assets LOCAL_TOKEN_ICONS).
export const RECEIVE_NETWORKS: ReceiveNetwork[] = [
  { key: 'mercury', name: 'Mercury', kind: 'username' },
  { key: 'bitcoin', name: 'Bitcoin', kind: 'address', addrKey: 'btc', coingeckoId: 'bitcoin', symbol: 'BTC', colorHex: '#FF991A', uriScheme: 'bitcoin' },
  { key: 'ethereum', name: 'Ethereum', kind: 'address', addrKey: 'eth', coingeckoId: 'ethereum', symbol: 'ETH', colorHex: '#25292E', uriScheme: 'ethereum', chainIds: { mainnet: 1n, testnet: 11155111n } },
  { key: 'arbitrum', name: 'Arbitrum', kind: 'address', addrKey: 'eth', coingeckoId: 'arbitrum', symbol: 'ARB', colorHex: '#28A0F0', uriScheme: 'ethereum', chainIds: { mainnet: 42161n, testnet: 421614n } },
  { key: 'base', name: 'Base', kind: 'address', addrKey: 'eth', coingeckoId: 'base', symbol: 'BASE', colorHex: '#0052FF', uriScheme: 'ethereum', chainIds: { mainnet: 8453n, testnet: 84532n } },
  { key: 'optimism', name: 'Optimism', kind: 'address', addrKey: 'eth', coingeckoId: 'optimism', symbol: 'OP', colorHex: '#FF0420', uriScheme: 'ethereum' },
  { key: 'polygon', name: 'Polygon', kind: 'address', addrKey: 'eth', coingeckoId: 'polygon', symbol: 'POL', colorHex: '#6F41D8', uriScheme: 'ethereum' },
  { key: 'solana', name: 'Solana', kind: 'address', addrKey: 'sol', coingeckoId: 'solana', symbol: 'SOL', colorHex: '#7333D9', uriScheme: 'solana' },
  { key: 'hyperliquid', name: 'Hyperliquid', kind: 'address', addrKey: 'eth', coingeckoId: 'hyperliquid', symbol: 'HYPE', colorHex: '#50D2C1', uriScheme: 'ethereum' },
  // Tempo is EVM-compatible (stablecoin payments chain) — same 0x receive address
  // as the other EVM networks; funds arrive as TIP-20 stablecoins, so it uses the
  // `ethereum:` URI scheme and the shared `eth` address.
  { key: 'tempo', name: 'Tempo', kind: 'address', addrKey: 'eth', coingeckoId: 'tempo', symbol: 'USD', colorHex: '#1C1C1E', uriScheme: 'ethereum', chainIds: { mainnet: 4217n, testnet: 42431n } },
  // Arc is a stablecoin chain whose NATIVE coin is USDC itself, so it borrows
  // USDC's icon rather than carrying one of its own. Same 0x address as every
  // other EVM network.
  { key: 'arc', name: 'Arc', kind: 'address', addrKey: 'eth', coingeckoId: 'usd-coin', symbol: 'USDC', colorHex: '#2775CA', uriScheme: 'ethereum', chainIds: { testnet: 5042002n } },
];

export function receiveNetwork(key: string): ReceiveNetwork | undefined {
  return RECEIVE_NETWORKS.find((n) => n.key === key);
}
