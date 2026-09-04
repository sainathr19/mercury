import { describe, it, expect } from 'vitest';
import { pickChallenge, checkChallenge } from '../verify';

const P = 'test test test test test test test test test test test junk';
const WORDS = P.split(' ');

describe('verify', () => {
  it('picks three distinct in-range indices', () => {
    const idx = pickChallenge(P);
    expect(idx).toHaveLength(3);
    expect(new Set(idx).size).toBe(3);
    idx.forEach((i) => { expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(12); });
  });
  it('returns indices in ascending order so the UI reads naturally', () => {
    const idx = pickChallenge(P);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('accepts correct answers', () => {
    const idx = pickChallenge(P);
    expect(checkChallenge(P, idx, idx.map((i) => WORDS[i]))).toBe(true);
  });
  it('rejects a wrong answer', () => {
    expect(checkChallenge(P, [0, 1, 11], ['test', 'test', 'wrong'])).toBe(false);
  });
  it('rejects when the answer count does not match', () => {
    expect(checkChallenge(P, [0, 1, 11], ['test', 'test'])).toBe(false);
  });
  it('is case and whitespace insensitive', () => {
    expect(checkChallenge(P, [0, 11], ['  TEST ', 'Junk'])).toBe(true);
  });
});
