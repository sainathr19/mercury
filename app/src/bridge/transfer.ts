import { FeeChoice, type WalletInterface } from 'mercury-wallet-core';
import { ENDPOINTS, evmRpcForChainId, btcEsploraForEnv, btcEsploraFallbackForEnv } from './networks';
import { getActiveEvmChainId, evmExplorerTxUrl } from './evmChain';
import { getActiveEnvironment } from './activeEnv';
import { btcExplorerTxUrl, solExplorerTxUrl } from './explorers';
import { getActiveAccount } from './account';
import { hexToArrayBuffer } from './web3';
import { toBaseUnits } from '../lib/format';

export interface SendResult { id: string; explorerUrl: string }

/**
 * Size the EVM gas limit for the exact transfer via `eth_estimateGas`.
 * A plain EOA recipient needs 21000, but a contract or EIP-7702-delegated
 * account runs code on receive and needs more — hardcoding 21000 makes those
 * revert ("out of gas"). If the node says the call would revert, we surface a
 * clear error instead of broadcasting a doomed transaction.
 */
async function estimateEvmGas(from: string, to: string, valueWei: string, rpc: string, data?: string): Promise<bigint> {
  const call: Record<string, string> = { from, to, value: '0x' + BigInt(valueWei).toString(16) };
  if (data) call.data = data;
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_estimateGas',
      params: [call],
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`recipient would reject this transfer (${json.error.message ?? 'execution reverted'})`);
  }
  // +25% headroom over the node's estimate.
  return (BigInt(json.result) * 125n) / 100n;
}

/** The RPC URL for an EVM chain (from the core's chain registry), so gas
 *  estimates hit the asset's actual chain. Falls back to the default endpoint. */
async function evmRpcForChain(wallet: WalletInterface, chainId: bigint): Promise<string> {
  try {
    const c = (await wallet.evmListChains()).find((x) => x.chainId === chainId);
    if (c?.rpcUrl) return c.rpcUrl;
  } catch {}
  // Resolve the chain's own RPC across both environments' managed chains before
  // the last-resort default (which follows the build environment).
  return evmRpcForChainId(chainId) ?? ENDPOINTS.evmRpc;
}

const MIN_SAT_PER_VB = 2n; // relay floor (min sat/vB)
/** Typical 1-in / 2-out P2TR tx size, used to turn a sat/vB rate into a fee. */
export const BTC_TX_VBYTES = 150;

/** BTC: broadcast on the active network. Uses the caller's chosen sat/vB rate
 *  (from the Transaction Speed sheet) when given; otherwise estimates a 6-block
 *  rate. Either way it's floored to the relay minimum. */
/** Run a BTC operation against the primary Esplora; if it fails because the node
 *  is rate-limiting (429 / too-many-requests), switch to the failover indexer,
 *  retry once, then restore the primary. Both mempool.space and Blockstream public
 *  APIs 429 under load, so a single-endpoint send would fail intermittently. */
async function withBtcFailover<T>(wallet: WalletInterface, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    const s = String((e as Error)?.message ?? e).toLowerCase();
    const rateLimited =
      s.includes('429') || s.includes('too many requests') || s.includes('rate limit') || s.includes('rate exceeds');
    const fb = btcEsploraFallbackForEnv(getActiveEnvironment());
    if (!rateLimited || !fb) throw e;
    console.warn('[btc] primary indexer rate-limited — retrying on failover:', fb);
    try {
      await wallet.setBtcEsploraEndpoint(fb);
      return await op();
    } finally {
      // Restore the primary so subsequent reads go back to it.
      await wallet.setBtcEsploraEndpoint(btcEsploraForEnv(getActiveEnvironment()));
    }
  }
}

export async function sendBtc(
  wallet: WalletInterface,
  to: string,
  amountBtc: string,
  satPerVbOverride?: bigint,
): Promise<SendResult> {
  return withBtcFailover(wallet, async () => {
    let satPerVb = MIN_SAT_PER_VB;
    if (satPerVbOverride != null) {
      if (satPerVbOverride > MIN_SAT_PER_VB) satPerVb = satPerVbOverride;
    } else {
      try {
        const rate = await wallet.btcEstimateFee(getActiveAccount(), 6);
        if (rate.satPerVb > MIN_SAT_PER_VB) satPerVb = rate.satPerVb;
      } catch {
        // fall back to the floor rate
      }
    }
    const req = {
      recipients: [{ address: to, amountSat: toBaseUnits(amountBtc, 8) }],
      fee: new FeeChoice.Rate({ rate: { satPerVb } }),
      replaceByFee: true,
    };
    const res = await wallet.btcSend(getActiveAccount(), req as any);
    return { id: res.txid, explorerUrl: btcExplorerTxUrl(res.txid) };
  });
}

// ---- BTC fee boost (RBF) ---------------------------------------------------

export interface BtcFeeTier {
  key: 'fast' | 'normal' | 'slow';
  label: string;
  blocks: number;
}
export const BTC_FEE_TIERS: BtcFeeTier[] = [
  { key: 'fast', label: 'Fast (~10 min)', blocks: 1 },
  { key: 'normal', label: 'Normal (~30 min)', blocks: 3 },
  { key: 'slow', label: 'Slow (~2 hr)', blocks: 12 },
];

/** Estimated sat/vB for a confirmation target (floored to the relay minimum). */
export async function estimateBtcTierRate(wallet: WalletInterface, blocks: number): Promise<bigint> {
  try {
    const r = await wallet.btcEstimateFee(getActiveAccount(), blocks);
    return r.satPerVb > MIN_SAT_PER_VB ? r.satPerVb : MIN_SAT_PER_VB;
  } catch {
    return MIN_SAT_PER_VB;
  }
}

/** Replace-by-fee bump of a pending BTC send to a higher sat/vB rate. */
export async function bumpBtcFee(wallet: WalletInterface, txid: string, satPerVb: bigint): Promise<SendResult> {
  const res = await wallet.btcBumpFee(getActiveAccount(), txid, new FeeChoice.Rate({ rate: { satPerVb } }), undefined);
  return { id: res.txid, explorerUrl: btcExplorerTxUrl(res.txid) };
}

/** SOL: native transfer on the active cluster. */
export async function sendSol(wallet: WalletInterface, to: string, amountSol: string): Promise<SendResult> {
  const sig = await wallet.solSend(getActiveAccount(), { to, lamports: toBaseUnits(amountSol, 9), addressLookupTables: [] });
  return { id: sig, explorerUrl: solExplorerTxUrl(sig) };
}

/** EVM: EIP-1559 native transfer on the asset's chain. maxFee = base + 2*priority. */
export async function sendEvm(
  wallet: WalletInterface,
  to: string,
  amountEth: string,
  chainId: bigint = getActiveEvmChainId(),
): Promise<SendResult> {
  const value = toBaseUnits(amountEth, 18).toString();
  const from = await wallet.evmAddress(getActiveAccount());
  const rpc = await evmRpcForChain(wallet, chainId);
  const gasLimit = await estimateEvmGas(from, to, value, rpc); // throws clearly if it would revert
  const fees = await wallet.evmEstimateFees(chainId, getActiveAccount());
  const base = BigInt(fees.baseFeePerGas);
  const prio = BigInt(fees.mediumPriorityFee);
  // EIP-1559: maxFee = baseFee*2 + priority (headroom for ~6 blocks of base-fee
  // growth). base + 2*priority under-provisions on mainnet where base ≫ priority.
  const maxFee = base * 2n + prio;
  const req = {
    to,
    value,
    data: new ArrayBuffer(0),
    gasLimit,
    maxFeePerGas: maxFee.toString(),
    maxPriorityFeePerGas: prio.toString(),
  };
  const txid = await wallet.evmSendTx(chainId, getActiveAccount(), req as any);
  return { id: txid, explorerUrl: evmExplorerTxUrl(chainId, txid) };
}

/** ERC-20 `transfer(address,uint256)` calldata as a 0x hex string. */
function erc20TransferHex(to: string, amount: bigint): string {
  const addr = to.trim().replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  const amt = amount.toString(16).padStart(64, '0');
  return '0xa9059cbb' + addr + amt;
}

/**
 * Send an ERC-20 token on the given EVM chain as a plain EIP-1559 transaction
 * (to = the token contract, calldata = transfer(...)). We deliberately use
 * `evmSendTx`, not `evmSendBatch`: batching goes through EIP-7702 delegation,
 * which reverts on chains without a configured delegate (e.g. Sepolia). A single
 * transfer needs no delegation.
 */
export async function sendErc20(
  wallet: WalletInterface,
  contract: string,
  decimals: number,
  to: string,
  amount: string,
  chainId: bigint = getActiveEvmChainId(),
): Promise<SendResult> {
  const raw = toBaseUnits(amount, decimals);
  const hex = erc20TransferHex(to, raw);
  const from = await wallet.evmAddress(getActiveAccount());
  const rpc = await evmRpcForChain(wallet, chainId);
  // Size the gas via the node; fall back to a safe limit if it won't estimate.
  let gasLimit = 120000n;
  try {
    gasLimit = await estimateEvmGas(from, contract, '0', rpc, hex);
  } catch {}
  const fees = await wallet.evmEstimateFees(chainId, getActiveAccount());
  const base = BigInt(fees.baseFeePerGas);
  const prio = BigInt(fees.mediumPriorityFee);
  const maxFee = (base * 2n + prio).toString(); // EIP-1559: baseFee*2 + priority
  const req = {
    to: contract,
    value: '0',
    data: hexToArrayBuffer(hex),
    gasLimit,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: prio.toString(),
  };
  const txid = await wallet.evmSendTx(chainId, getActiveAccount(), req as any);
  return { id: txid, explorerUrl: evmExplorerTxUrl(chainId, txid) };
}

/** Send an SPL token on Solana. */
export async function sendSpl(
  wallet: WalletInterface,
  mint: string,
  decimals: number,
  toOwner: string,
  amount: string,
): Promise<SendResult> {
  const raw = toBaseUnits(amount, decimals).toString();
  const sig = await wallet.solSendToken(getActiveAccount(), {
    toOwner: toOwner.trim(),
    mint,
    amount: raw,
    autoCreateAta: true,
    addressLookupTables: [],
  });
  return { id: sig, explorerUrl: solExplorerTxUrl(sig) };
}

export type SendChain = 'btc' | 'eth' | 'sol';

export function sendFor(chain: SendChain) {
  return chain === 'btc' ? sendBtc : chain === 'eth' ? sendEvm : sendSol;
}

/** Best-effort network-fee preview in native units (display number). Returns
 *  null when it can't be estimated — callers should show "calculated at send". */
export async function estimateFee(
  wallet: WalletInterface,
  chain: SendChain,
  chainId: bigint = getActiveEvmChainId(),
  isToken = false,
): Promise<number | null> {
  try {
    if (chain === 'btc') {
      let satPerVb = MIN_SAT_PER_VB;
      try {
        const rate = await wallet.btcEstimateFee(getActiveAccount(), 6);
        if (rate.satPerVb > MIN_SAT_PER_VB) satPerVb = rate.satPerVb;
      } catch {}
      const feeSat = Number(satPerVb) * BTC_TX_VBYTES;
      return feeSat / 1e8;
    }
    if (chain === 'eth') {
      const fees = await wallet.evmEstimateFees(chainId, getActiveAccount());
      const maxFee = BigInt(fees.baseFeePerGas) * 2n + BigInt(fees.mediumPriorityFee);
      // ERC-20 transfers run contract code (~100k gas); native sends are 21k.
      const gasLimit = isToken ? 100000n : 21000n;
      const feeWei = maxFee * gasLimit;
      return Number(feeWei) / 1e18;
    }
    // SOL: flat 5000-lamport base fee.
    return 5000 / 1e9;
  } catch {
    return null;
  }
}
