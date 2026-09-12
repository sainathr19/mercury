# Mercury — service specs

One file per service. Each says what it holds, what it deliberately does not,
where its boundaries are, and how it fails.

> **Status.** These were written before the build. Where one disagrees with the
> code, the code is right — see [../PLAN.md §0.5](../PLAN.md) for what shipped.
> `hub.md` has been rewritten to match; the others still describe some things
> that were never built (an agent, push notifications) and are marked below.

| Spec | Service | State |
|---|---|---|
| [app.md](app.md) | Expo wallet | built; no agent, no push |
| [hub.md](hub.md) | Gateway relayer + name sponsor + index proxy | **rewritten to match the code** |
| [subgraph.md](subgraph.md) | The Graph indexers | built for Arc |
| [shared.md](shared.md) | Types and chain config — the seam | **`shared/` is unused; the app and hub each keep their own chain registry** |
| [onboarding.md](onboarding.md) | First run: create, import, name claim | built |
| [ens.md](ens.md) | Names | built, via `contracts/MercuryNameRegistry.sol` |

Background lives in [../PLAN.md](../PLAN.md): §2 verified chain facts, §3 the
feature set, §5 the schedule. These specs assume it and don't repeat it.

---

## Four services, not five

**`contracts/` does exist, in the end.** This section originally said it would
not, with the condition attached: *"a `contracts/` directory gets created only
if the day-1 ENS spike proves we need a custom subregistry in Solidity."* The
spike proved exactly that, so `contracts/MercuryNameRegistry.sol` was written
and deployed to Sepolia at `0xe6967ac719caa21ee46d62ceafa9969f96e9252d`. The
one-shot ops scripts still live in `hub/scripts/` as planned.

The prediction was wrong and the decision rule was right — which is the part
worth keeping.

**`shared/` is not an npm package.** A `file:../shared` dependency works, but
it drags Metro resolver configuration into the Expo side — a day-1 cost for
track B. Same types, reached instead by a tsconfig path alias plus one
`extraNodeModules` line. No workspace, no install step, no version drift.

---

## Data path

~~The app talks to The Graph **directly**. The hub is never in the read path.~~

**This inverted.** The app reads through `GET /index/*` on the hub, because the
provider credential cannot ship in the app: `EXPO_PUBLIC_*` is inlined into the
bundle at build time and recoverable from the package, so a key there is handed
to anyone who downloads the app and billed to us. The proxy forwards a fixed set
of shapes with validated parameters — it is not an open relay, and a proxy that
passed arbitrary paths through with our key attached would have moved the
credential rather than protected it.

```
                 ┌──────────── app (Expo) ────────────┐
                 │  keys · signing · UI · rules parser │
                 └──┬──────────────┬───────────────┬───┘
        reads       │              │ writes        │ optional
   ┌────────────────▼──┐    ┌──────▼──────┐   ┌────▼─────────┐
   │  subgraph (Graph) │    │  Arc RPC    │   │  hub         │
   │  Arc/Base/Ethereum│    │  (viem)     │   │  agent+push  │
   │  + Token API      │    └─────────────┘   └────┬─────────┘
   └───────────────────┘                           │ own Graph client
                 ┌──────────────────┐              │
                 │ ENSv2 (Sepolia)  │◄─────────────┘
                 │ = the directory  │
                 └──────────────────┘
```

**The hub IS on the critical path now**, and that was a real trade. Kill it and
the wallet still holds keys, shows on-chain balances and sends ordinary
transactions — but instant cross-chain sends stop (the mint needs a relayer),
sponsored name claims stop, and transaction history goes dark.

What was bought for that: a recipient who needs no gas token on the destination
chain, and a new wallet that can claim a name with a zero balance. Both are the
product. The property that was protected instead is narrower and more important:
**the hub never holds user funds or user keys.** Its key holds gas, and every
endpoint that spends it is bounded by a spend ledger.

**One narrow exception: the name claim.** A new user has no funds on any
chain, so we sponsor subname issuance from the subregistry we own — which
requires the hub. Onboarding stays usable without it (the name is skippable),
and nothing after onboarding touches it. See [onboarding.md](onboarding.md).

---

## The seams

These four contracts are what stop two tracks building incompatible things.
Change one in a small commit of its own and say so in the message.

| Seam | Owner | Consumers | Breaks if |
|---|---|---|---|
| `shared/chains.ts` | both | app, hub, scripts | Decimals are converted anywhere else (see below) |
| `shared/intent.ts` | app | app, hub | The agent starts returning intents instead of answers |
| `shared/records.ts` | A | app, scripts | ENS record keys drift from what the resolver actually stores |
| `subgraph/schema.graphql` | A | app, hub | Field renamed without regenerating the app's client |

---

## Two rules that come from the chain, not from taste

**One decimals boundary.** Arc's native USDC is 18dp and the ERC-20 view is
6dp — the *same balance* in two scales. Worse, the two `Transfer` event
sources disagree (see [subgraph.md](subgraph.md)). Everything inside Mercury
is **6dp integer minor units**; conversion happens only in `shared/chains.ts`
and nowhere else. A `/1e18` or `/1e6` anywhere else in the codebase is a bug.

**Every Arc write goes through one wrapper.** `eth_estimateGas` is unreliable
on Arc, and receipts **do not throw on revert**. A bare `sendTransaction`
anywhere is a silent failure waiting to happen. `app/src/bridge/arc.ts`
exports the only send path: it sets gas explicitly and asserts
`receipt.status === 'success'`.

---

## Status

Every spec ends with an **Open questions** section. Nothing here is settled by
authority — if the day-1 spike contradicts a spec, the spike wins and the spec
gets edited the same day.
