// ─────────────────────────────────────────────────────────────────────────────
//  Payment requests — the "ask for money" half of the wallet.
//
//  Emits EIP-681, the same dialect `parsePayment` already reads, so a request
//  made here resolves in the send flow with the right token, the right chain and
//  the amount pre-filled. Generator and parser MUST stay in step; the round trip
//  is asserted in paymentRequest.test.ts against this module's own output rather
//  than a hand-written string.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentRequest {
  /** Who gets paid. */
  recipient: string;
  /** EVM chain the payment must go out on. Pinning it is the whole point: the
   *  same address exists on every EVM chain, and an unpinned request is how
   *  money lands on the wrong network. */
  chainId: bigint;
  /** ERC-20 being requested. Omit for the chain's native coin. */
  token?: { address: string; decimals: number };
  /** Human units. Omitted / zero means "any amount". */
  amount?: number;
}

/** Human amount → base units, without floating-point drift on the last digit. */
function baseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

/**
 * Build the request URI.
 *
 * Two shapes, because EIP-681 spells them differently:
 *   ERC-20  ethereum:<token>@<chain>/transfer?address=<to>&uint256=<base>
 *   native  ethereum:<to>@<chain>?value=<wei>
 */
export function buildPaymentUri(req: PaymentRequest): string {
  const chain = req.chainId.toString();
  if (req.token) {
    const q = [`address=${req.recipient}`];
    if (req.amount && req.amount > 0) {
      q.push(`uint256=${baseUnits(req.amount, req.token.decimals).toString()}`);
    }
    return `ethereum:${req.token.address}@${chain}/transfer?${q.join('&')}`;
  }
  const value = req.amount && req.amount > 0 ? baseUnits(req.amount, 18) : null;
  return `ethereum:${req.recipient}@${chain}${value !== null ? `?value=${value.toString()}` : ''}`;
}

/**
 * A tappable link that opens Mercury on the payment.
 *
 * The QR stays raw EIP-681 so ANY wallet's scanner can read it. A link has no
 * such convention, so it is wrapped in our own scheme rather than claiming
 * `ethereum:` — squatting a scheme other wallets also register makes which app
 * opens a coin toss.
 */
export function buildPaymentLink(uri: string): string {
  // A PATH segment, not a query param: an EIP-681 URI carries its own `?` and
  // `&`, and the router splits the query on those before decoding — which drops
  // everything after the first `&`, silently losing the amount.
  return `mercury://pay/${encodeURIComponent(uri)}`;
}

/** The payment URI inside an incoming link, or null if it is not one of ours. */
export function paymentUriFromLink(url: string): string | null {
  const s = url.trim();
  // Our own wrapper first — path form, plus the older query form.
  const m = /^mercury:\/\/pay\/(.+)$/i.exec(s) ?? /^mercury:\/\/pay\?uri=(.+)$/i.exec(s);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  // A bare payment URI handed to us directly (shared sheet, another app).
  if (/^(ethereum|bitcoin|solana):/i.test(s)) return s;
  return null;
}
