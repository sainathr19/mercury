# Mercury — service specs

One file per service. Each says what it holds, what it deliberately does not,
where its boundaries are, and how it fails.

| Spec | Service | Track |
|---|---|---|
| [app.md](app.md) | Expo wallet | B |
| [hub.md](hub.md) | Agent endpoint + push + ops scripts | A |
| [subgraph.md](subgraph.md) | The Graph indexers | A |
| [shared.md](shared.md) | Types and chain config — the seam | both |
| [onboarding.md](onboarding.md) | First run: create, import, name claim | B (+ one hub endpoint) |

Background lives in [../PLAN.md](../PLAN.md): §2 verified chain facts, §3 the
feature set, §5 the schedule. These specs assume it and don't repeat it.

---

## Four services, not five

**`contracts/` does not exist.** We deploy almost no Solidity — ERC-5564,
ERC-6538 and Uniswap V2 are already live on Arc, and ENSv2 is already on
Sepolia. What remains is one-shot *scripts* (register the name, deploy the
subregistry, seed the pool), which are TypeScript and viem — exactly what
`hub/` already is. They live in `hub/scripts/`.

A `contracts/` directory gets created only if the day-1 ENS spike proves we
need a custom subregistry in Solidity. That is a decision made with evidence,
not a guess made now.

**`shared/` is not an npm package.** A `file:../shared` dependency works, but
it drags Metro resolver configuration into the Expo side — a day-1 cost for
track B. Same types, reached instead by a tsconfig path alias plus one
`extraNodeModules` line. No workspace, no install step, no version drift.

---

## Data path

The app talks to The Graph **directly**. The hub is never in the read path.

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

**The hub is not on the critical path.** Kill it and the wallet still shows
balances, history, and sends money. Only natural-language history and push
notifications go dark. This is a deliberate property — protect it.

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
