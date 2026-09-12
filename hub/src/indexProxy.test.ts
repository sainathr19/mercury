import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The route reads ETHERSCAN_API_KEY at MODULE LOAD, so the env has to be set
// before the import. A dynamic import inside the describe gets that ordering.
process.env.ETHERSCAN_API_KEY = 'test-key';
const { indexProxy } = await import('./indexProxy.js');

const W = '0xB762cf6AEcefC5Bf3cC886C6298EE5567dA83128';
const url = (p: string) => `http://hub/explorer/${p}`;
const call = (p: string) => indexProxy.request(url(p));

const realFetch = globalThis.fetch;
/** Replace the upstream with a fixed body, and record what we asked it for. */
function upstream(body: unknown, ok = true): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    calls.push(String(u));
    return { ok, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls };
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('explorer proxy — request validation', () => {
  test('rejects an action outside the fixed set', async () => {
    // A proxy that forwards arbitrary actions with our key has moved the
    // credential, not protected it.
    assert.equal((await call(`burn?chainId=1&address=${W}`)).status, 404);
  });

  test('rejects a malformed address', async () => {
    assert.equal((await call('txlist?chainId=1&address=0xdeadbeef')).status, 400);
  });

  test('rejects a chain Etherscan does not index', async () => {
    // Arc. Asking anyway spends a rate-limit slot to be told "chain not
    // supported", on every scan.
    assert.equal((await call(`txlist?chainId=5042002&address=${W}`)).status, 400);
  });

  test('rejects a non-numeric chain id', async () => {
    assert.equal((await call(`txlist?chainId=abc&address=${W}`)).status, 400);
  });

  test('caps the page size it will ask upstream for', async () => {
    const u = upstream({ status: '1', result: [] });
    await call(`txlist?chainId=1&address=${W}&offset=9999`);
    assert.match(u.calls[0], /offset=100(&|$)/);
  });

  test('sends the chain id as Etherscan V2 expects it', async () => {
    const u = upstream({ status: '1', result: [] });
    await call(`txlist?chainId=421614&address=${W}`);
    assert.match(u.calls[0], /[?&]chainid=421614(&|$)/);
    assert.match(u.calls[0], /[?&]module=account(&|$)/);
    assert.match(u.calls[0], /[?&]apikey=test-key(&|$)/);
  });
});

describe('explorer proxy — telling "empty" apart from "broken"', () => {
  test('an empty array is a real, empty history', async () => {
    upstream({ status: '0', message: 'No transactions found', result: [] });
    const res = await call(`txlist?chainId=1&address=${W}`);
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { result: unknown[] }).result, []);
  });

  test('a rejected key is 503, not an empty history', async () => {
    // Regression: this collapsed into `result: []`, so an unusable credential
    // presented as a wallet with no transactions — on every chain, forever.
    upstream({ status: '0', message: 'NOTOK', result: 'Missing/Invalid API Key' });
    assert.equal((await call(`txlist?chainId=1&address=${W}`)).status, 503);
  });

  test('a rate limit is a transient fault, not an empty history', async () => {
    upstream({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
    const res = await call(`txlist?chainId=1&address=${W}`);
    assert.equal(res.status, 200);
    // Non-array result → the caller reads "could not answer" and shows nothing.
    assert.equal(Array.isArray(((await res.json()) as { result: unknown }).result), false);
  });

  test('an upstream HTTP error is a fault, not an empty history', async () => {
    upstream({}, false);
    const res = await call(`txlist?chainId=1&address=${W}`);
    assert.equal(Array.isArray(((await res.json()) as { result: unknown }).result), false);
  });

  test('an upstream that throws does not take the history screen down', async () => {
    globalThis.fetch = (async () => {
      throw new Error('socket hang up');
    }) as typeof fetch;
    const res = await call(`txlist?chainId=1&address=${W}`);
    assert.equal(res.status, 200);
  });
});

describe('explorer proxy — chains the plan does not cover', () => {
  test('a plan refusal is a fault, and the chain is not asked again', async () => {
    // Etherscan indexes 61 chains but a free key is refused on several of them.
    // Which ones depends on the plan, so this is learned rather than assumed.
    const u = upstream({
      status: '0',
      message: 'NOTOK',
      result: 'Free API access is not supported for this chain. Please upgrade your api plan',
    });

    const first = await call(`txlist?chainId=43114&address=${W}`);
    assert.equal(first.status, 200);
    assert.equal(Array.isArray(((await first.json()) as { result: unknown }).result), false);
    assert.equal(u.calls.length, 1);

    // Second ask must cost nothing upstream.
    const second = await call(`txlist?chainId=43114&address=${W}`);
    assert.equal(Array.isArray(((await second.json()) as { result: unknown }).result), false);
    assert.equal(u.calls.length, 1, 'asked the upstream again for a chain it already refused');
  });

  test('one refused chain does not retire the others', async () => {
    // A rejected KEY is global; a chain outside the plan is not. Conflating
    // them would turn one unsupported chain into no history anywhere.
    const u = upstream({
      status: '0',
      result: 'Free API access is not supported for this chain. Please upgrade',
    });
    await call(`txlist?chainId=56&address=${W}`);

    upstream({ status: '1', result: [{ hash: '0xabc' }] });
    const other = await call(`txlist?chainId=137&address=${W}`);
    assert.equal(other.status, 200);
    assert.deepEqual(((await other.json()) as { result: unknown[] }).result, [{ hash: '0xabc' }]);
  });
});

describe('explorer proxy — rate limiting', () => {
  test('spaces concurrent calls so one wallet cannot burn the shared quota', async () => {
    // The ceiling is enforced per KEY and every app instance shares ours: one
    // history scan is two calls per chain across a dozen chains.
    const at: number[] = [];
    globalThis.fetch = (async () => {
      at.push(Date.now());
      return { ok: true, json: async () => ({ status: '1', result: [] }) } as Response;
    }) as typeof fetch;

    const t0 = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => call(`txlist?chainId=1&address=${W}`)));
    const elapsed = Date.now() - t0;

    assert.equal(at.length, 5);
    assert.ok(elapsed >= 4 * 250 * 0.9, `5 calls finished in ${elapsed}ms — not spaced`);
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i] - at[i - 1] >= 200, `calls ${i - 1}->${i} only ${at[i] - at[i - 1]}ms apart`);
    }
  });
});
