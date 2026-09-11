// ─────────────────────────────────────────────────────────────────────────────
//  Circle Gateway — the unified USDC balance.
//
//  Deposit USDC once into GatewayWallet on any supported chain and it becomes
//  spendable on ALL of them, with no per-transfer bridge wait: the finality
//  happened at deposit time, so a send is just a signed intent plus a mint.
//
//  Every shape below was verified against the live testnet API and Circle's
//  contracts (circlefin/evm-gateway-contracts) — see the notes on each.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalletInterface } from 'mercury-wallet-core';
import {
  ensureAllowance,
  erc20BalanceOf,
  ethCall,
  rpc,
  sendCall,
  uint,
  waitForReceipt,
  word,
} from './evmTx';
import {
  chainById,
  chainCircleDomain,
  chainForDomain,
  chainUsdc,
  circleChainsForEnvironment,
  gatewayMinter,
  gatewayWallet,
  type ChainEnvironment,
} from '../lib/chains';
import { deliveryStatus, relayMint } from './relayer';
import { usePendingClaims } from '../stores/pendingClaimStore';

const API_TESTNET = 'https://gateway-api-testnet.circle.com';
const API_MAINNET = 'https://gateway-api.circle.com';

export { gatewayWallet, gatewayMinter } from '../lib/chains';

// Re-exported so callers that already treat this module as "the Gateway client"
// do not have to learn where the relayer moved to.
export {
  deliveryStatus,
  relayMint,
  relayerConfigured,
  type DeliveryStatus,
  type RelayResult,
} from './relayer';

export const gatewayApi = (env: ChainEnvironment): string =>
  env === 'testnet' ? API_TESTNET : API_MAINNET;

/**
 * EIP-712 domain, read straight off the Arc GatewayWallet via eip712Domain():
 * fields = 0x03, so ONLY name and version — chainId and verifyingContract are
 * deliberately absent so one signature is valid across every domain.
 */
const EIP712_DOMAIN = { name: 'GatewayWallet', version: '1' } as const;

/**
 * Field order matters — it defines the typehash. Verified: hashing these type
 * strings reproduces Circle's published constants exactly
 * (TransferSpec 0x44409c7b…e089b, BurnIntent 0x8b99d17a…ba37c).
 */
const EIP712_TYPES = {
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
} as const;

// ── Unified balance ──────────────────────────────────────────────────────────

export interface DomainBalance {
  domain: number;
  depositor: string;
  /** Human USDC units. */
  balance: number;
  /** Deposited but not yet finalised into the spendable balance. */
  pending: number;
}

export interface UnifiedBalance {
  /** Spendable now, across every domain. THE number the wallet shows. */
  total: number;
  /** Still settling — shown as "arriving" rather than spendable. */
  pending: number;
  perDomain: DomainBalance[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One call, every domain. This is the whole point of Gateway: the user has ONE
 * balance, not a row per chain. Returns zeros on failure — a balance screen must
 * never blank out because an API blipped.
 */
export async function unifiedBalance(
  address: string,
  env: ChainEnvironment,
): Promise<UnifiedBalance> {
  const chains = circleChainsForEnvironment(env);
  const empty: UnifiedBalance = { total: 0, pending: 0, perDomain: [] };
  if (!address || !chains.length) return empty;
  try {
    const res = await fetch(`${gatewayApi(env)}/v1/balances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'USDC',
        sources: chains.map((c) => ({ domain: c.circleDomain, depositor: address })),
      }),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as { balances?: { domain: number; depositor: string; balance: string; pendingBatch: string }[] };
    const perDomain: DomainBalance[] = (json.balances ?? []).map((b) => ({
      domain: b.domain,
      depositor: b.depositor,
      balance: num(b.balance),
      pending: num(b.pendingBatch),
    }));
    return {
      total: perDomain.reduce((s, b) => s + b.balance, 0),
      pending: perDomain.reduce((s, b) => s + b.pending, 0),
      perDomain,
    };
  } catch {
    return empty;
  }
}

// ── Wallet-held USDC ─────────────────────────────────────────────────────────

export interface WalletUsdc {
  chainId: bigint;
  domain: number;
  /** Human USDC units sitting in the user's OWN address on this chain. */
  balance: number;
}

/**
 * USDC sitting in the user's own address, per Circle chain.
 *
 * This is the money that has NOT been settled into Gateway yet. It still belongs
 * to the user and must be counted, but it cannot be spent on another chain until
 * it is deposited — which is the distinction the balance UI has to get right.
 *
 * On Arc the USDC contract is a 6dp ERC-20 view over the native 18dp balance, so
 * the same `balanceOf` call is correct there too.
 */
export async function walletUsdc(address: string, env: ChainEnvironment): Promise<WalletUsdc[]> {
  if (!address) return [];
  const chains = circleChainsForEnvironment(env);
  const rows = await Promise.all(
    chains.map(async (c) => {
      try {
        return {
          chainId: c.chainId,
          domain: c.circleDomain!,
          // USDC is 6dp on every chain, Arc included.
          balance: Number(await erc20BalanceOf(c.rpcUrl, c.usdc!, address)) / 1e6,
        };
      } catch {
        return null; // a chain that failed to answer is unknown, not zero
      }
    }),
  );
  return rows.filter((r): r is WalletUsdc => r !== null);
}

// ── Everything the user owns in USDC ─────────────────────────────────────────

/** totalBalance(address token, address depositor) on GatewayWallet. */
const SEL_TOTAL_BALANCE = '0x1453b987';

/**
 * What the Gateway contract itself says it holds for this user, per chain.
 *
 * Measured, and the reason this exists: Circle's /v1/balances API and the
 * contract lag in OPPOSITE directions. The contract credits a deposit the moment
 * it is mined but keeps showing a burn Circle has already attested; the API
 * drops that burn immediately but does not see a fresh deposit for a while.
 * Reading only the API made a just-settled deposit vanish from the balance —
 * the wallet showed $7.78 over $18.72 of real money.
 *
 * So: the contract answers "what do I own", the API answers "what can I spend".
 */
async function gatewayOnchain(
  address: string,
  env: ChainEnvironment,
): Promise<Map<number, number | null>> {
  const chains = circleChainsForEnvironment(env);
  const out = new Map<number, number | null>();
  await Promise.all(
    chains.map(async (c) => {
      if (c.circleDomain === undefined) return;
      if (!c.usdc) {
        out.set(c.circleDomain, 0);
        return;
      }
      const read = async () => {
        const hex = await ethCall(
          c.rpcUrl,
          gatewayWallet(env),
          SEL_TOTAL_BALANCE + word(c.usdc!) + word(address),
        );
        return hex && hex !== '0x' ? Number(BigInt(hex)) / 1e6 : 0;
      };
      try {
        out.set(c.circleDomain, await read());
      } catch {
        // One retry — these public RPCs rate-limit, and a dropped read must not
        // be mistaken for a real answer.
        try {
          out.set(c.circleDomain, await read());
        } catch {
          out.set(c.circleDomain, null); // unknown, NOT zero
        }
      }
    }),
  );
  return out;
}

export interface UsdcHoldings {
  /** Every USDC the user owns, wherever it sits. THE number the wallet shows. */
  total: number;
  /** Spendable on any Circle chain right now, with no bridge wait. */
  spendable: number;
  /** Owned but not yet spendable — a deposit still settling. Shown as "arriving". */
  pending: number;
  /** Still in the user's own address, not yet settled into Gateway. */
  inWallet: number;
  /**
   * How much more GatewayWallet still holds on-chain than Circle will let the
   * user spend, BEFORE any in-flight deduction.
   *
   * Non-zero means the two views disagree: either a deposit Circle has not
   * credited yet, or a burn the chain has not settled yet. The caller knows
   * which — it is the one that recorded the send — and uses this to tell when
   * the disagreement has resolved.
   */
  onchainSurplus: number;
  perDomain: DomainBalance[];
  perChain: WalletUsdc[];
}

/**
 * One USDC number for the whole wallet.
 *
 * Gateway holdings and wallet holdings are two pots that must be ADDED, never
 * shown as alternatives: settling moves money from one to the other, so a
 * headline counting only one falls whenever the user settles.
 *
 * `inFlightSent` is USDC this app has already burnt through Gateway but which
 * the contract has not caught up on yet. Without subtracting it the total would
 * keep counting money that is already on its way to someone else.
 */
export async function usdcHoldings(
  address: string,
  env: ChainEnvironment,
  inFlightSent = 0,
): Promise<UsdcHoldings> {
  const [api, wallet, onchainByDomain] = await Promise.all([
    unifiedBalance(address, env),
    walletUsdc(address, env),
    gatewayOnchain(address, env),
  ]);
  const inWallet = wallet.reduce((s, w) => s + w.balance, 0);
  const apiHeld = api.total + api.pending;
  // A chain we could not read falls back to what the API says for it. Counting
  // an unreachable chain as ZERO silently tells the user they own less than they
  // do — observed live: one dropped Base read wiped $1.00 off the balance.
  const onchain = [...onchainByDomain.entries()].reduce((sum, [domain, value]) => {
    if (value !== null) return sum + value;
    const row = api.perDomain.find((d) => d.domain === domain);
    return sum + (row ? row.balance + row.pending : 0);
  }, 0);
  // Never report less than Circle will actually let the user spend.
  const inGateway = Math.max(apiHeld, onchain - inFlightSent);
  return {
    total: inGateway + inWallet,
    spendable: api.total,
    pending: Math.max(0, inGateway - api.total),
    inWallet,
    onchainSurplus: onchain - apiHeld,
    perDomain: api.perDomain,
    perChain: wallet,
  };
}

// ── Settling wallet USDC into Gateway ────────────────────────────────────────

// Verified against the deployed GatewayWallet on Arc (proxy 0x0077777d…,
// implementation 0xa33d52b4…): every selector below is present in its bytecode.
const SEL_DEPOSIT = '0x47e7ef24'; // deposit(address,uint256)

export interface DepositResult {
  ok: boolean;
  txHash?: string;
  error?: string;
  ms: number;
}

/**
 * Move USDC out of the user's own address and into their Gateway balance.
 *
 * Two transactions, and the approve MUST be mined before the deposit — they come
 * from the same account, so firing both at once risks a reused nonce and a
 * guaranteed revert.
 *
 * The allowance is set to EXACTLY this deposit rather than the usual unlimited
 * approval. An infinite allowance to any contract is a standing risk on a wallet
 * holding real money, and on Arc the approve costs 0.0013 USDC — far too little
 * to buy that risk with.
 */
export async function gatewayDeposit(opts: {
  wallet: WalletInterface;
  account: number;
  chainId: bigint;
  /** Human USDC units. */
  amount: number;
}): Promise<DepositResult> {
  const t0 = Date.now();
  const { wallet, account, chainId, amount } = opts;
  const chain = chainById(chainId);
  const token = chainUsdc(chainId);
  if (!chain?.rpcUrl || !token) {
    return { ok: false, error: 'Chain does not support Gateway', ms: Date.now() - t0 };
  }
  const url = chain.rpcUrl;
  const value = BigInt(Math.round(amount * 1e6)); // USDC is 6dp
  if (value <= 0n) return { ok: false, error: 'Nothing to settle', ms: Date.now() - t0 };

  // The environment comes from the CHAIN, not from a caller-supplied flag: the
  // contract pair differs between mainnet and testnet, and a chain belongs to
  // exactly one of them, so this cannot disagree with the chain being used.
  const spender = gatewayWallet(chain.environment);

  try {
    const from = await wallet.evmAddress(account);

    const approved = await ensureAllowance({
      wallet, account, chainId, url, from, token, spender, amount: value,
    });
    if (!approved) return { ok: false, error: 'Approval did not confirm', ms: Date.now() - t0 };

    const depositTx = await sendCall(
      wallet, account, chainId, url, from, spender,
      SEL_DEPOSIT + word(token) + uint(value),
    );
    const mined = await waitForReceipt(url, depositTx);
    return {
      ok: mined,
      txHash: depositTx,
      error: mined ? undefined : 'Deposit did not confirm',
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Deposit failed', ms: Date.now() - t0 };
  }
}

/**
 * USDC left behind on a chain whose GAS IS USDC (Arc). Settling the last cent
 * would leave the wallet unable to pay for its own next transaction — including
 * the withdrawal that would get the money back. At Arc's measured prices an
 * approve + deposit costs ~0.0045 USDC, so this covers ~50 more of them.
 */
export const GAS_RESERVE_USDC = 0.25;

/** Below this, settling costs more attention than it saves. */
export const MIN_SETTLE_USDC = 0.5;

export interface SettleOutcome {
  chainId: bigint;
  amount: number;
  ok: boolean;
  /** Measured wall-clock for the deposit, so the UI can show what settling
   *  actually costs in time rather than asserting it is fast. */
  ms?: number;
  skipped?: 'dust' | 'no-gas';
  txHash?: string;
  error?: string;
}

/**
 * Sweep wallet-held USDC into the unified balance, chain by chain.
 *
 * Skips rather than fails where it must: a chain whose gas token is ETH needs
 * ETH to deposit, and a wallet without any still OWNS that USDC — it just can't
 * move it yet. The balance UI counts it either way, which is why this can be
 * best-effort without ever losing sight of the money.
 */
export async function settleUsdcToGateway(opts: {
  wallet: WalletInterface;
  account: number;
  address: string;
  env: ChainEnvironment;
}): Promise<SettleOutcome[]> {
  const { wallet, account, address, env } = opts;
  const held = await walletUsdc(address, env);
  const out: SettleOutcome[] = [];

  for (const row of held) {
    const chain = chainById(row.chainId);
    if (!chain) continue;
    // Arc pays gas in USDC itself, so the reserve comes out of this balance.
    // Everywhere else gas is a separate coin and none needs holding back.
    const gasIsUsdc = chain.nativeSymbol === 'USDC';
    const amount = row.balance - (gasIsUsdc ? GAS_RESERVE_USDC : 0);
    if (amount < MIN_SETTLE_USDC) {
      out.push({ chainId: row.chainId, amount: 0, ok: false, skipped: 'dust' });
      continue;
    }
    if (!gasIsUsdc) {
      const nativeHex = await rpc<string>(chain.rpcUrl, 'eth_getBalance', [address, 'latest']).catch(() => '0x0');
      if (BigInt(nativeHex || '0x0') === 0n) {
        out.push({ chainId: row.chainId, amount, ok: false, skipped: 'no-gas' });
        continue;
      }
    }
    const r = await gatewayDeposit({ wallet, account, chainId: row.chainId, amount });
    out.push({ chainId: row.chainId, amount, ok: r.ok, txHash: r.txHash, error: r.error, ms: r.ms });
  }
  return out;
}

// ── Transfer ─────────────────────────────────────────────────────────────────

interface GatewayInfoDomain {
  domain: number;
  chain: string;
  burnIntentExpirationHeight: string;
}

async function infoFor(domain: number, env: ChainEnvironment): Promise<GatewayInfoDomain | undefined> {
  const res = await fetch(`${gatewayApi(env)}/v1/info`);
  if (!res.ok) return undefined;
  const json = (await res.json()) as { domains?: GatewayInfoDomain[] };
  return json.domains?.find((d) => d.domain === domain);
}

const b32 = (addr: string): string => `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
const ZERO = `0x${'0'.repeat(64)}`;

/**
 * Height buffer. /v1/info returns the CURRENT expiration height, which Arc has
 * already moved past by the time the intent is signed — the API then rejects it
 * as "too low" by exactly one block. Verified in the spike.
 */
const HEIGHT_BUFFER = 1000n;

export interface TransferResult {
  ok: boolean;
  transferId?: string;
  /** Circle-signed payload + signature. Worthless to anyone else — the payload
   *  names its own recipient — but REQUIRED to claim on the destination. */
  attestation?: string;
  signature?: string;
  /** Set when Circle rejects — surfaced verbatim, its messages are specific. */
  error?: string;
  /**
   * What Circle actually charged, in human USDC — `maxFee` multiplied by the
   * number of burn intents, because the fee is per intent.
   *
   * Returned because it CANNOT be known in advance: Circle quotes a minimum
   * only in response to a signed intent (see the re-pricing loop below). While
   * this went unreported the send screen showed "you send 2.00" for a transfer
   * that debited 3.00, and nothing in the app ever said where the rest went.
   */
  feeUsdc?: number;
  /** Round-trip milliseconds, for the "is it actually instant" question. */
  ms: number;
}

/** Combined result of the two halves: Circle attests, the relayer delivers. */
export interface SendResult {
  ok: boolean;
  transferId?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  /** Attested but not yet claimed — the money is burnt and recoverable, not lost. */
  unclaimed?: boolean;
  /**
   * Circle's signed payload, kept on the result whenever the burn succeeded.
   *
   * This used to be dropped. On a relay failure the funds were already burnt and
   * the only thing that could ever deliver them — this payload — went out of
   * scope, while the UI said "funds are safe". It is worthless to an attacker
   * (the recipient is named inside the signature) and the sole means of
   * recovery, so it is always returned and always persisted.
   */
  attestation?: string;
  signature?: string;
  /** Circle's fee in human USDC, as actually charged. See TransferResult. */
  feeUsdc?: number;
  attestMs: number;
  relayMs: number;
}

/**
 * Move USDC out of the unified balance onto `toChainId`, settling instantly.
 *
 * There is no source network to choose. A burn intent names a source domain and
 * Circle requires THAT domain to hold the money, so the source is derived from
 * where the balance actually sits — largest first, split across several domains
 * only when no single one covers the amount.
 *
 * `maxFee` cannot be known before asking: Circle quotes a minimum and rejects
 * anything under it ("expected at least 0.0035, got 0.001"). Rather than guess,
 * we send once with a low fee to LEARN the quote, then sign again at that price.
 * One extra ~280ms round trip buys an exact fee instead of an over-payment.
 */
export async function gatewayTransfer(opts: {
  wallet: WalletInterface;
  account: number;
  address: string;
  toChainId: bigint;
  /** Human USDC units. */
  amount: number;
  recipient?: string;
  env: ChainEnvironment;
  /**
   * Per-domain spendable balances. Fetched if omitted, but the caller usually
   * already has them on screen — passing them saves a round trip on the path
   * the user is watching.
   */
  sources?: DomainBalance[];
}): Promise<TransferResult> {
  const t0 = Date.now();
  const { wallet, account, address, toChainId, amount, env } = opts;
  const destinationDomain = chainCircleDomain(toChainId);
  const destinationToken = chainUsdc(toChainId);
  if (destinationDomain === undefined || !destinationToken) {
    return { ok: false, error: 'Circle does not support that destination', ms: Date.now() - t0 };
  }

  const byDomain = new Map<number, { chainId: bigint; usdc: `0x${string}` }>();
  for (const c of circleChainsForEnvironment(env)) {
    if (c.circleDomain !== undefined && c.usdc) byDomain.set(c.circleDomain, { chainId: c.chainId, usdc: c.usdc });
  }

  const balances = opts.sources ?? (await unifiedBalance(address, env)).perDomain;
  const funded = balances
    .filter((b) => b.balance > 0 && byDomain.has(b.domain))
    .sort((a, b) => b.balance - a.balance);
  if (!funded.length) return { ok: false, error: 'No spendable balance', ms: Date.now() - t0 };

  const value = BigInt(Math.round(amount * 1e6)); // USDC is 6dp
  const recipient = opts.recipient || address;

  /**
   * Which domains to burn from. Gateway charges its fee PER intent and requires
   * each source to cover its own leg plus that fee, so the fee is reserved on
   * every leg rather than only on the total. Largest balance first, so the
   * common case is one leg and one signature.
   */
  const allocate = (fee: bigint): { domain: number; value: bigint }[] | null => {
    const legs: { domain: number; value: bigint }[] = [];
    let left = value;
    for (const b of funded) {
      if (left <= 0n) break;
      const spendable = BigInt(Math.round(b.balance * 1e6)) - fee;
      if (spendable <= 0n) continue;
      const take = spendable >= left ? left : spendable;
      legs.push({ domain: b.domain, value: take });
      left -= take;
    }
    return left === 0n ? legs : null;
  };

  const heights = new Map<number, bigint>();
  const heightFor = async (domain: number): Promise<bigint | undefined> => {
    const cached = heights.get(domain);
    if (cached !== undefined) return cached;
    const info = await infoFor(domain, env);
    if (!info) return undefined;
    const h = BigInt(info.burnIntentExpirationHeight) + HEIGHT_BUFFER;
    heights.set(domain, h);
    return h;
  };

  const submit = async (legs: { domain: number; value: bigint }[], maxFee: bigint) => {
    const intents: { burnIntent: unknown; signature: string }[] = [];
    for (const leg of legs) {
      const src = byDomain.get(leg.domain)!;
      const maxBlockHeight = await heightFor(leg.domain);
      if (maxBlockHeight === undefined) throw new Error('Gateway is unavailable');
      const message = {
        maxBlockHeight: maxBlockHeight.toString(),
        maxFee: maxFee.toString(),
        spec: {
          version: 1,
          sourceDomain: leg.domain,
          destinationDomain,
          sourceContract: b32(gatewayWallet(env)),
          destinationContract: b32(gatewayMinter(env)),
          sourceToken: b32(src.usdc),
          destinationToken: b32(destinationToken),
          sourceDepositor: b32(address),
          destinationRecipient: b32(recipient),
          sourceSigner: b32(address),
          destinationCaller: ZERO,
          value: leg.value.toString(),
          salt: `0x${(Date.now() + leg.domain).toString(16).padStart(64, '0')}`,
          hookData: '0x',
        },
      };
      const signature = await wallet.evmSignTypedData(
        account,
        JSON.stringify({ domain: EIP712_DOMAIN, types: EIP712_TYPES, primaryType: 'BurnIntent', message }),
      );
      intents.push({ burnIntent: message, signature });
    }
    const res = await fetch(`${gatewayApi(env)}/v1/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intents),
    });
    return { res, body: await res.text() };
  };

  try {
    // Probe with a deliberately low fee; the rejection carries the real quote.
    let legs = allocate(1n);
    if (!legs) return { ok: false, error: 'Not enough spendable balance', ms: Date.now() - t0 };
    let { res, body } = await submit(legs, 1n);

    // Re-price until the quote settles, not just once.
    //
    // The fee is charged per burn intent, and the number of intents depends on
    // how many domains the amount has to be drawn from — which depends on the
    // fee. Quoting once and re-signing at that price can therefore be rejected
    // AGAIN at a higher price, because paying the fee pushed the transfer onto
    // an extra source. That is not hypothetical: sweeping a balance spread over
    // three domains failed with "expected at least 0.01005, got 0.0035", the
    // second quote being the first one multiplied by the legs it caused.
    //
    // So loop, and stop as soon as the quote stops rising. Bounded because each
    // pass costs a signature and a round trip, and a fee that never converges is
    // a Circle-side problem we should report rather than grind against.
    let fee = 0n;
    for (let attempt = 0; attempt < 4 && !res.ok; attempt++) {
      const quoted = /expected at least ([0-9.]+)/.exec(body)?.[1];
      if (!quoted) break;
      const next = BigInt(Math.ceil(Number(quoted) * 1e6));
      if (next <= fee) break; // not a fee problem any more, or it is not moving
      fee = next;
      const priced = allocate(fee);
      if (!priced) {
        return { ok: false, error: `Not enough to cover the ${quoted} USDC fee`, ms: Date.now() - t0 };
      }
      legs = priced;
      ({ res, body } = await submit(legs, fee));
    }
    if (!res.ok) {
      const msg = (() => { try { return JSON.parse(body).message as string; } catch { return body.slice(0, 200); } })();
      return { ok: false, error: msg, ms: Date.now() - t0 };
    }
    const json = JSON.parse(body) as { transferId?: string; attestation?: string; signature?: string };
    return {
      ok: true,
      transferId: json.transferId,
      attestation: json.attestation,
      signature: json.signature,
      // Per intent, so the total is the quote multiplied by the legs it was
      // charged on — the same multiplication that makes the quote rise when an
      // amount has to be drawn from more than one domain.
      feeUsdc: Number(fee * BigInt(legs.length)) / 1e6,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Transfer failed', ms: Date.now() - t0 };
  }
}


/**
 * One tap: move USDC out of the unified balance and have it delivered.
 *
 * Three steps that fail differently, and the ORDER is the safety property:
 *
 *  1. Preflight. Nothing has moved, so a refusal here costs nothing.
 *  2. Burn. Circle debits the balance and returns an attestation. From this
 *     point the money is gone from the source whatever happens next.
 *  3. Relay. If this fails the funds are NOT lost — they sit in a valid
 *     unclaimed attestation — but only if someone kept it, which is why the
 *     payload is returned on every outcome rather than only on success.
 */
export async function gatewaySend(opts: Parameters<typeof gatewayTransfer>[0]): Promise<SendResult> {
  const destinationDomain = chainCircleDomain(opts.toChainId);
  if (destinationDomain === undefined) {
    return { ok: false, error: 'Circle does not support that destination', attestMs: 0, relayMs: 0 };
  }

  // Before the burn, never after. This is the whole point.
  const ready = await deliveryStatus(destinationDomain, opts.env);
  if (!ready.ok) {
    return { ok: false, error: ready.reason ?? 'Delivery is unavailable', attestMs: 0, relayMs: 0 };
  }

  const transfer = await gatewayTransfer(opts);
  if (!transfer.ok || !transfer.attestation || !transfer.signature) {
    return { ok: false, error: transfer.error ?? 'Transfer failed', attestMs: transfer.ms, relayMs: 0 };
  }

  // The burn has happened. Persist the claim BEFORE attempting delivery, so the
  // recoverable state is identical whether the relay fails, the process is
  // killed, or the phone dies mid-request. Recording it here rather than in the
  // callers is deliberate: `swap.tsx` and `gateway-send.tsx` both burn through
  // this function, and a caller that forgot would lose someone's money.
  const claimId = transfer.transferId ?? `local:${Date.now().toString(36)}`;
  usePendingClaims.getState().record({
    id: claimId,
    attestation: transfer.attestation,
    signature: transfer.signature,
    destinationDomain,
    environment: opts.env,
    amount: opts.amount,
    chainId: opts.toChainId.toString(),
    chainName: chainById(opts.toChainId)?.name ?? 'that network',
    recipient: opts.recipient,
  });

  const relay = await relayMint(
    transfer.attestation,
    transfer.signature,
    destinationDomain,
    opts.env,
  );
  // Delivered — the ticket has been redeemed and is no longer owed to anyone.
  if (relay.ok) usePendingClaims.getState().settle(claimId);
  return {
    ok: relay.ok,
    transferId: transfer.transferId,
    txHash: relay.txHash,
    explorerUrl: relay.explorerUrl,
    error: relay.error,
    unclaimed: !relay.ok,
    // Carried on BOTH outcomes. On success it is merely redundant; on failure it
    // is the only way the money is ever claimed.
    attestation: transfer.attestation,
    signature: transfer.signature,
    // Carried through on both outcomes: the fee is charged at the BURN, so it
    // has been paid whether or not the relay went on to deliver.
    feeUsdc: transfer.feeUsdc,
    attestMs: transfer.ms,
    relayMs: relay.ms,
  };
}
