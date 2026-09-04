# Mercury — Build Plan

**The wallet for everyday money.**
Build window: **Sept 4–16, 2026**. Written Sept 4 (day 1).

---

## 0. The one-liner

> Send USDC to a name. No addresses, no gas token, no bridging — your money
> works wherever it already is.

Everything below exists to make that sentence literally true on stage.

Payments are **public by default, private on request** — a per-payment
"send privately" toggle backed by ERC-5564 stealth addresses (§3.9). Read
§3.10 before describing the privacy anywhere: it hides *who received*, and
nothing else. Overclaiming it is the fastest way to lose the trust of anyone
who knows the standard.

---

## 1. Scope decisions, and why

Mercury is one rail and one asset: USDC on Arc. Three things drove that:

1. **One rail, not five.** Supporting Bitcoin, Lightning, Solana and Hedera
   alongside Arc would mean four separate signing stacks, four balance readers,
   four explorers and four ways for a live demo to fail — for a product whose
   value was never chain coverage. Every hour spent keeping those alive is an
   hour not spent on the things a user actually notices.
2. **Arc removes the gas token entirely.** Every other chain makes a payments
   wallet explain a second asset: you have USDC but you can't move it, go buy
   some ETH first. On Arc the gas token **is** USDC, so a user who receives a
   payment can spend it — and only ever holds one thing. That is the single
   biggest UX cliff in crypto payments and Arc deletes it.

   The same property is what makes stealth addresses *work* here. A stealth
   address elsewhere is an address with no gas, so the recipient must top it
   up from an address that deanonymises them — which defeats the point. On
   Arc the note pays its own way out. Arc is the first chain where ERC-5564
   closes end to end.
3. **Breadth is a losing fight.** Rainbow and MetaMask will list Arc within a
   week of mainnet. A five-rail wallet built in 12 days loses that comparison
   and has no differentiation left over. Competing on *how payments feel* — a
   name instead of an address, one asset instead of two, money that follows
   you across chains — is a comparison they aren't set up to win.

**"Not multichain" is answered by liquidity, not rails.** Users fund from
Base / Arbitrum / OP / Ethereum / Solana via CCTP V2 or Circle Gateway and
spend on Arc. From the user's seat that is multichain. From ours it is one
rail to keep alive on demo day.

---

## 2. Verified technical facts

Checked on day 1 against primary sources. Do not re-litigate these; do
re-check anything marked ⚠️.

### Arc

| | |
|---|---|
| Testnet chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` (also `arc-testnet.drpc.org`) |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| Native gas token | **USDC**, 18 decimals natively |
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| Mainnet | **Sept 16, 2026** — the last day of the event ⚠️ |

**Arc EVM quirks — these will cost you an afternoon if they surprise you:**
- `eth_estimateGas` returns unreliable values. **Override gas explicitly on
  every transaction.**
- `waitForTransactionReceipt` **does not throw on revert.** You must check
  `receipt.status` yourself or failures pass silently.
- `createPair`-class operations want ~5M gas, not ~500k.

### CCTP V2 / Circle Gateway

| | |
|---|---|
| Arc CCTP domain | `26` (V2 only; the V1 selector is incompatible) |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| Arc `minFinalityThreshold` | **2000** (finalized). 1000 leaves the Iris attestation pending forever. |
| Gateway testnet chains | Arc, Ethereum, Base, Arbitrum, OP, Polygon, Avalanche, Unichain, World Chain, Sei, Sonic, HyperEVM |
| CCTP adds | Solana (domain 5) |

⚠️ Gateway on Arc is **testnet-only** today. Build **CCTP V2 as the primary
path** and treat Gateway as the fast-path demo, or mainnet-readiness slips.

### The Graph

| Network | Subgraphs | Substreams | Token API |
|---|---|---|---|
| `arc-testnet` (`eip155:5042002`) | ✅ Studio only, support level **basic**, `issuanceRewards: false` → **cannot publish to the decentralized network** | ❌ none | ❌ none |
| `arc` (`eip155:5042`) | ✅ Studio, basic | ❌ | ❌ |
| `base`, `mainnet` | ✅ full, decentralized | ✅ full | ✅ `api.pinax.network` |

Deploy endpoint for all of them: `https://api.studio.thegraph.com/deploy`.

**Consequence:** a single subgraph cannot cover our whole surface from Arc
alone. Deploy **one schema to Arc + Base + Ethereum** and pull the **Token
API on the non-Arc chains** for portfolio data.

### Stealth (ERC-5564 / ERC-6538) — verified live on Arc testnet

**Both singletons are already deployed at their canonical addresses.** Nothing
to write, nothing to deploy.

| Contract | Address | Verified |
|---|---|---|
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | has code; `announce` selector `0x4d1f9583`; `Announcement` topic `0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7` |
| ERC-6538 Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` | has code; EIP-712 domain carries chainId `0x4cef52` (5042002) — a deliberate Arc deployment |

**The gas property is stronger than it looks.** The ERC-20 USDC at
`0x3600…0000` is a **view over the native balance**, not a separate wrapped
token. Checked against a live account:

```
eth_getBalance          65039980573344807780  /1e18 = 65.039981
USDC.balanceOf(same)              65039980    /1e6  = 65.039980
```

Same money, two interfaces. **There is therefore no way for USDC to arrive at
a stealth address in a non-gas-payable form** — native transfer or ERC-20
transfer, the recipient can always pay their own gas. This is the whole
argument for doing stealth on Arc rather than anywhere else.

⚠️ **Decimals footgun:** native USDC is 18dp, the ERC-20 view is 6dp. Convert
at exactly one boundary in the codebase and never anywhere else.

⚠️ **`Transfer` comes from two different emitters, at two different scales.**
Verified on testnet:

| How the money moved | Emitter | Amount scale |
|---|---|---|
| ERC-20 `transfer()` | `0x3600…0000` | **6dp** |
| Native value send | `0xfffffffffffffffffffffffffffffffffffffffe` | **18dp** |

An indexer watching only the USDC contract **silently misses every native
send** — faucet drips, external wallets, anything not routed through the ERC-20
interface. It does not error; the money simply never appears. Index both, and
have Mercury always pay via `transfer()` so our own payments are uniform.
Details in [specs/subgraph.md](specs/subgraph.md).

### ENS

ENSv2 is **L1-only, Sepolia today**. The cross-chain worry is a non-issue:
ENSIP-11 gives every EVM chain a coinType, and records are chain-agnostic
bytes. No CCIP-Read needed.

```
coinType = 0x80000000 | chainId      (chainId must be < 2^31)

Arc testnet  5042002 → 2152525650   (0x804CEF52)
Arc mainnet  5042    → 2147488690   (0x800013B2)
Base         8453    → 2147492101   (0x80002105)
Ethereum             → 60
```

The resolver supports multicoin `addr(node, coinType)` **and** arbitrary text
records. viem ≥2.35.0 / ENSjs ≥4.2.3 **read** ENSv2 fine.
⚠️ **Write support in libraries is preview-only** — registering, deploying a
subregistry and setting records means hand-rolled ABI calls. Registration is
commit-reveal and priced in **stablecoins (USDC/DAI)**, not ETH.

### Uniswap on Arc

Uniswap V2 is deployed on Arc testnet (community deployment):

| Contract | Address |
|---|---|
| UniswapV2Factory | `0x7483847d46db2920dd64efa676cf72dcf765814f` |
| UniswapV2Router02 | `0xe27d5d256b370604f1ff060fb489c6a8e3f8a6d9` |
| WETH9 | `0x6be2c68117ca58086bd6a14e525835584d7f721e` |
| USDC/EURC pair | `0xb3685D16AAa06361ED28377b1319136650Fa9A13` |

UniswapX reactors landed June 2026. **Uniswap v4 comes to Arc mainnet in
September** — re-check on the 16th.

⚠️ **The pool is thin and mispriced.** Checked on day 1:

```
token0 = USDC (0x3600…)   reserve0 = 445.95      implied 2.62 USDC/EURC
token1 = EURC (0x89B5…)   reserve1 = 170.16      real    ~1.08
```

A $20 swap is 4.5% of the pool and the price is ~2.4x off market — a live
demo swap against this would show catastrophic slippage. **Seed the pool from
the faucet (or deploy our own pair) as the first task on day 7**, not as a
surprise during the rehearsal. Note `createPair` wants ~5M gas here.

⚠️ This V2 is a **community** deployment, not an official Uniswap one. Prefer
**v4 on Arc mainnet** if it lands in time.

---

## 3. Product — the feature set

`[must]` no demo without it · `[core]` the reason the product exists — has to
be *good*, not merely present · `[stretch]` cut first

### 3.1 Identity — ENSv2
- `you.mercury.eth` issued at signup from **our own ENSv2 subregistry** `[core]`
- The name **is** the directory. The Permissioned Resolver holds the Arc
  address (coinType 2152525650), the Base address (2147492101), and the
  ERC-5564 **stealth meta-address** as a text record `[core]`
- Pay any `.eth` name, not just Mercury users `[must]`
- Reverse resolution — activity shows names, never hex `[must]`
- Recovery role rotates records after device loss, via Enhanced Access Control `[core]`

**There is no directory server.** This is what makes ENS central rather than
cosmetic, and it deletes the most-criticised component of the old design.

### 3.2 Payments — Arc + USDC
- Send USDC to a name; no address appears anywhere in the UI `[must]`
- **One asset, ever.** Gas is USDC, so the wallet never asks the user to
  acquire a second token `[must]` ← the pitch
- Receive: subgraph-driven, arrives in the feed within a block `[must]`
- **"Send privately" toggle** — off by default, see §3.9 `[core]`
- Payment requests + QR `[should]`
- EURC alongside USDC `[should]` — the Arc brief says "USDC **or** EURC"

### 3.3 Cross-chain liquidity — CCTP V2 / Gateway
- Fund from Base / Arbitrum / OP / Ethereum / Solana, spend on Arc `[must]`
- Unified balance across chains via Gateway `[should]`
- **Auto-top-up on send** — short on Arc, so it pulls via CCTP mid-flow `[stretch]`
  ← the best moment in the demo if it lands
- Withdraw back out to any supported chain `[should]`

### 3.4 Data + notifications — The Graph
- Balances and history from the subgraph, not RPC polling `[must]`
- **There is no RPC fallback.** The home screen, the activity feed and the
  notification trigger all render from the subgraph — across Arc, Base and
  Ethereum at once. Turn the subgraph off and the wallet has nothing to show.
  That is what "load-bearing" has to mean now that announcements are gone `[core]`
- Cross-chain USDC aggregation — one balance from three chains, which is
  precisely the job an indexer exists to do `[core]`
- **Indexes `Announcement` from the ERC-5564 singleton**, turning stealth
  scanning from a brute-force sweep into a query `[core]`
- Push notification on incoming payment `[must]`
- One schema deployed to Arc + Base + Ethereum `[core]`
- Token API for the CCTP funding chains we don't index ourselves — Arbitrum,
  OP, Polygon `[core]`

### 3.5 Swap — Uniswap
- USDC ↔ EURC and other Arc assets in-wallet `[core]`
- Swap-and-send: pay in a currency you don't hold, one confirmation `[stretch]`
- Publish our Arc EVM findings as `FEEDBACK.md` `[core]` — the quirks in §2
  cost us real time and aren't written down anywhere else

### 3.6 Agent
- NL payments: *"send sainath 20"* `[must]`
- **NL over Graph data**: *"how much did I send sainath last month?"* `[core]`
- **LLM on the read path, rules on the write path.** Payments parse with a
  deterministic grammar — an LLM that reads `20` as `200` moves real money.
  The LLM only ever answers questions about history `[must]`
- The **app's** rules parser produces an unsigned intent and the device signs
  it. The LLM is never in that path, so agent compromise cannot cost funds
  `[must]`
- The LLM key lives in the **hub**, never the app bundle — a key shipped in a
  React Native binary is extractable. This is most of why the hub exists at
  all `[must]`
- Recurring payments `[stretch]`

### 3.7 Wallet basics `[must]`
Seed generation, SecureStore, biometric gate, recovery phrase backup/restore,
QR scan, activity feed.

### 3.8 Explicitly out of scope
BTC, Lightning/Spark, Solana **sends**, Hedera. Solana returns only as a CCTP
funding source, and only if day 10 is calm.

### 3.9 Private payments — the toggle `[core]`

**Public by default, private on request.** One switch on the send screen.
Default-public keeps the Circle demo simple and uncomplicated; the toggle is
what makes the wallet different from Rainbow.

How it works (ERC-5564 scheme 1, secp256k1 + view tags):

```
SENDER                                     RECIPIENT
 r, R = r·G           ephemeral keypair
 s  = r·P_v           ECDH shared secret    s' = p_v·R       ← same secret
 P_stealth = P_s + keccak(s)·G              P_stealth' = P_s + keccak(s')·G
 addr = keccak(P_stealth)[12:]              spend key = p_s + keccak(s')
 send USDC → addr                                             ← an ordinary privkey
 announce(R, viewTag) → 0x5564…5564         subgraph query → match → spend
```

`P_s` (spend) and `P_v` (view) are the meta-address published in the user's
ENS text record. Only the holder of `p_v` can compute the shared secret, so
only they can link the address to their name. The **view tag** is one byte
that discards 255/256 of announcements after a single hash — without it,
scanning does not scale.

**Never consolidate.** Each private receipt is a one-time note, and the wallet
spends *onward* directly from it rather than sweeping to a main address. The
sweep transaction is the one that links every note back to one identity, and
on Arc we never have to create it, because the note pays its own gas. This is
the strongest form of stealth-address privacy that exists and it is not
achievable on any chain where gas is a second asset.

**Scan privately.** Fetch announcement batches and match view tags
**client-side**. Matching server-side would tell the subgraph provider exactly
which payments are yours — the one metadata leak we can actually close.

### 3.10 What the toggle does *not* hide — read before describing it

Stealth addresses hide **who received**. Claiming more than that is the
fastest way to lose the trust of anyone who knows the standard.

| Still public | Why |
|---|---|
| **The sender** | Your address is on the transaction |
| **The amount** | A plain USDC transfer on a public chain |
| **That a private payment happened, and when** | The announcement is a public event |
| **Everything, if the user consolidates** | Sweeping five notes into one wallet tells all five senders they paid the same person |
| **Correlation by amount and timing** | 47.32 out, 47.32 into a fresh address three seconds later |

Hiding sender *and* amount needs a shielded pool — commitments, nullifiers, ZK
proofs. That is not a twelve-day project, and it is the wrong thing to build
here regardless: **Arc is Circle's regulated, institution-facing chain**, and
something mixer-shaped on it would be at odds with the ecosystem we're asking
to adopt us. Stealth addressing is a receipt-privacy primitive, not a mixer,
and we should say exactly that.

---

## 4. Architecture

Per-service detail lives in [specs/](specs/) — one file each for `app/`,
`hub/`, `subgraph/` and `shared/`, including failure modes and open questions.

```
┌─────────────────── Expo app (TypeScript) ────────────────────┐
│  screens          stores           bridge/                   │
│  onboard / send   session          keys.ts   (bip32)         │
│  receive / swap   portfolio        ens.ts    (resolve+write) │
│  activity / agent activity         arc.ts    (viem, USDC gas)│
│                                    graph.ts  (subgraph reads)│
│                                    stealth.ts(ERC-5564)      │
│                                    cctp.ts   (fund from any) │
│                                    uniswap.ts                │
│           signs + broadcasts DIRECTLY to Arc ──────────►     │
└───────┬──────────────────────────────────────┬───────────────┘
        │ reads                                │ no keys, no funds
┌───────▼─────────────────┐        ┌───────────▼────────────────┐
│  The Graph              │        │  hub (Hono)                │
│  subgraph: USDC/EURC    │        │  agent  → answers only     │
│  transfers + ERC-5564   │        │  push   → notifications    │
│  Announcement, on       │        │                            │
│  Arc / Base / ETH       │        │  NO directory. ENS owns it.│
│  + Token API (remainder)│        │  NO mailbox. Chain owns it.│
└─────────────────────────┘        └────────────────────────────┘
                    ┌──────────────────────────┐
                    │  ENSv2 (Sepolia)         │
                    │  mercury.eth subregistry │
                    │  Permissioned Resolver   │
                    │  = the whole directory   │
                    └──────────────────────────┘
```

**The trust rule:** the hub can suggest and relay, only the device can sign,
and nothing the hub says is accepted without local verification. Identity now
comes from ENS, so the hub cannot lie about who a name is — an attack the old
signed-directory design could only mitigate.

**Payment lifecycle — public (default):**
1. `sainath.mercury.eth` → ENSv2 resolver → Arc address (coinType 2152525650)
2. Balance check; if short on Arc, CCTP/Gateway pulls USDC in
3. Sign + broadcast the USDC transfer straight to Arc — **explicit gas, check `receipt.status`**
4. Subgraph indexes the transfer; the hub pushes a notification to the recipient
5. Recipient's feed updates from the subgraph, and they can spend it
   immediately **without acquiring any other asset**

**Payment lifecycle — private (toggle on):** steps 1–2 unchanged, then
3. The resolver also returns the stealth **meta-address** text record
4. Device derives a one-time address and signs the transfer to it
5. `announce(R, viewTag)` to `0x5564…5564` in the same flow
6. Subgraph indexes the announcement; the recipient's device pulls the batch
   and matches **view tags locally** — the provider never learns which is theirs
7. The note is spendable onward as-is. **We never sweep**, so the transaction
   that would link every note back to one identity is never created.

---

## 5. Day-by-day — two tracks

**Two devs, two tracks.** **A = chain/infra** (contracts, subgraph, CCTP,
Uniswap, agent service). **B = app** (Expo, EAS, UI, payment flows). They
touch different files nearly all the way through, so merge conflicts stay
rare. Both converge from day 10.

Commit every day. Multiple times a day. See §7.

| Day | Date | **A — chain / infra** | **B — app** |
|---|---|---|---|
| **1** | Sep 4 | **ENSv2 write spike** — can we register, deploy a subregistry, set records with hand-rolled ABI calls? | **EAS dev build green on both phones.** Provisioning and certs eat a day if you let them — do it now, not on day 11 |
| **2** | Sep 5 | Register `mercury.eth` on Sepolia, deploy the subregistry | Wallet foundations: keys, onboarding, SecureStore, biometric gate |
| **3** | Sep 6 | `ens.ts` — resolve + write records, both directions | Home screen, real Arc balance, the shared `send()` wrapper (explicit gas, assert `receipt.status`) |
| **4** | Sep 7 | Subgraph v1: USDC/EURC transfers **+ ERC-5564 `Announcement`** | Send flow: name → amount → confirm |
| **5** | Sep 8 | Deploy subgraph to Studio; the receive path | Wire payments end to end against it |
| **6** | Sep 9 | CCTP funding: Base → Arc | Activity feed from the subgraph; push notifications wired |
| **7** | Sep 10 | **Seed the Uniswap pool first** (§2), then `uniswap.ts` | Swap UI, and write up `FEEDBACK.md` |
| **8** | Sep 11 | Agent service: NL→GraphQL over subgraph data (LLM), rules parser for payments | Agent screen; `stealth.ts` (pure, offline-testable) |
| **9** | Sep 12 | Deploy the subgraph to Base + Ethereum; Token API for the CCTP remainder | Private toggle UI, notes list, spend-onward |
| **10** | Sep 13 | ← both: private payments end to end, Arc mainnet config → | |
| **11** | Sep 14 | ← both: hardening + two-phone rehearsal → | |
| **12** | Sep 15 | ← both: demo video, README, architecture diagram → | |
| **13** | Sep 16 | ← both: **Arc mainnet deploy** — mainnet goes live today → | |

**Exit conditions that actually gate the next day:**
- **D1** — a USDC transfer lands on Arc from a script, *and* we know whether
  ENSv2 writes work. If they don't, §6 says fall back to Durin same-day.
- **D3** — fresh install → seed → name claimed → real balance on screen.
- **D5** — type a name, money arrives, the recipient's feed updates on its own.
- **D9** — everything except privacy is demo-able. **This is the checkpoint.**
- **D11** — full flow twice on two physical phones with nobody babysitting it.

**Parallelising bought the buffer back.** The single-track plan spent its only
slack day on the private toggle; two tracks put roughly two days of real slack
back into days 10–12. Do not spend it in advance — it is what absorbs the day
the EAS build breaks or Sepolia is congested.

`stealth.ts` is pure crypto with known test vectors. It depends on nothing and
blocks nothing, so it can slide to any evening.

**The day-9 checkpoint is the real decision point.** If days 1–8 are solid,
build the private toggle. If they aren't, cut it and ship the public wallet —
nothing else depends on it, so that choice stays open to the very end.

**Cut order if behind:** auto-top-up → recurring payments → swap-and-send →
**the private toggle** → Token API composability → EURC → multi-chain
subgraph → Uniswap entirely.
**Never cut:** ENSv2 identity, send-to-a-name, one-asset/no-gas-token, the subgraph.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **ENSv2 writes are preview-only in libraries** — the single biggest unknown | Day-1 spike, before anything else. Fallback: Durin/Namestone L2 subnames (still ENS, still works, forfeits the $4,500) |
| **Arc mainnet lands Sept 16** — the last day of the build window | Build mainnet-ready from day 1: chain config in one file, no testnet assumptions in logic. Switching should be an env change, not a scramble. |
| `eth_estimateGas` unreliable, reverts silent | Explicit gas everywhere; a shared `send()` wrapper that asserts `receipt.status === 'success'`. Write it on day 3, once. |
| Gateway is testnet-only on Arc | CCTP V2 is the primary path; Gateway is the fast demo |
| Graph on Arc is Studio-only, `basic` | Expected. Don't promise decentralized-network publishing in the video. |
| **The private toggle is the largest optional item** | It is the designated first cut (§5). Nothing depends on it. Decide at the day-9 checkpoint with days 1–8 in hand, not optimistically on day 4. |
| **Overclaiming privacy** — anyone who knows ERC-5564 will ask what it hides | §3.10 is the script. Say "receipt privacy, not a mixer" and name the sender/amount leaks before they do. Credibility is worth more than the claim. |
| **Scanning leaks to the subgraph provider** if view tags are matched server-side | Match client-side. Fetch the batch, filter locally — one byte per announcement, cheap. |

---

## 7. Working agreements

- **Two devs, two tracks** (§5). Track A owns `subgraph/` and `hub/` (which
  includes `hub/scripts/` for on-chain setup); track B owns `app/`. `shared/`
  is the seam — change it in a small commit of its own and say so. There is
  no `contracts/`: see [specs/README.md](specs/README.md).
- **Commit daily, several times a day.** A readable history is how the other
  track finds out what changed without asking.
- **Never force-push `main`.**
- **One conversion boundary for decimals.** Native USDC is 18dp, the ERC-20
  view is 6dp (§2). Convert in exactly one place and never anywhere else.
- **Every Arc write goes through the shared `send()` wrapper** — explicit gas,
  and assert `receipt.status`. Arc does not throw on revert (§2), so a raw
  `sendTransaction` anywhere in the codebase is a bug waiting to be silent.

---

## 8. Ship checklist

- [ ] Public repo with a readable history
- [ ] README: architecture, setup, and what actually works
- [ ] `FEEDBACK.md` — our Arc EVM findings, written up for the ecosystem
- [ ] Architecture diagram
- [ ] Demo video
- [ ] Arcscan links for the live transactions
- [ ] Deployed subgraph URLs (Arc + Base + Ethereum)
- [ ] ENSv2 Sepolia name + subregistry addresses
- [ ] Arc mainnet deployment

---

## 9. Roadmap beyond v1

v1 ships **receipt privacy**: the recipient is unlinkable, the sender and
amount are not (§3.10). The honest next steps, in order of value:

1. **Private by default**, once the note model is proven in the wild — public
   sends become the exception rather than the default.
2. **Merchant/receiving-only meta-addresses**, so a business can publish one
   name and still get a fresh address per customer.
3. **Amount privacy**, which is the real remaining gap and the only one that
   needs new cryptography — confidential transfers or a shielded pool. Note
   that anything mixer-shaped is the wrong thing to ship on Circle's
   regulated chain (§3.10); the plausible path is confidential-transfer style
   encrypted balances, not a pool.
4. **Cross-chain private receive** — accept on Base, settle privately on Arc,
   with CCTP in the middle.

(1) and (2) are safe to describe as roadmap. Do not imply (3) exists.
