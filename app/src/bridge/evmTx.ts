// ─────────────────────────────────────────────────────────────────────────────
//  Raw EVM contract calls.
//
//  The wallet's send paths go through the Rust core's typed helpers, but the
//  Gateway and Uniswap integrations need to call arbitrary contracts. Signing
//  still happens in the core (`evmSendTx`) — this module only builds calldata,
//  estimates gas and waits for receipts.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalletInterface } from 'standard-rn';
import { chainById } from '../lib/chains';

/** Left-pad a hex value (address or number) into a 32-byte ABI word. */
export const word = (hex: string): string =>
  hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

export const uint = (n: bigint): string => word(n.toString(16));

export function hexToBytes(hex: string): ArrayBuffer {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

/** A JSON-RPC error that keeps its revert payload. CCIP-Read is delivered AS a
 *  revert, so throwing away `data` throws away the answer. */
export class RpcError extends Error {
  constructor(message: string, readonly data?: string) {
    super(message);
    this.name = 'RpcError';
  }
}

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string; data?: string } };
  if (json.error) throw new RpcError(json.error.message ?? `${method} failed`, json.error.data);
  return json.result as T;
}

/** The chain's RPC endpoint, from the registry. */
export function rpcUrlFor(chainId: bigint): string | undefined {
  return chainById(chainId)?.rpcUrl;
}

/** A read-only contract call. */
export function ethCall(url: string, to: string, data: string): Promise<string> {
  return rpc<string>(url, 'eth_call', [{ to, data }, 'latest']);
}

/** Node estimate + 25% headroom, mirroring the send path. */
export async function estimateGas(
  url: string,
  from: string,
  to: string,
  data: string,
): Promise<bigint> {
  const r = await rpc<string>(url, 'eth_estimateGas', [{ from, to, value: '0x0', data }]);
  return (BigInt(r) * 125n) / 100n;
}

/** Poll until mined. Returns false on revert OR on timeout — the caller must not
 *  treat "we stopped waiting" as success, because the next step would revert. */
export async function waitForReceipt(url: string, hash: string, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await rpc<{ status?: string } | null>(url, 'eth_getTransactionReceipt', [hash]);
    if (r) return r.status === '0x1';
    await new Promise((res) => setTimeout(res, 1200));
  }
  return false;
}

/** Build + sign + broadcast a contract call through the Rust core. */
export async function sendCall(
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

// ── ERC-20 ───────────────────────────────────────────────────────────────────

export const SEL_APPROVE = '0x095ea7b3'; // approve(address,uint256)
export const SEL_ALLOWANCE = '0xdd62ed3e'; // allowance(address,address)
export const SEL_BALANCE_OF = '0x70a08231'; // balanceOf(address)

export async function erc20Allowance(
  url: string,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const hex = await ethCall(url, token, SEL_ALLOWANCE + word(owner) + word(spender));
  return hex && hex !== '0x' ? BigInt(hex) : 0n;
}

export async function erc20BalanceOf(url: string, token: string, owner: string): Promise<bigint> {
  const hex = await ethCall(url, token, SEL_BALANCE_OF + word(owner));
  return hex && hex !== '0x' ? BigInt(hex) : 0n;
}

/**
 * Ensure `spender` may move `amount` of `token`, approving EXACTLY that if not.
 *
 * Exact rather than the customary unlimited allowance: an infinite approval to
 * any contract is a standing risk on a wallet holding real money, and the extra
 * approve costs a fraction of a cent on the chains this runs on.
 *
 * Returns false if the approval did not confirm — the caller must not proceed,
 * because the transaction that follows would revert.
 */
export async function ensureAllowance(opts: {
  wallet: WalletInterface;
  account: number;
  chainId: bigint;
  url: string;
  from: string;
  token: string;
  spender: string;
  amount: bigint;
}): Promise<boolean> {
  const { wallet, account, chainId, url, from, token, spender, amount } = opts;
  if ((await erc20Allowance(url, token, from, spender)) >= amount) return true;
  const tx = await sendCall(
    wallet, account, chainId, url, from, token,
    SEL_APPROVE + word(spender) + uint(amount),
  );
  return waitForReceipt(url, tx);
}
