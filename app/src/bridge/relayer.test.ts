/**
 * The property under test is FAIL-CLOSED.
 *
 * `deliveryStatus` gates a burn. Circle debits the unified balance the instant a
 * burn intent is accepted, so once past this check the money has moved whatever
 * happens next. A false "ok" therefore does not degrade a feature — it strands
 * someone's funds in an attestation. Every ambiguous answer must refuse.
 */

const HUB = 'https://hub.example';

/**
 * Load the module with a chosen RELAYER_URL.
 *
 * It reads the variable once at module scope, so the only way to test the
 * unconfigured case is a fresh module registry per test. `require` rather than
 * `import()` because this Jest config runs without --experimental-vm-modules.
 */
function load(url: string | undefined): typeof import('./relayer') {
  jest.resetModules();
  if (url === undefined) delete process.env.EXPO_PUBLIC_RELAYER_URL;
  else process.env.EXPO_PUBLIC_RELAYER_URL = url;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  return require('./relayer') as typeof import('./relayer');
}

function mockFetch(impl: () => Promise<unknown> | never) {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

const okJson = (body: unknown) => async () => ({ ok: true, json: async () => body });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('deliveryStatus refuses whenever delivery is not proven', () => {
  it('refuses when no relayer is configured', async () => {
    const { deliveryStatus, relayerConfigured } = load(undefined);
    expect(relayerConfigured()).toBe(false);
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/not configured/i);
  });

  it('refuses when the hub cannot be reached', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(async () => {
      throw new Error('offline');
    });
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/could not reach/i);
  });

  it('refuses when the hub answers with an error status', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/not responding/i);
  });

  it('refuses when the hub has no signing key', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(okJson({ relayerConfigured: false, domains: [] }));
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/no signing key/i);
  });

  it('refuses a domain the relayer does not serve, and names the chain', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(okJson({ relayerConfigured: true, domains: [{ domain: 0, chain: 'Sepolia', chainId: 11155111 }] }));
    // Domain 26 is Arc on testnet — a chain we know, so the message should say so.
    const s = await deliveryStatus(26, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toContain('Arc Testnet');
  });

  it('refuses without naming a chain it cannot identify', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(okJson({ relayerConfigured: true, domains: [] }));
    const s = await deliveryStatus(999, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('Instant delivery is not available on that network.');
    expect(s.reason).not.toContain('undefined');
  });

  it('refuses when the relayer cannot pay on that chain', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(
      okJson({
        relayerConfigured: true,
        relayer: '0xrelayer',
        domains: [{ domain: 6, chain: 'Base Sepolia', chainId: 84532, gasWei: '0', ready: false }],
      }),
    );
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(false);
    expect(s.reason).toContain('Base Sepolia');
    // The address comes back so an empty relayer can be topped up.
    expect(s.relayer).toBe('0xrelayer');
  });
});

describe('deliveryStatus allows a proven path', () => {
  it('allows a served, funded domain', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(
      okJson({
        relayerConfigured: true,
        relayer: '0xrelayer',
        domains: [{ domain: 6, chain: 'Base Sepolia', chainId: 84532, gasWei: '5000000', ready: true }],
      }),
    );
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(true);
    expect(s.unverified).toBeUndefined();
  });

  it('allows but flags a hub too old to report funding', async () => {
    // The deployed hub predates the `ready` field. Refusing here would disable a
    // send that has always worked; promising delivery would overstate it.
    const { deliveryStatus } = load(HUB);
    mockFetch(okJson({ relayerConfigured: true, domains: [{ domain: 26, chain: 'Arc Testnet', chainId: 5042002 }] }));
    const s = await deliveryStatus(26, 'testnet');
    expect(s.ok).toBe(true);
    expect(s.unverified).toBe(true);
  });

  it('treats an unreadable chain as unverified rather than broken', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(
      okJson({
        relayerConfigured: true,
        domains: [{ domain: 6, chain: 'Base Sepolia', chainId: 84532, gasWei: null, ready: null }],
      }),
    );
    const s = await deliveryStatus(6, 'testnet');
    expect(s.ok).toBe(true);
    expect(s.unverified).toBe(true);
  });
});

describe('relayMint', () => {
  it('tells the hub which environment, because domain ids repeat', async () => {
    const { relayMint } = load(HUB);
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    global.fetch = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ ok: true, txHash: '0xabc' }) };
    }) as unknown as typeof fetch;

    await relayMint('0xatt', '0xsig', 6, 'mainnet');
    expect(calls[0].url).toBe(`${HUB}/gateway/relay`);
    // Without this the hub would mint domain 6 on Base Sepolia instead of Base.
    expect(calls[0].body.environment).toBe('mainnet');
    expect(calls[0].body.destinationDomain).toBe(6);
  });

  it('reports rather than throws when the hub is unreachable', async () => {
    const { relayMint } = load(HUB);
    mockFetch(async () => {
      throw new Error('offline');
    });
    const r = await relayMint('0xatt', '0xsig', 6, 'testnet');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('offline');
  });
});

describe('the real hub response', () => {
  /**
   * Captured verbatim from `GET /gateway/domains?environment=testnet` on a
   * locally-run hub (hub/src/index.ts) with a throwaway key.
   *
   * This is a CONTRACT test across two processes. The app and the hub share no
   * code — only this JSON shape — so a field rename on either side is exactly
   * the kind of break that typechecks fine and fails in production. Pinning the
   * real payload is what makes that break a test failure instead.
   */
  const LIVE = {
    environment: 'testnet',
    relayer: '0xC166F9Ad40b2937DFcFC0DDcC9D4dD08b43874F6',
    domains: [
      { domain: 0, chain: 'Sepolia', chainId: 11155111, gasWei: '0', ready: false },
      { domain: 3, chain: 'Arbitrum Sepolia', chainId: 421614, gasWei: '0', ready: false },
      { domain: 6, chain: 'Base Sepolia', chainId: 84532, gasWei: '0', ready: false },
      { domain: 26, chain: 'Arc Testnet', chainId: 5042002, gasWei: '0', ready: false },
    ],
    relayerConfigured: true,
  };

  it('refuses every domain when the relayer is unfunded', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(okJson(LIVE));
    for (const [domain, chain] of [
      [0, 'Sepolia'],
      [3, 'Arbitrum Sepolia'],
      [6, 'Base Sepolia'],
      [26, 'Arc Testnet'],
    ] as const) {
      const s = await deliveryStatus(domain, 'testnet');
      expect(s.ok).toBe(false);
      expect(s.reason).toContain(chain);
      expect(s.relayer).toBe(LIVE.relayer);
    }
  });

  it('allows the same domains once the relayer is funded', async () => {
    const { deliveryStatus } = load(HUB);
    mockFetch(
      okJson({
        ...LIVE,
        domains: LIVE.domains.map((d) => ({ ...d, gasWei: '20000000000000000', ready: true })),
      }),
    );
    const s = await deliveryStatus(26, 'testnet');
    expect(s.ok).toBe(true);
    expect(s.unverified).toBeUndefined();
  });

  it('asks the hub for the environment it means', async () => {
    const { deliveryStatus } = load(HUB);
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => LIVE };
    }) as unknown as typeof fetch;
    await deliveryStatus(6, 'mainnet');
    // Domain 6 is Base on mainnet and Base Sepolia on testnet; without the
    // query the hub would answer about the wrong one.
    expect(urls[0]).toBe(`${HUB}/gateway/domains?environment=mainnet`);
  });
});
