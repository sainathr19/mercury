import {
  TEMPO_MAINNET_CHAIN_ID,
  TEMPO_TESTNET_CHAIN_ID,
  TEMPO_CURRENCY_SYMBOL,
  isTempoChainId,
  evmChainHasNativeAsset,
} from './tempo';

test('Tempo chain ids match the published network config', () => {
  expect(TEMPO_MAINNET_CHAIN_ID).toBe(4217n);
  expect(TEMPO_TESTNET_CHAIN_ID).toBe(42431n);
});

test('isTempoChainId recognizes both Tempo networks', () => {
  expect(isTempoChainId(4217n)).toBe(true); // mainnet
  expect(isTempoChainId(42431n)).toBe(true); // testnet (Moderato)
});

test('isTempoChainId rejects other EVM chains', () => {
  expect(isTempoChainId(1n)).toBe(false); // Ethereum
  expect(isTempoChainId(8453n)).toBe(false); // Base
  expect(isTempoChainId(11155111n)).toBe(false); // Sepolia
});

test('Tempo fees are denominated in USD (no native gas token)', () => {
  expect(TEMPO_CURRENCY_SYMBOL).toBe('USD');
});

test('Tempo chains have no native asset; other EVM chains do', () => {
  // Tempo has no native gas coin — never surface a native balance row (its
  // eth_getBalance returns a huge placeholder that would show as a fake balance).
  expect(evmChainHasNativeAsset(4217n)).toBe(false);
  expect(evmChainHasNativeAsset(42431n)).toBe(false);
  // Every other EVM chain has a native coin (ETH/POL/BNB/...).
  expect(evmChainHasNativeAsset(1n)).toBe(true);
  expect(evmChainHasNativeAsset(8453n)).toBe(true);
});
