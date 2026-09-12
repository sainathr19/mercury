# `hub/` — Gateway relayer, name sponsor, index proxy

> **Rewritten after the build.** The previous version described an agent
> endpoint and a push service, and opened with *"It holds no user keys, no user
> funds, and no directory."* Two of those three are still true and the sentence
> as a whole was badly misleading: the hub holds **a funded key** and spends it.
> That is the line someone reads before deciding where to run this, so it is now
> the first thing the file says.

**It holds no user keys and no user funds. It does hold one key of its own, and
that key holds gas.** It pays for two things: submitting Circle Gateway mints on
a destination chain, and registering ENS subnames for users who have no funds
yet. ENS is the directory ([ens.md](ens.md)); the device holds the keys.

## Why it exists

Three reasons, none of them the ones this file originally gave.

1. **The mint needs gas on the destination chain.** Circle attests a burn
   instantly, but the funds only appear once somebody submits that attestation
   to `GatewayMinter` on the destination — an ordinary transaction, needing gas
   there. Making the recipient do it breaks the wallet's "no gas token" promise
   at exactly the wrong moment.
2. **A new user has no funds anywhere.** Their first name has to be paid for by
   someone, and that someone needs a key.
3. **The provider credential cannot ship in the app.** `EXPO_PUBLIC_*` is
   inlined into the bundle at build time and recoverable from the package, so a
   Graph key there is handed to anyone who downloads the app and billed to us.
   ERC-7677 gives this advice for paymaster keys; it applies unchanged here.

The LLM key is **not** a reason. There is no agent (see
[../PLAN.md §3.6](../PLAN.md)).

## Shape

```
hub/src/
  index.ts        routes, budgets, graceful shutdown
  relay.ts        Gateway mints, per-chain RPC, revert detection
  sponsor.ts      ENS subname issuance, signature check
  budget.ts       two-phase spend ledger
  indexProxy.ts   The Graph, key-side only
  chains.ts       Circle domain -> chain, per environment
hub/scripts/      one-shot ops (deploy registry, claim, verify)
```

Runs as a container; see `hub/README.md` and the root `docker-compose.yml`.

## Endpoints

| | Spends gas | Notes |
|---|---|---|
| `GET /healthz` | | Returns `ok`. **`HEAD` currently 500s** — a `c.text()` without an explicit `content-length` breaks HEAD on this adapter. Point uptime monitors at GET. |
| `GET /names/status` | | Whether sponsorship is on, and the live sponsor budget. |
| `GET /gateway/budget` | | The relay budget. Published so sponsorship is a documented offer, not an opaque favour. |
| `GET /gateway/domains?environment=` | | Per-chain relayer funding. **The app calls this before signing a burn.** |
| `POST /names/claim-message` | | The exact bytes to sign. Served rather than rebuilt in the app, because two implementations of one string format drift. |
| `POST /names/sponsor` | **yes** | Registers a subname. Requires the caller's signature — see below. |
| `POST /gateway/relay` | **yes** | Submits a Circle attestation on the destination chain. |
| `GET /index/token/*`, `/index/arc/*` | | Proxies The Graph. A fixed set of shapes, validated parameters. |
| `GET /index/explorer/:action` | | Proxies Etherscan V2 for `txlist`/`tokentx`. The fallback under Blockscout. |

### Why history needs two sources

The app tries The Graph, then Blockscout, then this proxy. Blockscout sits ahead
of Etherscan deliberately: it is keyless and unmetered. What it is not is
dependable.

A survey taken while the registry still carried 22 testnets found **5** with a
reachable history source: four Blockscout instances answering 503/429/404 and
thirteen chains with no explorer configured at all. The registry has since been
cut to the Circle domains, but the lesson outlived the chains that taught it —
Arbitrum Sepolia was among the dead ones, and it is a Circle domain, so a
Gateway send delivers real money there. The
balance rendered correctly, because balances come from RPC; the matching
"Received" row never appeared, because a **native transfer emits no logs** and
there is nothing for `eth_getLogs` to find. Only an indexer sees it.

`ETHERSCAN_API_KEY` closes that gap for 14 of our chains from one key. It is
optional: unset means Blockscout-only, which is the behaviour that shipped
before, not a failure.

Indexed is not the same as served. A free key is refused on some of those
chains — observed on Optimism, Base and Avalanche — while every testnet this
wallet now uses works on the free tier. Which chains
a plan covers is **learned from the upstream**, not hard-coded: a free-tier list
here would be wrong for anyone who pays and stale the day Etherscan moves a
chain between tiers. A refusal costs one call per chain per process, and is kept
distinct from a rejected key — that one is global, this one is not.

Two properties the proxy is built around:

- **An empty array is an answer; a failure is not.** Every fault path returns a
  non-array `result`, because `result: []` from a socket hang-up is the wallet
  asserting "you have no transactions" on the strength of a request that never
  arrived. A rejected key answers 503 so the app retires the source for the
  session instead of re-asking once per chain per scan.
- **The rate limit is per key, and every app instance shares ours.** One wallet
  opening its history is two calls per chain across a dozen chains, which alone
  exceeds the 5/s free tier. Calls are spaced in the hub, so no client can burn
  the shared quota.

### Why `/gateway/relay` is unauthenticated and `/names/sponsor` is not

The attestation is signed by Circle and names its own recipient inside the
signed payload. A relayer cannot redirect, alter or skim it — the only power it
has is whether to submit. So the worst a hostile caller can do is waste our gas,
which is a rate limit, not a custody risk.

`/names/sponsor` has no such thing vouching for it. There is no Circle signature
in the payload, so **the caller's own signature is the only thing standing
between our gas and a name pointing wherever a stranger likes.**

## The spend ledger

Both gas-spending endpoints book against a budget denominated in **ETH, not
operations**. Counting operations does not bound cost: 200 registrations is
0.042 ETH at 1 gwei and 2.11 ETH at 50, and gas price was not in the count.

- **Two-phase.** A request reserves its worst case *before* the transaction is
  sent and settles the real cost afterwards. Charging only on success would let
  concurrent requests each pass a check none of them could afford together.
- **A gas-price ceiling.** The honest answer to "gas is 200 gwei" is "not right
  now", not "here is ten times the usual bill".
- **Per-address, where the payer is known.** The relay is global-only, because
  the depositor cannot yet be read out of Circle's attestation layout. That is
  strictly weaker and should not stay that way.
- **`PER_ADDRESS_ETH` must cover `gasLimit × MAX_GAS_GWEI`.** Otherwise a claim
  above that gas price is refused as *"this wallet has used its allowance"* — a
  gas problem wearing a quota error's clothes.

The ledger is a file under `/app/data`. On ephemeral storage it resets every
deploy and every wallet gets its allowance back, which makes the caps
decorative.

## Failure modes

| | |
|---|---|
| An unreachable RPC | Reported as `ready: null`, **not** `ready: false`. Unknown is not the same as unfunded: reporting `false` tells the app to disable a send that might work, `true` tells it to burn into one that cannot. |
| Public RPCs refusing the host | Providers rate-limit by IP and a datacenter address is what they refuse. `RPC_<chainId>` overrides exist for this. Observed: Sepolia unreachable from the deployed host while three other chains read fine. |
| An unbounded RPC call | viem defaults to 10s × 3 retries; across four chains that turns one dead endpoint into a minutes-long hang — on an endpoint the app calls *before* signing a burn. Bounded to 8s / 1 retry. |
| A mint that reverts | A receipt does **not** throw on revert. Every mint asserts `status === 'success'` or a failed claim reports as a success. |
| A corrupt ledger | Throws rather than silently becoming an empty one — an empty ledger reopens the budget to everyone who already spent it. |

## What it still does not hold

No user keys. No user funds. No directory — ENS owns that, so the hub cannot lie
about who a name belongs to. No mailbox. No LLM key, because there is no agent.
