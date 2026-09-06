// Pure parsing for Solana `getTokenAccountsByOwner` (jsonParsed) responses.
// No native imports so it is unit-testable in isolation (the fetch glue lives in
// src/bridge/solTokens.ts). Ports the core's `chain/solana/balance.rs`.

/** Mirrors the core's `SolTokenBalance` record (camelCase, as the app consumes it). */
export interface SolTokenBalanceJs {
  mint: string;
  tokenAccount: string;
  rawAmount: string;
  decimals: number;
  uiAmountString: string;
  isToken2022: boolean;
}

/** Parse a `getTokenAccountsByOwner` (jsonParsed) `result.value` array into
 *  balances. Ports `parse_token_account`: skips anything missing a required
 *  field rather than throwing (mirrors the Rust `Option` short-circuit). */
export function parseSolTokenAccounts(value: unknown, is2022: boolean): SolTokenBalanceJs[] {
  if (!Array.isArray(value)) return [];
  const out: SolTokenBalanceJs[] = [];
  for (const acct of value) {
    const tokenAccount = acct?.pubkey;
    const info = acct?.account?.data?.parsed?.info;
    const amount = info?.tokenAmount;
    const mint = info?.mint;
    const rawAmount = amount?.amount;
    const decimals = amount?.decimals;
    if (
      typeof tokenAccount !== 'string' ||
      typeof mint !== 'string' ||
      typeof rawAmount !== 'string' ||
      typeof decimals !== 'number'
    ) {
      continue;
    }
    out.push({
      mint,
      tokenAccount,
      rawAmount,
      decimals,
      uiAmountString: typeof amount?.uiAmountString === 'string' ? amount.uiAmountString : '0',
      isToken2022: is2022,
    });
  }
  return out;
}
