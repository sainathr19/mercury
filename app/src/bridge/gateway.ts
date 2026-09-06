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
import type { WalletInterface } from 'standard-rn';
import {
  chainById,
  chainCircleDomain,
  chainUsdc,
  circleChainsForEnvironment,
  GATEWAY_MINTER,
  GATEWAY_WALLET,
  type ChainEnvironment,
} from '../lib/chains';

const API_TESTNET = 'https://gateway-api-testnet.circle.com';
const API_MAINNET = 'https://gateway-api.circle.com';

export { GATEWAY_WALLET, GATEWAY_MINTER } from '../lib/chains';

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

/** ERC-20 balanceOf(address) — the only call we need against a USDC contract. */
const BALANCE_OF = '0x70a08231';

async function erc20Balance(rpcUrl: string, token: string, owner: string): Promise<number> {
  const data = BALANCE_OF + owner.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data }, 'latest'] }),
  });
  const json = (await res.json()) as { result?: string };
  if (!json.result || json.result === '0x') return 0;
  return Number(BigInt(json.result)) / 1e6; // USDC is 6dp on every chain, Arc included
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
          balance: await erc20Balance(c.rpcUrl, c.usdc!, address),
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
        const hex = await rpc<string>(c.rpcUrl, 'eth_call', [
          { to: GATEWAY_WALLET, data: SEL_TOTAL_BALANCE + word(c.usdc!) + word(address) },
          'latest',
        ]);
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
    perDomain: api.perDomain,
    perChain: wallet,
  };
}

// ── Settling wallet USDC into Gateway ────────────────────────────────────────

// Verified against the deployed GatewayWallet on Arc (proxy 0x0077777d…,
// implementation 0xa33d52b4…): all four selectors are present in its bytecode.
const SEL_APPROVE = '0x095ea7b3'; // approve(address,uint256)
const SEL_ALLOWANCE = '0xdd62ed3e'; // allowance(address,address)
const SEL_DEPOSIT = '0x47e7ef24'; // deposit(address,uint256)

const word = (hex: string): string => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (n: bigint): string => word(n.toString(16));

function hexToBytes(hex: string): ArrayBuffer {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? `${method} failed`);
  return json.result as T;
}

/** Node estimate + 25% headroom, mirroring the send path. */
async function estimateGas(url: string, from: string, to: string, data: string): Promise<bigint> {
  const r = await rpc<string>(url, 'eth_estimateGas', [{ from, to, value: '0x0', data }]);
  return (BigInt(r) * 125n) / 100n;
}

/** Poll until mined. Returns false on revert OR on timeout — the caller must not
 *  treat "we stopped waiting" as success, because the next step would revert. */
async function waitForReceipt(url: string, hash: string, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await rpc<{ status?: string } | null>(url, 'eth_getTransactionReceipt', [hash]);
    if (r) return r.status === '0x1';
    await new Promise((res) => setTimeout(res, 1200));
  }
  return false;
}

/** Build + sign + broadcast a contract call through the Rust core. */
async function sendCall(
  wallet: WalletInterface,
  account: number,
  chainId: bigint,
  url: string,
  from: string,
  to: string,
  data: string,
): Promise<string> {
  const gasLimit = await estimateGas(url, from, to, data);
  const fees = await wallet.evmEstimateFees(chainId, account);
  const maxPriorityFeePerGas = fees.mediumPriorityFee;
  const maxFeePerGas = (BigInt(fees.baseFeePerGas) * 2n + BigInt(maxPriorityFeePerGas)).toString();
  return wallet.evmSendTx(chainId, account, {
    to,
    value: '0',
    data: hexToBytes(data),
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  } as never);
}

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

  try {
    const from = await wallet.evmAddress(account);

    const allowanceHex = await rpc<string>(url, 'eth_call', [
      { to: token, data: SEL_ALLOWANCE + word(from) + word(GATEWAY_WALLET) },
      'latest',
    ]);
    const allowance = allowanceHex && allowanceHex !== '0x' ? BigInt(allowanceHex) : 0n;

    if (allowance < value) {
      const approveTx = await sendCall(
        wallet, account, chainId, url, from, token,
        SEL_APPROVE + word(GATEWAY_WALLET) + uint(value),
      );
      if (!(await waitForReceipt(url, approveTx))) {
        return { ok: false, error: 'Approval did not confirm', ms: Date.now() - t0 };
      }
    }

    const depositTx = await sendCall(
      wallet, account, chainId, url, from, GATEWAY_WALLET,
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
    out.push({ chainId: row.chainId, amount, ok: r.ok, txHash: r.txHash, error: r.error });
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
  /** Round-trip milliseconds, for the "is it actually instant" question. */
  ms: number;
}

export interface RelayResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
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
          sourceContract: b32(GATEWAY_WALLET),
          destinationContract: b32(GATEWAY_MINTER),
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
    if (!res.ok) {
      const quoted = /expected at least ([0-9.]+)/.exec(body)?.[1];
      if (quoted) {
        const fee = BigInt(Math.ceil(Number(quoted) * 1e6));
        const priced = allocate(fee);
        if (!priced) {
          return { ok: false, error: `Not enough to cover the ${quoted} USDC fee`, ms: Date.now() - t0 };
        }
        legs = priced;
        ({ res, body } = await submit(legs, fee));
      }
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
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Transfer failed', ms: Date.now() - t0 };
  }
}


// ── Relay + send ─────────────────────────────────────────────────────────────

// The relayer is its OWN service, not the identity/registry hub — they have
// different lifetimes, different keys and different failure modes, so they get
// different URLs rather than sharing one.
const RELAYER_URL = process.env.EXPO_PUBLIC_RELAYER_URL ?? '';

/**
 * Ask the hub to submit an attestation on the destination chain.
 *
 * Without this the recipient needs gas on the destination to claim their own
 * money, which breaks the wallet's "no gas token" promise at the worst possible
 * moment. The relayer cannot redirect or skim the funds — the recipient is named
 * inside Circle's signed payload — so handing it over is safe.
 */
export async function relayMint(
  attestation: string,
  signature: string,
  destinationDomain: number,
): Promise<RelayResult> {
  const t0 = Date.now();
  if (!RELAYER_URL) return { ok: false, error: 'Relayer is not configured', ms: 0 };
  try {
    const res = await fetch(`${RELAYER_URL}/gateway/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attestation, signature, destinationDomain }),
    });
    const json = (await res.json()) as RelayResult;
    return { ...json, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Relay failed', ms: Date.now() - t0 };
  }
}

/**
 * One tap: move USDC out of the unified balance and have it delivered.
 *
 * Two steps that fail differently. If the attestation fails, nothing moved. If
 * the RELAY fails, the money has already been burnt on the source and is sitting
 * in a valid unclaimed attestation — recoverable by resubmitting, but the user
 * must be told that plainly rather than shown a generic error, which is why
 * `unclaimed` exists.
 */
export async function gatewaySend(opts: Parameters<typeof gatewayTransfer>[0]): Promise<SendResult> {
  const transfer = await gatewayTransfer(opts);
  if (!transfer.ok || !transfer.attestation || !transfer.signature) {
    return { ok: false, error: transfer.error ?? 'Transfer failed', attestMs: transfer.ms, relayMs: 0 };
  }

  const destinationDomain = chainCircleDomain(opts.toChainId);
  if (destinationDomain === undefined) {
    return { ok: false, error: 'Unsupported destination', unclaimed: true, attestMs: transfer.ms, relayMs: 0 };
  }

  const relay = await relayMint(transfer.attestation, transfer.signature, destinationDomain);
  return {
    ok: relay.ok,
    transferId: transfer.transferId,
    txHash: relay.txHash,
    explorerUrl: relay.explorerUrl,
    error: relay.error,
    unclaimed: !relay.ok,
    attestMs: transfer.ms,
    relayMs: relay.ms,
  };
}
