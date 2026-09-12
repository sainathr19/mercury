import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Hex } from 'viem';
import { relayMint, relayerStatus } from './relay.js';
import { CHAINS_BY_ENV, type RelayEnvironment } from './chains.js';
import { claimMessage, sponsorRegister, type SponsorConfig } from './sponsor.js';
import { Budget, policyFromEnv } from './budget.js';
import { indexProxy, indexProxyConfigured } from './indexProxy.js';
import { storageStatus } from './storage.js';

const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
const PORT = Number(process.env.PORT ?? 8787);

/**
 * Which environment a request means.
 *
 * Circle reuses domain ids across environments — domain 6 is Base on mainnet and
 * Base Sepolia on testnet — so a domain alone is ambiguous and callers are
 * expected to say. The fallback exists only for callers written before this
 * parameter did, and defaults to testnet: guessing mainnet would broadcast a
 * mint onto a real chain, whereas guessing testnet at worst wastes test gas.
 */
const DEFAULT_RELAY_ENVIRONMENT: RelayEnvironment =
  process.env.RELAY_ENVIRONMENT === 'mainnet' ? 'mainnet' : 'testnet';

const relayEnvironment = (v: unknown): RelayEnvironment =>
  v === 'mainnet' ? 'mainnet' : v === 'testnet' ? 'testnet' : DEFAULT_RELAY_ENVIRONMENT;

// ── Name sponsorship ─────────────────────────────────────────────────────────
// The same wallet that pays for Gateway mints also pays for ENS registrations.
// One key, one place to top up, one balance to watch.
const REGISTRY = process.env.ENS_REGISTRY as Hex | undefined;
const ENS_PARENT = (process.env.ENS_PARENT ?? 'mercurywallet.eth').toLowerCase();
// Two budgets, because the two endpoints have different shapes of abuse: one
// name per wallet is a reasonable lifetime allowance, while relaying is a
// repeated service for the same person. Both are denominated in ETH.
const sponsorBudget = new Budget(
  process.env.SPONSOR_LEDGER ?? 'data/sponsor-budget.json',
  policyFromEnv('SPONSOR'),
);
const relayBudget = new Budget(
  process.env.RELAY_LEDGER ?? 'data/relay-budget.json',
  policyFromEnv('RELAY', { perAddressOps: 50 }),
);

const sponsorConfig = (): SponsorConfig | null =>
  RELAYER_KEY && REGISTRY
    ? {
        relayerKey: RELAYER_KEY,
        registry: REGISTRY,
        parent: ENS_PARENT,
        mainnet: process.env.ENS_NETWORK === 'mainnet',
        budget: sponsorBudget,
        rpcUrl: process.env.ENS_RPC_URL,
      }
    : null;

const app = new Hono();

// Request log. Without it a hanging client is indistinguishable from a request
// that never arrived, which is exactly the wrong thing not to know.
app.use('*', async (c, next) => {
  const t0 = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} ${Date.now() - t0}ms`);
});

app.get('/healthz', (c) => c.text('ok'));

/** The Graph, proxied so the provider key never ships in the app bundle. */
app.route('/index', indexProxy);

app.get('/names/status', (c) => {
  const cfg = sponsorConfig();
  return c.json({
    // Published because a budget read from a volume that resets is a number
    // that looks authoritative and is not.
    storage: storageStatus(),
    sponsoring: !!cfg,
    parent: ENS_PARENT,
    registry: REGISTRY ?? null,
    network: process.env.ENS_NETWORK === 'mainnet' ? 'mainnet' : 'sepolia',
    budget: cfg ? sponsorBudget.status() : null,
  });
});

/** What the relayer will and will not pay for. Published so sponsorship is a
 *  documented offer rather than an opaque favour. */
app.get('/gateway/budget', (c) => c.json(relayBudget.status()));

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

/**
 * Which domains this relayer serves, and whether it can currently pay for them.
 *
 * The app calls this BEFORE signing a burn intent. Circle debits the unified
 * balance at burn time, so discovering an unfunded relayer afterwards means the
 * money has already moved with no way to deliver it.
 *
 * Falls back to the static table when no key is configured, so the shape is the
 * same either way and a caller never has to special-case an unconfigured hub.
 */
app.get('/gateway/domains', async (c) => {
  const environment = relayEnvironment(c.req.query('environment'));

  if (!RELAYER_KEY) {
    return c.json({
      environment,
      relayer: null,
      relayerConfigured: false,
      domains: Object.entries(CHAINS_BY_ENV[environment]).map(([domain, chain]) => ({
        domain: Number(domain),
        chain: chain.name,
        chainId: chain.id,
        gasWei: null,
        ready: false,
      })),
    });
  }

  const status = await relayerStatus(environment, RELAYER_KEY);
  return c.json({ ...status, relayerConfigured: true });
});

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

  let body: {
    attestation?: string;
    signature?: string;
    destinationDomain?: number;
    environment?: string;
  };
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
    environment: relayEnvironment(body.environment),
    attestation: attestation as Hex,
    signature: signature as Hex,
    relayerKey: RELAYER_KEY,
    budget: relayBudget,
  });
  return c.json(result, result.ok ? 200 : 502);
});

// Bind explicitly. A container that listens on loopback is reachable from
// nowhere but itself, and the symptom is a health check that times out against
// a process whose logs say it started fine.
const HOST = process.env.HOST ?? '0.0.0.0';

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });

// Orchestrators stop containers with SIGTERM. With no handler the process is
// killed outright, so anything mid-flight — a relay waiting on a receipt, a
// registration waiting to settle its budget reservation — dies unbooked.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, draining`);
    server.close(() => process.exit(0));
    // A wedged connection must not hold the deploy open forever.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

console.log(`mercury hub on ${HOST}:${PORT}  relayer=${RELAYER_KEY ? 'configured' : 'MISSING'}`);
console.log(`  names: ${sponsorConfig() ? `sponsoring ${ENS_PARENT} via ${REGISTRY}` : 'NOT sponsoring (set ENS_REGISTRY)'}`);
console.log(`  index: ${indexProxyConfigured() ? 'proxying The Graph' : 'NOT configured (set TOKEN_API_JWT / ARC_SUBGRAPH_URL)'}`);
{
  const s = storageStatus();
  if (!s.writable) {
    console.error(`  DATA:  ${s.path} IS NOT WRITABLE — spend ledgers cannot persist at all.`);
  } else if (s.looksEphemeral) {
    console.warn(
      `  DATA:  ${s.path} was empty at boot. Expected on a first deploy; after a REDEPLOY it means\n` +
        '         the volume is being discarded, every wallet gets its sponsorship allowance back,\n' +
        '         and the spend caps are not enforcing anything. Mount a persistent volume there.',
    );
  } else {
    console.log(`  data:  persistent — this volume has survived ${Math.round(s.ageSeconds! / 3600)}h`);
  }
}
