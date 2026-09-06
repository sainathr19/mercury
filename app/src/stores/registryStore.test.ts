import { useRegistry } from './registryStore';

describe('registryStore (seed defaults)', () => {
  it('exposes the bundled seed tokens for a chain without any I/O', () => {
    const sepolia = useRegistry.getState().tokensForChain(11155111n);
    expect(sepolia.map((t) => t.symbol).sort()).toEqual(['USDC', 'WBTC']);
    expect(sepolia.find((t) => t.symbol === 'USDC')!.contract.toLowerCase()).toContain('0xaddd620');
  });

  it('exposes the native coin per network', () => {
    expect(useRegistry.getState().nativeForChain(1n)!.symbol).toBe('ETH');
    expect(useRegistry.getState().nativeForChain(137n)!.symbol).toBe('POL');
  });
});
