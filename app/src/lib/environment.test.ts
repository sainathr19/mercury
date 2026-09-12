import {
  isTestnetChainId,
  environmentOfChainId,
  chainInEnvironment,
  environmentLabel,
  TESTNET_EVM_CHAIN_IDS,
} from './environment';

test('isTestnetChainId recognizes known testnets', () => {
  expect(isTestnetChainId(11155111n)).toBe(true); // Sepolia
  expect(isTestnetChainId(421614n)).toBe(true); // Arbitrum Sepolia
  expect(isTestnetChainId(84532n)).toBe(true); // Base Sepolia
});

test('isTestnetChainId treats production chains as mainnet', () => {
  expect(isTestnetChainId(1n)).toBe(false); // Ethereum
  expect(isTestnetChainId(42161n)).toBe(false); // Arbitrum One
  expect(isTestnetChainId(8453n)).toBe(false); // Base
  expect(isTestnetChainId(56n)).toBe(false); // BNB
});

test('environmentOfChainId maps to the right environment', () => {
  expect(environmentOfChainId(11155111n)).toBe('testnet');
  expect(environmentOfChainId(1n)).toBe('mainnet');
});

test('stablecoin chains classify into the right environment', () => {
  expect(isTestnetChainId(5042002n)).toBe(true); // Arc Testnet
  expect(environmentOfChainId(5042002n)).toBe('testnet');
  expect(environmentOfChainId(43114n)).toBe('mainnet'); // Avalanche C-Chain
});

test('chainInEnvironment filters per environment', () => {
  expect(chainInEnvironment(421614n, 'testnet')).toBe(true);
  expect(chainInEnvironment(421614n, 'mainnet')).toBe(false);
  expect(chainInEnvironment(42161n, 'mainnet')).toBe(true);
  expect(chainInEnvironment(42161n, 'testnet')).toBe(false);
});

test('environmentLabel is human-readable', () => {
  expect(environmentLabel('testnet')).toBe('Testnet');
  expect(environmentLabel('mainnet')).toBe('Mainnet');
});

test('testnet id list is unique', () => {
  const set = new Set(TESTNET_EVM_CHAIN_IDS.map(String));
  expect(set.size).toBe(TESTNET_EVM_CHAIN_IDS.length);
});
