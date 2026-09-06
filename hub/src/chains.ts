// Destination chains the relayer can mint on. Mirrors the app's chain registry
// (app/src/lib/chains.ts) — the two are separate processes, so the Circle domain
// is the shared key rather than a shared import.
import { defineChain, type Chain } from 'viem';
import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
});

/** Circle domain -> the chain to submit the mint on. */
export const CHAIN_BY_DOMAIN: Record<number, Chain> = {
  0: sepolia,
  3: arbitrumSepolia,
  6: baseSepolia,
  26: arcTestnet,
};

/** Same address on every EVM domain. */
export const GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as const;

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
