import { parseEvmReceipt, parseSolStatus, familyForSymbol } from '../lib/receipt-parse';

describe('parseEvmReceipt', () => {
  it('treats a null receipt (not mined yet) as pending', () => {
    expect(parseEvmReceipt(null)).toBe('pending');
    expect(parseEvmReceipt(undefined)).toBe('pending');
  });
  it('treats a receipt with no status field as pending', () => {
    expect(parseEvmReceipt({})).toBe('pending');
    expect(parseEvmReceipt({ status: 123 })).toBe('pending');
  });
  it('maps status 0x1 to confirmed', () => {
    expect(parseEvmReceipt({ status: '0x1' })).toBe('confirmed');
    expect(parseEvmReceipt({ status: '0x01' })).toBe('confirmed');
  });
  it('maps status 0x0 (revert / out-of-gas) to failed', () => {
    expect(parseEvmReceipt({ status: '0x0' })).toBe('failed');
    expect(parseEvmReceipt({ status: '0x00' })).toBe('failed');
  });
});

describe('parseSolStatus', () => {
  it('treats a null status (unknown to cluster) as pending', () => {
    expect(parseSolStatus(null)).toBe('pending');
  });
  it('maps a set err to failed', () => {
    expect(parseSolStatus({ err: { InstructionError: [0, 'Custom'] } })).toBe('failed');
  });
  it('maps confirmed / finalized commitment to confirmed', () => {
    expect(parseSolStatus({ err: null, confirmationStatus: 'confirmed' })).toBe('confirmed');
    expect(parseSolStatus({ err: null, confirmationStatus: 'finalized' })).toBe('confirmed');
  });
  it('treats a merely-processed tx as still pending', () => {
    expect(parseSolStatus({ err: null, confirmationStatus: 'processed' })).toBe('pending');
  });
});

describe('familyForSymbol', () => {
  it('maps native symbols to chain families', () => {
    expect(familyForSymbol('BTC')).toBe(0);
    expect(familyForSymbol('ETH')).toBe(1);
    expect(familyForSymbol('SOL')).toBe(2);
    expect(familyForSymbol('sol')).toBe(2);
  });
  it('returns undefined for non-native symbols', () => {
    expect(familyForSymbol('USDC')).toBeUndefined();
  });
});
