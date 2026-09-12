/**
 * Which chains a history scan covers.
 *
 * The bug this pins: the scan used to cover the active chain plus the ones we
 * index ourselves, so money that arrived anywhere else was invisible. A Gateway
 * send can deliver to any Circle domain and a swap can land its output on any
 * supported chain — both happened, on Arbitrum Sepolia, and neither showed.
 */
jest.mock('../lib/biometrics', () => ({ requireAuth: jest.fn(), authFailureMessage: jest.fn() }));

import { chainsForEnvironment, chainUsdc } from '../lib/chains';
import { BLOCKSCOUT_BASES } from '../lib/evm-activity';
import { graphCoversChain } from './graph';

/** Mirrors `evmChainsToScan` — exported indirectly through loadActivity. */
const readable = (chainId: bigint) =>
  graphCoversChain(chainId) || !!BLOCKSCOUT_BASES[chainId.toString()];

describe('every chain the wallet can hold money on is readable', () => {
  for (const env of ['testnet', 'mainnet'] as const) {
    it(`${env}: every Circle domain can be delivered to`, () => {
      // A domain without a USDC contract is a destination the app offers and
      // then cannot mint on. Arbitrum Sepolia spent a day in that state.
      const undeliverable = chainsForEnvironment(env)
        .filter((c) => c.circleDomain !== undefined && !chainUsdc(c.chainId))
        .map((c) => c.name);
      expect(undeliverable).toEqual([]);
    });

    it(`${env}: every Circle domain has an RPC, so a balance is always visible`, () => {
      // This is the property that actually protects the user. Balances come
      // straight from RPC, so a chain with no history source still SHOWS the
      // money — it just cannot draw a transaction row for it. An earlier
      // version of this test demanded a history source and would have blocked
      // Avalanche Fuji, Polygon Amoy and World Chain Sepolia, none of which run
      // a Blockscout instance, over a row rather than over a balance.
      const unreachable = chainsForEnvironment(env)
        .filter((c) => c.circleDomain !== undefined && !c.rpcUrl)
        .map((c) => c.name);
      expect(unreachable).toEqual([]);
    });
  }

  it('records which chains have no history source, so the gap is visible', () => {
    // Not a failure — a fact worth keeping in front of us. These chains show a
    // balance but no rows until they gain an indexer.
    const noHistory = chainsForEnvironment('testnet')
      .filter((c) => c.circleDomain !== undefined && !readable(c.chainId))
      .map((c) => c.name)
      .sort();
    expect(noHistory).toEqual(['Avalanche Fuji', 'Polygon Amoy', 'World Chain Sepolia']);
  });

  it('testnet covers more than just Arc and the active chain', () => {
    // The old behaviour: only chains with subgraphEnv were added. If this ever
    // collapses back to one, the regression is silent in the UI.
    const covered = chainsForEnvironment('testnet').filter((c) => readable(c.chainId));
    expect(covered.length).toBeGreaterThan(1);
    expect(covered.map((c) => c.name)).toEqual(expect.arrayContaining(['Arbitrum Sepolia']));
  });
});
