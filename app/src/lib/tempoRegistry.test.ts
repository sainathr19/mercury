import type { Registry } from './registry';
import { tokensForChain, nativeForChain } from './registry';
import { TEMPO_REGISTRY_NETWORKS, withTempoNetworks } from './tempoRegistry';

const emptyRegistry = (): Registry => ({
  version: 'test',
  updatedAt: 'test',
  networks: {},
});

test('built-in Tempo networks cover both chains with pathUSD as a token', () => {
  const testnet = TEMPO_REGISTRY_NETWORKS['42431'];
  const mainnet = TEMPO_REGISTRY_NETWORKS['4217'];
  expect(testnet.chainId).toBe(42431);
  expect(mainnet.chainId).toBe(4217);
  // pathUSD is the canonical first stablecoin / default fee token on both.
  const pathUsd = '0x20c0000000000000000000000000000000000000';
  expect(testnet.tokens.some((t) => t.address === pathUsd)).toBe(true);
  expect(mainnet.tokens.some((t) => t.address === pathUsd)).toBe(true);
});

test('every Tempo token is a 6-decimal stablecoin with a contract address', () => {
  for (const net of Object.values(TEMPO_REGISTRY_NETWORKS)) {
    for (const t of net.tokens) {
      expect(t.decimals).toBe(6);
      expect(t.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  }
});

test('withTempoNetworks injects Tempo into a registry that lacks it', () => {
  const merged = withTempoNetworks(emptyRegistry());
  expect(nativeForChain(merged, 4217n)?.symbol).toBe('USD'); // no native gas coin
  expect(tokensForChain(merged, 42431n).length).toBeGreaterThan(0);
  expect(
    tokensForChain(merged, 4217n).some((t) => t.symbol === 'pathUSD'),
  ).toBe(true);
});

test('withTempoNetworks lets a remote registry override the built-in Tempo data', () => {
  const remote: Registry = {
    version: 'remote',
    updatedAt: 'remote',
    networks: {
      '4217': {
        id: '4217',
        chainType: 'evm',
        name: 'Tempo (remote)',
        chainId: 4217,
        native: { symbol: 'USD', name: 'US Dollar', decimals: 6, coingeckoId: '' },
        tokens: [],
      },
    },
  };
  const merged = withTempoNetworks(remote);
  // Remote definition wins when present.
  expect(merged.networks['4217'].name).toBe('Tempo (remote)');
  // But the testnet the remote didn't define is still filled in.
  expect(merged.networks['42431']).toBeDefined();
});

test('withTempoNetworks preserves unrelated networks', () => {
  const reg = emptyRegistry();
  reg.networks['1'] = {
    id: '1',
    chainType: 'evm',
    name: 'Ethereum',
    chainId: 1,
    native: { symbol: 'ETH', name: 'Ether', decimals: 18, coingeckoId: 'ethereum' },
    tokens: [],
  };
  const merged = withTempoNetworks(reg);
  expect(merged.networks['1'].name).toBe('Ethereum');
  expect(merged.networks['4217']).toBeDefined();
});
