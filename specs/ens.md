# ENS — implementation plan (all chains)

Status: **Phase 0 built** (resolve any `.eth` name in the send field). Name chosen: **`mercurywallet.eth`** — not yet registered. Facts checked on-chain 2026-09-06. Anything I
did not verify is marked as such.

---

## The idea in one line

**One name holds every address you have. The wallet then picks how to pay it.**

Resolution and payment are two separate jobs, and keeping them separate is what
makes this work across chains.

---

## 1. The blocker, first

`mercury.eth` is **taken** — mainnet (owner `0x464305cb…461a`) and Sepolia
(`0x366e45e6…8391`). Free on mainnet right now: `mercurywallet.eth`,
`usemercury.eth`, `mercurypay.eth`, `getmercury.eth`, `paywithmercury.eth`.

Pick one and register it on **both** mainnet and Sepolia — they are separate
registries and the demo runs on testnet. ~$5/year plus L1 gas. This is a call
only you can make, and it blocks the subname phases (not Phase 0).

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

**Phase 0 — resolve any `.eth` name. DONE.** `src/bridge/ens.ts`, wired into the
send address field. `src/bridge/ens.ts` with a timeout and cache; wire into the send field and
`parsePayment`. Removes hex from the main flow immediately.

**Phase 1 — register the 2LD** on mainnet + Sepolia. Blocked on you.

**Phase 2 — issue subnames.** Offchain resolver on L1 + a CCIP-Read endpoint in
`hub/`. Name claimed at signup. Publish `addr(60)`, `addr(501)`, `addr(0)` and
the Arc preference together.

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
