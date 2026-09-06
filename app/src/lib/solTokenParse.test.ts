import { parseSolTokenAccounts } from './solTokenParse';

// A real getTokenAccountsByOwner (jsonParsed) `result.value` entry, captured from
// api.devnet.solana.com. Note `rentEpoch: 18446744073709551615` (u64::MAX) — the
// sentinel the Rust path chokes on; the JS parser must handle it fine.
const ACCOUNT = {
  account: {
    data: {
      parsed: {
        info: {
          isNative: false,
          mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          owner: '7B3mAMthcEiqh26rvgLRhsR3XyBB3367SKMmVeiWcL8z',
          state: 'initialized',
          tokenAmount: { amount: '23332058', decimals: 6, uiAmount: 23.332058, uiAmountString: '23.332058' },
        },
        type: 'account',
        program: 'spl-token',
        space: 165,
      },
    },
    executable: false,
    lamports: 2039280,
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    rentEpoch: 18446744073709551615,
    space: 165,
  },
  pubkey: '99x9HbLH4jcE2Bt9LaZftKy7a6pK9o6V1jHrp3DkQbWS',
};

test('parses a jsonParsed token account into a SolTokenBalance', () => {
  const out = parseSolTokenAccounts([ACCOUNT], false);
  expect(out).toEqual([
    {
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenAccount: '99x9HbLH4jcE2Bt9LaZftKy7a6pK9o6V1jHrp3DkQbWS',
      rawAmount: '23332058',
      decimals: 6,
      uiAmountString: '23.332058',
      isToken2022: false,
    },
  ]);
});

test('flags Token-2022 accounts', () => {
  expect(parseSolTokenAccounts([ACCOUNT], true)[0].isToken2022).toBe(true);
});

test('empty / non-array input yields no balances', () => {
  expect(parseSolTokenAccounts([], false)).toEqual([]);
  expect(parseSolTokenAccounts(null, false)).toEqual([]);
  expect(parseSolTokenAccounts(undefined, false)).toEqual([]);
});

test('skips malformed accounts instead of throwing', () => {
  const malformed = [{ pubkey: 'x', account: { data: { parsed: { info: {} } } } }, ACCOUNT];
  const out = parseSolTokenAccounts(malformed, false);
  expect(out).toHaveLength(1);
  expect(out[0].mint).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
});

test('defaults uiAmountString to "0" when absent', () => {
  const noUi = JSON.parse(JSON.stringify(ACCOUNT));
  delete noUi.account.data.parsed.info.tokenAmount.uiAmountString;
  expect(parseSolTokenAccounts([noUi], false)[0].uiAmountString).toBe('0');
});
