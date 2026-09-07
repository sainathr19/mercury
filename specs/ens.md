# ENS — implementation plan

Status: **plan, nothing built.** Facts below were checked on-chain on 2026-09-06;
anything unverified is marked as such.

---

## 1. The blocker, first

`mercury.eth` is **taken** — on Ethereum mainnet (owner `0x464305cb…461a`) and
on Sepolia (`0x366e45e6…8391`). The plan's `you.mercury.eth` is not available.

Checked and free on mainnet:

| Name | |
|---|---|
| `mercurywallet.eth` | available |
| `usemercury.eth` | available |
| `mercurypay.eth` | available |
| `getmercury.eth` | available |
| `paywithmercury.eth` | available |
| `mercuryapp.eth` | taken |

**This is a decision only you can make**, and it blocks phases 1–3. Registration
is a normal ENS commit/reveal on L1: ~$5/year for a 9+ character name, plus L1
gas. Register on **both** mainnet and Sepolia — the demo runs on testnet and
Sepolia ENS is a separate registry with separate ownership.

---

## 2. What ENS is actually for here

Two directions, and they are different jobs:

- **Forward** (`name → address`): the send field, payment requests, QR codes.
- **Reverse** (`address → name`): activity rows read "Paid sainath" instead of
  "To 0xF7Bc03…ca48e2".

Forward is most of the value and is far easier. Reverse is the awkward half —
see §6.

---

## 3. The simplification that makes this easy for us

Mercury derives **one** secp256k1 key, so the user has the **same `0x` address on
every EVM chain** — Arc, Base, Arbitrum, Sepolia. We are not a multi-address
wallet.

That means the hard part of "cross-chain ENS" — different addresses per chain —
**does not apply to us.** A single `addr()` record is correct everywhere.

So the division of labour is:

> **ENS answers *who*. Gateway answers *where*. The payer never picks a chain.**

That sentence is the whole cross-chain story, and it is only true because the
unified balance already removed the network question. A wallet without Gateway
would have to make the user choose a chain after resolving the name; we don't.

---

## 4. Where per-chain records still earn their place

ENSIP-11 encodes an EVM chain as `coinType = 0x80000000 + chainId`. Verified
arithmetic:

| Chain | chainId | coinType | hex |
|---|---|---|---|
| Ethereum | 1 | 2147483649 | `0x80000001` |
| Base | 8453 | 2147492101 | `0x80002105` |
| Arc mainnet | 5042 | **2147488690** | `0x800013b2` |
| Arc testnet | 5042002 | **2152525650** | `0x804cef52` |

We use these as a **routing preference, not a different address**:

- Paying a **Mercury** user: ignore them. Their balance is unified; deliver
  anywhere.
- Paying **anyone else**: this is how we learn which chain they actually watch.
  Someone with only an Arc record should not be paid on Base, where the funds
  would sit unseen.

Also worth one text record: `mercury.stealth` holding the ERC-5564 meta-address,
so the private-payment path has somewhere to publish to that isn't a hub we run.

---

## 5. Where the names live

Three options, and the choice is a time/credibility trade:

**A. Offchain subnames (CCIP-Read).** Own the 2LD on L1, point it at a wildcard
resolver (ENSIP-10) that reverts with `OffchainLookup` (EIP-3668); our gateway
answers with a signed response. Names are free, instant, and no user ever pays
gas. This is how `cb.id`, `uni.eth` and `base.eth` subnames work.

**B. On-chain subnames on L1.** Correct and simple; costs gas per signup. A
payments wallet that charges you to have a name is a non-starter.

**C. L2 registry + L1 CCIP-Read resolver.** More "real" than A — the registry is
a contract, not our database — but it is meaningfully more to build and to run.

**Recommendation: A now, C as the follow-up.** A is buildable inside the deadline
and is indistinguishable from C to a user or a judge; the difference is where
trust sits, which is worth being explicit about rather than hiding.

> Note: `PLAN.md` says "ENSv2 subregistry". I have **not** verified the state of
> ENSv2/Namechain, and nothing in this plan depends on it. Treat that line as
> aspirational until someone checks.

---

## 6. Reverse resolution, honestly

Reverse records (`<addr>.addr.reverse`) live on L1 and are set **per address, by
that address**. For offchain subnames this is the weak spot: our users cannot
cheaply claim an L1 reverse record, so a generic ENS client will not show their
name.

Two mitigations, in order:

1. **Inside Mercury**, we already know the names we issued — the gateway can
   answer `address → name` directly, so our own activity rows show names with no
   L1 involvement. This covers the demo and the product.
2. **Outside Mercury**, accept that third-party clients see hex until the user
   claims a reverse record themselves. Say so; do not imply otherwise.

Do not claim "reverse resolution works" without qualifying it to our own app.

---

## 7. Cross-chain mechanics, precisely

- **ENS is an L1 protocol. Arc has no ENS registry.** Resolution is a read on
  Ethereum (or Sepolia); payment is a write on Arc. They are different chains and
  never need to be atomic — resolve first, then pay.
- In **testnet mode** the app resolves against **Sepolia ENS** and pays on **Arc
  testnet**. That is cross-chain by construction and is exactly the demo.
- **CCIP-Read must run in JS.** Following an `OffchainLookup` revert is a client
  behaviour; `viem` implements it, the Rust core does not. Resolution therefore
  belongs in `src/bridge/ens.ts`, not in the core.
- Resolution is a network call on a chain we otherwise never touch: **cache it,
  time it out, and never block the send flow on it.**

---

## 8. Build order

**Phase 0 — resolve any `.eth` name (≈1 hour, no infra, no name needed).**
`src/bridge/ens.ts`: `resolveEns(name)` → address, against mainnet/Sepolia by
environment, with a timeout and an in-memory cache. Wire into the send address
field beside the existing `@username` path, and into `parsePayment` so a QR or
link can carry a name. **This alone removes hex from the send flow and works with
names people already own** — the cheapest large win here, and it is not blocked
on §1.

**Phase 1 — pick and register the 2LD** (mainnet + Sepolia). Blocked on you.

**Phase 2 — issue subnames.** OffchainResolver on L1 + a CCIP-Read endpoint in
`hub/`, which already exists as a service. Name claimed during onboarding,
written to our store, signed on request.

**Phase 3 — records.** `addr(node, 60)` for the default, ENSIP-11 coinTypes for
Arc and Base as routing preferences, `mercury.stealth` text record.

**Phase 4 — display.** Names in activity rows and the request screen via our own
reverse lookup, hex as the fallback.

Phase 0 is worth doing regardless of what you decide about the name.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Chosen 2LD gets squatted after we announce | Register before publishing anything |
| L1 RPC slow or down | Cache, 3s timeout, fall back to raw address entry |
| Rust core cannot follow CCIP-Read | Resolution stays in JS |
| Sepolia ENS ≠ mainnet ENS | Register both; treat as separate registries |
| Offchain names invisible to other wallets | State the limit plainly; do not claim full ENS interop |
| A name resolving to the wrong address loses funds | Show the resolved address in the review step, always |
