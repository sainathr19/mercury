import { parseOffchainLookup, revertDataOf } from './ccipRead';

// Encoded by viem's encodeErrorResult for the canonical EIP-3668 error. Decoding
// this wrong is silent — the wallet would just report that the name has no
// address, which for a gasless subname is every user we ever issue one to.
const REVERT =
  '0x556f18300000000000000000000000001234567890abcdef1234567890abcdef1234567800000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001a01e9c9c6f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000002768747470733a2f2f67772e6578616d706c652f7b73656e6465727d2f7b646174617d2e6a736f6e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001d68747470733a2f2f6261636b75702e6578616d706c652f6c6f6f6b75700000000000000000000000000000000000000000000000000000000000000000000004deadbeef000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003c0ffee0000000000000000000000000000000000000000000000000000000000';

describe('parseOffchainLookup', () => {
  test('decodes every field of a real revert', () => {
    const l = parseOffchainLookup(REVERT);
    expect(l).not.toBeNull();
    expect(l!.sender.toLowerCase()).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(l!.urls).toEqual([
      'https://gw.example/{sender}/{data}.json',
      'https://backup.example/lookup',
    ]);
    expect(l!.callData).toBe('0xdeadbeef');
    expect(l!.callbackFunction).toBe('0x1e9c9c6f');
    expect(l!.extraData).toBe('0xc0ffee');
  });

  test('an ordinary revert is not mistaken for a lookup', () => {
    // ResolverNotFound — what an unregistered name actually returns.
    expect(parseOffchainLookup('0x77209fe800000000000000000000000000000000000000000000000000000000000000')).toBeNull();
    expect(parseOffchainLookup('0x')).toBeNull();
  });
});

test('revertDataOf finds the payload however the node reports it', () => {
  expect(revertDataOf({ data: '0x556f1830aa' })).toBe('0x556f1830aa');
  expect(revertDataOf({ message: 'execution reverted: 0x556f1830bb' })).toBe('0x556f1830bb');
  expect(revertDataOf({ message: 'plain failure' })).toBeNull();
  expect(revertDataOf(null)).toBeNull();
});
