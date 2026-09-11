//! One USDC address per chain, asserted across every file that names one.
//
// This exists because they drifted. `lib/chains.ts` carried Circle's Sepolia
// USDC — the only one GatewayWallet accepts — while `assets/registry.seed.json`
// and `bridge/networks.ts` carried a DIFFERENT ERC-20 that also calls itself
// "USD Coin". Both are real contracts on Sepolia, so nothing errored: the
// Gateway card read Circle's and showed $20, the portfolio read the other one
// and showed $0, and the app told the same user that money had arrived and that
// they did not have it.
//
// A mismatch is invisible at run time, so it is asserted at build time.
import { CHAINS, chainUsdc } from './chains';
import { USDC_MAINNET, USDC_SEPOLIA } from '../bridge/networks';
import seed from '../../assets/registry.seed.json';

interface SeedToken { symbol: string; address?: string }
interface SeedNetwork { tokens?: SeedToken[] }
const networks = (seed as { networks: Record<string, SeedNetwork> }).networks;

const seedUsdc = (chainId: bigint): string | undefined =>
  networks[chainId.toString()]?.tokens?.find((t) => t.symbol === 'USDC')?.address;

describe('every file that names a USDC address agrees', () => {
  // Only chains the seed actually covers. A chain the registry has not been
  // taught about is a gap, not a contradiction, and is not this test's business.
  const shared = CHAINS.filter((c) => c.usdc && seedUsdc(c.chainId));

  test('the seed covers the chains this asserts over', () => {
    // Guards the filter above: if the seed is restructured and every lookup
    // starts returning undefined, `shared` empties and the suite below passes
    // while checking nothing.
    expect(shared.length).toBeGreaterThan(0);
  });

  test.each(shared.map((c) => [c.name, c.chainId] as const))(
    '%s: registry seed matches lib/chains',
    (_name, chainId) => {
      const chains = chainUsdc(chainId);
      expect(seedUsdc(chainId)?.toLowerCase()).toBe(chains?.toLowerCase());
    },
  );

  test('bridge/networks constants match lib/chains', () => {
    expect(USDC_SEPOLIA.toLowerCase()).toBe(chainUsdc(11155111n)?.toLowerCase());
    expect(USDC_MAINNET.toLowerCase()).toBe(chainUsdc(1n)?.toLowerCase());
  });
});
