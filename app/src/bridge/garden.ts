//! Garden Finance — intent-based atomic swaps, used for TESTNET routes.
//
// The split: Flashnet Orchestra runs mainnet swaps and has no testnet at all
// (4,635 live routes, 23 chains, zero test networks, and no sandbox in its
// docs), so testnet needed a different provider. Garden has a full testnet
// catalog covering seven of the chains this wallet already supports, including
// Bitcoin testnet4 and Arc.
//
// How a Garden swap works, because it is NOT a bridge with a deposit address:
//
//   1. /v2/quote            price the pair
//   2. POST /v2/orders      the solver commits, and returns the HTLC to fund
//   3. the integrator FUNDS the source HTLC — an ordinary transfer or contract
//      call that this wallet signs itself, exactly as with Orchestra
//   4. the solver fills the destination side, and the order completes when
//      `destination_swap.redeem_tx_hash` is populated
//
// So there is no Garden-specific signature: their API authorises with the
// `garden-app-id` header, and the chain authorises with our own key.
//
// Every shape below was read off the live testnet API (GET /v2/chains and
// /v2/assets, captured in __fixtures__/garden-assets.json) rather than from the
// docs alone — the docs describe `wbtc` where the API answers a contract
// address, and the error bodies are the only place the two failure modes are
// distinguishable.
import type { ChainEnvironment } from '../lib/chains';

const API_TESTNET = 'https://testnet.api.garden.finance';
const API_MAINNET = 'https://api.garden.finance';

export const gardenApi = (env: ChainEnvironment): string =>
  env === 'testnet' ? API_TESTNET : API_MAINNET;

/**
 * Garden requires an app id on every request.
 *
 * Reads (`/v2/chains`, `/v2/assets`, `/v2/quote`) answer without one, which is
 * how the catalog below was captured — but that is not a documented guarantee
 * and order creation is not read-only. Get one from portal.garden.finance.
 */
const APP_ID = process.env.EXPO_PUBLIC_GARDEN_APP_ID ?? '';

export const gardenConfigured = (): boolean => !!APP_ID;

// ── Errors ───────────────────────────────────────────────────────────────────

export class GardenError extends Error {
  readonly status: number;
  /** Classified, because the two shapes mean very different things. */
  readonly kind: GardenErrorKind;
  constructor(message: string, status: number, kind: GardenErrorKind) {
    super(message);
    this.name = 'GardenError';
    this.status = status;
    this.kind = kind;
  }
}

/**
 * `no_pair` and `no_quote` look identical to a user and are opposites to us.
 *
 * Measured on the live API, and the distinction is the whole reason this type
 * exists:
 *
 *   "No order pair found : <from>::<to>"  — the route is NOT configured. No
 *                                            amount, key or retry will help.
 *   "no quotes available"                 — the route EXISTS but no solver is
 *                                            quoting it right now. Worth
 *                                            retrying, and worth saying so.
 *
 * Collapsing them into one "swap unavailable" message would have the app tell a
 * user to try again later for a pair that does not exist, or tell them a route
 * is unsupported when a solver is merely asleep.
 */
export type GardenErrorKind = 'no_pair' | 'no_quote' | 'below_min' | 'auth' | 'other';

export function classifyGardenError(raw: string): GardenErrorKind {
  const s = raw.toLowerCase();
  if (s.includes('no order pair')) return 'no_pair';
  if (s.includes('no quotes available')) return 'no_quote';
  if (s.includes('amount') && (s.includes('min') || s.includes('less than'))) return 'below_min';
  if (s.includes('unauthor') || s.includes('app-id') || s.includes('api key')) return 'auth';
  return 'other';
}

/** A message worth putting on screen for each kind. */
export function gardenErrorMessage(e: GardenError): string {
  switch (e.kind) {
    case 'no_pair':
      return 'Garden does not offer this pair.';
    case 'no_quote':
      return 'No solver is quoting this route right now. Try again shortly.';
    case 'below_min':
      return e.message;
    case 'auth':
      return 'Garden rejected this app’s credentials.';
    default:
      return e.message;
  }
}

interface Envelope<T> {
  status: 'Ok' | 'Error';
  result?: T;
  error?: string;
}

/** Every response is `{status, result | error}` — never a bare body. */
async function call<T>(
  env: ChainEnvironment,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (APP_ID) headers['garden-app-id'] = APP_ID;
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${gardenApi(env)}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new GardenError('Could not reach Garden.', 0, 'other');
  }

  const text = await res.text();
  let json: Envelope<T> | undefined;
  try {
    json = JSON.parse(text) as Envelope<T>;
  } catch {
    // A non-JSON body means something in front of the API answered — a WAF
    // returning 403 to a burst, for instance, which is what a parallel scan of
    // this endpoint produces.
    throw new GardenError(
      res.ok ? 'Garden returned an unreadable response.' : `Garden returned ${res.status}.`,
      res.status,
      res.status === 401 || res.status === 403 ? 'auth' : 'other',
    );
  }

  if (json.status === 'Ok' && json.result !== undefined) return json.result;

  const raw = json.error ?? `Garden returned ${res.status}.`;
  throw new GardenError(raw, res.status, classifyGardenError(raw));
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/** How an asset is held and how its HTLC is shaped. Drives which code path
 *  funds the swap, so it is read rather than inferred from the chain name. */
export interface GardenHtlc {
  address: string;
  /** e.g. `evm:htlc_erc20`, `solana:htlc_spltoken`. Null on UTXO chains, where
   *  the order response carries a per-order deposit address instead. */
  schema: string | null;
}

export interface GardenAsset {
  /** `<chain>:<symbol>`, e.g. `base_sepolia:wbtc`. The API's own identifier. */
  id: string;
  /** "Wrapped Bitcoin:WBTC" — a joined pair, not a display name. See `symbolOf`. */
  name: string;
  chain: string;
  /** `evm:84532` | `bitcoin` | `solana:103` — the namespaced chain key. */
  chain_id: string;
  chain_type: 'evm' | 'bitcoin' | 'solana' | 'starknet' | 'tron' | 'sui' | string;
  icon?: string;
  chain_icon?: string;
  decimals: number;
  /** Smallest units, as decimal strings. Enforced by the API. */
  min_amount: string;
  max_amount: string;
  htlc?: GardenHtlc | null;
  token?: { address: string; schema: string | null } | null;
  explorer_url?: string;
  /** Garden's own USD price for the asset. Useful, but ours is authoritative. */
  price?: number;
  token_ids?: { coingecko?: string; cmc?: string; aggregate?: string };
  is_active: boolean;
}

export interface GardenChain {
  chain: string;
  name: string;
  id: string;
  native_asset_id: string;
  icon?: string;
  explorer_url?: string;
  confirmation_target?: number;
  source_timelock?: string;
  destination_timelock?: string;
}

export const fetchAssets = (env: ChainEnvironment): Promise<GardenAsset[]> =>
  call<GardenAsset[]>(env, '/v2/assets');

export const fetchChains = (env: ChainEnvironment): Promise<GardenChain[]> =>
  call<GardenChain[]>(env, '/v2/chains');

/**
 * The ticker out of Garden's `name` field.
 *
 * `name` is "Wrapped Bitcoin:WBTC" — a display name and a symbol joined by a
 * colon — and some entries have no colon at all ("Litecoin", "XRP"). The id's
 * suffix is a safer source for the symbol, but it is lowercase, so the name's
 * tail is preferred when present because it carries the real casing (cbBTC,
 * USDC.e) that an uppercased id would destroy.
 */
export function symbolOf(asset: Pick<GardenAsset, 'id' | 'name'>): string {
  const tail = asset.name.includes(':') ? asset.name.split(':').pop()?.trim() : undefined;
  if (tail) return tail;
  const fromId = asset.id.split(':').pop() ?? asset.id;
  return fromId.toUpperCase();
}

/** The human display name, with the symbol half removed. */
export function displayNameOf(asset: Pick<GardenAsset, 'id' | 'name'>): string {
  const head = asset.name.split(':')[0]?.trim();
  return head || symbolOf(asset);
}

// ── Quote ────────────────────────────────────────────────────────────────────

/** One side of a quote, as the live API returns it. */
export interface GardenQuoteLeg {
  asset: string;
  /** Smallest units, as a decimal string. */
  amount: string;
  /** Already formatted by Garden ("0.00012880"). Preferred for display: it is
   *  the solver's own rendering and cannot disagree with `amount`. */
  display?: string;
  /** USD value, as a STRING ("9.9496") — not a number, despite looking like one. */
  value?: string;
}

export interface GardenQuote {
  source: GardenQuoteLeg;
  destination: GardenQuoteLeg;
  solver_id?: string;
  /** Seconds the solver expects to take. Worth showing — it is the answer to
   *  "how long will this take", which a swap screen otherwise cannot give. */
  estimated_time?: number;
  slippage?: number;
  fee?: number;
  fixed_fee?: string;
  [k: string]: unknown;
}

/**
 * Price `fromAmount` (smallest units of `from`) into `to`.
 *
 * Throws a classified `GardenError`, because "this pair does not exist" and "no
 * solver is quoting" need different words on screen.
 */
/**
 * Pick the quote that pays out most.
 *
 * `/v2/quote` returns an ARRAY — one entry per solver — which is not what the
 * docs' prose suggests and is exactly the sort of thing that fails quietly: read
 * as a single object, `destination.amount` is `undefined`, falls back to "0",
 * and the screen shows a valid quote as a zero payout. Accepts a bare object
 * too, so a future single-quote response would not break this.
 */
export function bestQuote(raw: GardenQuote | GardenQuote[]): GardenQuote | undefined {
  const list = Array.isArray(raw) ? raw : [raw];
  let best: GardenQuote | undefined;
  for (const q of list) {
    const out = q?.destination?.amount;
    if (out === undefined) continue;
    let v: bigint;
    try {
      v = BigInt(out);
    } catch {
      continue;
    }
    // A solver quoting zero is not a quote; treating it as one enabled the
    // confirm button on a swap that would pay out nothing.
    if (v <= 0n) continue;
    if (!best || v > BigInt(best.destination.amount)) best = q;
  }
  return best;
}

/**
 * Price `fromAmount` (smallest units of `from`) into `to`.
 *
 * Throws a classified `GardenError`, because "this pair does not exist" and "no
 * solver is quoting" need different words on screen — and now also when the API
 * answers OK with nothing usable in it.
 */
export async function quote(opts: {
  env: ChainEnvironment;
  from: string;
  to: string;
  /** Smallest units of `from`, as a decimal string. */
  fromAmount: string;
}): Promise<GardenQuote> {
  const q = new URLSearchParams({
    from: opts.from,
    to: opts.to,
    from_amount: opts.fromAmount,
  });
  const raw = await call<GardenQuote | GardenQuote[]>(opts.env, `/v2/quote?${q}`);
  const best = bestQuote(raw);
  if (!best) throw new GardenError('no quotes available', 200, 'no_quote');
  return best;
}

// ── Order ────────────────────────────────────────────────────────────────────

export interface GardenSwapLeg {
  /**
   * Optional, like everything else on this interface, because the order response
   * is the one shape that could NOT be observed against the live API — no route
   * on either network will produce an order. Declaring these required would let
   * the compiler assert a guarantee nobody has checked, and the funding code
   * would read `undefined` as a value instead of refusing.
   */
  asset?: string;
  /** Where the funds must go / come from. Per-order on UTXO chains. */
  htlc_address?: string;
  amount?: string;
  initiate_tx_hash?: string;
  redeem_tx_hash?: string;
  refund_tx_hash?: string;
  [k: string]: unknown;
}

/**
 * An unsigned transaction Garden wants broadcast, exactly as it returns one.
 *
 * Observed, not assumed: `{to, value, data, gas_limit, chain_id}` on both the
 * approval and the initiate leg of an EVM order.
 */
export interface GardenEvmTx {
  to?: string;
  value?: string;
  data?: string;
  gas_limit?: string;
  chain_id?: number;
  [k: string]: unknown;
}

export interface GardenOrder {
  /** Garden calls this `order_id` in the docs and returns `create_id` on some
   *  responses; both are carried so a caller never has to guess. */
  order_id?: string;
  create_id?: string;
  source_swap?: GardenSwapLeg;
  destination_swap?: GardenSwapLeg;
  /** Unsigned transactions for non-UTXO sources, when Garden supplies them. */
  transactions?: unknown;
  /**
   * EVM sources. Garden returns the calls ready to sign rather than describing
   * them, so funding one requires no ABI encoding on our side — which is what
   * made this path implementable at all (see gardenSwap.fundingPlan).
   */
  approval_transaction?: GardenEvmTx;
  initiate_transaction?: GardenEvmTx;
  /** EIP-712 `Initiate` payload for Garden's gasless submission path. */
  typed_data?: unknown;
  status?: string;
  [k: string]: unknown;
}

/**
 * Commit to a quote.
 *
 * `amount` on each side must be the figure the quote returned, not what the user
 * typed — the same discipline the Orchestra path follows, and for the same
 * reason: the quote is the number the solver agreed to.
 */
export function createOrder(opts: {
  env: ChainEnvironment;
  source: { asset: string; owner: string; amount: string };
  destination: { asset: string; owner: string; amount: string };
}): Promise<GardenOrder> {
  return call<GardenOrder>(opts.env, '/v2/orders', {
    method: 'POST',
    body: { source: opts.source, destination: opts.destination },
  });
}

/** Ask Garden to submit the source-side initiation on our behalf (gasless). */
export function initiateOrder(opts: {
  env: ChainEnvironment;
  orderId: string;
  /** The EIP-712 signature over Garden's initiate payload, for EVM sources. */
  signature: string;
}): Promise<GardenOrder> {
  return call<GardenOrder>(opts.env, `/v2/orders/${opts.orderId}?action=initiate`, {
    method: 'PATCH',
    body: { signature: opts.signature },
  });
}

export const orderStatus = (env: ChainEnvironment, orderId: string): Promise<GardenOrder> =>
  call<GardenOrder>(env, `/v2/orders/${orderId}`);

/** An order is done when the destination side has been redeemed. Garden's own
 *  completion condition, not a status string we hope is stable. */
export const isComplete = (o: GardenOrder): boolean =>
  !!o.destination_swap?.redeem_tx_hash;

/** Refunded means the source came back — a finished order, not a pending one. */
export const isRefunded = (o: GardenOrder): boolean => !!o.source_swap?.refund_tx_hash;
