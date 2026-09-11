import {
  formatUnits,
  toBaseUnits,
  shortenAddress,
  formatUsd,
  formatTotal,
  formatCrypto,
  formatFee,
  formatPercent,
} from './format';

test('formatUnits by decimals', () => {
  expect(formatUnits('100000000', 8)).toBe('1');
  expect(formatUnits('100000000', 9)).toBe('0.1');
  expect(formatUnits('0', 18)).toBe('0');
  expect(formatUnits(123456n, 6)).toBe('0.123456');
  expect(formatUnits('-100000000', 8)).toBe('-1');
});

test('toBaseUnits round-trips', () => {
  expect(toBaseUnits('1', 8)).toBe(100000000n);
  expect(toBaseUnits('0.1', 9)).toBe(100000000n);
  expect(toBaseUnits('0.000001', 6)).toBe(1n);
  expect(toBaseUnits('', 8)).toBe(0n);
});

test('shortenAddress', () => {
  expect(shortenAddress('0x1234567890abcdef1234', 6, 4)).toBe('0x1234…1234');
  expect(shortenAddress('short')).toBe('short');
});

test('formatUsd', () => {
  expect(formatUsd(0)).toBe('$0.00');
  expect(formatUsd(1234.5)).toBe('$1,234.50');
  expect(formatUsd(21820)).toBe('$21,820.00');
});

test('formatCrypto', () => {
  expect(formatCrypto(5)).toBe('5');
  expect(formatCrypto(0.0421)).toBe('0.0421');
  expect(formatCrypto(1234.567)).toBe('1,234.57');
});

test('formatCrypto never renders a held balance as zero', () => {
  // 4dp collapses a small holding of an expensive asset, which read as owning
  // nothing next to a row showing its dollar value. Small amounts fall back to
  // more precision instead.
  expect(formatCrypto(0.00003)).toBe('0.00003');
  expect(formatCrypto(0.000021)).toBe('0.000021');
  expect(formatCrypto(0.0000000001)).toBe('<0.00000001');
  // Zero is still zero, and the ordinary path is untouched.
  expect(formatCrypto(0)).toBe('0');
  expect(formatCrypto(0.5)).toBe('0.5');
});

test('formatFee keeps tiny L2 gas visible', () => {
  expect(formatFee(0.000021)).toBe('0.000021');
  expect(formatFee(0.0003)).toBe('0.0003');
  expect(formatFee(0.0000000005)).toBe('<0.000001');
  expect(formatFee(0)).toBe('0');
});

test('formatPercent', () => {
  expect(formatPercent(2.41)).toBe('+2.41%');
  expect(formatPercent(-1.12)).toBe('-1.12%');
});

describe('formatTotal', () => {
  it('shows the fee that formatCrypto rounds away', () => {
    // The bug this exists for: 4dp renders amount + fee as the amount.
    expect(formatCrypto(0.000145)).toBe('0.0001');
    expect(formatTotal(0.000145, 0.0001)).toBe('0.000145');
  });

  it('keeps the readable format when 4dp already shows the difference', () => {
    expect(formatTotal(1.5023, 1.5)).toBe('1.5023');
  });

  it('groups large totals like formatCrypto does', () => {
    expect(formatTotal(1234.5678, 1234.5)).toBe('1,234.57');
  });

  it('reads the same as the part when the difference is below 8dp', () => {
    expect(formatTotal(2.0000000001, 2)).toBe('2');
  });
});
