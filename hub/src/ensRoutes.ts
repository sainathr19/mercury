// ─────────────────────────────────────────────────────────────────────────────
//  HTTP surface for offchain names.
//
//  Two jobs that must not be confused:
//    • `/ens/:sender/:data` answers ENS lookups. Public, read-only, signed.
//    • `/ens/claim` hands out a name. Authenticated by the claimant's own key.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  answerFor,
  decodeRequest,
  encodeSignedAnswer,
  signAnswer,
  type GatewayRecords,
} from './ens.js';
import { checkLabel, claim, claimMessage, count, isTaken, recordsFor } from './names.js';

const SIGNER_KEY = process.env.ENS_SIGNER_PRIVATE_KEY as Hex | undefined;
const RESOLVER = process.env.ENS_RESOLVER_ADDRESS as Hex | undefined;
export const PARENT = (process.env.ENS_PARENT ?? 'mercurywallet.eth').toLowerCase();

/** The apex name's own records. Once our resolver is set on the 2LD it answers
 *  for the 2LD too, so without this `mercurywallet.eth` itself would go dark. */
const APEX: GatewayRecords = {
  evm: process.env.ENS_APEX_ADDRESS,
};

export const ensConfigured = (): boolean => !!SIGNER_KEY && !!RESOLVER;

export const ensStatus = () => ({
  parent: PARENT,
  resolver: RESOLVER ?? null,
  signer: SIGNER_KEY ? privateKeyToAccount(SIGNER_KEY).address : null,
  names: count(),
});

/**
 * Which record set answers for a name.
 *
 * Returns null for anything outside our parent — a resolver that answered for
 * names it was not set on would be signing statements about somebody else's.
 */
function lookup(name: string): GatewayRecords | null {
  const n = name.toLowerCase();
  if (n === PARENT) return APEX;
  if (!n.endsWith(`.${PARENT}`)) return null;
  const label = n.slice(0, -(PARENT.length + 1));
  // Only direct children. `a.b.mercurywallet.eth` is not a name we issue, and
  // silently treating it as `b`'s would resolve a name nobody claimed.
  if (label.includes('.')) return null;
  return recordsFor(label);
}

export const ensRoutes = new Hono();

/**
 * The CCIP-Read endpoint.
 *
 * Reached two ways: directly by a client that speaks EIP-3668, or server-side by
 * ENS's batch gateway on behalf of one that only follows the resolver's URL
 * list. Both send the same thing.
 */
async function handle(sender: string, data: string) {
  if (!SIGNER_KEY || !RESOLVER) {
    return { status: 503 as const, body: { message: 'ENS gateway not configured' } };
  }
  // The resolver named in the request must be ours. A lookup aimed at another
  // resolver is not ours to sign for, and signing it would hand that contract a
  // valid-looking answer from a key it may trust.
  if (sender.toLowerCase() !== RESOLVER.toLowerCase()) {
    return { status: 400 as const, body: { message: 'Unknown resolver' } };
  }

  let request: ReturnType<typeof decodeRequest>;
  try {
    request = decodeRequest(data as Hex);
  } catch {
    return { status: 400 as const, body: { message: 'Malformed request' } };
  }

  const records = lookup(request.name);
  // No such name is a real answer, and it must be a SIGNED one: the resolver
  // rejects anything unsigned, so returning an error here would surface as
  // "lookup failed" rather than "no such name".
  const result = answerFor(records ?? {}, request.inner);
  if (result === null) {
    return { status: 400 as const, body: { message: 'Unsupported record' } };
  }

  const signed = await signAnswer({
    privateKey: SIGNER_KEY,
    resolver: RESOLVER,
    request: data as Hex,
    result,
  });
  return { status: 200 as const, body: { data: encodeSignedAnswer(signed) } };
}

/** Is this name free? Called while the user is still typing it. */
ensRoutes.get('/available/:label', (c) => {
  const label = c.req.param('label').trim().toLowerCase();
  const check = checkLabel(label);
  if (!check.ok) return c.json({ available: false, reason: check.reason });
  if (isTaken(label)) return c.json({ available: false, reason: 'That name is taken' });
  return c.json({ available: true, name: `${label}.${PARENT}` });
});

/** The exact bytes to sign, so the app never has to reproduce the format. */
ensRoutes.post('/claim/message', async (c) => {
  let b: Record<string, string | number>;
  try {
    b = await c.req.json();
  } catch {
    return c.json({ message: 'Invalid JSON' }, 400);
  }
  const nonce = Date.now();
  return c.json({
    nonce,
    message: claimMessage({
      label: String(b.label ?? '').toLowerCase(),
      parent: PARENT,
      evm: String(b.evm ?? ''),
      solana: b.solana ? String(b.solana) : undefined,
      bitcoin: b.bitcoin ? String(b.bitcoin) : undefined,
      nonce,
    }),
  });
});

// ── The CCIP-Read endpoint ───────────────────────────────────────────────────
//
// Under its own `/lookup` prefix, and registered last. `:sender` would otherwise
// match anything — `/ens/available/alice` was being read as a lookup for a
// resolver called "available" until this prefix existed. A catch-all sitting
// beside named siblings is a trap, so it gets a segment of its own.

/** The `{sender}/{data}.json` template the resolver publishes. */
ensRoutes.get('/lookup/:sender/:data', async (c) => {
  const r = await handle(c.req.param('sender'), c.req.param('data').replace(/\.json$/, ''));
  return c.json(r.body, r.status);
});

/** POST form, for clients that send the payload in a body. */
ensRoutes.post('/lookup', async (c) => {
  let body: { sender?: string; data?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: 'Invalid JSON' }, 400);
  }
  if (!body.sender || !body.data) return c.json({ message: 'sender and data are required' }, 400);
  const r = await handle(body.sender, body.data);
  return c.json(r.body, r.status);
});

ensRoutes.post('/claim', async (c) => {
  let b: Record<string, unknown>;
  try {
    b = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const result = await claim({
    label: String(b.label ?? ''),
    parent: PARENT,
    evm: String(b.evm ?? ''),
    solana: b.solana ? String(b.solana) : undefined,
    bitcoin: b.bitcoin ? String(b.bitcoin) : undefined,
    prefer: typeof b.prefer === 'number' ? b.prefer : undefined,
    nonce: Number(b.nonce ?? 0),
    signature: String(b.signature ?? ''),
  });
  return result.ok ? c.json(result, 200) : c.json(result, result.status);
});
