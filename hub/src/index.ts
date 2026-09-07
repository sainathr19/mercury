import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Hex } from 'viem';
import { relayMint } from './relay.js';
import { CHAIN_BY_DOMAIN } from './chains.js';
import { claimMessage, sponsorRegister, type SponsorConfig } from './sponsor.js';

const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
const PORT = Number(process.env.PORT ?? 8787);

// ── Name sponsorship ─────────────────────────────────────────────────────────
// The same wallet that pays for Gateway mints also pays for ENS registrations.
// One key, one place to top up, one balance to watch.
const REGISTRY = process.env.ENS_REGISTRY as Hex | undefined;
const ENS_PARENT = (process.env.ENS_PARENT ?? 'mercurywallet.eth').toLowerCase();
const sponsorConfig = (): SponsorConfig | null =>
  RELAYER_KEY && REGISTRY
    ? {
        relayerKey: RELAYER_KEY,
        registry: REGISTRY,
        parent: ENS_PARENT,
        mainnet: process.env.ENS_NETWORK === 'mainnet',
        perAddress: Number(process.env.SPONSOR_PER_ADDRESS ?? 1),
        perDay: Number(process.env.SPONSOR_PER_DAY ?? 200),
        rpcUrl: process.env.ENS_RPC_URL,
      }
    : null;

const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

app.get('/names/status', (c) => {
  const cfg = sponsorConfig();
  return c.json({
    sponsoring: !!cfg,
    parent: ENS_PARENT,
    registry: REGISTRY ?? null,
    network: process.env.ENS_NETWORK === 'mainnet' ? 'mainnet' : 'sepolia',
    perAddress: cfg?.perAddress ?? null,
    perDay: cfg?.perDay ?? null,
  });
});

/**
 * The exact bytes to sign.
 *
 * Served rather than rebuilt in the app: two implementations of one string
 * format drift, and when they drift the signature check fails with nothing to
 * say why.
 */
app.post('/names/claim-message', async (c) => {
  let b: Record<string, unknown>;
  try {
    b = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const nonce = Date.now();
  return c.json({
    nonce,
    message: claimMessage({
      label: String(b.label ?? '').toLowerCase(),
      parent: ENS_PARENT,
      evm: String(b.evm ?? ''),
      solana: b.solana ? String(b.solana) : undefined,
      bitcoin: b.bitcoin ? String(b.bitcoin) : undefined,
      nonce,
    }),
  });
});

/**
 * Register a name and pay the gas for it.
 *
 * Unlike /gateway/relay this is NOT safe to leave unauthenticated: there is no
 * Circle signature vouching for the payload, so the caller's own signature is
 * the only thing standing between our gas and a name pointing wherever a
 * stranger likes. See sponsor.ts.
 */
app.post('/names/sponsor', async (c) => {
  const cfg = sponsorConfig();
  if (!cfg) {
    return c.json(
      { ok: false, error: REGISTRY ? 'Relayer key not configured' : 'ENS_REGISTRY not configured' },
      503,
    );
  }
  let b: Record<string, unknown>;
  try {
    b = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const result = await sponsorRegister(
    {
      label: String(b.label ?? ''),
      evm: String(b.evm ?? ''),
      solana: b.solana ? String(b.solana) : undefined,
      bitcoin: b.bitcoin ? String(b.bitcoin) : undefined,
      prefer: typeof b.prefer === 'number' ? b.prefer : undefined,
      nonce: Number(b.nonce ?? 0),
      signature: String(b.signature ?? ''),
    },
    cfg,
  );
  return result.ok ? c.json(result, 200) : c.json(result, result.status);
});

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
console.log(`  names: ${sponsorConfig() ? `sponsoring ${ENS_PARENT} via ${REGISTRY}` : 'NOT sponsoring (set ENS_REGISTRY)'}`);
