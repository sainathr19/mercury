/**
 * The withdrawal path is the one the user reaches when something has gone
 * wrong, or a week after they last thought about it. Both cases punish a wrong
 * answer: an over-stated countdown makes someone stop checking, and a scan that
 * reports "nothing withdrawing" hides the only route to their money.
 */
jest.mock('./evmTx', () => ({
  ethCall: jest.fn(),
  rpc: jest.fn(),
  sendCall: jest.fn(),
  waitForReceipt: jest.fn(),
  word: (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0'),
  uint: (n: bigint) => n.toString(16).padStart(64, '0'),
}));

import { circleChainsForEnvironment } from '../lib/chains';
import { ethCall, rpc } from './evmTx';
import {
  delayLabel,
  remainingLabel,
  withdrawableByChain,
  withdrawalsInProgress,
} from './gatewayWithdraw';

const mockCall = ethCall as jest.MockedFunction<typeof ethCall>;
const mockRpc = rpc as jest.MockedFunction<typeof rpc>;
const ADDR = '0x1111111111111111111111111111111111111111';

/** 6dp USDC as the 32-byte word an eth_call returns. */
const usdcWord = (amount: number) =>
  '0x' + BigInt(Math.round(amount * 1e6)).toString(16).padStart(64, '0');

const SEL_WITHDRAWING = '0xdf0c6690';
const SEL_AVAILABLE = '0x3ccb64ae';

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockRejectedValue(new Error('execution reverted'));
});

describe('remainingLabel', () => {
  const DAY = 86400_000;
  const WEEK_S = 7 * 86400;

  it('says nothing about duration when the start time is unknown', () => {
    // Started on another device, or straight on chain. Inventing a date here
    // would be worse than admitting we do not know.
    expect(remainingLabel(undefined, WEEK_S)).toBe('Not ready yet');
    expect(remainingLabel(Date.now(), undefined)).toBe('Not ready yet');
  });

  it('counts down in days, then hours', () => {
    const now = 1_000_000_000_000;
    expect(remainingLabel(now - 2 * DAY, WEEK_S, now)).toBe('About 5 days left');
    expect(remainingLabel(now - 6.5 * DAY, WEEK_S, now)).toBe('About 12 hours left');
    expect(remainingLabel(now - (WEEK_S * 1000 - 60_000), WEEK_S, now)).toBe(
      'Less than an hour left',
    );
  });

  it('never shows a negative or a stale "ready" once the estimate runs out', () => {
    const now = 1_000_000_000_000;
    // The contract's clock is the authority; ours only estimates, so an expired
    // estimate must read as imminent rather than as done.
    expect(remainingLabel(now - 9 * DAY, WEEK_S, now)).toBe('Ready any moment now');
  });
});

describe('delayLabel', () => {
  it('falls back to a week when the chain did not answer', () => {
    expect(delayLabel()).toBe('about a week');
  });

  it('reports whole days', () => {
    expect(delayLabel(7 * 86400)).toBe('about 7 days');
  });
});

describe('withdrawalsInProgress', () => {
  it('pays for the full state only on chains that have something', async () => {
    // One chain withdrawing, the rest empty. Keyed on the chain's RPC rather
    // than on call order, because the chains are read in parallel and the
    // second phase re-reads the same selector.
    const chains = circleChainsForEnvironment('testnet');
    const withdrawingOn = chains[0].rpcUrl;
    mockCall.mockImplementation(async (url: string, _to: string, data: string) =>
      data.startsWith(SEL_WITHDRAWING) && url === withdrawingOn ? usdcWord(5) : usdcWord(0),
    );

    const rows = await withdrawalsInProgress(ADDR, 'testnet');

    expect(rows).toHaveLength(1);
    expect(rows[0].chainId).toBe(chains[0].chainId);
    expect(rows[0].withdrawing).toBe(5);
    // `claimable` comes from the simulation, which reverted above.
    expect(rows[0].claimable).toBe(false);
  });

  it('returns nothing rather than throwing when a chain is unreachable', async () => {
    mockCall.mockRejectedValue(new Error('rate limited'));
    await expect(withdrawalsInProgress(ADDR, 'testnet')).resolves.toEqual([]);
  });

  it('does not call out at all without an address', async () => {
    await expect(withdrawalsInProgress('', 'testnet')).resolves.toEqual([]);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('withdrawableByChain', () => {
  it('reports a per-chain ceiling, not one unified figure', async () => {
    // The bug this guards: treating the unified spendable balance as the amount
    // withdrawable from any single chain. $7 spread over four chains is not $7
    // withdrawable from the first one.
    let n = 0;
    mockCall.mockImplementation(async (_url, _to, data: string) => {
      expect(data.startsWith(SEL_AVAILABLE)).toBe(true);
      return usdcWord([4, 3, 0, 0][n++] ?? 0);
    });

    const rows = await withdrawableByChain(ADDR, 'testnet');

    // One row per Circle chain, derived — the literal that used to be here
    // grew stale the moment the registry did, and the property under test is
    // the SHAPE (a figure per chain), not how many chains there happen to be.
    expect(rows).toHaveLength(circleChainsForEnvironment('testnet').length);
    expect(rows.slice(0, 4).map((r) => r.available)).toEqual([4, 3, 0, 0]);
    expect(rows.every((r) => r.available <= 4)).toBe(true);
    // The whole point: the unified figure is never handed to a single chain.
    const unified = rows.reduce((sum, r) => sum + r.available, 0);
    expect(rows.every((r) => r.available < unified)).toBe(true);
  });

  it('reads an unreachable chain as zero withdrawable, never as the whole balance', async () => {
    mockCall.mockRejectedValue(new Error('rate limited'));
    const rows = await withdrawableByChain(ADDR, 'testnet');
    expect(rows.every((r) => r.available === 0)).toBe(true);
  });
});
