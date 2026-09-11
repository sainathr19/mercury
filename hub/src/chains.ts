// Destination chains the relayer can mint on. Mirrors the app's chain registry
// (app/src/lib/chains.ts) — the two are separate processes, so the Circle domain
// is the shared key rather than a shared import.
//
// Circle reuses the SAME domain id across environments: domain 6 is Base on
// mainnet and Base Sepolia on testnet. So a domain alone does not identify a
// chain, and the caller has to say which environment it means. That is why the
// map below is keyed by environment first — a single flat table could only ever
// serve one of them, which is how this file came to be testnet-only.
import { defineChain, type Chain } from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from 'viem/chains';

export type RelayEnvironment = 'mainnet' | 'testnet';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
});

/** Circle domain -> the chain to submit the mint on, per environment. */
export const CHAINS_BY_ENV: Record<RelayEnvironment, Record<number, Chain>> = {
  testnet: {
    0: sepolia,
    3: arbitrumSepolia,
    6: baseSepolia,
    26: arcTestnet,
  },
  // Arc is testnet-only on Gateway (GET /v1/info lists no domain 26 on
  // mainnet), so it is deliberately absent here rather than mapped to nothing.
  mainnet: {
    0: mainnet,
    1: avalanche,
    2: optimism,
    3: arbitrum,
    6: base,
    7: polygon,
  },
};

export const chainFor = (env: RelayEnvironment, domain: number): Chain | undefined =>
  CHAINS_BY_ENV[env][domain];

/**
 * GatewayMinter, per environment.
 *
 * The same address on every EVM domain within an environment, but mainnet and
 * testnet are different deployments. This file used to assert the testnet
 * address as universal, which would have sent every mainnet mint to an address
 * with no code — a transaction that succeeds and does nothing.
 *
 * Both verified with `eth_getCode` against GET /v1/info.
 */
const MINTERS: Record<RelayEnvironment, `0x${string}`> = {
  mainnet: '0x2222222d7164433c4C09B0b0D809a9b52C04C205',
  testnet: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
};

export const gatewayMinter = (env: RelayEnvironment): `0x${string}` => MINTERS[env];

export const GATEWAY_MINTER_ABI = [
  {
    name: 'gatewayMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestationPayload', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;
