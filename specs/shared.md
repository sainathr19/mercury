# `shared/` — the seam

> **Not used.** `shared/` exists in the tree and nothing imports it. The app and
> the hub each keep their own chain registry (`app/src/lib/chains.ts` and
> `hub/src/chains.ts`), kept in step by the Circle domain rather than a shared
> module — they are separate processes with separate deploy cycles, and one is
> bundled into a mobile binary. The decimals boundary this file describes lives
> in `app/src/lib/format.ts`.
>
> Kept for the reasoning. If the two registries are ever unified, this is the
> argument for how.

Types and pure helpers that `app/`, `hub/` and `hub/scripts/` must agree on.
**Owner: both tracks.** Changes land in their own commit with a message saying
what moved, because both tracks rebuild against them.

## Not an npm package

A plain directory, reached by path alias. No `package.json`, no workspace, no
install step.

```jsonc
// app/tsconfig.json and hub/tsconfig.json
{ "compilerOptions": { "paths": { "@shared/*": ["../shared/*"] } } }
```

```js
// app/metro.config.js — Metro doesn't read tsconfig paths
config.resolver.extraNodeModules = { '@shared': path.resolve(__dirname, '../shared') };
config.watchFolders = [path.resolve(__dirname, '../shared')];
```

**Hard constraint: zero runtime dependencies.** Types, constants and pure
functions only. The moment `shared/` imports `viem` it stops being a seam and
becomes a library both sides have to version-match. If you need a viem type,
re-declare the narrow shape you actually use.

## Layout

```
shared/
  chains.ts      chain configs + the ONLY decimals conversion
  records.ts     what lives in an ENS resolver, and under which keys
  intent.ts      the parsed payment intent
  notify.ts      push payload shapes
  index.ts       re-exports
```

## `chains.ts` — the decimals boundary

Everything inside Mercury is **6dp integer minor units** (`1_000000n` = 1 USDC).
Floats never represent money. Conversion to and from chain-native scales
happens here and nowhere else.

```ts
export const ARC_TESTNET = {
  id: 5042002,
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app',
  ensCoinType: 2152525650,          // 0x80000000 | 5042002
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  nativeDecimals: 18,               // eth_getBalance, tx.value
  erc20Decimals: 6,                 // balanceOf, Transfer data
} as const;

/** native (18dp) → minor units (6dp). Truncates; never round up. */
export const nativeToMinor = (wei: bigint): bigint => wei / 10n ** 12n;
/** minor units (6dp) → native (18dp), for tx.value. */
export const minorToNative = (minor: bigint): bigint => minor * 10n ** 12n;
/** display only — the ONLY place money becomes a float. */
export const formatMinor = (m: bigint): string => (Number(m) / 1e6).toFixed(2);
```

Truncation direction matters: `nativeToMinor` drops sub-microdollar dust, so a
balance never displays higher than what is actually spendable. Rounding up
would show money that cannot be sent, and the send would fail at the node.

Also holds `ARC_MAINNET` (chain 5042, coinType 2147488690) so the mainnet
switch on day 13 is a constant change, not a search-and-replace.

## `records.ts` — the ENS contract

The resolver *is* the directory, so these keys are load-bearing. A drift
between what `hub/scripts/ens-set-records.ts` writes and what
`app/src/bridge/ens.ts` reads means resolution silently returns nothing.

```ts
export const ENS_KEYS = {
  stealthMetaAddress: 'mercury.stealth',   // hex: 0x<spendPub><viewPub>
  displayName:        'display',
} as const;

export interface MercuryRecord {
  name: string;                 // sainath.mercury.eth
  arcAddress: `0x${string}`;    // addr(node, 2152525650)
  baseAddress?: `0x${string}`;  // addr(node, 2147492101)
  stealthMeta?: `0x${string}`;  // text(node, 'mercury.stealth'), 66 bytes
  display?: string;
}
```

`stealthMeta` is two compressed secp256k1 points concatenated — spend key
first, then view key, 33 bytes each. Absent means the user has not enabled
private receive; the sender must fall back to a public transfer and the send
screen must say so rather than failing.

## `intent.ts` — parsed payment

Produced by the app's deterministic parser. Carries **no authority**: it is a
description of what the user asked for, and the device decides whether to sign.

```ts
export interface Intent {
  recipient: string;      // 'sainath.mercury.eth' | '0x…'
  amountMinor: bigint;    // 6dp
  token: 'USDC' | 'EURC';
  private: boolean;       // the toggle
  note?: string;
}
```

Not produced by the LLM. See [hub.md](hub.md).

## `notify.ts` — push payloads

```ts
export interface IncomingPayment {
  kind: 'incoming';
  amountMinor: string;    // stringified — JSON has no bigint
  token: 'USDC' | 'EURC';
  fromName?: string;      // reverse-resolved if known
  txHash: string;
  private: boolean;
}
```

`amountMinor` is a string on the wire and parsed back to `bigint` on receipt.
Serialising a bigint throws in `JSON.stringify`; the type makes that explicit
rather than leaving it to be discovered at runtime.

## Open questions

- **Does `stealthMeta` belong in ENS or in the ERC-6538 registry?** Both work
  and both are live on Arc. ENS keeps one lookup; ERC-6538 is the standard
  path other wallets would check. Day-1 spike decides — if ENSv2 text writes
  are hard, ERC-6538 becomes the fallback and this type moves.
- **`baseAddress` may be unnecessary** if funding always routes through CCTP
  rather than being sent to a Base address directly. Keep the field, leave it
  unset, decide on day 6.
