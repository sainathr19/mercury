import { describe, it, expect } from 'vitest';
import { ARC_TESTNET, nativeToMinor, minorToNative, formatMinor } from '@shared/chains';

describe('chains', () => {
  it('has the verified Arc testnet config', () => {
    expect(ARC_TESTNET.id).toBe(5042002);
    expect(ARC_TESTNET.ensCoinType).toBe(2152525650);
    expect(ARC_TESTNET.usdc).toBe('0x3600000000000000000000000000000000000000');
  });
  it('converts native 18dp to minor 6dp', () => {
    expect(nativeToMinor(65039980573344807780n)).toBe(65039980n);
  });
  it('round-trips minor units through native', () => {
    expect(nativeToMinor(minorToNative(1_000000n))).toBe(1_000000n);
  });
  it('truncates rather than rounding up', () => {
    expect(nativeToMinor(1_999999999999n)).toBe(1n);
  });
  it('formats minor units for display', () => {
    expect(formatMinor(1_234567n)).toBe('1.23');
  });
});
