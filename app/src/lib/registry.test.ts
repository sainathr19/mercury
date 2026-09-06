import {
  tokensForChain,
  nativeForChain,
  solanaTokens,
  solanaMints,
  networkByKey,
  isValidRegistry,
  builtinDisplay,
  type Registry,
} from './registry';

const ETH = { symbol: 'ETH', name: 'Ethereum', decimals: 18, coingeckoId: 'ethereum', imageUrl: '' };

const REG: Registry = {
  version: '2026-06-24.1',
  updatedAt: '2026-06-24T00:00:00.000Z',
  networks: {
    '1': {
      id: '1', chainType: 'evm', chainId: 1, name: 'Ethereum', imageUrl: '', native: ETH,
      tokens: [
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin', imageUrl: '', address: '0xA0b8' },
        { symbol: 'ARB', name: 'Arbitrum', decimals: 18, coingeckoId: 'arbitrum', imageUrl: '', address: '0xARB1' },
      ],
    },
    '42161': {
      id: '42161', chainType: 'evm', chainId: 42161, name: 'Arbitrum', imageUrl: '', native: ETH,
      tokens: [{ symbol: 'ARB', name: 'Arbitrum', decimals: 18, coingeckoId: 'arbitrum', imageUrl: '', address: '0xARB42161' }],
    },
    solana: {
      id: 'solana', chainType: 'solana', name: 'Solana', imageUrl: '',
      native: { symbol: 'SOL', name: 'Solana', decimals: 9, coingeckoId: 'solana', imageUrl: '' },
      tokens: [{ symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin', imageUrl: '', address: 'EPjF…mint' }],
    },
    bitcoin: {
      id: 'bitcoin', chainType: 'bitcoin', name: 'Bitcoin', imageUrl: '',
      native: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, coingeckoId: 'bitcoin', imageUrl: '' },
      tokens: [],
    },
  },
};

describe('tokensForChain (EVM)', () => {
  it('resolves each token contract for the requested chain', () => {
    expect(tokensForChain(REG, 1n).map((x) => x.symbol).sort()).toEqual(['ARB', 'USDC']);
    expect(tokensForChain(REG, 1n).find((x) => x.symbol === 'USDC')!.contract).toBe('0xA0b8');
  });
  it('returns [] for an unknown chain', () => expect(tokensForChain(REG, 999n)).toEqual([]));
});

describe('native + non-EVM accessors', () => {
  it('returns the EVM native per chain', () => {
    expect(nativeForChain(REG, 1n)!.symbol).toBe('ETH');
    expect(nativeForChain(REG, 999n)).toBeUndefined();
  });
  it('exposes Solana + Bitcoin via networkByKey/solanaTokens', () => {
    expect(networkByKey(REG, 'solana')!.native.symbol).toBe('SOL');
    expect(networkByKey(REG, 'bitcoin')!.native.symbol).toBe('BTC');
    expect(solanaTokens(REG).map((t) => t.symbol)).toEqual(['USDC']);
    expect(solanaTokens(REG)[0].contract).toBe('EPjF…mint');
  });
  it('maps SPL mints to assets for enrichment/allowlist', () => {
    expect(solanaMints(REG).get('EPjF…mint')!.symbol).toBe('USDC');
    expect(solanaMints(REG).has('not-a-mint')).toBe(false);
  });
});

describe('isValidRegistry', () => {
  it('accepts a well-formed registry', () => expect(isValidRegistry(REG)).toBe(true));
  it('rejects junk', () => {
    expect(isValidRegistry(null)).toBe(false);
    expect(isValidRegistry({ version: '1', networks: [] })).toBe(false);
    expect(isValidRegistry({ version: '1', networks: { '1': { chainId: 1 } } })).toBe(false); // no family/native/tokens
  });
});

describe('builtinDisplay', () => {
  it('aggregates a token across the networks it appears on', () => {
    const usdc = builtinDisplay(REG).find((x) => x.symbol === 'USDC')!;
    expect(usdc.networks.sort()).toEqual(['Ethereum', 'Solana']);
    const arb = builtinDisplay(REG).find((x) => x.symbol === 'ARB')!;
    expect(arb.networks.sort()).toEqual(['Arbitrum', 'Ethereum']);
  });
});
