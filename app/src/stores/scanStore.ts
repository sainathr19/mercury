import { create } from 'zustand';

/** Tiny channel to pass a scanned QR payload back from the scanner route to the
 *  screen that opened it (Expo Router has no return-value navigation). */
interface ScanState {
  result: string | null;
  setResult: (v: string) => void;
  consume: () => string | null;
}

export const useScan = create<ScanState>((set, get) => ({
  result: null,
  setResult: (v) => set({ result: v }),
  consume: () => {
    const r = get().result;
    if (r !== null) set({ result: null });
    return r;
  },
}));

/** A parsed payment request from a scanned QR / pasted URI. `address` is always
 *  the PAYMENT RECIPIENT; the optional fields let the Send flow pre-select the
 *  requested token and pre-fill the amount instead of defaulting to the native
 *  asset. */
export interface ScannedPayment {
  /** Recipient address (scheme + `@chain` + `?query` stripped). */
  address: string;
  /** Requested token identity, when the URI names one (Solana-Pay `spl-token`
   *  mint, or an EIP-681 token-`transfer` contract). Matched to a held asset. */
  token?: { mint?: string; contract?: string };
  /** Amount in HUMAN units, when the URI states it directly (Solana-Pay /
   *  bitcoin `amount`). */
  amount?: string;
  /** Amount in BASE units that needs decimals to render: EIP-681 native `value`
   *  (wei → `kind: 'wei'`) or token `uint256` (`kind: 'token'`, uses the matched
   *  asset's decimals). */
  amountBase?: string;
  amountBaseKind?: 'wei' | 'token';
  /** EIP-681 `@<chainId>` — the EVM chain the payment must go out on. Critical:
   *  paying on the wrong chain sends to the right address but the wrong network. */
  chainId?: number;
  /** Chain implied by the URI scheme (`ethereum:`→eth, `bitcoin:`→btc,
   *  `solana:`→sol). Authoritative over address-byte guessing, which is
   *  ambiguous (a bech32 `tb1…` also matches the base58 Solana shape). */
  chainHint?: 'btc' | 'eth' | 'sol';}

/** Manual query-string parse. Avoids depending on RN's partial URLSearchParams
 *  polyfill, and handles percent-encoding. */
function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq >= 0 ? part.slice(0, eq) : part;
    const val = eq >= 0 ? part.slice(eq + 1) : '';
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

/** Parse a scanned QR / URI into a structured payment request. Handles:
 *   • bare addresses (0x… / bc1… / base58)
 *   • `ethereum:`, `bitcoin:`, `solana:` schemes
 *   • EIP-681 `@chainId` suffix and native `?value=<wei>`
 *   • EIP-681 token transfer `ethereum:<contract>@<chain>/transfer?address=<to>&uint256=<amt>`
 *   • Solana-Pay `?amount=<x>&spl-token=<mint>`
 *   • bitcoin `?amount=<x>` */
export function parsePayment(raw: string): ScannedPayment {
  const s = raw.trim();
  const lower = s.toLowerCase();

  // hub handle (@username) — what the receive QR encodes. Return it
  // verbatim so the Send flow resolves it to the recipient's receive address.
  // MUST come before the EIP-681 `<addr>@<chainId>` handling below, which would
  // otherwise read the leading `@` as a chain separator and blank the recipient
  // (the "not valid" you saw). Tolerates an optional `mercury:` scheme prefix.
  const handleBody = lower.startsWith('mercury:') ? s.slice('mercury:'.length).trim() : s;
  if (/^@[a-z0-9_.-]{1,64}$/i.test(handleBody)) {
    return { address: handleBody };
  }

  // Strip a `scheme:` prefix (letters only, and not a bare 0x… address).
  const colon = s.indexOf(':');
  const hasScheme =
    colon > 0 && !lower.startsWith('0x') && /^[a-zA-Z]{1,12}$/.test(s.slice(0, colon));
  const scheme = hasScheme ? lower.slice(0, colon) : '';
  let rest = hasScheme ? s.slice(colon + 1) : s;

  // Split off the query string.
  const q = rest.indexOf('?');
  const query = q >= 0 ? parseQuery(rest.slice(q + 1)) : {};
  let path = q >= 0 ? rest.slice(0, q) : rest;

  // EIP-681: <target>@<chainId>[/<function>]
  let fn = '';
  const slash = path.indexOf('/');
  if (slash >= 0) {
    fn = path.slice(slash + 1);
    path = path.slice(0, slash);
  }
  const at = path.indexOf('@');
  let chainId: number | undefined;
  if (at >= 0) {
    const cid = parseInt(path.slice(at + 1), 10);
    if (Number.isFinite(cid)) chainId = cid;
    path = path.slice(0, at);
  }

  const out: ScannedPayment = { address: path.trim() };
  if (chainId != null) out.chainId = chainId;
  const hint = scheme === 'ethereum' ? 'eth' : scheme === 'bitcoin' ? 'btc' : scheme === 'solana' ? 'sol' : undefined;
  if (hint) out.chainHint = hint;

  // EIP-681 token transfer: the path is the token CONTRACT, the real recipient
  // is the `address` arg, and the amount is `uint256` (token base units).
  if (scheme === 'ethereum' && fn.toLowerCase().startsWith('transfer')) {
    out.token = { contract: path.trim() };
    if (query.address) out.address = query.address.trim();
    const v = query.uint256 ?? query.value;
    if (v) {
      out.amountBase = v.trim();
      out.amountBaseKind = 'token';
    }
    return out;
  }

  // Solana-Pay token mint.
  if (query['spl-token']) out.token = { mint: query['spl-token'].trim() };

  // Amount: human `amount` (Solana-Pay / bitcoin) wins; else native `value` (wei).
  if (query.amount) out.amount = query.amount.trim();
  else if (query.value) {
    out.amountBase = query.value.trim();
    out.amountBaseKind = 'wei';
  }

  return out;
}

/** Normalize a scanned QR payload to a bare recipient address. Kept for callers
 *  that only need the address (delegates to {@link parsePayment}). */
export function parseScanned(raw: string): string {
  return parsePayment(raw).address;
}
