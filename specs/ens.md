# ENS — implementation plan (all chains)

Status: **Phases 0–2 built, on-chain.** Resolve any `.eth` name in the send
field, and issue subnames under **`mercurywallet.eth`** (registered on Sepolia,
ENSv2). Remaining: deploy the registry and point the name at it — see
`contracts/DEPLOY.md`.
Decision: **v2 only, Sepolia as the testnet**, matching Arc.
Facts checked on-chain 2026-09-07. Anything I did not verify is marked as such.

---

## The idea in one line

**One name holds every address you have. The wallet then picks how to pay it.**

Resolution and payment are two separate jobs, and keeping them separate is what
makes this work across chains.

---

## 1. ENSv2, and what it changed

Sepolia has moved to **ENSv2 beta**. Verified on-chain: the v1
`ETHRegistrarController` has **no code** on Sepolia, so v1 registration there is
dead. Mainnet is still v1 and prices normally.

We build on **v2 only**, with Sepolia as the testnet — the same shape as Arc.

Everything now goes through one entry point:

| Contract | Address | |
|---|---|---|
| **UpgradableUniversalResolverProxy** | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | same on mainnet AND Sepolia |
| ETHRegistrar (v2) | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` | Sepolia |
| ETHRegistry (v2) | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` | Sepolia |
| PublicResolverV2 | `0xe7b9a25607e02da8145e4eb1836ca539e53f11f7` | Sepolia |
| MockUSDC | `0x768f42455a2d082e23ceef7d51e5787c82d67a39` | Sepolia registration fee token |

The Universal Resolver walks the registry hierarchy itself, serves ENSv1 names
through a mirror resolver, and is where CCIP-Read offchain names arrive. One
call replaces the old registry→resolver→addr walk. Because the proxy address is
identical on both networks, it needs no per-environment configuration.

Verified live: `resolve("nick.eth", addr(node))` through the proxy on Sepolia
returns `0xb8c2c29e…67d5` in a single plain `eth_call` — no CCIP-Read hop needed
for on-registry names.

### The name

`mercury.eth` is **taken** (mainnet `0x464305cb…461a`, Sepolia `0x366e45e6…8391`).
Free on mainnet: `mercurywallet.eth`, `usemercury.eth`, `mercurypay.eth`,
`getmercury.eth`, `paywithmercury.eth`.

**Cost, measured:**

| | |
|---|---|
| Sepolia (v2) | free — the fee is paid in **MockUSDC**, whose mint has no access control |
| Mainnet, 1 year | **0.00201 ETH** (0.001996 fee + ~0.00001 gas at 0.04 gwei) |
| Mainnet, 3 years | 0.00600 ETH |

Registering is a purchase and is yours to execute. Sepolia costs nothing but
test ETH for gas.

---

## 2. What one name holds

ENS records are **not** Ethereum-only. The lookup is `addr(node, coinType)` and
it returns **raw bytes**, so it can hold any chain's address format.

| Record | Holds | Covers |
|---|---|---|
| `addr(node, 60)` | your `0x…` | **every** EVM chain — Arc, Base, Arbitrum, Sepolia |
| `addr(node, 501)` | your Solana address | Solana (SLIP-44 = 501) |
| `addr(node, 0)` | your Bitcoin address | Bitcoin |
| `addr(node, 2147488690)` | `0x…` again | "prefer Arc" — a routing hint, not a different address |
| `addr(node, 2147492101)` | `0x…` again | "prefer Base" |
| text `mercury.stealth` | ERC-5564 meta-address | private payments, later |

Mercury already derives all three address families (`btc`, `eth`, `sol`), so we
publish all three under one name at signup.

**Why the EVM side is easy:** one key gives the *same* `0x` address on every EVM
chain, so a single record covers all of them. Solana and Bitcoin are genuinely
different keys and need their own records. That is the whole difference.

---

## 3. What happens when you pay a name

Resolve once, then decide. The decision is ours, not ENS's:

```
name → { evm: 0x…, solana: …, bitcoin: …, prefers: Arc }

  has EVM address?        → pay via Gateway on their preferred chain
                            ~4s, they need no gas          [BUILT]
  Solana only?            → needs USDC on Solana:
                              • direct SPL send if we hold it   [BUILT]
                              • CCTP V2 from Cash (domain 5)    [NOT BUILT]
  Bitcoin only?           → cannot be paid in USDC. Ever.       [IMPOSSIBLE]
```

That table is the honest scope. Resolution is universal; **delivery is not.**

---

## 4. What we CAN implement

| | Effort | Notes |
|---|---|---|
| Resolve any `.eth` name in the send field | ~1 hour | No name, no contract, no gateway needed. Works with names people already own. |
| Publish all address records under our own name | small | Once the 2LD is registered |
| Free instant subnames (`you.<name>.eth`) | ~1 day | Offchain via CCIP-Read, how `cb.id` and `base.eth` do it |
| Names shown in our own activity + requests | small | We know the names we issued |
| Per-chain routing preference | small | ENSIP-11 records |
| **Pay a Solana address from Cash** | ~1–2 days | Needs CCTP V2 (Solana = domain 5). Gateway does not reach Solana; CCTP does. |
| Gasless receive on Solana | medium | Solana has a native fee-payer, so a relayer works there too |

Everything above is a matter of time, not possibility.

---

## 5. What we LITERALLY CANNOT implement

These are protocol facts. No amount of work changes them.

**1. USDC cannot be sent to a Bitcoin address.**
USDC does not exist on Bitcoin. If someone's only record is Bitcoin, we can send
them BTC — never dollars. "Pay anyone in USDC by name" therefore excludes
Bitcoin-only recipients, and saying otherwise would be false.

**2. Other wallets cannot reverse-resolve our users without an L1 transaction
from that user.**
A reverse record lives at `<address>.addr.reverse` on Ethereum L1 and can only be
set by that address. Our users have no ETH on L1. Inside Mercury we show names
because we issued them; in MetaMask or Etherscan they will show hex until the
user pays L1 gas themselves. This is how ENS reverse works, not something we
skipped.

**3. ENS cannot prove a record is true.**
ENS proves who owns the *name*. It says nothing about whether the Solana or
Bitcoin address inside is really theirs — anyone can publish anything. So the
review screen must always show the resolved address before sending. A name is a
convenience, never a guarantee.

**4. ENS cannot be resolved on Arc.**
ENS lives on Ethereum. Arc has no registry and we cannot put the real one there.
Resolution is always an L1 read. In practice this is fine — read on Ethereum,
pay on Arc, no atomicity needed — but it does mean name lookup depends on an L1
RPC being reachable.

**5. A name cannot tell you which chain someone actually watches** beyond what
they chose to publish. If a recipient publishes no preference, we are guessing.
ENSIP-11 records mitigate this only when the recipient sets them.

---

## 6. Build order

**Phase 0 — resolve any `.eth` name. DONE.** `src/bridge/ens.ts`, through the v2
Universal Resolver, wired into the send address field with a cache, a timeout
and endpoint fallback. The hand-rolled `resolve(bytes,bytes)` calldata is
unit-tested against viem byte for byte — a wrong selector does not error, it
hits a fallback and fails opaquely, which is exactly what happened once.

**Phase 1 — register `mercurywallet.eth` on Sepolia (v2). DONE.** Owned by
`0x6BA9A2Ab805ca80BEBf6D51daC85016641aCeD87`, expires Sep 2027.

**Phase 2 — issue subnames. BUILT, fully on-chain.**

Records live in `contracts/MercuryNameRegistry.sol`, which is the resolver on
`mercurywallet.eth` and the storage for every name beneath it. No server, no
signing key, nothing of ours that has to stay running: once a name is
registered it resolves in any wallet forever.

| | |
|---|---|
| `contracts/MercuryNameRegistry.sol` | ENSIP-10 wildcard resolver + registry. One deploy, no constructor args, no subregistry needed. |
| `app/src/bridge/mercuryName.ts` | Availability read, `register` calldata, claim flow. |
| `app/src/stores/mercuryNameStore.ts` | Replaces the Standard handle. |
| `hub/scripts/verify-ens.ts` | Post-deploy check through a standard ENS client. |

**The trade that was made.** An earlier offchain build (EIP-3668 + a signing
gateway) gave names away free, and it worked end to end — but it put an HTTP
service on the critical path of every lookup, permanently. If the gateway went
down, every name went with it. On-chain costs one transaction per name and then
depends on nothing. The CCIP-Read *client* was kept: it is how Mercury resolves
other people's offchain names, like `jesse.base.eth`.

**Measured on a real EVM**, not estimated: deploy 1,749,596 gas; register 80,919
gas for an EVM-only name, 211,125 with Solana and Bitcoin too.

**What was verified.** The contract was deployed to a local chain and driven
through registration, duplicate and reserved labels, all seven malformed-label
cases, sponsored registration, every record type (`addr`, `addr(60)`,
`addr(Arc)`, `addr(Base)`, `addr(501)`, `addr(0)`, `text`), unregistered and
over-deep names, apex resolution, and the ownership rules. The app's
hand-rolled `register` calldata was then used to register a name on that real
contract — a wrong ABI offset does not revert, it registers a name nobody asked
for.

Also verified on Sepolia beforehand: ENSv2's Universal Resolver descends to the
parent's resolver for subnames despite `mercurywallet.eth` having no
subregistry, which is what makes the whole design possible without deploying a
registry per name.

**Sponsorship — the user needs no gas.** Registering is an Ethereum transaction,
which is the one place the wallet's "never hold gas" promise runs out of road.
So `hub/src/sponsor.ts` pays it. The app tries the sponsor first and only falls
back to the user's own ETH if it declines; the name belongs to the user either
way, because `register` takes the owner as a parameter and the sponsor passes
the address it VERIFIED, never one from the request body.

This endpoint could not be left open the way `/gateway/relay` is. That one is
safe for anyone to call because Circle signs the attestation and names the
recipient inside it — the relayer's only power is whether to submit. Here we are
choosing what to write into a name registry, and a name is a payment
instruction, so the caller's signature carries the whole weight: it covers the
label and every address published under it, the registration is made out to the
recovered signer, we only sponsor names pointing at that signer's own address,
and there is a per-wallet and per-day ceiling because gas is real money.

Verified against a local chain at Sepolia's chain id, with a user wallet holding
**exactly zero ETH**: the name registered, resolved to the user, was owned by
the user, and the wallet's balance never moved. Then every abuse path — a forged
body signed by someone else, a signature over different text, an expired nonce,
a reserved label, a taken name, a second name for one wallet, a malformed label
— each rejected, the taken one without spending gas.

**Not built: reverse records.** Other wallets still show hex for our users. See
§5.2 — a protocol limit, not a gap.

**Phase 3 — routing.** Use the records to choose the rail per §3, including the
"they can only take Solana" and "Bitcoin only — cannot pay in USDC" branches,
each with an honest message rather than a silent failure.

**Phase 4 — CCTP to Solana**, if you want Cash → Solana. This is the only piece
that makes "pay any chain from one balance" literally true.

---

## 7. What to claim in the submission

True: **"One name, one balance, four EVM networks — and the recipient never
needs gas."**

Not true yet: "pay anyone on any chain." Solana needs CCTP; Bitcoin cannot take
USDC at all. Claiming universal coverage is the kind of thing a judge checks.
