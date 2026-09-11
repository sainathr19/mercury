import { chainForDomain } from './chains';
import {
  depositReadySeconds,
  gasIsUsdc,
  hubChain,
  hubDomain,
  readyLabel,
} from './gatewayHub';

describe('deposit finality', () => {
  it('knows the Ethereum-finality chains are slow', () => {
    // The point of the table: these five look like fast L2s and are not, for
    // this purpose. Choosing one as the hub would cost 19 minutes per top-up.
    for (const domain of [0, 2, 3, 6, 10, 14]) {
      expect(depositReadySeconds(domain)).toBeGreaterThan(600);
    }
  });

  it('knows the genuinely fast ones', () => {
    expect(depositReadySeconds(26)).toBeLessThanOrEqual(2); // Arc
    expect(depositReadySeconds(7)).toBeLessThanOrEqual(10); // Polygon
    expect(depositReadySeconds(1)).toBeLessThanOrEqual(10); // Avalanche
  });

  it('is pessimistic about a domain it does not know', () => {
    // Guessing "fast" for an unmeasured chain would promise what we cannot keep.
    expect(depositReadySeconds(999)).toBeGreaterThan(600);
  });

  it('phrases every domain as something sayable', () => {
    expect(readyLabel(26)).toBe('about a second');
    expect(readyLabel(7)).toBe('about 8 seconds');
    expect(readyLabel(6)).toBe('up to 19 minutes');
    // Never leaks a raw number or a unit-less figure.
    for (const d of [0, 1, 2, 3, 5, 6, 7, 10, 13, 14, 16, 19, 26, 999]) {
      expect(readyLabel(d)).toMatch(/second|minute/);
    }
  });
});

describe('hub choice', () => {
  it('is the fastest option available in each environment', () => {
    expect(hubChain('testnet')?.name).toBe('Arc Testnet');
    expect(hubChain('mainnet')?.name).toBe('Polygon');
  });

  it('never picks a chain slower than the alternatives it had', () => {
    for (const env of ['mainnet', 'testnet'] as const) {
      const chosen = depositReadySeconds(hubDomain(env));
      // Whatever we picked must be at least as fast as anything else we could
      // have picked in that environment — otherwise the table and the choice
      // have drifted apart.
      for (const domain of [0, 1, 2, 3, 6, 7, 26]) {
        if (!chainForDomain(domain, env)) continue;
        expect(chosen).toBeLessThanOrEqual(depositReadySeconds(domain));
      }
    }
  });

  it('resolves to a chain that really supports Gateway', () => {
    for (const env of ['mainnet', 'testnet'] as const) {
      const hub = hubChain(env);
      expect(hub).toBeDefined();
      expect(hub!.circleDomain).toBe(hubDomain(env));
      expect(hub!.usdc).toBeTruthy();
      expect(hub!.environment).toBe(env);
    }
  });
});

describe('gasIsUsdc', () => {
  it('is true on Arc and false on Polygon', () => {
    // This is what lets a testnet deposit work from a USDC-only wallet.
    expect(gasIsUsdc(hubChain('testnet')!)).toBe(true);
    expect(gasIsUsdc(hubChain('mainnet')!)).toBe(false);
  });
});
