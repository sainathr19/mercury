// SPL / Token-2022 balances fetched over JS `fetch()` instead of the Rust core's
// `solTokenBalances`. The compiled Rust reqwest path panics on the
// `getTokenAccountsByOwner` response (same class of bug that pushed Garden swaps
// to `fetch()` — see swap.ts), so we mirror the core's `chain/solana/balance.rs`
// logic here. Pure parsing lives in ../lib/solTokenParse (unit-tested there).

import { solRpcForEnv } from './networks';
import { getActiveEnvironment } from './activeEnv';
import { parseSolTokenAccounts, type SolTokenBalanceJs } from '../lib/solTokenParse';

export type { SolTokenBalanceJs } from '../lib/solTokenParse';

// The two SPL token programs the core queries (classic + Token-2022).
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Public Solana RPCs (api.mainnet-beta.solana.com) are rate-limited and can hang
// on a bad response. Abort each request after this long so a stalled fetch can't
// wedge the portfolio load — the caller treats the abort as a failed fetch and
// keeps the last-known balances.
const RPC_TIMEOUT_MS = 10000;

/** POST a JSON-RPC body with an abort-based timeout, returning the parsed JSON. */
async function rpcPost(rpc: string, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function tokenAccountsByOwner(rpc: string, owner: string, programId: string): Promise<unknown> {
  const json = await rpcPost(rpc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  });
  if (json?.error) throw new Error(json.error.message ?? 'getTokenAccountsByOwner failed');
  return json?.result?.value;
}

/** Native SOL balance in lamports for `owner` on the active cluster. Drop-in for
 *  `wallet.solBalance(account)`, which returns 0 here — the compiled Rust reqwest
 *  path fails on the Solana RPC response (same class of bug as the SPL token
 *  fetch and Garden swaps), so we call `getBalance` over JS `fetch()` instead. */
export async function fetchSolBalance(owner: string): Promise<bigint> {
  if (!owner) return 0n;
  const rpc = solRpcForEnv(getActiveEnvironment());
  const json = await rpcPost(rpc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [owner, { commitment: 'confirmed' }],
  });
  if (json?.error) throw new Error(json.error.message ?? 'getBalance failed');
  return BigInt(json?.result?.value ?? 0);
}

/** Token balances across both token programs for `owner` on the active cluster.
 *  Drop-in replacement for `wallet.solTokenBalances(account)`. */
export async function fetchSolTokenBalances(owner: string): Promise<SolTokenBalanceJs[]> {
  if (!owner) return [];
  const rpc = solRpcForEnv(getActiveEnvironment());
  const [spl, t2022] = await Promise.all([
    tokenAccountsByOwner(rpc, owner, SPL_TOKEN),
    tokenAccountsByOwner(rpc, owner, TOKEN_2022),
  ]);
  return [...parseSolTokenAccounts(spl, false), ...parseSolTokenAccounts(t2022, true)];
}
