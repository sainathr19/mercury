import type {
  WalletInterface,
  StealthPayment,
  StealthSendReceipt,
  StealthSpendReceipt,
  StealthSponsoredSpend,
  StealthEvmToken,
  AnnouncementProcessReport,
} from 'standard-rn';
import { toBaseUnits } from '../lib/format';
import { btcExplorerTxUrl, solExplorerTxUrl } from './explorers';
import { evmExplorerTxUrl } from './evmChain';
import { evmChainHasNativeAsset } from '../lib/tempo';
import { APP_ENVIRONMENT, DEFAULT_EVM_CHAIN_ID, chainInEnvironment, type Environment } from '../lib/environment';
import { tokensForChain, type Registry } from '../lib/registry';
import { authClient } from './auth';
import type { CustomToken } from './tokens';
import type { PortfolioAsset } from './portfolio';

export type { StealthPayment } from 'standard-rn';

/** Chain families supported for stealth payments (mirrors iOS StealthSendView). */
export interface StealthChain {
  family: number; // 0=BTC, 1=EVM, 2=SOL
  key: 'btc' | 'eth' | 'sol';
  label: string;
  symbol: string;
  decimals: number;
  chainId: bigint; // EVM chain id; 0 for BTC/SOL
}

// Static default; the EVM entry follows APP_ENVIRONMENT and is overridden at
// runtime from the wallet's enabled EVM chains (see setStealthEvmChains).
export const STEALTH_CHAINS: StealthChain[] = [
  { family: 0, key: 'btc', label: 'Bitcoin', symbol: 'BTC', decimals: 8, chainId: 0n },
  { family: 1, key: 'eth', label: APP_ENVIRONMENT === 'mainnet' ? 'Ethereum' : 'EVM (Sepolia)', symbol: 'ETH', decimals: 18, chainId: DEFAULT_EVM_CHAIN_ID },
  { family: 2, key: 'sol', label: 'Solana', symbol: 'SOL', decimals: 9, chainId: 0n },
];

// The EVM chains available for stealth are sourced at runtime from the wallet's
// enabled EVM chains (see setStealthEvmChains) so stealth mirrors the normal
// view. Seeded with Sepolia so lookups work before the registry is populated.
let evmStealthChains: StealthChain[] = [STEALTH_CHAINS[1]];

// Registry-derived token metadata (coingeckoId + icon) keyed by
// `${chainId}:${contractLower}`, populated by `syncStealthTokens` from the same
// asset registry the normal dashboard uses. Lets a privately-held token price +
// show its icon exactly like it does on the main dashboard — the hardcoded
// `tokenMeta` fallback only knows USDC, so without this USDT (etc.) shows no
// fiat value.
const tokenMetaByContract = new Map<string, { coingeckoId: string; imageUrl: string }>();

/** Populate the EVM stealth chain registry from the wallet's enabled EVM chains,
 *  so stealth offers the same chains as the normal view. Excludes no-native-gas
 *  chains (e.g. Tempo — fees paid in a stablecoin) since the stealth flow assumes
 *  an ETH-like native asset. Falls back to Sepolia if the set is empty. */
export function setStealthEvmChains(
  configs: { chainId: bigint; name: string; nativeSymbol: string; nativeDecimals: number; enabled: boolean }[],
): void {
  const mapped = configs
    .filter((c) => c.enabled && evmChainHasNativeAsset(c.chainId))
    .map<StealthChain>((c) => ({
      family: 1,
      key: 'eth',
      label: `EVM (${c.name})`,
      symbol: c.nativeSymbol,
      decimals: c.nativeDecimals,
      chainId: c.chainId,
    }));
  evmStealthChains = mapped.length ? mapped : [STEALTH_CHAINS[1]];
}

/** All chains offered for stealth: BTC + every enabled EVM chain + SOL. */
export function stealthChains(): StealthChain[] {
  return [STEALTH_CHAINS[0], ...evmStealthChains, STEALTH_CHAINS[2]];
}

/** Chain metadata by family. For EVM this returns the DEFAULT (first) stealth
 *  chain — callers that have a specific payment/asset should prefer
 *  `chainForChainId` / `chainForPayment` so the correct EVM chain is used. */
export function chainForFamily(family: number): StealthChain | undefined {
  if (family === 1) return evmStealthChains[0];
  return STEALTH_CHAINS.find((c) => c.family === family);
}

/** Resolve the stealth chain for a specific EVM chain id (falls back to the
 *  first EVM stealth chain if the id isn't in the enabled set). */
export function chainForChainId(chainId: bigint): StealthChain | undefined {
  return evmStealthChains.find((c) => c.chainId === chainId) ?? evmStealthChains[0];
}

/** Resolve the stealth chain for a payment: EVM by its own `chainId`, BTC/SOL by
 *  family. Display and spend code should use this — an EVM payment is not
 *  necessarily on the default chain. */
export function chainForPayment(payment: { chainFamily: number; chainId?: bigint }): StealthChain | undefined {
  if (payment.chainFamily === 1) return chainForChainId(payment.chainId ?? 0n);
  return STEALTH_CHAINS.find((c) => c.family === payment.chainFamily);
}

/** Whether a scanned stealth payment is a REAL balance worth surfacing. A NATIVE
 *  EVM payment on a no-native-gas chain (Tempo) is bogus: `eth_getBalance` there
 *  returns a huge placeholder (~76-digit `4242…42`) that would render as a multi-
 *  quadrillion balance and blow up the private total. Mirrors the normal
 *  portfolio, which skips native rows for these chains. Token (TIP-20) payments
 *  on Tempo ARE real and kept. Used to filter payments at the store boundary so
 *  the total, holdings, activity, and spend-planning all ignore the phantom. */
export function isRealStealthPayment(p: { chainFamily: number; chainId?: bigint; tokenContract?: string | null }): boolean {
  if (p.chainFamily === 1 && !p.tokenContract && !evmChainHasNativeAsset(p.chainId ?? 0n)) return false;
  return true;
}

/** True if a stealth payment belongs to the given environment. The wallet's
 *  stealth DB persists across a testnet↔mainnet flip, so old testnet receipts
 *  would otherwise keep showing after switching to mainnet. Discriminate by:
 *   - EVM (family 1): the chain id's environment.
 *   - BTC (family 0): the stealth address prefix (bc1/1/3 = mainnet, else testnet).
 *   - SOL (family 2): addresses are identical across clusters, so we can't tell
 *     from the payment — keep it and rely on the network-scoped rescan. */
export function paymentInEnvironment(
  p: { chainFamily: number; chainId?: bigint; stealthAddress?: string },
  env: Environment,
): boolean {
  if (p.chainFamily === 1) return chainInEnvironment(p.chainId ?? 0n, env);
  if (p.chainFamily === 0) {
    const a = (p.stealthAddress ?? '').toLowerCase();
    const isMainnet = a.startsWith('bc1') || /^[13]/.test(p.stealthAddress ?? '');
    return isMainnet === (env === 'mainnet');
  }
  return true; // SOL — no per-cluster discriminator on the payment
}

/** Stable id for a private (stealth) holding — native aggregates per chain
 *  family, each ERC-20 gets its own row. Shared by the private balance display
 *  and the optimistic-ledger deltas so a shield/spend folds onto the right row. */
export function stealthHoldingId(chainFamily: number, tokenContract?: string | null): string {
  return tokenContract ? `stealth-t:${chainFamily}:${tokenContract.toLowerCase()}` : `stealth-f:${chainFamily}`;
}

/** Block-explorer URL for a stealth tx (funding tx for a pay, spend tx for a spend). */
export function stealthTxUrl(chain: StealthChain, txid: string): string {
  if (chain.family === 0) return btcExplorerTxUrl(txid);
  if (chain.family === 2) return solExplorerTxUrl(txid);
  return evmExplorerTxUrl(chain.chainId, txid);
}

/** CoinGecko id for a stealth chain (for USD valuation). */
export function coingeckoIdForChain(chain: StealthChain): string {
  return chain.family === 0 ? 'bitcoin' : chain.family === 2 ? 'solana' : 'ethereum';
}

/** Flat network fee reserved per Solana transaction (lamports). Each stealth
 *  source pays its own fee, so a source can contribute at most balance − fee. */
export const SOL_FEE_LAMPORTS = 5000n;

/** Gas reserved per EVM transaction (wei). Each stealth source EOA pays its own
 *  gas for its leg; a conservative Sepolia buffer (~21k gas at a high fee).
 *  Any unused reserve just stays as dust in that stealth address. */
export const EVM_GAS_RESERVE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

/** Conservative BTC fee reserve (sats) for a key-spend multi-input tx with `n`
 *  inputs at a low testnet feerate. The core recomputes the exact fee on send;
 *  this just keeps the entered amount under the spendable ceiling. */
function estBtcFeeSats(n: number): bigint {
  const vsize = 11 + 58 * Math.max(1, n) + 43 * 2; // ~58 vB/input, 2 outputs
  return BigInt(Math.ceil(vsize * 5)); // ~5 sat/vB
}

/** Spendable BTC total across received payments (sum minus one aggregate fee). */
export function btcSpendableTotal(payments: StealthPayment[]): bigint {
  const btc = payments.filter((p) => p.chainFamily === 0 && p.amount);
  const total = btc.reduce((s, p) => s + BigInt(p.amount as string), 0n);
  const reserve = estBtcFeeSats(btc.length);
  return total > reserve ? total - reserve : 0n;
}

/** Spendable total across an account chain's received payments (each balance
 *  minus a per-source fee/gas reserve). */
function accountSpendableTotal(payments: StealthPayment[], family: number, reserve: bigint): bigint {
  return payments
    .filter((p) => p.chainFamily === family && p.amount)
    .reduce((sum, p) => {
      const bal = BigInt(p.amount as string);
      return sum + (bal > reserve ? bal - reserve : 0n);
    }, 0n);
}
export const solSpendableTotal = (p: StealthPayment[]): bigint => accountSpendableTotal(p, 2, SOL_FEE_LAMPORTS);
export const evmSpendableTotal = (p: StealthPayment[], reserveWei: bigint = EVM_GAS_RESERVE_WEI): bigint =>
  accountSpendableTotal(p, 1, reserveWei);

/** Convert a live per-tx gas estimate (ETH, from `estimateFee`) into a per-source
 *  EVM reserve in wei, with a small safety margin for base-fee drift. Falls back
 *  to the conservative fixed reserve when no estimate is available. Pure so the
 *  bridge stays testable; screens fetch the estimate and pass it here. */
export function evmReserveFromFeeEth(feeEth: number | null): bigint {
  if (feeEth == null || feeEth <= 0) return EVM_GAS_RESERVE_WEI;
  return BigInt(Math.ceil(feeEth * 1e18 * 1.25));
}

/** Format an atomic bigint → a decimal string at `decimals` (exact round-trip). */
function atomicToHuman(atomic: bigint, decimals: number): string {
  const s = atomic.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Auto-select an account chain's received payments (largest-spendable first)
 *  to cover `amountHuman`, reserving a per-source fee/gas. Returns per-source
 *  portions to spend (one tx each), or null if the spendable total is short. */
function planAccountSpend(
  payments: StealthPayment[],
  family: number,
  decimals: number,
  reserve: bigint,
  amountHuman: string,
): { payment: StealthPayment; human: string }[] | null {
  let remaining = toBaseUnits(amountHuman, decimals);
  const sources = payments
    .filter((p) => p.chainFamily === family && p.amount)
    .map((p) => ({ payment: p, spendable: BigInt(p.amount as string) - reserve }))
    .filter((s) => s.spendable > 0n)
    .sort((a, b) => (b.spendable > a.spendable ? 1 : b.spendable < a.spendable ? -1 : 0));

  const out: { payment: StealthPayment; human: string }[] = [];
  for (const s of sources) {
    if (remaining <= 0n) break;
    const take = s.spendable < remaining ? s.spendable : remaining;
    out.push({ payment: s.payment, human: atomicToHuman(take, decimals) });
    remaining -= take;
  }
  return remaining <= 0n ? out : null;
}

/** Sweep an account chain: drain EVERY source fully (balance − per-source
 *  reserve), one tx each, in exact atomic units. Unlike `planAccountSpend`, this
 *  never round-trips through a float human amount, so a MAX/sweep leaves no dust
 *  and can't fail at the spendable ceiling. Skips sources that can't cover fees. */
function planAccountSweep(
  payments: StealthPayment[],
  family: number,
  decimals: number,
  reserve: bigint,
): { payment: StealthPayment; human: string }[] {
  return payments
    .filter((p) => p.chainFamily === family && p.amount)
    .map((p) => ({ payment: p, take: BigInt(p.amount as string) - reserve }))
    .filter((s) => s.take > 0n)
    .map((s) => ({ payment: s.payment, human: atomicToHuman(s.take, decimals) }));
}

/** Sweep all SOL sources (drain each fully). */
export const planSolSweep = (payments: StealthPayment[]) =>
  planAccountSweep(payments, 2, 9, SOL_FEE_LAMPORTS);

/** Sweep all EVM sources (drain each fully), reserving `reserveWei` of gas each. */
export const planEvmSweep = (payments: StealthPayment[], reserveWei: bigint = EVM_GAS_RESERVE_WEI) =>
  planAccountSweep(payments, 1, 18, reserveWei);

/** Full spendable total across an ERC-20's stealth sources. NO fee reserve —
 *  gas is sponsored (EIP-7702), so the entire token balance is spendable. */
export function tokenSpendableTotal(payments: StealthPayment[]): bigint {
  return payments
    .filter((p) => p.tokenContract && p.amount)
    .reduce((s, p) => s + BigInt(p.amount as string), 0n);
}

/** Sweep all of an ERC-20's stealth sources — drain each fully (exact atomic
 *  units, one sponsored spend per source). No fee reserve (gas is sponsored). */
export function planTokenSweep(payments: StealthPayment[]): { payment: StealthPayment; human: string }[] {
  const decimals = payments[0]?.tokenDecimals ?? 0;
  return payments
    .filter((p) => p.tokenContract && p.amount && BigInt(p.amount as string) > 0n)
    .map((p) => ({ payment: p, human: atomicToHuman(BigInt(p.amount as string), decimals) }));
}

/** Coin-select ERC-20 stealth sources (largest first) to cover `amountHuman` —
 *  one gas-sponsored spend per source. All `payments` must be the same token.
 *  No fee reserve (gas is sponsored). Returns null if the total is short. */
export function planTokenSpend(
  payments: StealthPayment[],
  amountHuman: string,
): { payment: StealthPayment; human: string }[] | null {
  const decimals = payments[0]?.tokenDecimals ?? 0;
  let remaining = toBaseUnits(amountHuman, decimals);
  const sources = payments
    .filter((p) => p.tokenContract && p.amount)
    .map((p) => ({ payment: p, spendable: BigInt(p.amount as string) }))
    .filter((s) => s.spendable > 0n)
    .sort((a, b) => (b.spendable > a.spendable ? 1 : b.spendable < a.spendable ? -1 : 0));
  const out: { payment: StealthPayment; human: string }[] = [];
  for (const s of sources) {
    if (remaining <= 0n) break;
    const take = s.spendable < remaining ? s.spendable : remaining;
    out.push({ payment: s.payment, human: atomicToHuman(take, decimals) });
    remaining -= take;
  }
  return remaining <= 0n ? out : null;
}

/** Auto-select SOL sources to cover `amountHuman` (one tx per source). */
export const planSolSpend = (payments: StealthPayment[], amountHuman: string) =>
  planAccountSpend(payments, 2, 9, SOL_FEE_LAMPORTS, amountHuman);

/** Auto-select EVM sources to cover `amountHuman` (one tx per source), reserving
 *  `reserveWei` of gas per source (pass a live estimate; defaults to the fixed reserve). */
export const planEvmSpend = (
  payments: StealthPayment[],
  amountHuman: string,
  reserveWei: bigint = EVM_GAS_RESERVE_WEI,
) => planAccountSpend(payments, 1, 18, reserveWei, amountHuman);

const CHAIN_COLOR: Record<number, string> = { 0: '#FF991A', 1: '#627EEA', 2: '#7333D9' };
const CHAIN_NAME: Record<number, PortfolioAsset['chain']> = { 0: 'bitcoin', 1: 'ethereum', 2: 'solana' };

/** Synthesize a `PortfolioAsset` for a received stealth payment so the shared
 *  amount/confirm screens can drive a "Spend received" the same way as a normal
 *  send. `amount` is the received balance, which becomes the Available/MAX cap. */
/** CoinGecko id + brand color for an allowlisted stealth token (by symbol). */
function tokenMeta(symbol: string): { coingeckoId: string; colorHex: string } {
  switch (symbol.toUpperCase()) {
    case 'USDC':
      return { coingeckoId: 'usd-coin', colorHex: '#2775CA' };
    default:
      return { coingeckoId: '', colorHex: '#8E8E93' };
  }
}

export function stealthPaymentAsset(p: StealthPayment): PortfolioAsset {
  const c = chainForPayment(p);
  const id = `stealth-${Array.from(new Uint8Array(p.ephemeralPub)).slice(0, 8).join('')}`;
  // ERC-20 payment: denominate in the token (its own decimals/symbol), but keep
  // the EVM chain metadata. Native payment: use the chain's native asset.
  if (p.tokenContract && p.tokenSymbol != null) {
    const decimals = p.tokenDecimals ?? 0;
    const tm = tokenMeta(p.tokenSymbol);
    // Prefer the registry's coingeckoId/icon (keyed by chain+contract) so the
    // token prices exactly like on the normal dashboard; fall back to the
    // hardcoded map (USDC only) if the registry hasn't been synced.
    const reg = tokenMetaByContract.get(`${c?.chainId ?? 0n}:${p.tokenContract.toLowerCase()}`);
    return {
      id,
      name: p.tokenSymbol,
      symbol: p.tokenSymbol,
      amount: p.amount ? Number(p.amount) / 10 ** decimals : 0,
      decimals,
      coingeckoId: reg?.coingeckoId || tm.coingeckoId,
      chain: CHAIN_NAME[p.chainFamily] ?? 'ethereum',
      colorHex: tm.colorHex,
      imageUrl: reg?.imageUrl,
      evmChainId: c?.chainId ?? 0n,
      tokenContract: p.tokenContract,
    };
  }
  const decimals = c?.decimals ?? 0;
  return {
    id,
    name: c?.label ?? symbolForFamily(p.chainFamily),
    symbol: c?.symbol ?? '?',
    amount: p.amount ? Number(p.amount) / 10 ** decimals : 0,
    decimals,
    coingeckoId: c ? coingeckoIdForChain(c) : 'bitcoin',
    chain: CHAIN_NAME[p.chainFamily] ?? 'bitcoin',
    colorHex: CHAIN_COLOR[p.chainFamily] ?? '#8E8E93',
    evmChainId: p.chainFamily === 1 ? (c?.chainId ?? 0n) : undefined,
  };
}

/** Synthesize an asset for the AGGREGATE of a chain's received payments — its
 *  `amount` is the spendable total (net of fees), the Available/MAX cap for an
 *  aggregate spend. SOL combines via N txs; BTC via one multi-input tx. */
export function stealthAggregateAsset(payments: StealthPayment[], evmReserveWei?: bigint): PortfolioAsset {
  const base = stealthPaymentAsset(payments[0]);
  // ERC-20: gas is sponsored, so the FULL token balance is spendable.
  if (payments[0].tokenContract) {
    return {
      ...base,
      id: `stealth-agg-${base.symbol.toLowerCase()}`,
      amount: Number(tokenSpendableTotal(payments)) / 10 ** base.decimals,
    };
  }
  const family = payments[0].chainFamily;
  const spendable =
    family === 2
      ? solSpendableTotal(payments)
      : family === 0
        ? btcSpendableTotal(payments)
        : evmSpendableTotal(payments, evmReserveWei);
  return { ...base, id: `stealth-agg-${base.symbol.toLowerCase()}`, amount: Number(spendable) / 10 ** base.decimals };
}

/** Symbol for a received payment's chain family. */
export function symbolForFamily(family: number): string {
  return chainForFamily(family)?.symbol ?? '?';
}

/** Format an atomic-units string into a human amount for a chain family. */
export function formatStealthAmount(atomic: string | undefined, family: number): string {
  if (!atomic) return '—';
  const c = chainForFamily(family);
  if (!c) return atomic;
  const n = Number(atomic) / 10 ** c.decimals;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: Math.min(c.decimals, 6) })} ${c.symbol}`;
}

export interface ScanResult {
  report: AnnouncementProcessReport;
  payments: StealthPayment[];
}

/** This wallet's bech32m stealth meta-address (the shareable handle). */
export function loadMetaAddress(wallet: WalletInterface): Promise<string> {
  return wallet.stealthMetaAddress();
}

export function listPayments(wallet: WalletInterface): Promise<StealthPayment[]> {
  return wallet.stealthListPayments();
}

/** One scan pass: process mailbox announcements, rescan pending, return fresh list. */
export async function scan(wallet: WalletInterface): Promise<ScanResult> {
  const report = await wallet.stealthProcessAnnouncements();
  await wallet.stealthRescanPending().catch(() => undefined);
  const payments = await wallet.stealthListPayments();
  return { report, payments };
}

/** Re-push outgoing + received announcements so a reset relay / cleared mailbox
 *  can still rediscover payments (mirrors the iOS startup retryAllOutgoing +
 *  reannounceReceived). Best-effort — never throws. */
export async function resync(wallet: WalletInterface): Promise<void> {
  await wallet.stealthRetryAllOutgoing().catch(() => undefined);
  await wallet.stealthReannounceReceived().catch(() => undefined);
}

/** Push the app's full ERC-20 token set into the stealth scanner so private
 *  discovery finds the SAME tokens the normal dashboard shows: the registry's
 *  tokens across every enabled EVM chain, plus user-added custom tokens. Without
 *  this, the core only probes its tiny built-in allowlist (testnet USDC), so a
 *  shielded mainnet USDT/USDC (or any other token) is never discovered. The core
 *  keeps this set until the next call, so a single sync per scan cycle suffices.
 *  Best-effort — on any failure the core falls back to its built-in allowlist. */
export async function syncStealthTokens(
  wallet: WalletInterface,
  registry: Registry,
  customTokens: CustomToken[] = [],
): Promise<void> {
  try {
    const chains = (await wallet.evmListChains().catch(() => [])).filter((c) => c.enabled);
    const out: StealthEvmToken[] = [];
    for (const chain of chains) {
      for (const t of tokensForChain(registry, chain.chainId)) {
        out.push({ chainId: chain.chainId, contract: t.contract, decimals: t.decimals, symbol: t.symbol });
        tokenMetaByContract.set(`${chain.chainId}:${t.contract.toLowerCase()}`, {
          coingeckoId: t.coingeckoId,
          imageUrl: t.imageUrl ?? '',
        });
      }
    }
    // User-added custom tokens (Manage Tokens) — mirror the dashboard exactly.
    for (const t of customTokens) {
      out.push({
        chainId: BigInt(t.chainId),
        contract: t.contractAddress,
        decimals: t.decimals,
        symbol: t.symbol,
      });
      tokenMetaByContract.set(`${t.chainId}:${t.contractAddress.toLowerCase()}`, {
        coingeckoId: t.coingeckoId ?? '',
        imageUrl: t.imageUrl ?? '',
      });
    }
    wallet.stealthSetEvmTokens(out);
  } catch {
    // best-effort — discovery falls back to the core's built-in allowlist
  }
}

/** Pay privately to a recipient's stealth meta-address. Pass `token` (EVM only)
 *  to send an ERC-20 instead of the chain's native asset — the amount is then in
 *  the token's own decimals and the send is a `transfer` on that contract. */
export async function paySend(
  wallet: WalletInterface,
  args: {
    recipientMeta: string;
    chain: StealthChain;
    amountHuman: string;
    token?: { contract: string; decimals: number };
  },
): Promise<StealthSendReceipt> {
  const decimals = args.token ? args.token.decimals : args.chain.decimals;
  const amount = toBaseUnits(args.amountHuman, decimals).toString();
  return wallet.stealthSend({
    recipientMeta: args.recipientMeta.trim(),
    chainFamily: args.chain.family,
    chainId: args.chain.chainId,
    amount,
    tokenContract: args.token?.contract,
  });
}

/** Spend funds from a previously-received stealth payment to a normal address. */
export function spend(
  wallet: WalletInterface,
  payment: StealthPayment,
  to: string,
  amountHuman: string,
): Promise<StealthSpendReceipt> {
  const c = chainForPayment(payment);
  const amount = toBaseUnits(amountHuman, c?.decimals ?? 0).toString();
  return wallet.stealthSpend(payment.ephemeralPub, to.trim(), amount);
}

function bytesToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '0x';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Spend a received ERC-20 stealth payment to `to`, with **gas sponsored** by
 *  the hub (EIP-7702). The core signs the delegation + the transfer intent with
 *  the stealth key; the hub submits one transaction and pays the gas. The token
 *  address holds no ETH and never needs any — and no approvals are involved. */
export async function spendErc20Sponsored(
  wallet: WalletInterface,
  payment: StealthPayment,
  to: string,
  amountHuman: string,
): Promise<{ txid: string }> {
  if (!payment.tokenContract) throw new Error('not a token payment');
  const amount = toBaseUnits(amountHuman, payment.tokenDecimals ?? 0).toString();
  // Core: sign the 7702 auth (first spend) + the EIP-712 execute intent.
  const bundle = await wallet.stealthSpendErc20(payment.ephemeralPub, to.trim(), amount);
  return broadcastSponsored(bundle);
}

/** Spend a privately-received ERC-20 to another recipient's stealth meta-address
 *  (private on both ends), gas-sponsored via EIP-7702. Core derives the recipient's
 *  one-time EVM address as the transfer destination and announces to their mailbox;
 *  the hub broadcasts the same bundle. `recipientMeta` is a `stealth1…` address. */
export async function spendErc20SponsoredToMeta(
  wallet: WalletInterface,
  payment: StealthPayment,
  recipientMeta: string,
  amountHuman: string,
): Promise<{ txid: string }> {
  if (!payment.tokenContract) throw new Error('not a token payment');
  const amount = toBaseUnits(amountHuman, payment.tokenDecimals ?? 0).toString();
  const bundle = await wallet.stealthSpendErc20ToMeta(payment.ephemeralPub, recipientMeta.trim(), amount);
  return broadcastSponsored(bundle);
}

/** POST a signed sponsored-spend bundle to the hub, which assembles, signs, and
 *  broadcasts the tx (paying gas). Shared by the normal and stealth→stealth paths. */
async function broadcastSponsored(bundle: StealthSponsoredSpend): Promise<{ txid: string }> {
  const res = await authClient.authedFetch('/v1/stealth/sponsor-spend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chain_id: Number(bundle.chainId),
      account: bundle.account,
      call_data: bytesToHex(bundle.callData),
      authorization_json: bundle.authorizationJson ?? null,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`gas sponsor failed (${res.status})${msg ? `: ${msg}` : ''}`);
  }
  const data = (await res.json()) as { txid: string };
  return { txid: data.txid };
}

/** Spend a received stealth payment DIRECTLY to another recipient's stealth
 *  meta-address (stealth → stealth — private on both ends). Same chain as the
 *  source payment; `recipientMeta` is a `stealth1…` meta-address. */
export function spendToMeta(
  wallet: WalletInterface,
  payment: StealthPayment,
  recipientMeta: string,
  amountHuman: string,
): Promise<StealthSpendReceipt> {
  const c = chainForPayment(payment);
  const amount = toBaseUnits(amountHuman, c?.decimals ?? 0).toString();
  return wallet.stealthSpendToMeta(payment.ephemeralPub, recipientMeta.trim(), amount);
}

/** Spend across MULTIPLE received BTC payments in ONE multi-input transaction to
 *  a normal address. `payments` are the BTC received payments to combine. */
export function spendMulti(
  wallet: WalletInterface,
  payments: StealthPayment[],
  to: string,
  amountHuman: string,
  sweep = false,
): Promise<StealthSpendReceipt> {
  const c = chainForPayment(payments[0]);
  const amount = toBaseUnits(amountHuman, c?.decimals ?? 8).toString();
  return wallet.stealthSpendMulti(payments.map((p) => p.ephemeralPub), to.trim(), amount, sweep);
}

/** Spend across MULTIPLE received BTC payments in ONE multi-input transaction to
 *  another recipient's stealth meta-address (private on both ends). The BTC-native
 *  aggregate for stealth → stealth: one tx, one fee, announced to the recipient.
 *  `sweep` drains every input minus the exact fee (no change, no fee-estimate risk). */
export function spendMultiToMeta(
  wallet: WalletInterface,
  payments: StealthPayment[],
  recipientMeta: string,
  amountHuman: string,
  sweep = false,
): Promise<StealthSpendReceipt> {
  const c = chainForPayment(payments[0]);
  const amount = toBaseUnits(amountHuman, c?.decimals ?? 8).toString();
  return wallet.stealthSpendMultiToMeta(payments.map((p) => p.ephemeralPub), recipientMeta.trim(), amount, sweep);
}
