import { getActiveEnvironment } from './activeEnv';
import { btcEsploraForEnv, solRpcForEnv, evmRpcForChainId } from './networks';
import { chainForFamily } from './stealth';
import { parseEvmReceipt, parseSolStatus, type TxOutcome } from '../lib/receipt-parse';

// On-chain outcome polling for transactions we broadcast but can't reconcile via
// the normal address scan — chiefly private spends, which are signed by a
// one-time stealth address and so never appear in the main-account history. We
// mark those `pending` on broadcast and flip them here once the chain has ruled.

export type { TxOutcome } from '../lib/receipt-parse';
export { parseEvmReceipt, parseSolStatus, familyForSymbol } from '../lib/receipt-parse';

async function evmOutcome(txid: string, chainId: bigint): Promise<TxOutcome> {
  const rpc = evmRpcForChainId(chainId);
  if (!rpc) return 'pending';
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txid] }),
  });
  const json = (await res.json()) as { result?: unknown };
  return parseEvmReceipt(json.result);
}

async function solOutcome(txid: string): Promise<TxOutcome> {
  const res = await fetch(solRpcForEnv(getActiveEnvironment()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignatureStatuses',
      params: [[txid], { searchTransactionHistory: true }],
    }),
  });
  const json = (await res.json()) as { result?: { value?: unknown[] } };
  return parseSolStatus(json.result?.value?.[0]);
}

async function btcOutcome(txid: string): Promise<TxOutcome> {
  // Esplora returns 404 until the tx is known; once known, status.confirmed
  // tells us whether it's mined. BTC txs don't "fail" post-broadcast — they
  // confirm or sit unconfirmed — so there is no `failed` outcome here.
  const res = await fetch(`${btcEsploraForEnv(getActiveEnvironment())}/tx/${txid}`);
  if (!res.ok) return 'pending';
  const tx = (await res.json()) as { status?: { confirmed?: boolean } };
  return tx.status?.confirmed ? 'confirmed' : 'pending';
}

/**
 * Resolve the on-chain outcome of a broadcast tx by chain family (0=BTC,
 * 1=EVM, 2=SOL). Never throws — any network/parse error resolves to `pending`
 * so the caller keeps polling rather than declaring a false failure.
 */
export async function checkTxOutcome(family: number, txid: string, chainId?: bigint): Promise<TxOutcome> {
  if (!txid) return 'pending';
  try {
    if (family === 0) return await btcOutcome(txid);
    if (family === 2) return await solOutcome(txid);
    // EVM: poll on the tx's actual chain (falls back to the default stealth EVM
    // chain when the caller doesn't know it, e.g. legacy activity items).
    const cid = chainId ?? chainForFamily(1)?.chainId ?? 0n;
    return await evmOutcome(txid, cid);
  } catch {
    return 'pending';
  }
}

// ---- On-chain timestamp lookup --------------------------------------------
// Stealth payments carry no block time, so a received private tx would otherwise
// be stamped "now" (jumping to the top of activity on every reinstall). Fetch the
// real block time from the tx's chain by its txid.

async function btcTxTime(txid: string): Promise<number | null> {
  const res = await fetch(`${btcEsploraForEnv(getActiveEnvironment())}/tx/${txid}`);
  if (!res.ok) return null;
  const tx = (await res.json()) as { status?: { block_time?: number } };
  return tx.status?.block_time ?? null;
}

async function solTxTime(txid: string): Promise<number | null> {
  const res = await fetch(solRpcForEnv(getActiveEnvironment()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [txid, { maxSupportedTransactionVersion: 0 }],
    }),
  });
  const json = (await res.json()) as { result?: { blockTime?: number | null } };
  return json.result?.blockTime ?? null;
}

async function evmTxTime(txid: string, chainId: bigint): Promise<number | null> {
  const rpc = evmRpcForChainId(chainId);
  if (!rpc) return null;
  const post = (method: string, params: unknown[]) =>
    fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }).then((r) => r.json() as Promise<{ result?: any }>);
  const tx = (await post('eth_getTransactionByHash', [txid])).result;
  const blockNumber = tx?.blockNumber;
  if (!blockNumber) return null;
  const blk = (await post('eth_getBlockByNumber', [blockNumber, false])).result;
  return blk?.timestamp ? parseInt(blk.timestamp, 16) : null;
}

/** The on-chain block time (unix seconds) of a tx, by chain family. Null if not
 *  mined yet or unresolvable. Never throws. */
export async function fetchTxTime(family: number, txid: string, chainId?: bigint): Promise<number | null> {
  if (!txid) return null;
  try {
    if (family === 0) return await btcTxTime(txid);
    if (family === 2) return await solTxTime(txid);
    const cid = chainId ?? chainForFamily(1)?.chainId ?? 0n;
    return await evmTxTime(txid, cid);
  } catch {
    return null;
  }
}

/**
 * Poll until `txid` is mined (confirmed or failed) or the budget runs out.
 * Used to SERIALIZE dependent sends — notably multi-address EIP-7702 spends,
 * where the node permits only one in-flight tx per delegated account, so the
 * next leg must wait for the previous to land. Returns the final outcome
 * ('pending' if it never mined within the budget).
 */
export async function waitForTxMined(
  family: number,
  txid: string,
  chainId?: bigint,
  { tries = 20, delayMs = 3000 }: { tries?: number; delayMs?: number } = {},
): Promise<TxOutcome> {
  for (let i = 0; i < tries; i++) {
    const outcome = await checkTxOutcome(family, txid, chainId);
    if (outcome !== 'pending') return outcome;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return 'pending';
}
