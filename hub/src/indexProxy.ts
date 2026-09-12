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

// ── Block-explorer history ───────────────────────────────────────────────────
//
// Etherscan's V2 API answers for 61 chains from ONE key, which is why it is here
// rather than a per-chain arrangement. It replaces nothing: Blockscout stays the
// app's first choice because it is keyless and unmetered. This is the fallback
// for when Blockscout is down or was never deployed for a chain.
//
// That fallback is not hypothetical. Of the 22 testnets this wallet supports,
// only 5 had a reachable history source when this was written: 4 Blockscout
// instances were answering 503/429/404 and 13 chains had no explorer configured
// at all. Arbitrum Sepolia — a Circle domain, so money genuinely lands there —
// was one of the dead ones, and a wallet that shows a balance it cannot explain
// is worse than one that shows neither.
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY ?? '';

/** Chain ids Etherscan V2 indexes, as reported by its own /v2/chainlist and
 *  intersected with lib/chains.ts. Listing them means an unsupported chain costs
 *  nothing instead of a round trip that can only answer "chain not supported". */
const ETHERSCAN_CHAINS = new Set([
  // mainnet
  1, 10, 56, 137, 8453, 42161, 43114,
  // testnet
  97, 1301, 1328, 4801, 5003, 10143, 14601, 43113, 59141, 80002, 84532, 421614,
  11155111, 11155420, 168587773,
]);

/** The two history shapes the wallet reads: native transfers and ERC-20
 *  transfers. Chosen from this set, never taken from the request. */
const EXPLORER_ACTIONS = new Set(['txlist', 'tokentx']);

/**
 * Chains this key's PLAN does not cover, learned from the upstream.
 *
 * Indexing a chain and serving it on the free tier are different things:
 * Etherscan lists 61 chains, and a free key is refused on Optimism, Base,
 * Avalanche and both BNB chains with "Free API access is not supported for this
 * chain". Which chains those are depends on the operator's plan, so hard-coding
 * a free-tier list here would be wrong for anyone who pays — and stale the day
 * Etherscan moves a chain between tiers.
 *
 * Learning it instead costs one refused call per chain per process and is
 * correct on every plan. Not persisted: a plan does not change mid-process, and
 * a restart should re-check rather than trust yesterday's answer.
 */
const planExcluded = new Set<number>();
const PLAN_REFUSAL = /free api access is not supported/i;

/**
 * Etherscan's free tier allows 5 calls/second and enforces it per KEY — so every
 * app instance shares one budget. A single wallet opening its history fans out
 * to two calls per chain across a dozen chains, which alone exceeds the ceiling;
 * several wallets at once would get the whole fleet throttled. Spacing the calls
 * here keeps that impossible by construction rather than by hope.
 */
const MIN_INTERVAL_MS = 250; // 4/s, one under the limit
let queue: Promise<unknown> = Promise.resolve();
let lastDispatch = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const slot = queue.then(async () => {
    const wait = lastDispatch + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDispatch = Date.now();
  });
  // The queue tracks the SLOT, not the upstream call, so one slow explorer
  // response does not serialise every later request behind it.
  queue = slot.catch(() => {});
  return slot.then(fn);
}

/** The free tier returns EMPTY above 10 rather than clamping, so a larger page
 *  reads as "no transactions" instead of an error. Enforced here too: the app
 *  can no longer get this wrong on our key. */
const MAX_PAGE = 10;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NETWORK = /^[a-z0-9-]{1,32}$/;

const isAddress = (v: string): boolean => EVM_ADDRESS.test(v) || SOL_ADDRESS.test(v);

export const indexProxyConfigured = (): boolean => !!JWT || !!ARC_SUBGRAPH;
export const explorerProxyConfigured = (): boolean => !!ETHERSCAN_KEY;
export const explorerChainCount = (): number => ETHERSCAN_CHAINS.size;

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

/**
 * Etherscan-compatible history for one address on one chain.
 *
 * Returns the provider's own envelope unchanged (`{ status, message, result }`)
 * because the app's Blockscout mapper already parses exactly that shape — the
 * whole point of Etherscan compatibility is that the caller needs no second
 * code path.
 *
 * Distinguishes "no key" (503) from "no transactions" (200 with an empty
 * result), because the app uses that difference: a 503 retires the explorer for
 * the session instead of asking again once per chain per scan.
 */
indexProxy.get('/explorer/:action', async (c) => {
  if (!ETHERSCAN_KEY) return c.json({ error: 'Explorer proxy not configured' }, 503);

  const action = c.req.param('action');
  if (!EXPLORER_ACTIONS.has(action)) return c.json({ error: 'Unknown query' }, 404);

  const address = c.req.query('address') ?? '';
  if (!EVM_ADDRESS.test(address)) return c.json({ error: 'Invalid address' }, 400);

  const chainId = Number(c.req.query('chainId'));
  if (!Number.isInteger(chainId) || !ETHERSCAN_CHAINS.has(chainId)) {
    return c.json({ error: 'Unsupported chain' }, 400);
  }

  // Already refused for this chain — answer without spending a rate-limit slot
  // on a request whose outcome we know.
  if (planExcluded.has(chainId)) {
    return c.json({ status: '0', message: 'upstream', result: 'chain not in plan' });
  }

  const offset = Math.min(Number(c.req.query('offset') ?? 25) || 25, 100);
  const params = new URLSearchParams({
    chainid: String(chainId),
    module: 'account',
    action,
    address,
    sort: 'desc',
    page: '1',
    offset: String(offset),
    apikey: ETHERSCAN_KEY,
  });

  try {
    const res = await throttled(() => fetch(`${ETHERSCAN_API}?${params}`));
    // Non-array result, deliberately: see the note below on why an empty array
    // is the one thing a failure must never return.
    if (!res.ok) return c.json({ status: '0', message: 'upstream', result: `HTTP ${res.status}` });
    const json = (await res.json()) as { status?: string; message?: string; result?: unknown };

    // An ARRAY result is an answer, empty or not — Etherscan reports a quiet
    // address as status 0 / "No transactions found" / `[]`, which is a real
    // history, not a failure.
    if (Array.isArray(json.result)) return c.json(json);

    // A STRING result is always a fault, and the two kinds need different
    // handling. Folding them into an empty array — which this code did until a
    // dummy key proved it — turns an unusable credential into a wallet that
    // calmly reports no transactions, forever, on every chain.
    const detail = typeof json.result === 'string' ? json.result : '';
    if (PLAN_REFUSAL.test(detail)) {
      // Permanent for this key, but specific to ONE chain — so it must not
      // retire the explorer the way a bad key does.
      planExcluded.add(chainId);
      console.warn(`[explorer] chain ${chainId} is not in this key's plan — will not ask again`);
      return c.json({ status: '0', message: 'upstream', result: 'chain not in plan' });
    }
    if (/api key/i.test(detail)) {
      // Permanent until an operator acts. Reported as 503 so the app retires the
      // explorer for the session instead of re-asking once per chain per scan.
      console.warn(`[explorer] Etherscan rejected our key: ${detail}`);
      return c.json({ error: 'Explorer proxy not configured' }, 503);
    }
    // Transient (rate limit, upstream blip). Non-array result → the app reads it
    // as "this source could not answer" and shows nothing rather than a lie.
    return c.json({ status: '0', message: 'upstream', result: detail || 'upstream error' });
  } catch {
    // Also a non-array. Every fault path here agrees on that, because the app
    // reads an ARRAY as the truth about an address: `result: []` from a socket
    // hang-up is the wallet asserting "you have no transactions" on the
    // strength of a request that never arrived.
    return c.json({ status: '0', message: 'upstream', result: 'request failed' });
  }
});
