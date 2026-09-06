//! Lightning bridge — Breez SDK **Spark** (self-custodial, in-app, mainnet).
//
// Breez's recommended implementation (Liquid is being phased out; Liquid also
// removed testnet). Spark runs on mainnet here — Lightning is Bitcoin-only and
// independent of the rest of the app's network (which stays on testnet). Keys are
// derived from the wallet's own BIP-39 mnemonic. See lightning-breez-spark-plan.md.
//
// Public function signatures are unchanged from the previous bridge, so the
// ln-pay / receive/ln screens need no changes — only the implementation moved to
// the Spark `sdk` instance returned by connect(). `connect()` is lazy + idempotent.

import {
  connect,
  defaultConfig,
  Network,
  Seed,
  ReceivePaymentMethod,
  PaymentRequest,
  SendPaymentOptions,
  MaxFee,
  PaymentStatus as SparkPaymentStatus,
  PaymentType as SparkPaymentType,
  type BreezSdkInterface,
} from '@breeztech/breez-sdk-spark-react-native';
import { Directory, Paths } from 'expo-file-system';
import { loadMnemonic } from './seedVault';
import { getActiveAlias } from './wallet';

/** Breez API key (free, from the Breez console). Inlined by Metro at bundle time. */
const BREEZ_API_KEY = process.env.EXPO_PUBLIC_BREEZ_API_KEY || '';

// Spark's RN SDK supports Mainnet + Regtest only (no testnet). Regtest needs local
// infra ("no JWT-issuing Breez endpoint"), so mainnet is the practical choice.
const NETWORK = Network.Mainnet;

export interface DecodedInvoice {
  amountSat: number | null;
  description: string;
  expiresAt?: number;
  payee?: string;
}

export interface PayResult {
  paymentId: string;
  status: 'succeeded' | 'pending' | 'failed';
  feeSat: number;
  balanceSat: number;
  reason?: string;
}

export interface CreatedInvoice {
  paymentId: string;
  invoice: string;
  amountSat: number;
  expiresAt?: number;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface PaymentInfo {
  paymentId: string;
  status: PaymentStatus;
  amountSat: number;
  direction: 'incoming' | 'outgoing';
}

// ---- Connection (lazy, idempotent) ----------------------------------------

let sdk: BreezSdkInterface | null = null;
let connecting: Promise<void> | null = null;

/** App-controlled Spark storage directory (plain path, not a file:// URI). */
function storageDir(): string | undefined {
  try {
    const dir = new Directory(Paths.document, 'breez_spark');
    if (!dir.exists) dir.create({ intermediates: true });
    return dir.uri.replace(/^file:\/\//, '');
  } catch {
    return undefined;
  }
}

/** Connect the Spark SDK once, using the wallet's mnemonic. Idempotent. */
export async function initLightning(): Promise<void> {
  if (sdk) return;
  if (connecting) return connecting;
  connecting = (async () => {
    if (!BREEZ_API_KEY) throw new Error('Missing EXPO_PUBLIC_BREEZ_API_KEY');
    const words = await loadMnemonic(getActiveAlias());
    if (!words || words.length === 0) throw new Error('No wallet mnemonic available');
    const config = defaultConfig(NETWORK);
    config.apiKey = BREEZ_API_KEY;
    const seed = new Seed.Mnemonic({ mnemonic: words.join(' '), passphrase: undefined });
    sdk = await connect({ config, seed, storageDir: storageDir() ?? '' });
    console.log('[lightning] Breez Spark connected (mainnet)');
  })();
  connecting.catch((e) => console.warn('[lightning] connect failed:', String(e)));
  try {
    await connecting;
  } finally {
    connecting = null;
  }
}

function requireSdk(): BreezSdkInterface {
  if (!sdk) throw new Error('Lightning not connected');
  return sdk;
}

// ---- Helpers ---------------------------------------------------------------

/** Map a raw Breez error to a short, user-facing message (raw kept for logs). */
export function friendlyLnError(e: unknown): string {
  const s = String((e as Error)?.message ?? e);
  if (/insufficient/i.test(s)) return 'Insufficient balance for this payment.';
  if (/missing.*api.?key/i.test(s)) return 'Lightning is not configured.';
  if (/network|timeout|connect|gateway|unavailable/i.test(s))
    return 'Lightning service is temporarily unavailable. Please try again shortly.';
  return s;
}

/** JSON.stringify but BigInt-safe (Spark error objects carry u64 fields as
 *  BigInt, which JSON.stringify throws on). Falls back to String(). */
function stringifyErr(e: unknown): string {
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String((e as Error)?.message ?? e);
  }
}

/** Detect a bolt11 Lightning invoice string. Pure — used by the scanner. */
export function parseBolt11(raw: string): string | null {
  let s = raw.trim();
  const lower = s.toLowerCase();
  const pfx = lower.startsWith('lightning:') ? 'lightning:'.length : 0;
  s = s.slice(pfx).trim();
  if (/^ln(bc|tb|tbs|bcrt)[0-9]/i.test(s)) return s.toLowerCase();
  return null;
}

/** Parse the amount (sats) from a bolt11's human-readable part (offline, no SDK). */
function bolt11AmountSat(invoice: string): number | null {
  const s = invoice.trim().toLowerCase();
  const sep = s.lastIndexOf('1');
  if (sep <= 0) return null;
  const hrp = s.slice(0, sep);
  const amount = ['lnbcrt', 'lntbs', 'lnbc', 'lntb', 'lnsb'].reduce<string | null>(
    (acc, p) => acc ?? (hrp.startsWith(p) ? hrp.slice(p.length) : null),
    null,
  );
  if (amount == null || amount === '') return null;
  const mult: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  const last = amount[amount.length - 1];
  const num = last in mult ? Number(amount.slice(0, -1)) : Number(amount);
  const factor = last in mult ? mult[last] : 1;
  if (!Number.isFinite(num)) return null;
  return Math.round(num * factor * 1e8);
}

// ---- Reads -----------------------------------------------------------------

/** Decode a bolt11's amount (offline HRP parse; description omitted). */
export async function decodeInvoice(invoice: string): Promise<DecodedInvoice> {
  return { amountSat: bolt11AmountSat(invoice), description: '' };
}

/** The user's Lightning (Spark) balance, in sats. */
export async function lightningBalance(): Promise<number> {
  await initLightning();
  const info = await requireSdk().getInfo({ ensureSynced: false });
  return Number(info.balanceSats);
}

export interface ClaimResult {
  /** total unclaimed deposits the SDK currently sees at our addresses */
  found: number;
  /** deposits successfully claimed into the Spark balance this run */
  claimed: number;
  /** total sats claimed this run */
  claimedSats: number;
  /** deposits seen but not yet mature (need more confirmations) */
  pending: number;
  /** sats sitting in not-yet-mature deposits */
  pendingSats: number;
  /** per-deposit claim errors (from the SDK), if any */
  errors: string[];
}

// Single-flight guard: refreshLightning fires on launch AND foreground, so two
// claim passes could run concurrently and race on the same deposit (the first
// then fails with a generic SparkError). Coalesce concurrent callers onto one run.
let claimInFlight: Promise<ClaimResult> | null = null;

/** Claim any confirmed on-chain deposits into the Spark balance. On-chain BTC
 *  sent to the deposit address (see {@link bitcoinDepositAddress}) is NOT auto-
 *  credited — it must be claimed once mature (enough confirmations). Best-effort;
 *  returns a detailed breakdown so the UI can tell the user what happened.
 *  Single-flight: concurrent calls share one in-flight run. */
export async function claimDeposits(): Promise<ClaimResult> {
  if (claimInFlight) return claimInFlight;
  claimInFlight = runClaimDeposits().finally(() => {
    claimInFlight = null;
  });
  return claimInFlight;
}

async function runClaimDeposits(): Promise<ClaimResult> {
  await initLightning();
  const s = requireSdk();
  const out: ClaimResult = { found: 0, claimed: 0, claimedSats: 0, pending: 0, pendingSats: 0, errors: [] };
  try {
    await s.syncWallet({});
  } catch (e) {
    console.warn('[lightning] syncWallet failed:', String(e));
  }
  const { deposits } = await s.listUnclaimedDeposits({});
  out.found = deposits.length;
  if (deposits.length) console.log(`[lightning] unclaimed deposits: ${deposits.length}`);
  for (const d of deposits) {
    const sats = Number(d.amountSats);
    // NOTE: d.claimError is Spark's OWN prior auto-claim attempt (it tries at a low
    // default feerate and records MaxDepositClaimFeeExceeded). It's informational —
    // we re-claim below at the network feerate — so it's not surfaced as an error.
    if (!d.isMature) {
      out.pending += 1;
      out.pendingSats += sats;
      console.log(`[lightning] deposit not mature yet: ${d.txid} (${sats} sats)`);
      continue;
    }
    try {
      // Claim at the network-recommended feerate (with a little leeway) instead
      // of the SDK's low default cap, which rejects with MaxDepositClaimFeeExceeded
      // even at normal mainnet feerates. The on-chain claim fee is deducted from
      // the deposit, so a tiny deposit may still be uneconomic to claim.
      await s.claimDeposit({
        txid: d.txid,
        vout: d.vout,
        maxFee: new MaxFee.NetworkRecommended({ leewaySatPerVbyte: BigInt(3) }),
      });
      out.claimed += 1;
      out.claimedSats += sats;
      console.log(`[lightning] claimed deposit ${d.txid} (${sats} sats)`);
    } catch (e) {
      out.errors.push(stringifyErr((e as Error)?.message ?? e));
      console.warn('[lightning] claimDeposit failed:', d.txid, String(e));
    }
  }
  return out;
}

// ---- Send ------------------------------------------------------------------

export interface PreparedPayment {
  /** amount that will be sent, in sats (authoritative — from the SDK) */
  amountSat: number;
  /** total fee in sats (Lightning routing + any Spark transfer fee) */
  feeSat: number;
  /** invoice memo, if any */
  description: string;
  /** payee node pubkey, if decodable */
  payee?: string;
}

/** Decode + fee-quote an invoice for the review screen, WITHOUT sending. Returns
 *  the exact amount and fee the SDK will charge so the UI can show a real fee row
 *  (like the on-chain send's "Network fee"). Pass amountSat for amountless invoices. */
export async function prepareInvoice(invoice: string, amountSat?: number): Promise<PreparedPayment> {
  await initLightning();
  const s = requireSdk();
  const prep = await s.prepareSendPayment({
    paymentRequest: new PaymentRequest.Input({ input: invoice }),
    amount: amountSat != null ? BigInt(amountSat) : undefined,
    tokenIdentifier: undefined,
    conversionOptions: undefined,
    feePolicy: undefined,
  });
  let feeSat = 0;
  let description = '';
  let payee: string | undefined;
  // paymentMethod is a SendPaymentMethod enum; the bolt11 variant carries the fees
  // + decoded invoice details in `.inner`.
  const inner = (prep.paymentMethod as { inner?: Record<string, unknown> })?.inner;
  if (inner) {
    feeSat = Number((inner.lightningFeeSats as bigint) ?? 0n) + Number((inner.sparkTransferFeeSats as bigint) ?? 0n);
    const details = inner.invoiceDetails as { description?: string; payeePubkey?: string } | undefined;
    description = details?.description ?? '';
    payee = details?.payeePubkey;
  }
  return { amountSat: Number(prep.amount), feeSat, description, payee };
}

export async function payInvoice(invoice: string, amountSat?: number): Promise<PayResult> {
  await initLightning();
  const s = requireSdk();
  const prep = await s.prepareSendPayment({
    paymentRequest: new PaymentRequest.Input({ input: invoice }),
    amount: amountSat != null ? BigInt(amountSat) : undefined,
    tokenIdentifier: undefined,
    conversionOptions: undefined,
    feePolicy: undefined,
  });
  const res = await s.sendPayment({
    prepareResponse: prep,
    options: new SendPaymentOptions.Bolt11Invoice({ preferSpark: false, completionTimeoutSecs: 15 }),
    idempotencyKey: undefined,
  });
  const p = res.payment;
  const status =
    p.status === SparkPaymentStatus.Completed
      ? 'succeeded'
      : p.status === SparkPaymentStatus.Failed
        ? 'failed'
        : 'pending';
  const balanceSat = Number((await s.getInfo({ ensureSynced: false })).balanceSats);
  return { paymentId: p.id, status, feeSat: Number(p.fees), balanceSat };
}

// ---- Receive ---------------------------------------------------------------

// Tracks pending invoices so paymentStatus can detect the incoming payment via
// listPayments (Spark has no per-invoice id until the payment lands).
const pending = new Map<string, { amountSat: number; since: bigint }>();

export async function createInvoice(amountSat: number, description?: string): Promise<CreatedInvoice> {
  await initLightning();
  const res = await requireSdk().receivePayment({
    paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
      description: description ?? 'Standard',
      amountSats: BigInt(amountSat),
      expirySecs: undefined,
      paymentHash: undefined,
    }),
  });
  const invoice = res.paymentRequest;
  const paymentId = `inv-${Date.now()}-${amountSat}`;
  pending.set(paymentId, { amountSat, since: BigInt(Math.floor(Date.now() / 1000) - 5) });
  return { paymentId, invoice, amountSat };
}

/** Poll for the incoming payment via listPayments (matched by amount + recency). */
export async function paymentStatus(paymentId: string): Promise<PaymentInfo> {
  await initLightning();
  const want = pending.get(paymentId);
  const list = await requireSdk().listPayments({
    typeFilter: [SparkPaymentType.Receive],
    statusFilter: [SparkPaymentStatus.Completed],
    assetFilter: undefined,
    paymentDetailsFilter: undefined,
    fromTimestamp: want?.since,
    toTimestamp: undefined,
    offset: undefined,
    limit: 20,
    sortAscending: undefined,
  });
  const hit = list.payments.find(
    (p) => !want || Number(p.amount) === want.amountSat,
  );
  return {
    paymentId,
    status: hit ? 'paid' : 'pending',
    amountSat: want?.amountSat ?? (hit ? Number(hit.amount) : 0),
    direction: 'incoming',
  };
}

/** A Lightning invoice (bolt11, `lnbc…`) any Lightning wallet can pay. Amountless
 *  by default so the payer chooses the amount — Spark has no static reusable
 *  Lightning address (that needs LNURL), so this is the "Receive over Lightning"
 *  default. Use {@link createInvoice} for a fixed amount. */
export async function lightningAddress(): Promise<string> {
  await initLightning();
  const res = await requireSdk().receivePayment({
    paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
      description: 'Standard',
      amountSats: undefined,
      expirySecs: undefined,
      paymentHash: undefined,
    }),
  });
  return res.paymentRequest;
}

/** An on-chain Bitcoin deposit address (`bc1…`). Send on-chain BTC here from any
 *  wallet and Breez converts it into your Lightning/Spark balance (needs ~1
 *  confirmation + a swap fee). The way to fund from an on-chain-only wallet. */
export async function bitcoinDepositAddress(): Promise<string> {
  await initLightning();
  const res = await requireSdk().receivePayment({
    paymentMethod: new ReceivePaymentMethod.BitcoinAddress({ newAddress: undefined }),
  });
  return res.paymentRequest;
}
