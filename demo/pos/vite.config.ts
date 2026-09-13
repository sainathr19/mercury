import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Every chain's RPC is proxied rather than called from the page.
//
// A browser POSTing JSON-RPC straight at a public endpoint is subject to that
// host's CORS policy, which we do not control and which can change without
// notice — and there are eight of them here, so one unlucky header would break
// the demo on the one chain being shown. Proxying makes every call same-origin.
//
// Endpoints are the same ones the wallet uses (app/src/lib/chains.ts).
const RPC: Record<string, string> = {
  arc: 'https://rpc.testnet.arc.io',
  base: 'https://base-sepolia-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-sepolia-rpc.publicnode.com',
  optimism: 'https://optimism-sepolia-rpc.publicnode.com',
  polygon: 'https://polygon-amoy-bor-rpc.publicnode.com',
  avalanche: 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  unichain: 'https://unichain-sepolia-rpc.publicnode.com',
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      Object.entries(RPC).map(([key, target]) => [
        `/rpc/${key}`,
        { target, changeOrigin: true, rewrite: () => new URL(target).pathname },
      ]),
    ),
  },
});
