import { useRegistry } from './registryStore';
import { chainUsdc } from '../lib/chains';

describe('registryStore (seed defaults)', () => {
  it('exposes the bundled seed tokens for a chain without any I/O', () => {
    const sepolia = useRegistry.getState().tokensForChain(11155111n);
    expect(sepolia.map((t) => t.symbol).sort()).toEqual(['USDC', 'WBTC']);
    // Compared against lib/chains rather than a literal. This line used to pin
    // a hardcoded address, and when that address turned out to be a different
    // Sepolia token than the one Gateway settles, the test defended the bug.
    expect(sepolia.find((t) => t.symbol === 'USDC')!.contract.toLowerCase()).toBe(
      chainUsdc(11155111n)!.toLowerCase(),
    );
  });

  it('exposes the native coin per network', () => {
    expect(useRegistry.getState().nativeForChain(1n)!.symbol).toBe('ETH');
    expect(useRegistry.getState().nativeForChain(137n)!.symbol).toBe('POL');
  });
});
