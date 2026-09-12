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
import { etherscanIndexes } from './explorer';

/** Mirrors `evmChainsToScan` — exported indirectly through loadActivity. */
const readable = (chainId: bigint) =>
  graphCoversChain(chainId) || !!BLOCKSCOUT_BASES[chainId.toString()] || etherscanIndexes(chainId);

/** The same question without the keyed fallback: what a deployment sees when
 *  the operator sets no ETHERSCAN_API_KEY on the hub. */
const readableKeyless = (chainId: bigint) =>
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

  it('every Circle domain now has SOME history source', () => {
    // Was ['Avalanche Fuji', 'Polygon Amoy', 'World Chain Sepolia'] — three
    // chains that could receive a Gateway delivery and then show a balance with
    // no row to explain it. Etherscan's V2 API indexes all three, which is why
    // the explorer fallback exists.
    const noHistory = chainsForEnvironment('testnet')
      .filter((c) => c.circleDomain !== undefined && !readable(c.chainId))
      .map((c) => c.name)
      .sort();
    expect(noHistory).toEqual([]);
  });

  it('records which chains depend on the hub having an explorer key', () => {
    // Not a failure — the gap that remains when no ETHERSCAN_API_KEY is set.
    // Keeping it visible stops "we added a fallback" from being mistaken for
    // "every deployment has one".
    const keyedOnly = chainsForEnvironment('testnet')
      .filter((c) => c.circleDomain !== undefined && !readableKeyless(c.chainId))
      .map((c) => c.name)
      .sort();
    expect(keyedOnly).toEqual(['Avalanche Fuji', 'Polygon Amoy', 'World Chain Sepolia']);
  });

  it('testnet covers more than just Arc and the active chain', () => {
    // The old behaviour: only chains with subgraphEnv were added. If this ever
    // collapses back to one, the regression is silent in the UI.
    const covered = chainsForEnvironment('testnet').filter((c) => readable(c.chainId));
    expect(covered.length).toBeGreaterThan(1);
    expect(covered.map((c) => c.name)).toEqual(expect.arrayContaining(['Arbitrum Sepolia']));
  });
});
