import { decodeAbiString, chainNames } from './tokens';

test('decodeAbiString decodes a dynamic ABI string', () => {
  // offset(0x20) + length(8) + "USD Coin" right-padded to 32 bytes
  const offset = '0'.repeat(62) + '20';
  const length = '0'.repeat(63) + '8';
  const data = '55534420436f696e' + '0'.repeat(48); // "USD Coin"
  expect(decodeAbiString('0x' + offset + length + data)).toBe('USD Coin');
});

test('decodeAbiString decodes a bytes32 string', () => {
  const data = '444149' + '0'.repeat(58); // "DAI"
  expect(decodeAbiString('0x' + data)).toBe('DAI');
});

test('decodeAbiString returns empty for too-short input', () => {
  expect(decodeAbiString('0x00')).toBe('');
});

test('chainNames maps known ids', () => {
  // 'Arbitrum One' is the chain's real name and what the registry uses
  // everywhere else (activity rows, the networks screen). Chain names come from
  // that one registry now; asserting the old hand-written label here would put
  // a second source of names back.
  expect(chainNames([1, 42161])).toBe('Ethereum, Arbitrum One');
  expect(chainNames([999])).toBe('Chain 999');
});
