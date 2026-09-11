//! Where the unified balance lives, and how long a deposit takes to get there.
//
// Two facts drive every timing promise this feature makes, and neither is
// obvious enough to leave implicit:
//
//  1. SPENDING from Gateway is instant. DEPOSITING is not. A deposit is only
//     credited once its transaction reaches finality on the chain it landed on,
//     and Base, Arbitrum, Optimism, Unichain and World Chain all inherit
//     Ethereum's — 13 to 19 minutes. Polygon and Avalanche take about eight
//     seconds. Arc takes about half of one.
//
//  2. So the "obvious" L2 is the worst choice here. Routing deposits to Base
//     because it is familiar would make every top-up take a quarter of an hour
//     to become usable, for no benefit: the balance is spendable on every chain
//     regardless of which one it was deposited on.
//
// Numbers are Circle's published confirmation requirements, keyed by Circle
// domain because that is the identifier that does not change when a chain is
// renamed.
import { chainForDomain, type ChainDef, type ChainEnvironment } from './chains';

/**
 * Seconds until a deposit on this domain becomes spendable.
 *
 * Upper bounds, deliberately: a range shown as its optimistic end is a promise
 * the app cannot keep, and "ready in 13 minutes" followed by six more minutes of
 * waiting is worse than having said 19.
 */
const READY_SECONDS: Record<number, number> = {
  0: 1140, // Ethereum      ~65 blocks    13-19 min
  1: 8, //    Avalanche       1 block      ~8s
  2: 1140, // Optimism      ~65 ETH blocks 13-19 min
  3: 1140, // Arbitrum      ~65 ETH blocks 13-19 min
  5: 8, //    Solana        ~2-3 slots     ~8s
  6: 1140, // Base          ~65 ETH blocks 13-19 min
  7: 8, //    Polygon PoS   ~2-3 blocks    ~8s
  10: 1140, // Unichain     ~65 ETH blocks 13-19 min
  13: 8, //   Sonic          ~1 block      ~8s
  14: 1140, // World Chain  ~65 ETH blocks 13-19 min
  16: 5, //   Sei            ~1 block      ~5s
  19: 5, //   HyperEVM       ~1 block      ~5s
  26: 1, //   Arc            ~1 block      ~0.5s, rounded up to a sayable number
};

/** Fallback for a domain we have no measurement for. Pessimistic on purpose. */
const UNKNOWN_READY_SECONDS = 1140;

export const depositReadySeconds = (domain: number): number =>
  READY_SECONDS[domain] ?? UNKNOWN_READY_SECONDS;

/** "about 8 seconds" / "up to 19 minutes" — phrasing that survives being wrong. */
export function readyLabel(domain: number): string {
  const s = depositReadySeconds(domain);
  if (s <= 2) return 'about a second';
  if (s < 60) return `about ${s} seconds`;
  return `up to ${Math.round(s / 60)} minutes`;
}

/**
 * The domain the wallet deposits into, per environment.
 *
 *  • testnet → Arc. Roughly half a second to finality, and its gas token IS
 *    USDC, so depositing needs no second coin. Nothing else comes close.
 *  • mainnet → Polygon. Eight seconds to finality and the cheapest domain to
 *    spend from ($0.0015 of gas per transfer, against $0.01 on Base and $1.00
 *    on Ethereum). Arc is not an option: Gateway lists no domain 26 on mainnet.
 */
const HUB_DOMAIN: Record<ChainEnvironment, number> = {
  testnet: 26,
  mainnet: 7,
};

export function hubChain(env: ChainEnvironment): ChainDef | undefined {
  return chainForDomain(HUB_DOMAIN[env], env);
}

export const hubDomain = (env: ChainEnvironment): number => HUB_DOMAIN[env];

/**
 * Is this chain's gas its own USDC?
 *
 * Arc's is, which removes the whole "you need a gas coin to deposit" problem
 * there. Everywhere else a deposit needs the chain's native coin, and a wallet
 * holding only USDC cannot make one.
 */
export const gasIsUsdc = (chain: ChainDef): boolean => chain.nativeSymbol === 'USDC';
