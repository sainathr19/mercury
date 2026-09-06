import { isValidBtc, isValidEvm, isValidSol } from './validation';

test('EVM 0x + 40 hex', () => {
  expect(isValidEvm('0xd35e3f7c5d8b4a2f9e1c0b6a7d8e9f0a1b2c3d4e')).toBe(true);
  expect(isValidEvm('0xZZZ')).toBe(false);
  expect(isValidEvm('not-an-address')).toBe(false);
  expect(isValidEvm('0x5B6D94243A4221e6')).toBe(false);
});

test('BTC bech32/bech32m prefix + charset', () => {
  expect(isValidBtc('tb1pem3lnvc7eeptefhmvva24xkahjh6pyl2mnkg9kh3e575dr8jfmkqc4deaw')).toBe(true);
  expect(isValidBtc('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
  expect(isValidBtc('hello')).toBe(false);
});

test('SOL base58 length', () => {
  expect(isValidSol('DaZCFNUGTtfBx2e8f85b3ac61TCntphxuM426aGNb1Zt')).toBe(true);
  expect(isValidSol('0x123')).toBe(false);
  expect(isValidSol('0OIl')).toBe(false);
});
