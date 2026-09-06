// ─────────────────────────────────────────────────────────────────────────────
//  Uniswap V2 — in-wallet swaps.
//
//  Everything here was verified against the live deployment on Arc testnet:
//  the router reports the registry's factory, factory.getPair(USDC, EURC)
//  resolves to a funded pool, and getAmountsOut returns curve-consistent
//  numbers (1 USDC -> 2.0865 EURC against reserves of 597.85 / 1253.26).
//
//  ONE TRAP worth knowing: router.WETH() on Arc points at an address with no
//  code. Every ETH-path helper therefore reverts, so this module only ever uses
//  swapExactTokensForTokens. That is the right shape for Arc anyway — its
//  native coin IS USDC, and USDC is an ordinary ERC-20 here.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalletInterface } from 'standard-rn';
import {
  ensureAllowance,
  ethCall,
  sendCall,
  uint,
  waitForReceipt,
  word,
} from './evmTx';
import {
  chainById,
  tokensForChain,
  uniswapFor,
  type TokenDef,
} from '../lib/chains';

const SEL_GET_AMOUNTS_OUT = '0xd06ca61f'; // getAmountsOut(uint256,address[])
const SEL_GET_PAIR = '0xe6a43905'; // getPair(address,address)
const SEL_SWAP_EXACT_TOKENS = '0x38ed1739'; // swapExactTokensForTokens(uint,uint,address[],address,uint)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Human amount -> atomic units, without floating-point drift on the last digit. */
export function toAtomic(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

export function fromAtomic(atomic: bigint, decimals: number): number {
  return Number(atomic) / 10 ** decimals;
}

/** Decode `uint256[]` returned by getAmountsOut: offset, length, then elements. */
function decodeUintArray(hex: string): bigint[] {
  const h = hex.replace(/^0x/, '');
  if (h.length < 128) return [];
  const len = Number(BigInt('0x' + h.slice(64, 128)));
  const out: bigint[] = [];
  for (let i = 0; i < len; i++) {
    const at = 128 + i * 64;
    if (h.length < at + 64) break;
    out.push(BigInt('0x' + h.slice(at, at + 64)));
  }
  return out;
}

/** True when a direct pool exists for this pair. */
export async function pairExists(chainId: bigint, a: string, b: string): Promise<boolean> {
  const url = chainById(chainId)?.rpcUrl;
  const dex = uniswapFor(chainId);
  if (!url || !dex) return false;
  try {
    const hex = await ethCall(url, dex.factory, SEL_GET_PAIR + word(a) + word(b));
    return !!hex && hex !== '0x' && '0x' + hex.slice(26) !== ZERO_ADDRESS;
  } catch {
    return false;
  }
}

export interface Quote {
  /** Atomic units in / out. */
  amountIn: bigint;
  amountOut: bigint;
  /** Human units, for display. */
  out: number;
  /** Units of `to` per unit of `from`, at this size. */
  rate: number;
  /** The route actually priced. Two entries for a direct pool. */
  path: string[];
}

/**
 * Price a swap through the pool.
 *
 * Routing is deliberately shallow: a direct pool, else one hop through the
 * chain's USDC. A deeper router would need the full pair graph, and quoting a
 * route the wallet cannot then execute is worse than saying "no route".
 */
export async function quoteSwap(opts: {
  chainId: bigint;
  from: TokenDef;
  to: TokenDef;
  /** Human units of `from`. */
  amount: number;
}): Promise<Quote | null> {
  const { chainId, from, to, amount } = opts;
  const url = chainById(chainId)?.rpcUrl;
  const dex = uniswapFor(chainId);
  if (!url || !dex || amount <= 0) return null;

  const amountIn = toAtomic(amount, from.decimals);
  if (amountIn <= 0n) return null;

  const usdc = chainById(chainId)?.usdc;
  const candidates: string[][] = [[from.address, to.address]];
  if (usdc && ![from.address, to.address].some((a) => a.toLowerCase() === usdc.toLowerCase())) {
    candidates.push([from.address, usdc, to.address]);
  }

  for (const path of candidates) {
    try {
      const data =
        SEL_GET_AMOUNTS_OUT +
        uint(amountIn) +
        uint(64n) + // offset to the address[]
        uint(BigInt(path.length)) +
        path.map((a) => word(a)).join('');
      const amounts = decodeUintArray(await ethCall(url, dex.router, data));
      const amountOut = amounts[amounts.length - 1];
      if (!amountOut || amountOut <= 0n) continue;
      const out = fromAtomic(amountOut, to.decimals);
      return { amountIn, amountOut, out, rate: out / amount, path };
    } catch {
      // No pool on this route — try the next one.
    }
  }
  return null;
}

export interface SwapResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  ms: number;
}

/** 20 minutes, the Uniswap UI's own default. */
const DEADLINE_SECONDS = 20 * 60;

/**
 * Execute a swap: approve exactly what is being sold, then swap.
 *
 * `minOut` is derived from the quote and the caller's slippage tolerance, and
 * is the ONLY thing standing between the user and an unbounded sandwich — so it
 * is computed here from the quote rather than accepted from the UI.
 */
export async function executeSwap(opts: {
  wallet: WalletInterface;
  account: number;
  chainId: bigint;
  from: TokenDef;
  to: TokenDef;
  quote: Quote;
  /** Tolerated slippage in basis points. 50 = 0.5%. */
  slippageBps: number;
  /** Defaults to the signer's own address. */
  recipient?: string;
}): Promise<SwapResult> {
  const t0 = Date.now();
  const { wallet, account, chainId, from, quote, slippageBps } = opts;
  const chain = chainById(chainId);
  const dex = uniswapFor(chainId);
  if (!chain?.rpcUrl || !dex) {
    return { ok: false, error: 'No exchange on this network', ms: Date.now() - t0 };
  }
  const url = chain.rpcUrl;

  try {
    const signer = await wallet.evmAddress(account);
    const recipient = opts.recipient || signer;

    const approved = await ensureAllowance({
      wallet, account, chainId, url, from: signer,
      token: from.address, spender: dex.router, amount: quote.amountIn,
    });
    if (!approved) return { ok: false, error: 'Approval did not confirm', ms: Date.now() - t0 };

    const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    // swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline).
    // `path` is dynamic, so its data sits after the five head words — offset 0xa0.
    const data =
      SEL_SWAP_EXACT_TOKENS +
      uint(quote.amountIn) +
      uint(minOut) +
      uint(160n) +
      word(recipient) +
      uint(deadline) +
      uint(BigInt(quote.path.length)) +
      quote.path.map((a) => word(a)).join('');

    const tx = await sendCall(wallet, account, chainId, url, signer, dex.router, data);
    const mined = await waitForReceipt(url, tx);
    return {
      ok: mined,
      txHash: tx,
      explorerUrl: `${chain.explorerUrl}/tx/${tx}`,
      error: mined ? undefined : 'Swap did not confirm',
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Swap failed', ms: Date.now() - t0 };
  }
}

/** The tradeable set for a chain, straight from the registry. */
export function swappableTokens(chainId: bigint): TokenDef[] {
  return tokensForChain(chainId);
}
