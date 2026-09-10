//! Flashnet Orchestra — cross-chain swaps.
//
// Orchestra is asynchronous and custody-free at the source: you ask for a
// quote, it allocates a deposit address, YOU move the funds there yourself, and
// it delivers the destination asset to an address you named. It never holds a
// key of ours, which is why the whole thing works from a wallet app at all.
//
// The lifecycle, and where each step lives:
//
//   estimate  → priced preview while the user types            (public)
//   quote     → deposit address + firm amount, 2-minute expiry (needs a key)
//   [sign]    → OUR wallet signs and broadcasts the transfer   (bridge/transfer)
//   submit    → hand over the tx hash as proof                 (needs a key)
//   status    → poll until delivered                            (public)
//
// ── On the API key ──────────────────────────────────────────────────────────
//
// Orchestra issues two kinds, and the difference matters more than usual:
//
//   fn_…   SERVER key. Secret, FULL access to the account. Flashnet's own
//          integration guide says "never embed it in mobile or browser apps".
//   fnp_…  CLIENT key. Public, scope-gated, meant to be embedded.
//
// An `EXPO_PUBLIC_*` value is inlined into the JS bundle at build time and is
// recoverable from the installed app package by anyone who downloads it, so a
// server key here is a server key published. This repo has already been through
// that once — see the note on `INDEX_API` in bridge/graph.ts, where the Token
// API JWT was moved server-side for exactly this reason.
//
// So: a client key belongs here, and a server key does not. `keyKind()` reports
// which one is configured and the composer surfaces it, because the failure is
// otherwise completely silent — a server key WORKS, which is the problem.
import { assetKey, inScope, type RawRoute, type SwapRoute } from '../lib/flashnetScope';

const BASE = 'https://orchestration.flashnet.xyz';

/** Every call is a user waiting on a screen; none of them deserve 30 seconds. */
const TIMEOUT_MS = 20_000;

const KEY = process.env.EXPO_PUBLIC_FLASHNET_API_KEY ?? '';

export type KeyKind = 'client' | 'server' | 'missing' | 'unrecognised';

/** Which kind of key is configured — see the note above on why this is checked. */
export function keyKind(): KeyKind {
  if (!KEY) return 'missing';
  if (KEY.startsWith('fnp_')) return 'client';
  if (KEY.startsWith('fn_')) return 'server';
  return 'unrecognised';
}

/** Whether quoting and submitting are possible at all. */
export const swapsConfigured = (): boolean => !!KEY;

if (keyKind() === 'server' && __DEV__) {
  console.warn(
    '[flashnet] EXPO_PUBLIC_FLASHNET_API_KEY is a SERVER key (fn_…). It is inlined ' +
      'into the bundle and extractable from the app package, and it has full access ' +
      'to the Orchestra account. Replace it with a client key (fnp_…).',
  );
}

export class FlashnetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'FlashnetError';
  }
}

async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean; idempotencyKey?: string } = {},
): Promise<T> {
  const { method = 'GET', body, auth = false, idempotencyKey } = init;
  if (auth && !KEY) {
    throw new FlashnetError('Swaps are not configured on this build.', 0, 'no_api_key');
  }

  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${KEY}`;
  // Required on every authenticated mutating call. Reusing a key with a
  // DIFFERENT body is a 409, so each is derived from the request it belongs to.
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new FlashnetError(
      aborted ? 'Flashnet took too long to answer.' : 'Could not reach Flashnet.',
      0,
      aborted ? 'timeout' : 'network',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) throw errorFrom(json, res.status);
  return json as T;
}

/**
 * An error body turned into an Error, without ever putting an OBJECT in the
 * message.
 *
 * Orchestra nests its errors — `{"error":{"code":"amount_too_small","message":
 * "Amount too small"}}` — so reading `body.error` and handing it to `new Error`
 * put the string "[object Object]" on screen where the reason should have been.
 * Every candidate is type-checked before use, and flat shapes are still
 * accepted in case a gateway in front of the API does not nest.
 */
export function errorFrom(json: unknown, status: number): FlashnetError {
  const o = (json ?? {}) as Record<string, unknown>;
  const nested =
    typeof o.error === 'object' && o.error !== null ? (o.error as Record<string, unknown>) : undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const message =
    str(nested?.message) ??
    str(o.message) ??
    str(o.error) ??
    str(o.detail) ??
    `Flashnet returned ${status}.`;
  return new FlashnetError(message, status, str(nested?.code) ?? str(o.code));
}

// ── routes ──────────────────────────────────────────────────────────────────

/**
 * The pairs we can take, read live.
 *
 * The docs are explicit that the route table changes as chains and provider
 * capacity change, and must not be copied into the app as a static list. It is
 * narrowed to our own capabilities on arrival (see lib/flashnetScope) because
 * the full response is ~3MB and 4,600 routes.
 */
export async function fetchRoutes(): Promise<SwapRoute[]> {
  const r = await call<{ routes: RawRoute[] }>('/v1/orchestration/routes');
  return inScope(r.routes ?? []);
}

// ── limits ──────────────────────────────────────────────────────────────────

/** What a route will accept, in USD cents. */
export interface RouteLimits {
  minUsdCents?: number;
  maxUsdCents?: number;
}

/**
 * The amount bounds for one pair.
 *
 * Worth asking for up front: every route in scope has a floor (currently $5),
 * and without it the first thing a user sees after typing a small amount is
 * "Amount too small" with no clue what would be large enough. The API is
 * explicit that a live quote can still reject an amount inside these bounds,
 * because pricing and liquidity move — so this is a hint, never a guarantee.
 */
export async function limits(p: {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
}): Promise<RouteLimits> {
  const q = new URLSearchParams(p as unknown as Record<string, string>);
  const r = await call<{
    routes?: { limits?: { orderNotionalUsd?: { minCents?: string; maxCents?: string } } }[];
  }>(`/v1/orchestration/limits?${q.toString()}`);
  const b = r.routes?.[0]?.limits?.orderNotionalUsd;
  const num = (v?: string): number | undefined => {
    const n = Number(v);
    return v != null && Number.isFinite(n) ? n : undefined;
  };
  return { minUsdCents: num(b?.minCents), maxUsdCents: num(b?.maxCents) };
}

// ── estimate ────────────────────────────────────────────────────────────────

export interface Estimate {
  estimatedOut: string;
  feeAmount: string;
  totalFeeAmount?: string;
  feeBps?: number;
  feeAsset: string;
  /**
   * The fee's OWN chain, asset and decimals.
   *
   * Load-bearing: the fee is not necessarily denominated in the source asset —
   * a base:ETH route is charged in USDC — so formatting it with the source's
   * decimals renders a $37 fee as "0.000000000037". Always read decimals here.
   */
  feeAssetDetails?: { chain: string; asset: string; decimals: number };
  totalFeeAmountUsd?: string;
  route?: string[];
  /** Some destinations cost extra to deliver to — a Solana token account, say.
   *  Denominated in the FEE asset, not the source. */
  networkCostAmount?: string;
  networkCostAsset?: string;
  networkCostRequired?: boolean;
}

/** Priced preview. Unauthenticated, so it works even with no key configured. */
export function estimate(p: {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
  /** Smallest units of the SOURCE asset, as a decimal string. */
  amount: string;
  slippageBps?: number;
}): Promise<Estimate> {
  const q = new URLSearchParams({
    sourceChain: p.sourceChain,
    sourceAsset: p.sourceAsset,
    destinationChain: p.destinationChain,
    destinationAsset: p.destinationAsset,
    amount: p.amount,
    amountMode: 'exact_in',
  });
  if (p.slippageBps !== undefined) q.set('slippageBps', String(p.slippageBps));
  return call<Estimate>(`/v1/orchestration/estimate?${q.toString()}`);
}

// ── quote ───────────────────────────────────────────────────────────────────

export interface Quote {
  quoteId: string;
  depositAddress: string;
  /** EXACTLY what must be sent, in smallest units. Not what the user typed. */
  amountIn: string;
  estimatedOut: string;
  feeAmount: string;
  totalFeeAmount?: string;
  feeBps?: number;
  feeAsset: string;
  route?: string[];
  expiresAt: string;
}

/**
 * Lock a price and get somewhere to pay.
 *
 * Quotes expire two minutes after creation. A late deposit is not lost — it is
 * repriced at live rates and executed within the quoted slippage, or refunded —
 * but the figure shown at review stops being the figure delivered.
 */
export function quote(p: {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
  amount: string;
  recipientAddress: string;
  refundAddress: string;
  refundChain: string;
  slippageBps: number;
  idempotencyKey: string;
}): Promise<Quote> {
  const { idempotencyKey, ...body } = p;
  return call<Quote>('/v1/orchestration/quote', {
    method: 'POST',
    auth: true,
    idempotencyKey,
    body: { ...body, amountMode: 'exact_in', deliveryMode: 'variable' },
  });
}

// ── submit ──────────────────────────────────────────────────────────────────

/**
 * Hand over proof that the deposit was made.
 *
 * The payload is chain-shaped: EVM and Solana are `txHash` + `sourceAddress`.
 * Bitcoin wants a txid AND a vout, and Lightning a receive-request id, neither
 * of which this wallet can supply — which is why those are not offered as
 * source chains (see lib/flashnetScope).
 */
export function submit(p: {
  quoteId: string;
  txHash: string;
  sourceAddress: string;
  idempotencyKey: string;
}): Promise<{ orderId: string; status: string }> {
  const { idempotencyKey, ...body } = p;
  return call<{ orderId: string; status: string }>('/v1/orchestration/submit', {
    method: 'POST',
    auth: true,
    idempotencyKey,
    body,
  });
}

// ── status ──────────────────────────────────────────────────────────────────

/** Every state an order can be in, from the API's own enum. */
export type OrderStatus =
  | 'processing'
  | 'confirming'
  | 'bridging'
  | 'swapping'
  | 'awaiting_approval'
  | 'refunding'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'unfulfilled'
  | 'refunded';

export interface OrderStage {
  name: string;
  status: string;
  completedAt?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  quoteId: string;
  sourceChain: string;
  sourceAsset: string;
  sourceTxHash?: string;
  destinationChain: string;
  destinationAsset: string;
  recipientAddress: string;
  amountIn: string;
  amountOut?: string | null;
  feeAmount?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
}

/** Terminal states. Polling stops here; nothing more will happen. */
export const SETTLED: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'completed',
  'failed',
  'expired',
  'unfulfilled',
  'refunded',
]);

export function orderStatus(p: { orderId?: string; quoteId?: string }): Promise<{
  order: Order;
  stages?: OrderStage[];
}> {
  const q = new URLSearchParams();
  // Exactly one selector is allowed.
  if (p.orderId) q.set('id', p.orderId);
  else if (p.quoteId) q.set('quoteId', p.quoteId);
  return call<{ order: Order; stages?: OrderStage[] }>(`/v1/orchestration/status?${q.toString()}`);
}

/** Human wording for a status. The raw enum values leak into nothing. */
export function statusLabel(s: OrderStatus): string {
  switch (s) {
    case 'processing':
      return 'Processing';
    case 'confirming':
      return 'Confirming deposit';
    case 'bridging':
      return 'Bridging';
    case 'swapping':
      return 'Swapping';
    case 'awaiting_approval':
      return 'Awaiting approval';
    case 'delivering':
      return 'Delivering';
    case 'completed':
      return 'Completed';
    case 'refunding':
      return 'Refunding';
    case 'refunded':
      return 'Refunded';
    case 'expired':
      return 'Expired';
    case 'unfulfilled':
      return 'Not fulfilled';
    case 'failed':
      return 'Failed';
  }
}

export { assetKey };
