// ─────────────────────────────────────────────────────────────────────────────
//  Index proxy — The Graph, without shipping the key.
//
//  `EXPO_PUBLIC_*` is inlined into the app bundle at build time and recoverable
//  from the package, so a Token API JWT there is a credential handed to anyone
//  who downloads the app, billed to us. ERC-7677 gives this exact advice for
//  paymaster keys — proxy through your own backend — and it applies unchanged to
//  any provider key a mobile client would otherwise carry.
//
//  Two things this is NOT:
//
//  • Not an open relay. It forwards a fixed set of shapes with validated
//    parameters. A proxy that passes arbitrary paths through with our key
//    attached has moved the credential, not protected it.
//
//  • Not a privacy fix by itself. The provider stops seeing per-device query
//    patterns and starts seeing ours — which is better, but the addresses still
//    reach them. Only running our own index changes that.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';

const TOKEN_API = 'https://api.pinax.network/v1';
const JWT = process.env.TOKEN_API_JWT ?? '';
const ARC_SUBGRAPH = process.env.ARC_SUBGRAPH_URL ?? '';

/** The free tier returns EMPTY above 10 rather than clamping, so a larger page
 *  reads as "no transactions" instead of an error. Enforced here too: the app
 *  can no longer get this wrong on our key. */
const MAX_PAGE = 10;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NETWORK = /^[a-z0-9-]{1,32}$/;

const isAddress = (v: string): boolean => EVM_ADDRESS.test(v) || SOL_ADDRESS.test(v);

export const indexProxyConfigured = (): boolean => !!JWT || !!ARC_SUBGRAPH;

export const indexProxy = new Hono();

/**
 * Exactly the Token API paths the wallet uses, nothing else.
 *
 * The path is chosen from a fixed map rather than taken from the request, so no
 * input can reach an endpoint we did not intend to expose.
 */
const TOKEN_PATHS: Record<string, string> = {
  balances: '/evm/balances',
  'balances-native': '/evm/balances/native',
  transfers: '/evm/transfers',
};

indexProxy.get('/token/:kind', async (c) => {
  if (!JWT) return c.json({ error: 'Index proxy not configured' }, 503);

  const path = TOKEN_PATHS[c.req.param('kind')];
  if (!path) return c.json({ error: 'Unknown query' }, 404);

  const network = c.req.query('network') ?? '';
  const address = c.req.query('address') ?? '';
  if (!NETWORK.test(network)) return c.json({ error: 'Invalid network' }, 400);
  if (!isAddress(address)) return c.json({ error: 'Invalid address' }, 400);

  const limit = Math.min(Number(c.req.query('limit') ?? MAX_PAGE) || MAX_PAGE, MAX_PAGE);
  const params = new URLSearchParams({ network, address, limit: String(limit) });
  const page = c.req.query('page');
  if (page && /^\d{1,4}$/.test(page)) params.set('page', page);

  try {
    const res = await fetch(`${TOKEN_API}${path}?${params}`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    if (!res.ok) return c.json({ data: [] });
    return c.json((await res.json()) as unknown);
  } catch {
    // A balance screen must never blank out because an upstream blipped.
    return c.json({ data: [] });
  }
});

/**
 * Our own Arc subgraph. The query is built here, not forwarded, so the endpoint
 * cannot be used to run arbitrary GraphQL against our deployment.
 */
indexProxy.get('/arc/transfers', async (c) => {
  if (!ARC_SUBGRAPH) return c.json({ data: { transfers: [] } });

  const address = c.req.query('address') ?? '';
  if (!EVM_ADDRESS.test(address)) return c.json({ error: 'Invalid address' }, 400);
  const first = Math.min(Number(c.req.query('first') ?? 50) || 50, 100);

  // Copied verbatim from the app's ARC_QUERY, including `Bytes!` and the field
  // list. A proxy that rewrites the query returns a different shape than the
  // caller parses, which fails as "no history" rather than as an error.
  const query = `
  query Transfers($me: Bytes!, $first: Int!) {
    transfers(
      first: $first
      orderBy: blockNumber
      orderDirection: desc
      where: { or: [{ from: $me }, { to: $me }] }
    ) { id txHash from to symbol amount timestamp }
  }`;

  try {
    const res = await fetch(ARC_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { me: address.toLowerCase(), first } }),
    });
    if (!res.ok) return c.json({ data: { transfers: [] } });
    return c.json((await res.json()) as unknown);
  } catch {
    return c.json({ data: { transfers: [] } });
  }
});
