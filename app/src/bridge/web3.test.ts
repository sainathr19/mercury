import {
  weiHexToDecimal,
  hexToArrayBuffer,
  personalSignBytes,
  typedDataJson,
  chainIdHex,
  resolveUrl,
  originOf,
} from './web3';

test('weiHexToDecimal handles wide values + edge cases', () => {
  expect(weiHexToDecimal('0xde0b6b3a7640000')).toBe('1000000000000000000'); // 1 ETH
  expect(weiHexToDecimal('0x0')).toBe('0');
  expect(weiHexToDecimal('0x')).toBe('0');
  expect(weiHexToDecimal('')).toBe('0');
  expect(weiHexToDecimal('0xZZ')).toBe('0'); // invalid → 0
});

test('hexToArrayBuffer parses bytes', () => {
  expect(Array.from(new Uint8Array(hexToArrayBuffer('0x0a0b0c')))).toEqual([10, 11, 12]);
  expect(hexToArrayBuffer('0x').byteLength).toBe(0);
  expect(hexToArrayBuffer('0xabc').byteLength).toBe(0); // odd length → empty
});

test('personalSignBytes decodes hex and utf8', () => {
  expect(Array.from(new Uint8Array(personalSignBytes(['0x48656c6c6f', '0xaddr'])))).toEqual([
    72, 101, 108, 108, 111,
  ]); // "Hello"
  expect(new TextDecoder().decode(personalSignBytes(['gm', '0xaddr']))).toBe('gm');
});

test('typedDataJson accepts string or object', () => {
  expect(typedDataJson(['0xaddr', '{"a":1}'])).toBe('{"a":1}');
  expect(typedDataJson(['0xaddr', { a: 1 }])).toBe('{"a":1}');
  expect(() => typedDataJson(['0xaddr'])).toThrow();
});

test('chainIdHex', () => {
  expect(chainIdHex(11155111n)).toBe('0xaa36a7');
  expect(chainIdHex(1n)).toBe('0x1');
});

test('resolveUrl: domain vs search vs blocked', () => {
  expect(resolveUrl('app.uniswap.org')).toBe('https://app.uniswap.org');
  expect(resolveUrl('https://x.com')).toBe('https://x.com');
  expect(resolveUrl('hello world')).toBe('https://www.google.com/search?q=hello%20world');
  expect(resolveUrl('  ')).toBeNull();
  expect(resolveUrl('javascript:alert(1)')).toBe('https://www.google.com/search?q=javascript%3Aalert(1)');
});

test('originOf extracts host', () => {
  expect(originOf('https://app.uniswap.org/swap?x=1')).toBe('app.uniswap.org');
  expect(originOf('not a url')).toBe('');
});
