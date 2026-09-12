/**
 * A claim is the only record of money that has left the balance and arrived
 * nowhere, so the two rules under test both concern what the app is allowed to
 * tell the user about it.
 *
 * 1. A mint that was MINED AND REVERTED is finished. The same calldata against
 *    the same contract reverts identically, and Circle returns the amount to
 *    the unified balance, so continuing to offer "Retry" points the user at a
 *    button that cannot work and implies funds are still outstanding.
 * 2. A claim that merely failed to reach the relayer is NOT finished, and must
 *    stay retryable — that is the case this store exists for.
 */
jest.mock('expo-file-system', () => ({
  File: class {
    exists = false;
    write() {}
    text() { return Promise.resolve('{}'); }
    textSync() { return '{}'; }
  },
  Paths: { document: '/tmp' },
}));

// `mock`-prefixed so Jest's hoisted factory may reference it.
const mockRelayMint = jest.fn();
jest.mock('../bridge/gateway', () => ({ relayMint: (...a: unknown[]) => mockRelayMint(...a) }));

import { usePendingClaims } from './pendingClaimStore';

const CLAIM = {
  id: 'c1',
  attestation: '0xaa',
  signature: '0xbb',
  destinationDomain: 0,
  environment: 'testnet' as const,
  amount: 0.5,
  chainId: '11155111',
  chainName: 'Sepolia',
};

beforeEach(() => {
  mockRelayMint.mockReset();
  usePendingClaims.getState().reset();
  usePendingClaims.getState().record(CLAIM);
});

describe('a reverted mint ends the claim', () => {
  test('a failure WITH a tx hash marks it reverted', async () => {
    // A hash only exists once the mint reached the chain.
    mockRelayMint.mockResolvedValue({ ok: false, txHash: '0xdead', error: 'Mint reverted on chain', ms: 1 });
    await usePendingClaims.getState().retry('c1');
    expect(usePendingClaims.getState().claims[0].reverted?.txHash).toBe('0xdead');
  });

  test('a reverted claim refuses to be retried again', async () => {
    mockRelayMint.mockResolvedValue({ ok: false, txHash: '0xdead', error: 'Mint reverted on chain', ms: 1 });
    await usePendingClaims.getState().retry('c1');
    mockRelayMint.mockClear();

    const r = await usePendingClaims.getState().retry('c1');
    expect(r.ok).toBe(false);
    // The point: no second submission of calldata already known to revert.
    expect(mockRelayMint).not.toHaveBeenCalled();
  });

  test('a failure WITHOUT a hash stays retryable', async () => {
    // Unreachable hub, dead relayer, no network — the money really is still out
    // there and the claim must survive.
    mockRelayMint.mockResolvedValue({ ok: false, error: 'Could not reach the delivery service.', ms: 1 });
    await usePendingClaims.getState().retry('c1');

    const c = usePendingClaims.getState().claims[0];
    expect(c.reverted).toBeUndefined();
    expect(c.attempts).toBe(1);

    mockRelayMint.mockResolvedValue({ ok: true, txHash: '0xgood', ms: 1 });
    const r = await usePendingClaims.getState().retry('c1');
    expect(r.ok).toBe(true);
    expect(usePendingClaims.getState().claims).toHaveLength(0);
  });
});

describe('dismiss only touches finished claims', () => {
  test('a live claim cannot be dismissed', () => {
    usePendingClaims.getState().dismiss('c1');
    expect(usePendingClaims.getState().claims).toHaveLength(1);
  });

  test('a reverted claim can be', () => {
    usePendingClaims.getState().markReverted('c1', '0xdead');
    usePendingClaims.getState().dismiss('c1');
    expect(usePendingClaims.getState().claims).toHaveLength(0);
  });
});
