# `subgraph/` — indexing

> **Written before the build.** The `Account` aggregates below exist to answer
> agent questions, and there is no agent — see [../PLAN.md §3.6](../PLAN.md).
> The transfer indexing is built and in use; history reaches the app through the
> hub's `/index/*` proxy rather than directly, so no provider key ships in the
> bundle.

One schema, three deployments: **Arc testnet, Base, Ethereum**. Studio only —
Arc's registry entry has `issuanceRewards: false`, so it cannot be published
to the decentralized network. **Owner: track A.**

The app queries this **directly** ([app.md](app.md)); the hub keeps a separate
client for notification polling ([hub.md](hub.md)). Two consumers, no shared
connection, so neither can break the other.

## The finding that shapes everything here

**Arc emits `Transfer` from two different addresses, at two different scales.**
Verified on testnet on day 1:

| How the money moved | Emitter | Amount scale |
|---|---|---|
| ERC-20 `transfer()` | `0x3600000000000000000000000000000000000000` | **6dp** |
| Native value send (`tx.value`) | `0xfffffffffffffffffffffffffffffffffffffffe` | **18dp** |

A subgraph watching only the USDC contract **silently misses every native
send** — faucet drips, external wallets, anything not routed through the ERC-20
interface. It won't error; the money simply never appears in the feed.

Two consequences:

1. **Index both addresses**, and normalise 18dp → 6dp in the native handler.
2. **Mercury always pays via ERC-20 `transfer()`**, never a bare value send —
   so our own payments are uniform, 6dp, single-source. We still index the
   native emitter to catch money arriving from outside.

Sending via `transfer()` does not cost the recipient anything: `balanceOf`
mirrors the native balance on Arc (verified: 65.039981 native vs 65.039980 via
`balanceOf`), so a recipient of an ERC-20 transfer can still pay their own gas.

## Schema

```graphql
type Transfer @entity(immutable: true) {
  id: Bytes!              # txHash-logIndex
  from: Bytes!
  to: Bytes!
  token: Bytes!
  symbol: String!         # USDC | EURC
  amount: BigInt!         # ALWAYS 6dp minor units
  native: Boolean!        # came from the native emitter
  chain: String!          # arc | base | mainnet
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
}

type Announcement @entity(immutable: true) {
  id: Bytes!
  schemeId: BigInt!
  stealthAddress: Bytes!
  caller: Bytes!
  ephemeralPubKey: Bytes!
  viewTag: Int!           # metadata[0], extracted for cheap filtering
  metadata: Bytes!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
}

type Account @entity {
  id: Bytes!              # address
  sentMinor: BigInt!
  receivedMinor: BigInt!
  txCount: Int!
  firstSeen: BigInt!
  lastSeen: BigInt!
}
```

`Transfer` and `Announcement` are `immutable` — they are log facts and are never
revised, which lets the indexer skip load-before-write and stay fast.

`viewTag` is denormalised out of `metadata` deliberately. It is the one byte a
scanning client filters on, and pulling it into an indexed column is the
difference between a query and a scan.

`Account` is a running aggregate so the agent can answer "how much have I sent"
without paginating every transfer.

## Sources

```yaml
# arc-testnet
- USDC ERC-20         0x3600000000000000000000000000000000000000  Transfer  (6dp)
- EURC ERC-20         0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a  Transfer  (6dp)
- native emitter      0xfffffffffffffffffffffffffffffffffffffffe  Transfer  (18dp → scale)
- ERC-5564 Announcer  0x55649E01B5Df198D18D95b5cc5051630cfD45564  Announcement
```

Base and Ethereum index their canonical USDC only. The ERC-5564 Announcer is
Arc-only in v1 — private payments settle on Arc, so there is nothing to watch
elsewhere.

## Handlers

```
src/
  usdc.ts        handleTransfer      — 6dp, native:false
  native.ts      handleNativeTransfer — divide by 1e12, native:true
  announcer.ts   handleAnnouncement  — extract viewTag = metadata[0]
  account.ts     touch(address, sent, received) — shared aggregate helper
```

Keep handlers thin. Anything that reasons about a payment belongs in the app;
the subgraph's job is to turn logs into rows.

## Start blocks

**Do not start from block 0.** Arc's public RPC prunes history — `eth_getLogs`
from genesis returns `pruned history unavailable`. Pin `startBlock` to roughly
the day-4 deployment height. Indexing 60M blocks of history we do not need would
cost hours of sync time for nothing.

Record the chosen heights in `subgraph/networks.json` so a redeploy is
reproducible.

## Query shapes the app depends on

Design the schema around these three; anything else is speculative.

```graphql
# home screen: balance + recent
transfers(where:{ or:[{from:$me},{to:$me}] }, orderBy:timestamp, orderDirection:desc, first:50)

# scanning for private receipts — pull the batch, match view tags LOCALLY
announcements(where:{ viewTag:$tag, blockNumber_gt:$since }, first:1000)

# agent aggregates
account(id:$me) { sentMinor receivedMinor txCount }
```

The scanning query filters on `viewTag` only — never on anything identifying.
A tag matches 1/256 of all announcements, so the provider learns almost nothing,
and the actual ECDH match happens on-device. Filtering server-side by address
would hand the provider the exact link the whole scheme exists to hide.

## Failure modes

| Failure | Symptom | Response |
|---|---|---|
| Indexer lags the chain | Payment sent, feed empty | Show the optimistic row from the local tx receipt; reconcile when it indexes |
| Subgraph unsynced after deploy | Empty wallet on a fresh build | Check sync status in Studio *before* the rehearsal, not during |
| Handler throws | Indexing halts at that block, silently | Handlers must never throw on malformed data — skip and continue |
| Wrong `startBlock` | Missing early history | Redeploy with a corrected height; the app is stateless about this |

## Open questions

- **Is `0xffff…fffe` stable on Arc mainnet?** It looks like a system emitter,
  but it is undocumented — verified empirically, not from a spec. Re-check on
  day 13 before the mainnet deployment.
- **Does the native emitter also log gas payments?** 20,902 Transfer events in
  3,000 blocks is high. If gas shows up as transfers, the feed needs to filter
  them or every user sees hundreds of dust rows. **Check this on day 4** — it
  is the single most likely source of a noisy, broken-looking activity feed.
- **Base/Ethereum start blocks** are a cost decision, not a correctness one.
  Pick something recent; nobody's demo history predates the event.
