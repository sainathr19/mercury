import { evmCoinType, isEnsName, namehash } from './ens';

// Reference values from viem's own namehash. Getting namehash wrong does not
// error — it resolves to a DIFFERENT name, i.e. someone else's address.
describe('namehash', () => {
  test('matches known constants', () => {
    expect(namehash('')).toBe('0x' + '0'.repeat(64));
    expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
    expect(namehash('vitalik.eth')).toBe('0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835');
    expect(namehash('mercurywallet.eth')).toBe('0x4512fb657ec43693affa29542596356c53b5b7cc4bb0b6ad3fca9c38a6b7f0fb');
    expect(namehash('sainath.mercurywallet.eth')).toBe('0x646d6a68bb1c1017a86b29c2a0030770e704277783d92de209370922e3ba7ef8');
  });

  test('a trailing dot is the same name', () => {
    expect(namehash('vitalik.eth.')).toBe(namehash('vitalik.eth'));
  });
});

describe('isEnsName', () => {
  test('accepts names, rejects addresses and noise', () => {
    expect(isEnsName('vitalik.eth')).toBe(true);
    expect(isEnsName('  Sainath.ETH ')).toBe(true);
    expect(isEnsName('0xF7Bc03D57D4B6FEc1A52c58D2cC64d8BBDca48e2')).toBe(false);
    expect(isEnsName('.eth')).toBe(false);
    expect(isEnsName('two words.eth')).toBe(false);
    expect(isEnsName('sainath')).toBe(false);
  });
});

// ENSIP-11: the address is the SAME, the coin type only records which chain the
// recipient actually watches.
test('evmCoinType matches the published Arc and Base values', () => {
  expect(evmCoinType(5042n)).toBe(2147488690);
  expect(evmCoinType(5042002n)).toBe(2152525650);
  expect(evmCoinType(8453n)).toBe(2147492101);
});
