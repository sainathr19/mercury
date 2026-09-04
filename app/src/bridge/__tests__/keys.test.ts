import { describe, it, expect } from 'vitest';
import { generatePhrase, isValidPhrase, invalidWords, deriveAccount } from '../keys';

// Standard BIP-39/BIP-44 vector, verified against Anvil account #0.
const VECTOR = 'test test test test test test test test test test test junk';
const VECTOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('keys', () => {
  it('generates a valid 12-word phrase', () => {
    const p = generatePhrase();
    expect(p.split(' ')).toHaveLength(12);
    expect(isValidPhrase(p)).toBe(true);
  });
  it('generates a different phrase each time', () => {
    expect(generatePhrase()).not.toBe(generatePhrase());
  });
  it('derives the known address from the known vector', () => {
    expect(deriveAccount(VECTOR).address).toBe(VECTOR_ADDRESS);
  });
  it('rejects a phrase with a bad checksum', () => {
    expect(isValidPhrase('test test test test test test test test test test test test')).toBe(false);
  });
  it('names words that are not in the wordlist', () => {
    // 'banana' IS a valid BIP-39 word; only genuinely absent words are reported.
    expect(invalidWords('test banana test zzzz qqqq')).toEqual(['zzzz', 'qqqq']);
  });
  it('tolerates extra whitespace and casing', () => {
    expect(deriveAccount(`  TEST   ${VECTOR.split(' ').slice(1).join(' ')}  `).address).toBe(VECTOR_ADDRESS);
  });
});
