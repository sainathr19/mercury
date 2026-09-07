import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Hex } from 'viem';
import { relayMint } from './relay.js';
import { CHAIN_BY_DOMAIN } from './chains.js';
import { ensRoutes, ensStatus, ensConfigured } from './ensRoutes.js';

const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

/** Offchain ENS subnames: the CCIP-Read gateway and the claim flow. */
app.route('/ens', ensRoutes);

app.get('/gateway/domains', (c) =>
  c.json({
    domains: Object.entries(CHAIN_BY_DOMAIN).map(([domain, chain]) => ({
      domain: Number(domain),
      chain: chain.name,
      chainId: chain.id,
    })),
    relayerConfigured: !!RELAYER_KEY,
  }),
);

app.get('/ens-status', (c) => c.json({ configured: ensConfigured(), ...ensStatus() }));

/**
 * Submit a Circle Gateway attestation on the destination chain so the recipient
 * doesn't need gas there.
 *
 * Unauthenticated on purpose: the attestation is Circle-signed and names its own
 * recipient, so a caller cannot redirect funds — the only abuse is burning our
 * gas, which is a rate limit, not a custody risk. Add a limiter before this is
 * exposed anywhere real.
 */
app.post('/gateway/relay', async (c) => {
  if (!RELAYER_KEY) return c.json({ ok: false, error: 'Relayer not configured' }, 503);

  let body: { attestation?: string; signature?: string; destinationDomain?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { attestation, signature, destinationDomain } = body;
  if (!attestation?.startsWith('0x') || !signature?.startsWith('0x')) {
    return c.json({ ok: false, error: 'attestation and signature must be 0x-prefixed hex' }, 400);
  }
  if (typeof destinationDomain !== 'number') {
    return c.json({ ok: false, error: 'destinationDomain is required' }, 400);
  }

  const result = await relayMint({
    destinationDomain,
    attestation: attestation as Hex,
    signature: signature as Hex,
    relayerKey: RELAYER_KEY,
  });
  return c.json(result, result.ok ? 200 : 502);
});

serve({ fetch: app.fetch, port: PORT });
console.log(`mercury hub on :${PORT}  relayer=${RELAYER_KEY ? 'configured' : 'MISSING'}`);
console.log(`  ens: ${ensConfigured() ? `${ensStatus().parent} via ${ensStatus().signer}` : 'NOT configured'}`);
