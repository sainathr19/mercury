/**
 * The explorer fallback, and the one distinction it exists to preserve:
 * "this source could not answer" is not "this address has no transactions".
 *
 * The bug behind it: 0.005 ETH arrived on Arbitrum Sepolia, the balance showed
 * it (balances come from RPC), and the feed stayed empty for hours because
 * Blockscout — the chain's only configured history source — was returning 503.
 * A native transfer emits no logs, so `eth_getLogs` cannot find it either; an
 * indexer is the only way to see it at all.
 */
process.env.EXPO_PUBLIC_RELAYER_URL = 'https://hub.test';

import { explorerCoversChain, explorerHistory, etherscanIndexes, resetExplorerAvailability } from './explorer';

const W = '0xB762cf6AEcefC5Bf3cC886C6298EE5567dA83128';
const ARB_SEPOLIA = 421614n;
const ARC = 5042002n;

const row = { hash: '0xabc', from: '0xdead', to: W, value: '5000000000000000', timeStamp: '1757000000' };

/** Stand in for the hub. `per` maps an action to the Response it answers with. */
function hub(per: Record<string, { status: number; body?: unknown }>): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    const action = url.includes('/tokentx') ? 'tokentx' : 'txlist';
    const r = per[action] ?? { status: 200, body: { status: '1', result: [] } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  resetExplorerAvailability();
  jest.restoreAllMocks();
});

describe('coverage', () => {
  it('knows Etherscan indexes Arbitrum Sepolia', () => {
    expect(etherscanIndexes(ARB_SEPOLIA)).toBe(true);
    expect(explorerCoversChain(ARB_SEPOLIA)).toBe(true);
  });

  it('does not ask about a chain Etherscan has never heard of', () => {
    // Arc. A request could only come back "chain not supported", having spent a
    // slot of a rate limit the whole fleet shares.
    expect(etherscanIndexes(ARC)).toBe(false);
    expect(explorerCoversChain(ARC)).toBe(false);
  });
});

describe('reading history', () => {
  it('returns the rows the hub gives it', async () => {
    hub({ txlist: { status: 200, body: { status: '1', result: [row] } } });
    const out = await explorerHistory(W, ARB_SEPOLIA);
    expect(out?.native).toHaveLength(1);
    expect(out?.native[0].hash).toBe('0xabc');
  });

  it('asks for the chain by id', async () => {
    const fn = hub({});
    await explorerHistory(W, ARB_SEPOLIA);
    expect(fn.mock.calls[0][0]).toContain('chainId=421614');
    expect(fn.mock.calls[0][0]).toContain(`address=${W}`);
  });

  it('an empty result is an empty history, not a failure', async () => {
    hub({ txlist: { status: 200, body: { status: '1', result: [] } } });
    expect(await explorerHistory(W, ARB_SEPOLIA)).toEqual({ native: [], tokens: [] });
  });

  it('keeps the half that answered when only one leg fails', async () => {
    // A chain with native activity and no ERC-20s is the ordinary case.
    hub({
      txlist: { status: 200, body: { status: '1', result: [row] } },
      tokentx: { status: 500 },
    });
    const out = await explorerHistory(W, ARB_SEPOLIA);
    expect(out?.native).toHaveLength(1);
    expect(out?.tokens).toEqual([]);
  });

  it('reports null — not an empty history — when both legs fail', async () => {
    // The whole point. Returning `{native: [], tokens: []}` here would render
    // as "no recent activity" over a wallet that has been receiving all day.
    hub({ txlist: { status: 500 }, tokentx: { status: 500 } });
    expect(await explorerHistory(W, ARB_SEPOLIA)).toBeNull();
  });

  it('reports null when a non-array result comes back', async () => {
    // How the hub signals a rate limit or a rejected key.
    hub({
      txlist: { status: 200, body: { status: '0', result: 'Max rate limit reached' } },
      tokentx: { status: 200, body: { status: '0', result: 'Max rate limit reached' } },
    });
    expect(await explorerHistory(W, ARB_SEPOLIA)).toBeNull();
  });
});

describe('an unconfigured hub is asked once, not once per chain', () => {
  it('stops asking after a 503', async () => {
    const fn = hub({ txlist: { status: 503 }, tokentx: { status: 503 } });
    expect(await explorerHistory(W, ARB_SEPOLIA)).toBeNull();
    const afterFirst = fn.mock.calls.length;

    // Every later chain in the same scan must cost nothing.
    expect(await explorerHistory(W, 11155111n)).toBeNull();
    expect(await explorerHistory(W, 84532n)).toBeNull();
    expect(explorerCoversChain(ARB_SEPOLIA)).toBe(false);
    expect(fn.mock.calls.length).toBe(afterFirst);
  });

  it('re-checks after a reset, so setting the key does not need an app restart', async () => {
    hub({ txlist: { status: 503 }, tokentx: { status: 503 } });
    await explorerHistory(W, ARB_SEPOLIA);
    expect(explorerCoversChain(ARB_SEPOLIA)).toBe(false);

    resetExplorerAvailability();
    const fn = hub({ txlist: { status: 200, body: { status: '1', result: [row] } } });
    const out = await explorerHistory(W, ARB_SEPOLIA);
    expect(out?.native).toHaveLength(1);
    expect(fn).toHaveBeenCalled();
  });
});
