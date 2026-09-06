import { evmExplorerTxUrl } from './evmChain';

test('evmExplorerTxUrl builds etherscan links for known chains', () => {
  expect(evmExplorerTxUrl(1n, '0xabc')).toBe('https://etherscan.io/tx/0xabc');
  expect(evmExplorerTxUrl(8453n, '0xabc')).toBe('https://basescan.org/tx/0xabc');
});

test('evmExplorerTxUrl uses the Tempo explorer for Tempo chains', () => {
  expect(evmExplorerTxUrl(4217n, '0xabc')).toBe('https://explore.tempo.xyz/tx/0xabc');
  expect(evmExplorerTxUrl(42431n, '0xabc')).toBe(
    'https://explore.testnet.tempo.xyz/tx/0xabc',
  );
});
