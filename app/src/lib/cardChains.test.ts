import { CARD_CHAINS, cardChainMeta, type CardChain } from './cardChains';

test('every card chain has the correct atomic decimals', () => {
  // These feed parseUnits when building a card transfer; a wrong value would
  // silently mis-scale the amount, so they are pinned explicitly.
  expect(cardChainMeta('btc').decimals).toBe(8);
  expect(cardChainMeta('eth').decimals).toBe(18);
  expect(cardChainMeta('usdc').decimals).toBe(6);
  expect(cardChainMeta('sol').decimals).toBe(9);
});

test('each chain maps to a distinct coingecko id', () => {
  const ids = CARD_CHAINS.map((c) => c.coingeckoId);
  expect(new Set(ids).size).toBe(CARD_CHAINS.length);
  expect(cardChainMeta('usdc').coingeckoId).toBe('usd-coin');
});

test('cardChainMeta throws on an unknown chain', () => {
  expect(() => cardChainMeta('doge' as CardChain)).toThrow(/Unknown card chain/);
});
