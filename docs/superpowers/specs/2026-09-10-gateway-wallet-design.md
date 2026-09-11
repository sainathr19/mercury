# Gateway as a visible wallet

**Date:** 2026-09-10 · **Status:** implemented (testnet), partial (mainnet)

Two named balances instead of one silent rail, an explicit deposit action, and a
send path that refuses to burn funds it cannot deliver.

---

## Why

Circle Gateway was already integrated — 729 lines of unified balance, EIP-712
burn intents, deposit and relay — but as invisible plumbing. The wallet swept
every USDC into Gateway on each dashboard mount and showed a one-line strip.
That bought instant sends with no user education, at three costs:

1. It moved the user's money into Circle's contract without asking. Getting it
   back is a withdrawal.
2. **On mainnet it did not work at all.** `chains.ts` hardcoded the *testnet*
   contract pair with a comment asserting the addresses were universal. They are
   not. A call to an address with no code succeeds as a no-op and
   `waitForReceipt` only checks `status === '0x1'`, so the wallet approved USDC
   to a dead address, sent a deposit that moved nothing, and logged it settled —
   then repeated the wasted transaction on every mount.
3. **"Send instantly" burnt funds and discarded the claim.** With
   `EXPO_PUBLIC_RELAYER_URL` unset, the burn succeeded, `relayMint` returned
   "Relayer is not configured", and `SendResult` had no `attestation` field — so
   the only artefact that could deliver the money went out of scope while the UI
   said "funds are safe".

## Verified facts this design rests on

| Fact | How it was established |
|---|---|
| Mainnet Gateway is at `0x77777777Dcc…` / `0x2222222d71…`; testnet at `0x0077777d…` / `0x0022222A…` | `GET /v1/info` on both APIs, confirmed with `eth_getCode` on 6 chains |
| Spending is instant; **depositing is not** | Circle's confirmation table: Polygon/Avalanche ~8s, Arc ~0.5s, Base/Arb/OP/Ethereum ~13–19 min |
| Circle reuses domain ids across environments | domain 6 = Base *and* Base Sepolia |
| `depositFor` exists; no permit variant | selector scan of the deployed implementation bytecode |
| Flashnet Orchestra is **mainnet-only** | 4,635 live routes, 23 chains, zero testnet; no sandbox in the docs |
| Flashnet has no destination hooks | so swap→deposit cannot be atomic |
| Arc testnet has a funded USDC/EURC pool | `getPair` → `0xb3685d16…`, reserves 1,055 / 838 |

## Decisions

- **Naming: Gateway / Wallet.** The user's own framing. Two pots, named.
- **Hub chain: Arc on testnet, Polygon on mainnet.** Arc is ~0.5s and its gas
  token *is* USDC, so depositing needs no second coin. Polygon is ~8s and the
  cheapest domain to spend from. Base would have cost 13–19 minutes per top-up
  for no benefit — the balance spends everywhere regardless of entry point.
- **Send rail: our own relayer.** It was already deployed at
  `mercury-hub.thecircleco.xyz`, already correct for the four testnet domains,
  and the hard parts (spend budget, revert detection, already-claimed races) were
  done and measured. It needed mainnet chains and an environment-aware minter.
- **Auto-sweep: removed.** It is the premise of the two-pot model.
- **Deposits are same-chain only.** Circle credits a deposit on *any* domain to
  the one balance, so moving funds cross-chain before depositing buys nothing.
  What the chain changes is only the finality wait, which the planner reports.

## Shape

```
lib/gatewayHub.ts        per-domain finality + which chain is the hub, and why
lib/chains.ts            gatewayWallet(env) / gatewayMinter(env)
bridge/relayer.ts        deliveryStatus() + relayMint(), split out of gateway.ts
bridge/gatewayDeposit.ts planDeposit() → DepositPlan, runDeposit() → outcome
stores/pendingClaimStore persisted attestations, retryable
(app)/gateway/index.tsx  two pots · unclaimed sends · where it sits · activity
(app)/gateway/deposit.tsx source · amount · what happens · hold to deposit
hub: CHAINS_BY_ENV       mainnet + testnet tables, env-aware minter
hub: /gateway/domains    now publishes the relayer address and per-chain funding
```

### The ordering that is the safety property

`gatewaySend` is preflight → burn → relay, and the claim is persisted **between**
the burn and the relay:

1. `deliveryStatus` — nothing has moved, so a refusal is free. **Fails closed:**
   an unreachable hub, a missing key, an unserved domain or an unfunded relayer
   all refuse. A send that cannot happen is a disabled button; a burn that cannot
   be delivered is someone's money.
2. Burn. Circle debits the balance and returns the attestation.
3. Persist the claim, then relay. A crash, a force-quit or a dead relayer all
   leave the same recoverable state, surfaced on the Gateway page with a Retry.

`runDeposit` needs no equivalent: its worst failure leaves USDC in the user's own
address on a chain the wallet already displays.

## What is deliberately not built

**Cross-chain deposit on mainnet.** Holding ETH on Ethereum and wanting USDC in
Gateway needs Flashnet, which is mainnet-only and asynchronous — its orders
outlive the screen. `planDeposit` says "no route" rather than inventing one. The
adapter seam is the `swap` branch of `DepositPlan`.

So the deposit matrix today:

| | USDC already held | Token → USDC |
|---|---|---|
| **testnet** | any of 4 Circle chains | EURC on Arc, via Uniswap V2 |
| **mainnet** | any of 6 Circle chains | not yet — needs the Flashnet adapter |

## Still open

- The hub's relay budget is a **global** daily cap; per-depositor limits need
  Circle's attestation layout confirmed against a real payload.
- The deployed hub predates `/gateway/domains` reporting funding.
  `deliveryStatus` treats a missing `ready` as `unverified` and allows the send —
  the bar the app applied unconditionally before — so this needs a redeploy to
  become a real gate.
- `indexProxy.ts:73` turns an upstream error into `{data: []}`, so the app cannot
  tell "no tokens" from "The Graph rejected our JWT".
- No deposit or send has been run end to end on a device against real balances.
