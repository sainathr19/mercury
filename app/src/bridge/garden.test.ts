/**
 * The error strings below are VERBATIM from the live Garden API, and the reason
 * this file exists is that two of them look the same to a user and mean
 * opposite things to us.
 */
import { classifyGardenError, gardenErrorMessage, GardenError, symbolOf } from './garden';

describe('classifying what Garden actually returns', () => {
  it('separates a missing route from a sleeping solver', () => {
    // Both observed on the live API within seconds of each other:
    //   testnet, every pair tried  -> "No order pair found"
    //   mainnet, bitcoin:btc->wbtc -> "no quotes available"
    // The first is permanent; the second is worth retrying. Telling a user to
    // "try again later" for a route that does not exist wastes their time, and
    // calling a sleeping solver "unsupported" is simply wrong.
    expect(
      classifyGardenError(
        'No order pair found : bitcoin_testnet:primary::base_sepolia:0xd1e0ba2b165726b3a6051b765d4564d030fdcf50',
      ),
    ).toBe('no_pair');
    expect(classifyGardenError('no quotes available')).toBe('no_quote');
  });

  it('is not fooled by case', () => {
    expect(classifyGardenError('NO ORDER PAIR FOUND : a::b')).toBe('no_pair');
    expect(classifyGardenError('No Quotes Available')).toBe('no_quote');
  });

  it('recognises an amount below the minimum', () => {
    expect(classifyGardenError('amount is less than min_amount')).toBe('below_min');
  });

  it('recognises a credentials problem', () => {
    expect(classifyGardenError('unauthorized')).toBe('auth');
    expect(classifyGardenError('missing garden-app-id header')).toBe('auth');
  });

  it('falls back rather than guessing', () => {
    expect(classifyGardenError('internal server error')).toBe('other');
    expect(classifyGardenError('')).toBe('other');
  });
});

describe('what reaches the screen', () => {
  const msg = (raw: string, status = 400) =>
    gardenErrorMessage(new GardenError(raw, status, classifyGardenError(raw)));

  it('never puts a contract address in front of a user', () => {
    // The raw no_pair error is 100+ characters of two contract addresses.
    const out = msg('No order pair found : bitcoin_testnet:primary::base_sepolia:0xd1e0ba2b165726b3a6051b765d4564d030fdcf50');
    expect(out).toBe('Garden does not offer this pair.');
    expect(out).not.toContain('0x');
  });

  it('says a sleeping route is worth retrying', () => {
    expect(msg('no quotes available')).toMatch(/try again/i);
  });

  it('passes a minimum-amount message through, because it is specific', () => {
    // Garden names the figure; paraphrasing would drop it.
    const raw = 'amount is less than min_amount 50000';
    expect(msg(raw)).toBe(raw);
  });
});

describe('GardenError', () => {
  it('carries the status and kind for callers that branch on them', () => {
    const e = new GardenError('no quotes available', 400, 'no_quote');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('GardenError');
    expect(e.status).toBe(400);
    expect(e.kind).toBe('no_quote');
  });
});

describe('symbolOf', () => {
  it('handles every shape the real catalog contains', () => {
    const cases: [string, string, string][] = [
      ['base_sepolia:wbtc', 'Wrapped Bitcoin:WBTC', 'WBTC'],
      ['arc_testnet:usdc', 'Arc Testnet:USDC', 'USDC'],
      ['monad_testnet:cbbtc', 'Coinbase Wrapped Bitcoin:cbBTC', 'cbBTC'],
      ['tempo_testnet:usdce', 'Tempo Testnet:USDC.e', 'USDC.e'],
      ['litecoin_testnet:ltc', 'Litecoin', 'LTC'],
      ['hypercore_testnet:usdc_perps', 'USD Coin:USDC (Perps)', 'USDC (Perps)'],
    ];
    for (const [id, name, want] of cases) {
      expect(symbolOf({ id, name })).toBe(want);
    }
  });
});
