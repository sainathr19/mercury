// Built-in Tempo token metadata. Tempo networks are always present in the
// active registry regardless of the remote registry CDN (which does not know
// about Tempo) — `registryStore` overlays these via `withTempoNetworks` on every
// seed/cache/CDN load. Remote definitions win if the CDN ever ships Tempo.
//
// Addresses/decimals are the canonical values from Tempo's token list
// (tokenlist.tempo.xyz/list/{chainId}); all Tempo stablecoins are 6-decimal.
// Tempo has NO native gas coin — the `native` entry is a USD placeholder that is
// never rendered as a balance (see lib/tempo.ts `evmChainHasNativeAsset`); it
// only supplies the "USD" fee symbol for token rows.
//
// Pure module (no native imports) so it stays unit-testable.

import type { Registry, RegistryAsset, RegistryNetwork } from './registry';

/** Tempo pays fees in USD-denominated stablecoins; there is no native coin. */
const TEMPO_NATIVE: RegistryAsset = {
  symbol: 'USD',
  name: 'US Dollar',
  decimals: 6,
  coingeckoId: '',
};

const tok = (
  symbol: string,
  name: string,
  address: string,
  coingeckoId = '',
): RegistryAsset => ({ symbol, name, decimals: 6, coingeckoId, address });

// Tempo Testnet (Moderato) — the full faucet stablecoin set.
const TEMPO_TESTNET: RegistryNetwork = {
  id: '42431',
  chainType: 'evm',
  name: 'Tempo Testnet',
  chainId: 42431,
  native: TEMPO_NATIVE,
  tokens: [
    tok('pathUSD', 'PathUSD', '0x20c0000000000000000000000000000000000000', 'pathusd'),
    tok('alphaUSD', 'AlphaUSD', '0x20c0000000000000000000000000000000000001'),
    tok('betaUSD', 'BetaUSD', '0x20c0000000000000000000000000000000000002'),
    tok('thetaUSD', 'ThetaUSD', '0x20c0000000000000000000000000000000000003'),
    tok('USDC.e', 'Bridged USDC (Stargate)', '0x20c0000000000000000000009e8d7eb59b783726', 'usd-coin'),
    tok('EURC.e', 'Bridged EURC (Stargate)', '0x20c000000000000000000000d72572838bbee59c', 'euro-coin'),
  ],
};

// Tempo Mainnet — a curated set of the most recognizable stablecoins. Users can
// add any other TIP-20 via the custom-token flow; the full list lives at
// tokenlist.tempo.xyz/list/4217.
const TEMPO_MAINNET: RegistryNetwork = {
  id: '4217',
  chainType: 'evm',
  name: 'Tempo',
  chainId: 4217,
  native: TEMPO_NATIVE,
  tokens: [
    tok('pathUSD', 'PathUSD', '0x20c0000000000000000000000000000000000000', 'pathusd'),
    tok('USDC.e', 'Bridged USDC (Stargate)', '0x20c000000000000000000000b9537d11c60e8b50', 'usd-coin'),
    tok('USDT0', 'USDT0', '0x20c00000000000000000000014f22ca97301eb73', 'tether'),
    tok('EURC.e', 'Bridged EURC (Stargate)', '0x20c0000000000000000000001621e21f71cf12fb', 'euro-coin'),
    tok('USDe', 'USDe', '0x20c0000000000000000000002f52d5cc21a3207b', 'ethena-usde'),
    tok('cbBTC', 'Coinbase Wrapped BTC', '0x20c000000000000000000000c412ec89d0c08be5', 'coinbase-wrapped-btc'),
  ],
};

/** Built-in Tempo networks, keyed by decimal chain id string. */
export const TEMPO_REGISTRY_NETWORKS: Record<string, RegistryNetwork> = {
  '42431': TEMPO_TESTNET,
  '4217': TEMPO_MAINNET,
};

/**
 * Overlay the built-in Tempo networks onto a registry. A network already present
 * in `reg` (e.g. shipped by the remote registry CDN) is kept as-is — the remote
 * definition wins; the built-ins only fill gaps. Returns a new Registry.
 */
export function withTempoNetworks(reg: Registry): Registry {
  return {
    ...reg,
    networks: { ...TEMPO_REGISTRY_NETWORKS, ...reg.networks },
  };
}
