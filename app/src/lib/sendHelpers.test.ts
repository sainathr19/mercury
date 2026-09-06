import { chainIconKeyFor } from './sendHelpers';
import type { PortfolioAsset } from '../bridge/portfolio';

// chainIconKeyFor only reads: tokenContract, tokenMint, chain, evmChainId, symbol.
const asset = (p: Partial<PortfolioAsset>): PortfolioAsset =>
  ({
    id: 'x',
    name: 'x',
    symbol: 'X',
    amount: 0,
    decimals: 6,
    coingeckoId: 'x',
    chain: 'ethereum',
    colorHex: '#000',
    ...p,
  }) as PortfolioAsset;

test('EVM tokens badge with their own chain', () => {
  expect(
    chainIconKeyFor(asset({ symbol: 'USDC', evmChainId: 8453n, tokenContract: '0xabc' })),
  ).toBe('base');
  expect(
    chainIconKeyFor(asset({ symbol: 'USDC', evmChainId: 42161n, tokenContract: '0xabc' })),
  ).toBe('arbitrum');
});

test('native ETH badges only off Ethereum mainnet; home-chain natives show none', () => {
  expect(chainIconKeyFor(asset({ symbol: 'ETH', evmChainId: 1n }))).toBeNull();
  expect(chainIconKeyFor(asset({ symbol: 'ETH', evmChainId: 8453n }))).toBe('base');
  expect(chainIconKeyFor(asset({ symbol: 'BTC', chain: 'bitcoin' }))).toBeNull();
});

test('Tempo tokens badge with Tempo, not Ethereum', () => {
  // Regression: Tempo chain ids fell through evmChainKey's default → 'ethereum',
  // so pathUSD wrongly showed the Ethereum mark.
  expect(
    chainIconKeyFor(asset({ symbol: 'pathUSD', evmChainId: 4217n, tokenContract: '0x20c0000000000000000000000000000000000000' })),
  ).toBe('tempo');
  expect(
    chainIconKeyFor(asset({ symbol: 'alphaUSD', evmChainId: 42431n, tokenContract: '0x20c0000000000000000000000000000000000001' })),
  ).toBe('tempo');
});
