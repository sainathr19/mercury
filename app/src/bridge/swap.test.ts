import {
  parseSymbol,
  parseDisplayName,
  coingeckoIdFor,
  chainKindFor,
  canonicalGardenChain,
  findGardenAsset,
  friendlyQuoteError,
  friendlySwapError,
  toAtomic,
  type GardenAsset,
} from './swap';

test('parseSymbol / parseDisplayName from "Name:SYMBOL"', () => {
  expect(parseSymbol('Bitcoin:BTC', 'x')).toBe('BTC');
  expect(parseSymbol('Wrapped Bitcoin:WBTC', 'x')).toBe('WBTC');
  expect(parseSymbol('plain', 'fallback')).toBe('fallback');
  expect(parseDisplayName('Wrapped Bitcoin:WBTC')).toBe('Wrapped Bitcoin');
  expect(parseDisplayName('plain')).toBe('plain');
});

test('coingeckoIdFor maps known symbols', () => {
  expect(coingeckoIdFor('BTC', 'x')).toBe('bitcoin');
  expect(coingeckoIdFor('WBTC', 'x')).toBe('wrapped-bitcoin');
  expect(coingeckoIdFor('ETH', 'x')).toBe('ethereum');
  expect(coingeckoIdFor('SOL', 'x')).toBe('solana');
  expect(coingeckoIdFor('ZZZ', 'Some:ZZZ')).toBe('some:zzz');
});

test('chainKindFor routes to the right address kind', () => {
  expect(chainKindFor('evm:421614')).toBe('eth');
  expect(chainKindFor('solana')).toBe('sol');
  expect(chainKindFor('bitcoin')).toBe('btc');
  expect(chainKindFor('bitcoin_testnet')).toBe('btc');
});

test('chainKindFor handles Garden named chains (v2 API)', () => {
  // Garden's v2 API returns named chains, not "evm:<id>". These must still route
  // EVM assets to the ETH address — the bug that made non-SOL assets vanish.
  expect(chainKindFor('arbitrum_sepolia')).toBe('eth');
  expect(chainKindFor('base_sepolia')).toBe('eth');
  expect(chainKindFor('ethereum_sepolia')).toBe('eth');
  expect(chainKindFor('arbitrum')).toBe('eth');
  expect(chainKindFor('base')).toBe('eth');
  expect(chainKindFor('ethereum')).toBe('eth');
  expect(chainKindFor('solana_testnet')).toBe('sol');
  // Tempo (pathUSD's chain) is EVM. Without its mapping it fell through to 'btc',
  // so the app derived a Bitcoin address as the pathUSD owner and Garden's
  // create_order rejected it ("not a valid EVM address") — surfaced as a swap
  // "Network issue". Must route to 'eth'.
  expect(chainKindFor('tempo')).toBe('eth');
  expect(chainKindFor('tempo_testnet')).toBe('eth');
});

test('canonicalGardenChain normalizes Garden names to the app-canonical form', () => {
  // EVM names → "evm:<chainId>" so held-balance matching against the portfolio works.
  expect(canonicalGardenChain('arbitrum_sepolia')).toBe('evm:421614');
  expect(canonicalGardenChain('base_sepolia')).toBe('evm:84532');
  expect(canonicalGardenChain('ethereum_sepolia')).toBe('evm:11155111');
  expect(canonicalGardenChain('arbitrum')).toBe('evm:42161');
  expect(canonicalGardenChain('base')).toBe('evm:8453');
  expect(canonicalGardenChain('ethereum')).toBe('evm:1');
  // Tempo (pathUSD) → its EVM chain id, so the owner address derives as EVM.
  expect(canonicalGardenChain('tempo')).toBe('evm:4217');
  expect(canonicalGardenChain('tempo_testnet')).toBe('evm:42431');
  // Bitcoin / Solana families collapse to the canonical single key.
  expect(canonicalGardenChain('bitcoin_testnet')).toBe('bitcoin');
  expect(canonicalGardenChain('bitcoin')).toBe('bitcoin');
  expect(canonicalGardenChain('solana_testnet')).toBe('solana');
  expect(canonicalGardenChain('solana')).toBe('solana');
  // Unsupported chains pass through unchanged (match no balance).
  expect(canonicalGardenChain('starknet_sepolia')).toBe('starknet_sepolia');
});

test('findGardenAsset prefers an exact (coingeckoId + EVM chain) match', () => {
  const mk = (id: string, coingeckoId: string, chain: string): GardenAsset => ({
    id, symbol: 'USDC', displayName: 'USD Coin', chain, chainName: null, decimals: 6,
    price: 1, tokenIcon: null, chainIcon: null, coingeckoId, colorHex: '#000', chainKind: 'eth',
    tokenAddress: null,
  });
  const assets = [
    mk('base_sepolia:usdc', 'usd-coin', 'evm:84532'),
    mk('arbitrum_sepolia:usdc', 'usd-coin', 'evm:421614'),
  ];
  // exact chain wins over registry order
  expect(findGardenAsset(assets, 'usd-coin', '421614')?.id).toBe('arbitrum_sepolia:usdc');
  // no chain → first coingeckoId match
  expect(findGardenAsset(assets, 'usd-coin')?.id).toBe('base_sepolia:usdc');
  // chain Garden doesn't list → fall back to coingeckoId
  expect(findGardenAsset(assets, 'usd-coin', '999')?.id).toBe('base_sepolia:usdc');
  // unknown asset → undefined
  expect(findGardenAsset(assets, 'tether', '421614')).toBeUndefined();
});

test('toAtomic converts human → base units by decimals', () => {
  expect(toAtomic('0.001', 8)).toBe('100000');
  expect(toAtomic('1', 8)).toBe('100000000');
  expect(toAtomic('1', 18)).toBe('1000000000000000000'); // no float overflow
});

test('friendlyQuoteError classifies common cases', () => {
  expect(friendlyQuoteError('HTTP 400 Bad Request')).toBe('Route Unavailable');
  expect(friendlyQuoteError('network timeout')).toMatch(/Network error/);
  expect(friendlyQuoteError('amount below minimum')).toMatch(/minimum/);
  expect(friendlyQuoteError('weird')).toBe('Route Unavailable');
});

test("friendlyQuoteError parses Garden's range error (returned as a 400)", () => {
  const raw =
    'Error: Garden /quote HTTP 400 {"status":"Error","error":"Exact output quote error : expected amount to be within the range of 50000 to 1000000"}';
  // 10 sats is below the 50000 min → humanized minimum in BTC (8dp).
  expect(friendlyQuoteError(raw, { atomicAmount: '10', decimals: 8, symbol: 'BTC' })).toBe('Minimum is 0.0005 BTC');
  // Over the 1000000 max → humanized maximum.
  expect(friendlyQuoteError(raw, { atomicAmount: '2000000', decimals: 8, symbol: 'BTC' })).toBe('Maximum is 0.01 BTC');
  // Without context it still classifies (no generic "pair isn't available").
  expect(friendlyQuoteError(raw)).toBe('Amount is below the minimum');
});

test('friendlySwapError humanizes known cases and hides raw Garden errors', () => {
  expect(friendlySwapError('missing calldata for route')).toBe('Route Unavailable');
  expect(friendlySwapError('Quote expired')).toMatch(/expired/);
  expect(friendlySwapError('insufficient balance')).toMatch(/Insufficient/);
  // Anything else (e.g. a raw gardenwallet error) → generic network message.
  expect(friendlySwapError('gardenwallet: some internal error 0x123')).toBe('Network issue — please try again.');
  expect(friendlySwapError('something else')).toBe('Network issue — please try again.');
});
