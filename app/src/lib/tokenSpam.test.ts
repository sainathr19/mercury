import { isLikelySpam, SPAM_VALUE_FLOOR } from './tokenSpam';

describe('isLikelySpam', () => {
  it('hides a discovered token with no value', () => {
    expect(isLikelySpam({ discovered: true }, 0)).toBe(true);
    expect(isLikelySpam({ discovered: true }, 0.004)).toBe(true);
  });

  it('never hides something worth money, however it arrived', () => {
    // The safety brake. Hiding money is a worse bug than showing spam.
    expect(isLikelySpam({ discovered: true }, SPAM_VALUE_FLOOR)).toBe(false);
    expect(isLikelySpam({ discovered: true }, 1200)).toBe(false);
  });

  it('never hides a registry token or a hand-added one, even at zero', () => {
    // A real token can be unpriced — brand new, or not covered by the feed.
    // Provenance is what protects it, not its price.
    expect(isLikelySpam({}, 0)).toBe(false);
    expect(isLikelySpam({ discovered: false }, 0)).toBe(false);
  });

  it('treats a broken price as no value rather than passing it through', () => {
    expect(isLikelySpam({ discovered: true }, NaN)).toBe(true);
  });
});
