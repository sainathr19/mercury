// ─────────────────────────────────────────────────────────────────────────────
//  The chains the till can ask to be paid on.
//
//  Every one carries a Circle domain, which is the point: the customer holds a
//  single Gateway balance and the till decides where the money should LAND. Ask
//  on Base and a payer whose USDC was deposited from anywhere can still settle,
//  because the burn intent names this chain as the destination.
//
//  Addresses and RPCs are copied from app/src/lib/chains.ts — the wallet's own
//  registry — so the till and the wallet can never disagree about what USDC is
//  on a given chain.
// ─────────────────────────────────────────────────────────────────────────────

export interface Chain {
  /** Proxy path segment, and the React key. */
  key: string;
  name: string;
  short: string;
  chainId: number;
  usdc: string;
  explorerTx: (hash: string) => string;
  /** Circle domain — shown so the demo can point at what makes this work. */
  domain: number;
  /**
   * Arc is the exception that shapes this whole module.
   *
   * There, USDC is the NATIVE coin as well as an ERC-20, and Transfer logs come
   * from two addresses at two scales: the ERC-20 contract (6dp) and the native
   * emitter (18dp). An ERC-20 `transfer()` emits from both, a plain value send
   * only from the native one — so the native emitter is a strict superset and
   * watching it alone counts every payment exactly once. Everywhere else USDC is
   * an ordinary 6dp ERC-20 and the contract itself is the only emitter.
   */
  nativeEmitter?: { address: string; scaleDown: bigint };
}

const ARC_NATIVE_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';

export const CHAINS: Chain[] = [
  {
    key: 'arc',
    name: 'Arc Testnet',
    short: 'Arc',
    chainId: 5042002,
    usdc: '0x3600000000000000000000000000000000000000',
    explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
    domain: 26,
    nativeEmitter: { address: ARC_NATIVE_EMITTER, scaleDown: 10n ** 12n },
  },
  {
    key: 'base',
    name: 'Base Sepolia',
    short: 'Base',
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    domain: 6,
  },
  {
    key: 'arbitrum',
    name: 'Arbitrum Sepolia',
    short: 'Arbitrum',
    chainId: 421614,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorerTx: (h) => `https://sepolia.arbiscan.io/tx/${h}`,
    domain: 3,
  },
  {
    key: 'optimism',
    name: 'OP Sepolia',
    short: 'OP',
    chainId: 11155420,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    explorerTx: (h) => `https://sepolia-optimism.etherscan.io/tx/${h}`,
    domain: 2,
  },
  {
    key: 'polygon',
    name: 'Polygon Amoy',
    short: 'Polygon',
    chainId: 80002,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    explorerTx: (h) => `https://amoy.polygonscan.com/tx/${h}`,
    domain: 7,
  },
  {
    key: 'avalanche',
    name: 'Avalanche Fuji',
    short: 'Avalanche',
    chainId: 43113,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    explorerTx: (h) => `https://testnet.snowtrace.io/tx/${h}`,
    domain: 1,
  },
  {
    key: 'sepolia',
    name: 'Ethereum Sepolia',
    short: 'Ethereum',
    chainId: 11155111,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
    domain: 0,
  },
  {
    key: 'unichain',
    name: 'Unichain Sepolia',
    short: 'Unichain',
    chainId: 1301,
    usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
    explorerTx: (h) => `https://sepolia.uniscan.xyz/tx/${h}`,
    domain: 10,
  },
];

export const chainByKey = (key: string): Chain => CHAINS.find((c) => c.key === key) ?? CHAINS[0];
