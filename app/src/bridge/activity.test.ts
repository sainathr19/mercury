import { pendingSendItem, privateSendItem } from './activity';

// ─────────────────────────────────────────────────────────────────────────────
//  Arc's native coin is USDC, not ETH.
//
//  `chain` on these rows is a FAMILY — btc, eth or sol — so its metadata says
//  every EVM chain's native coin is ETH. On Arc that is wrong, and it showed:
//  a native Arc send of 0.05 USDC rendered as "-0.05 ETH" with an Ethereum icon
//  until the next chain scan corrected it. Wrong at exactly the moment someone
//  is looking for confirmation that their money went where they meant.
// ─────────────────────────────────────────────────────────────────────────────
describe('send rows name what was actually sent', () => {
  const base = { chain: 'eth' as const, id: '0xabc', amount: 0.05, usd: 0.05, explorerUrl: '' };
  const USDC = { symbol: 'USDC', coingeckoId: 'usd-coin', colorHex: '#2775CA' };

  test('a native Arc send reads USDC, not ETH', () => {
    const item = pendingSendItem({ ...base, to: '0x1111111111111111111111111111111111111111', asset: USDC });
    expect(item.symbol).toBe('USDC');
    expect(item.amountText).toBe('-0.05 USDC');
    expect(item.coingeckoId).toBe('usd-coin');
  });

  test('a private Arc send reads USDC too', () => {
    expect(privateSendItem({ ...base, asset: USDC }).amountText).toBe('-0.05 USDC');
  });

  test('a real ETH send still reads ETH', () => {
    const item = pendingSendItem({
      ...base, to: '0x1111111111111111111111111111111111111111',
      asset: { symbol: 'ETH', coingeckoId: 'ethereum', colorHex: '#627EEA' },
    });
    expect(item.amountText).toBe('-0.05 ETH');
  });

  test('falls back to the family when nothing is passed', () => {
    expect(pendingSendItem({ ...base, to: '0x1111111111111111111111111111111111111111' }).symbol).toBe('ETH');
  });
});
