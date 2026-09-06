import { btcMempoolBase, btcExplorerTxUrl, solExplorerTxUrl } from './explorers';

test('BTC explorer base + tx url follow the environment', () => {
  expect(btcMempoolBase('testnet')).toBe('https://mempool.space/testnet4');
  expect(btcMempoolBase('mainnet')).toBe('https://mempool.space');
  expect(btcExplorerTxUrl('abc', 'testnet')).toBe('https://mempool.space/testnet4/tx/abc');
  expect(btcExplorerTxUrl('abc', 'mainnet')).toBe('https://mempool.space/tx/abc');
});

test('SOL explorer tx url follows the environment (devnet param only on testnet)', () => {
  expect(solExplorerTxUrl('sig', 'testnet')).toBe('https://explorer.solana.com/tx/sig?cluster=devnet');
  expect(solExplorerTxUrl('sig', 'mainnet')).toBe('https://explorer.solana.com/tx/sig');
});
