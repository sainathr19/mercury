# Building on Arc — field notes

Findings from building a payments wallet on Arc testnet (chain `5042002`).
Everything below was **observed directly** against the live chain, with the
command or measurement that produced it. Where we only read something in docs
and did not confirm it, we say so.

Written because these cost us real time and none of them are written down
anywhere we could find.

---

## 1. USDC is the native coin *and* an ERC-20 — at two different scales

Arc has no separate gas token: the native coin **is** USDC. What is easy to miss
is that the same balance is visible two ways, at two different decimal scales:

| Access path | Address | Decimals |
|---|---|---|
| `eth_getBalance` (native) | — | **18** |
| `balanceOf` (ERC-20) | `0x3600000000000000000000000000000000000000` | **6** |

They are the same money. A deposit that arrives as an ERC-20 transfer also
raises the native balance, and paying gas lowers the ERC-20 balance.

**Why it bites.** A wallet that reads the native balance at 18dp and the token
balance at 6dp will happily show the user two USDC rows for one pot of money.
Worse, if you sweep "all your USDC" as an ERC-20 you have also spent your gas.

Verified: `eth_getBalance` returned `10.191319965` while
`balanceOf(0x3600…)` returned `10.191319` for the same address at the same
block.

## 2. Two `Transfer` emitters, and the native one is a superset

Arc emits ERC-20-shaped `Transfer` logs from **two** addresses:

| How the money moved | Emitter | Scale |
|---|---|---|
| ERC-20 `transfer()` | `0x3600…0000` **and** `0xffff…fffe` | 6dp / 18dp |
| Plain native value send | `0xffff…fffe` only | 18dp |

We built a subgraph against the ERC-20 contract first and lost every plain
native send. The obvious correction — index both — **double-counts**, because an
ERC-20 transfer emits from both.

**Index the native emitter `0xffffffffffffffffffffffffffffffffffffffffe` alone,
convert 18dp → 6dp.** It is a strict superset. We only found this by sending one
of each and counting the logs; we had assumed the opposite and shipped a
double-counting subgraph first.

## 3. `UniswapV2Router02.WETH()` points at an address with no code

On the deployment we used (`0xe27d…a6d9`):

```
router.factory() -> 0x7483847d46db2920dd64efa676cf72dcf765814f   (has code)
router.WETH()    -> 0x6be2c68117ca58086bd6a14e525835584d7f721e   (NO CODE)
```

So every ETH-path helper — `swapExactETHForTokens`, `swapExactTokensForETH`,
`addLiquidityETH` — reverts. This is arguably correct for Arc, which has no ETH,
but the router still advertises the function and a generic integration will call
it and fail with nothing useful in the revert.

**Use `swapExactTokensForTokens` exclusively.** Since USDC is an ordinary ERC-20
here, there is nothing you actually need the ETH path for.

## 4. Gas is cheap enough to stop designing around

Measured `eth_gasPrice`: **21.2 gwei**, denominated in USDC at 18dp.

| Operation | Gas | Cost |
|---|---|---|
| Plain transfer | 21,000 | 0.00045 USDC |
| ERC-20 `approve` | ~60,000 | 0.00127 USDC |
| Gateway `deposit` | ~150,000 | 0.00318 USDC |
| Uniswap approve + swap | ~330,000 | ~0.007 USDC |

This is what makes exact-amount approvals practical. We approve precisely the
amount being spent rather than the customary unlimited allowance, and it costs
about a tenth of a cent — a trade we would not make on a chain where the approve
cost real money.

`eth_estimateGas` + 25% headroom worked reliably for us across approvals,
Gateway deposits and Uniswap swaps. (Some earlier notes we were given warned it
was unreliable for pool-creation-class operations; we did not create pools, so
we cannot confirm or deny that.)

## 5. Keep a gas reserve, or strand yourself

Because gas *is* the asset, a wallet that moves its entire USDC balance
somewhere — into a Gateway deposit, a swap, a payment — leaves itself unable to
pay for the transaction that would get it back. There is no second token to fall
back on.

We reserve **0.25 USDC**, roughly fifty transactions' worth. Any wallet that
sweeps balances on Arc needs an equivalent, and it has to be enforced at the
point of sweeping, not by asking the user to remember.

---

## Circle Gateway

## 6. The API and the contract lag in opposite directions

This one produced a visible bug for us: the wallet displayed **$7.78 over
$18.72 of real money**.

| Source | Sees a fresh deposit | Sees an attested-but-unsettled burn |
|---|---|---|
| `POST /v1/balances` | **No** — lags | **Yes** — deducted immediately |
| `GatewayWallet.totalBalance()` | **Yes** — the block it mines | **No** — still counted |

Neither is "the balance". Measured simultaneously right after a deposit and a
send: the contract reported `18.477319` while the API reported `15.473819`, and
both were correct about different things.

**What worked:** the contract answers *what do I own*, the API answers *what can
I spend*, and burns your own client has issued are discounted locally until the
contract catches up.

## 7. `burnIntentExpirationHeight` from `/v1/info` is already stale

The value `GET /v1/info` returns is the *current* height, and Arc has moved past
it by the time you have built and signed the intent. The API then rejects the
burn as too low — by roughly one block. Add a buffer; we use 1000.

## 8. The transfer fee is not knowable up front, but the rejection tells you

`maxFee` has to be in the signed intent, and Circle rejects anything under its
quote with a message naming the number:
`"... expected at least 0.0035, got 0.000001"`.

We submit once with a deliberately low fee to *learn* the quote, then re-sign at
that price. One extra round trip (~280ms) buys an exact fee instead of a guess.
Observed as a flat **0.0035 USDC** across 0.1, 1 and 2 USDC transfers.

## 9. A burn intent names a source domain, and that domain must hold the money

"Unified balance" is about spending, not about signing. We wrote a send screen
that treated the source as irrelevant and it failed every time the destination
chain was not the one holding funds:

```
Insufficient balance for depositor 0x00c2…f5f1: available 0, required 1.26
```

Source domains must be chosen from where the balance actually sits, splitting
across several when no single one covers the amount. The `/v1/transfer` endpoint
takes an array of signed intents for exactly this.

**Measured end to end:** Arc → Base Sepolia, attestation in ~1.1s, relayer mint
in ~2.9s, recipient a fresh address that had never held gas.

---

## The Graph

## 10. Arc cannot be published to the decentralized network

`arc-testnet` (`eip155:5042002`) is **Studio-only**, support level *basic*, with
`issuanceRewards: false`. Substreams: none. Token API: does not index Arc.

Practically: you can build and query a subgraph, but you cannot publish it, and
anything you want from the Token API (balances, transfers) has to come from your
own subgraph on Arc instead.

## 11. Token API: `limit > 10` returns zero rows, not ten

On the free tier, a limit above 10 does not clamp — it returns an **empty**
result set. An activity feed that asks for 25 renders as "no transactions"
rather than erroring, which is the worst possible failure mode. Page at 10.

Also: the `server_`-prefixed key authenticates with `X-Api-Key`, **not**
`Authorization: Bearer`, contrary to the docs we were following. The JWT does
use `Bearer`.

---

## What we would ask for

1. **Document the dual `Transfer` emitter.** It is the single highest-risk thing
   for anyone indexing Arc, and getting it wrong produces plausible-looking but
   wrong numbers rather than an error.
2. **Publish the ERC-20/native decimal duality prominently.** 18dp native over a
   6dp ERC-20 view of the same balance is unusual and easy to get half-right.
3. **Either wire up `router.WETH()` or remove the ETH paths** from the deployed
   router, so integrations fail loudly instead of at execution time.
4. **A "pending deposit" field on the Gateway balances API.** The information
   exists on-chain the moment the deposit mines; every integrator otherwise has
   to reconcile two sources to avoid showing users less money than they have.
