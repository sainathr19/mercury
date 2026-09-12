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
    it(`${env}: every Circle domain has a history source`, () => {
      // A chain Gateway can deliver to, whose history we cannot read, is a
      // balance the user is told they do not have.
      const unreadable = chainsForEnvironment(env)
        .filter((c) => c.circleDomain !== undefined && chainUsdc(c.chainId))
        .filter((c) => !readable(c.chainId))
        .map((c) => c.name);
      expect(unreadable).toEqual([]);
    });
  }

  it('testnet covers more than just Arc and the active chain', () => {
    // The old behaviour: only chains with subgraphEnv were added. If this ever
    // collapses back to one, the regression is silent in the UI.
    const covered = chainsForEnvironment('testnet').filter((c) => readable(c.chainId));
    expect(covered.length).toBeGreaterThan(1);
    expect(covered.map((c) => c.name)).toEqual(expect.arrayContaining(['Arbitrum Sepolia']));
  });
});
