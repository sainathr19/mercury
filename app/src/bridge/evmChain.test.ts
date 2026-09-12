import { evmExplorerTxUrl } from './evmChain';

test('evmExplorerTxUrl builds etherscan links for known chains', () => {
  expect(evmExplorerTxUrl(1n, '0xabc')).toBe('https://etherscan.io/tx/0xabc');
  expect(evmExplorerTxUrl(8453n, '0xabc')).toBe('https://basescan.org/tx/0xabc');
});

test('evmExplorerTxUrl uses the explorer each chain declares', () => {
  // Registry-driven, so a chain with its own explorer gets it rather than
  // falling through to etherscan.
  expect(evmExplorerTxUrl(5042002n, '0xabc')).toBe('https://testnet.arcscan.app/tx/0xabc');
  expect(evmExplorerTxUrl(421614n, '0xabc')).toBe('https://sepolia.arbiscan.io/tx/0xabc');
});

test('evmExplorerTxUrl falls back to etherscan for a chain we do not ship', () => {
  expect(evmExplorerTxUrl(999999n, '0xabc')).toBe('https://etherscan.io/tx/0xabc');
});
