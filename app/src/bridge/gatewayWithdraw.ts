//! Getting USDC back OUT of Gateway, onto one chain.
//
// The other half of the door. Depositing takes minutes; spending is instant;
// coming back out takes SEVEN DAYS, and until this existed the wallet offered
// the first two and no way to do the third — which is the kind of thing a user
// discovers at the worst possible moment.
//
// Two transactions with a week between them:
//
//   initiateWithdrawal(token, value)   marks the amount, starts the clock
//   ...withdrawalDelay() blocks...
//   withdraw(token)                    transfers it to your own address
//
// ── The clock is not ours to compute ────────────────────────────────────────
//
// `withdrawalDelay()` is denominated in the chain's own blocks, and on Arbitrum
// `block.number` inside a contract is an approximation of the L1 block number
// while `eth_blockNumber` returns the L2 one — roughly 48x faster. Comparing the
// contract's `withdrawalBlock` against an RPC block height would therefore be
// wrong by days on exactly one chain, and right everywhere else, which is the
// worst kind of bug to find.
//
// So readiness is never computed. It is SIMULATED: `eth_call` of `withdraw()`
// reverts until the delay has passed, and succeeds once it has, using the
// contract's own clock whatever that clock happens to be. The countdown shown on
// screen is an estimate derived from when we started; the button is gated on the
// simulation.
import type { WalletInterface } from 'mercury-wallet-core';
import { ethCall, rpc, sendCall, uint, waitForReceipt, word } from './evmTx';
import {
  chainById,
  chainUsdc,
  circleChainsForEnvironment,
  gatewayWallet,
  type ChainDef,
  type ChainEnvironment,
} from '../lib/chains';

// Verified present in the deployed implementation bytecode on Base Sepolia.
const SEL_INITIATE = '0xc8393ba9'; // initiateWithdrawal(address,uint256)
const SEL_WITHDRAW = '0x51cff8d9'; // withdraw(address)
const SEL_DELAY = '0xa7ab6961'; // withdrawalDelay()
const SEL_AVAILABLE = '0x3ccb64ae'; // availableBalance(address,address)
const SEL_WITHDRAWING = '0xdf0c6690'; // withdrawingBalance(address,address)

/**
 * Seconds per block ON THE CLOCK THE CONTRACT SEES.
 *
 * Arbitrum is 12, not 0.25: its `block.number` tracks L1. Measured against live
 * chains, every entry here multiplies out to ~7 days against that chain's
 * `withdrawalDelay()`, which is evidently the figure Circle configured for.
 */
const SECONDS_PER_BLOCK: Record<string, number> = {
  '1': 12, // Ethereum
  '11155111': 12, // Sepolia
  '42161': 12, // Arbitrum One — L1 clock
  '421614': 12, // Arbitrum Sepolia — L1 clock
  '8453': 2, // Base
  '84532': 2, // Base Sepolia
  '10': 2, // Optimism
  '137': 1.5, // Polygon
  '43114': 2, // Avalanche
  '5042002': 0.5, // Arc
};

export interface WithdrawalState {
  /** Spendable through Gateway on this chain, whole USDC. */
  available: number;
  /** Marked for withdrawal. Non-zero means one is in progress. */
  withdrawing: number;
  /** `withdraw()` would succeed right now. The authority, not an estimate. */
  claimable: boolean;
  /** The configured delay in seconds, for saying how long this takes. */
  delaySeconds?: number;
}

const usdc = (hex: string): number => (hex && hex !== '0x' ? Number(BigInt(hex)) / 1e6 : 0);

/** Would `withdraw(token)` succeed for this address right now? */
async function simulateClaim(chain: ChainDef, token: string, address: string): Promise<boolean> {
  try {
    await rpc<string>(chain.rpcUrl, 'eth_call', [
      { from: address, to: gatewayWallet(chain.environment), data: SEL_WITHDRAW + word(token) },
      'latest',
    ]);
    return true;
  } catch {
    // Reverts while the delay is running, and also when there is nothing to
    // withdraw — both correctly mean "cannot claim".
    return false;
  }
}

export async function withdrawalState(
  chainId: bigint,
  address: string,
): Promise<WithdrawalState> {
  const chain = chainById(chainId);
  const token = chainUsdc(chainId);
  const empty: WithdrawalState = { available: 0, withdrawing: 0, claimable: false };
  if (!chain?.rpcUrl || !token || !address) return empty;

  const wallet = gatewayWallet(chain.environment);
  const [available, withdrawing, delay, claimable] = await Promise.all([
    ethCall(chain.rpcUrl, wallet, SEL_AVAILABLE + word(token) + word(address)).catch(() => '0x'),
    ethCall(chain.rpcUrl, wallet, SEL_WITHDRAWING + word(token) + word(address)).catch(() => '0x'),
    ethCall(chain.rpcUrl, wallet, SEL_DELAY).catch(() => '0x'),
    simulateClaim(chain, token, address),
  ]);

  const blocks = delay && delay !== '0x' ? Number(BigInt(delay)) : 0;
  const spb = SECONDS_PER_BLOCK[chainId.toString()];
  return {
    available: usdc(available),
    withdrawing: usdc(withdrawing),
    claimable,
    delaySeconds: blocks && spb ? blocks * spb : undefined,
  };
}

/** "about 7 days" — the figure that has to appear BEFORE anyone deposits. */
export function delayLabel(seconds?: number): string {
  if (!seconds) return 'about a week';
  const days = Math.round(seconds / 86400);
  if (days >= 2) return `about ${days} days`;
  const hours = Math.round(seconds / 3600);
  return hours >= 2 ? `about ${hours} hours` : 'about an hour';
}

/**
 * How much longer the wait has to run — an ESTIMATE, and labelled as one.
 *
 * The contract's clock is the authority (`claimable`), and this never overrides
 * it. Two cases matter and both are handled explicitly rather than rounded away:
 * with no start time we say nothing about duration at all, and once the estimate
 * has run out but the chain still refuses, we say "any moment now" instead of a
 * negative number or a stale "ready".
 */
export function remainingLabel(startedAt?: number, delaySeconds?: number, now = Date.now()): string {
  if (!startedAt || !delaySeconds) return 'Not ready yet';
  const left = startedAt + delaySeconds * 1000 - now;
  if (left <= 0) return 'Ready any moment now';
  const days = Math.ceil(left / 86400_000);
  if (days > 1) return `About ${days} days left`;
  const hours = Math.ceil(left / 3600_000);
  if (hours > 1) return `About ${hours} hours left`;
  return 'Less than an hour left';
}

export interface WithdrawResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Start the clock on `amount` USDC.
 *
 * One call, no approval: the funds are already inside GatewayWallet, so nothing
 * has to be granted to move them — the deposit path's approve has no counterpart
 * here.
 */
export async function startWithdrawal(opts: {
  wallet: WalletInterface;
  account: number;
  chainId: bigint;
  /** Whole USDC. */
  amount: number;
}): Promise<WithdrawResult> {
  const chain = chainById(opts.chainId);
  const token = chainUsdc(opts.chainId);
  if (!chain?.rpcUrl || !token) return { ok: false, error: 'Chain does not support Gateway' };
  const value = BigInt(Math.round(opts.amount * 1e6));
  if (value <= 0n) return { ok: false, error: 'Nothing to withdraw' };

  try {
    const from = await opts.wallet.evmAddress(opts.account);
    const tx = await sendCall(
      opts.wallet,
      opts.account,
      opts.chainId,
      chain.rpcUrl,
      from,
      gatewayWallet(chain.environment),
      SEL_INITIATE + word(token) + uint(value),
    );
    const mined = await waitForReceipt(chain.rpcUrl, tx);
    return { ok: mined, txHash: tx, error: mined ? undefined : 'Withdrawal did not confirm' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start the withdrawal' };
  }
}

/**
 * Take the money, once the delay has passed.
 *
 * Simulated first. A `withdraw()` that reverts still costs gas, and "not ready
 * yet" is a far better message than a failed transaction the user has paid for.
 */
export async function claimWithdrawal(opts: {
  wallet: WalletInterface;
  account: number;
  chainId: bigint;
}): Promise<WithdrawResult> {
  const chain = chainById(opts.chainId);
  const token = chainUsdc(opts.chainId);
  if (!chain?.rpcUrl || !token) return { ok: false, error: 'Chain does not support Gateway' };

  try {
    const from = await opts.wallet.evmAddress(opts.account);
    if (!(await simulateClaim(chain, token, from))) {
      return { ok: false, error: 'This withdrawal is not ready yet.' };
    }
    const tx = await sendCall(
      opts.wallet,
      opts.account,
      opts.chainId,
      chain.rpcUrl,
      from,
      gatewayWallet(chain.environment),
      SEL_WITHDRAW + word(token),
    );
    const mined = await waitForReceipt(chain.rpcUrl, tx);
    return { ok: mined, txHash: tx, error: mined ? undefined : 'Withdrawal did not confirm' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not complete the withdrawal' };
  }
}

// ── Finding the way out, across chains ───────────────────────────────────────
//
// A withdrawal is per chain — `availableBalance` and `withdrawingBalance` are
// keyed by (token, depositor) on each chain's own GatewayWallet — while the
// balance the user sees is unified. So both screens have to fan out.
//
// The cost is why there are two functions rather than one. A full
// `withdrawalState` is four eth_calls; run over every Circle chain on every
// Gateway page mount that is 16-24 reads against public RPCs that rate-limit,
// to answer "no, nothing is withdrawing" almost every time. So the scan reads
// ONE call per chain and pays for the rest only where there is something to
// report.

export interface ChainWithdrawal extends WithdrawalState {
  chainId: bigint;
  name: string;
}

/**
 * Every chain with money on its way out, newest state first.
 *
 * Cheap by design: one call per chain, and the full four-call state only for
 * the chains that have something. The common answer is an empty array for four
 * reads.
 */
export async function withdrawalsInProgress(
  address: string,
  env: ChainEnvironment,
): Promise<ChainWithdrawal[]> {
  if (!address) return [];
  const chains = circleChainsForEnvironment(env);
  const marked = await Promise.all(
    chains.map(async (c) => {
      if (!c.rpcUrl || !c.usdc) return null;
      try {
        const hex = await ethCall(
          c.rpcUrl,
          gatewayWallet(c.environment),
          SEL_WITHDRAWING + word(c.usdc) + word(address),
        );
        return usdc(hex) > 0 ? c : null;
      } catch {
        // Unknown, not zero — but a chain we cannot reach cannot be claimed on
        // either, so it is correct to leave it out of the list rather than show
        // a row whose buttons would all fail.
        return null;
      }
    }),
  );

  const live = marked.filter((c): c is ChainDef => c !== null);
  return Promise.all(
    live.map(async (c) => ({
      chainId: c.chainId,
      name: c.name,
      ...(await withdrawalState(c.chainId, address)),
    })),
  );
}

/** What could be withdrawn on each chain right now. One call per chain. */
export async function withdrawableByChain(
  address: string,
  env: ChainEnvironment,
): Promise<{ chain: ChainDef; available: number }[]> {
  if (!address) return [];
  return Promise.all(
    circleChainsForEnvironment(env).map(async (chain) => {
      if (!chain.rpcUrl || !chain.usdc) return { chain, available: 0 };
      const available = await ethCall(
        chain.rpcUrl,
        gatewayWallet(chain.environment),
        SEL_AVAILABLE + word(chain.usdc) + word(address),
      ).then(usdc, () => 0);
      return { chain, available };
    }),
  );
}
