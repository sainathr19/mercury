/**
 * Which destinations the send screen may default to.
 *
 * The bug: the default was `destinations[0]` — registry order, not readiness —
 * which landed on Sei Atlantic, a chain the relayer had no gas on. The user
 * could fill in an amount and a recipient and only be refused at the hold.
 */
process.env.EXPO_PUBLIC_RELAYER_URL = 'https://hub.test';

const { deliverableDomains } = require('./relayer') as typeof import('./relayer');

const body = (domains: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({ environment: 'testnet', domains, ...extra }),
});
const stub = (v: unknown) => {
  global.fetch = jest.fn(async () => v) as unknown as typeof fetch;
};

afterEach(() => jest.restoreAllMocks());

describe('deliverableDomains', () => {
  it('separates funded destinations from unfunded ones', async () => {
    stub(
      body([
        { domain: 0, chain: 'Sepolia', chainId: 11155111, ready: true },
        { domain: 3, chain: 'Arbitrum Sepolia', chainId: 421614, ready: true },
        { domain: 16, chain: 'Sei Testnet', chainId: 1328, ready: false },
      ]),
    );
    const d = await deliverableDomains('testnet');
    expect(d.answered).toBe(true);
    expect([...d.ready].sort((a, b) => a - b)).toEqual([0, 3]);
    expect(d.ready.has(16)).toBe(false);
    expect(d.unverified.size).toBe(0);
  });

  it('treats an unpublished funding state as usable, not refused', async () => {
    // An older hub does not publish balances. That is unknown, not "no" — it
    // is the bar the app applied before the endpoint existed.
    stub(body([{ domain: 7, chain: 'Polygon Amoy', chainId: 80002, ready: null }]));
    const d = await deliverableDomains('testnet');
    expect(d.ready.has(7)).toBe(false);
    expect(d.unverified.has(7)).toBe(true);
  });

  it('fails OPEN when the hub cannot be reached', async () => {
    // Unlike deliveryStatus, which fails closed. This only picks a default; a
    // dead hub must leave the picker as it was rather than blank it, and the
    // binding check still runs before the burn.
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const d = await deliverableDomains('testnet');
    expect(d.answered).toBe(false);
    expect(d.ready.size).toBe(0);
  });

  it('fails open on a non-OK response', async () => {
    stub({ ok: false, json: async () => ({}) });
    expect((await deliverableDomains('testnet')).answered).toBe(false);
  });

  it('reports not-answered when the hub has no signing key', async () => {
    stub(body([{ domain: 0, chain: 'Sepolia', chainId: 11155111, ready: true }], { relayerConfigured: false }));
    const d = await deliverableDomains('testnet');
    expect(d.answered).toBe(false);
    expect(d.ready.size).toBe(0);
  });

  it('answers with an empty set rather than throwing on a malformed body', async () => {
    stub({ ok: true, json: async () => ({}) });
    const d = await deliverableDomains('testnet');
    expect(d.answered).toBe(true);
    expect(d.ready.size).toBe(0);
  });
});

describe('choosing the default destination', () => {
  // Mirrors the screen's `usable` predicate.
  const pick = (
    chains: { name: string; circleDomain: number }[],
    d: { ready: Set<number>; unverified: Set<number> },
  ) => chains.find((c) => d.ready.has(c.circleDomain) || d.unverified.has(c.circleDomain))?.name;

  const CHAINS = [
    { name: 'Sei Atlantic', circleDomain: 16 },
    { name: 'World Chain Sepolia', circleDomain: 14 },
    { name: 'Arbitrum Sepolia', circleDomain: 3 },
  ];

  it('skips the unfunded chain that registry order puts first', () => {
    const d = { ready: new Set([3]), unverified: new Set<number>() };
    expect(pick(CHAINS, d)).toBe('Arbitrum Sepolia');
  });

  it('keeps registry order among the chains that ARE deliverable', () => {
    const d = { ready: new Set([14, 3]), unverified: new Set<number>() };
    expect(pick(CHAINS, d)).toBe('World Chain Sepolia');
  });

  it('accepts an unverified chain rather than skipping to a funded one', () => {
    const d = { ready: new Set([3]), unverified: new Set([16]) };
    expect(pick(CHAINS, d)).toBe('Sei Atlantic');
  });
});
