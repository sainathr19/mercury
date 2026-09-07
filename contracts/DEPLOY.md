# Deploying the name registry

`MercuryNameRegistry` is the resolver on `mercurywallet.eth` **and** the place
subname records are stored. One contract, one deploy, no server.

Everything here is on **Sepolia**, matching Arc's testnet-only status. The same
steps work on mainnet — only the RPC and ENS app URL change.

Both transactions come from your own wallet, so they are yours to send.

---

## 1. Deploy

`MercuryNameRegistry.sol` is one file with no imports — paste it into
[remix.ethereum.org](https://remix.ethereum.org), compile with **0.8.24+**,
optimizer on. Constructor takes **no arguments**.

Deploy on Sepolia with **Injected Provider**. Measured cost: **1,749,596 gas**
(~0.0018 ETH at 1 gwei). Save the deployed address.

---

## 2. Point the name at it

On the [Sepolia ENS app](https://sepolia.app.ens.domains), open
`mercurywallet.eth` → **Edit resolver** → paste the deployed address.

From that moment the contract answers for `mercurywallet.eth` **and everything
under it**. That is ENSv2's wildcard resolution, and it is why no subregistry is
needed — verified on-chain before this was written: the Universal Resolver
descends to the parent's resolver for subnames even though your name shows "No
subregistry".

Because the apex now resolves here too, set its own record or the 2LD goes dark:

```
setApex(<your address>, "", "", 0)
```

---

## 3. Reserve the names that read as you

```
reserve(["support","admin","help","security","billing","refund","refunds","mercury","wallet","team","official","verify","www","api","hub","app","mail","root","system","staff"], true)
```

One transaction. `support.mercurywallet.eth` pointing at a stranger is a
phishing tool, not a username, and the contract cannot know which words matter
to you.

---

## 4. Tell the app where it is

```bash
# app/.env.local
EXPO_PUBLIC_ENS_REGISTRY=0x…
EXPO_PUBLIC_ENS_PARENT=mercurywallet.eth
EXPO_PUBLIC_RELAYER_URL=https://your-hub    # also the name sponsor
```

## 4b. Let the relayer pay for names (optional but recommended)

```bash
# hub/.env
RELAYER_PRIVATE_KEY=0x…       # the wallet that pays; needs Sepolia ETH
ENS_REGISTRY=0x…              # from step 1
ENS_PARENT=mercurywallet.eth
SPONSOR_PER_ADDRESS=1
SPONSOR_PER_DAY=200
```

With this set, a user claims a name holding **no ETH at all** — the app tries
the sponsor first and only falls back to spending the user's own gas if it
declines. The name belongs to the user either way; the sponsor is the payer,
never the owner.

Fund the relayer wallet with Sepolia ETH. At ~211k gas per name that is roughly
**4,700 names per 1 ETH** at 1 gwei.

Unlike `/gateway/relay`, this endpoint is **not** safe to leave open: there is no
Circle signature vouching for the payload, so the caller's own signature is the
only thing between your gas and a name pointing wherever a stranger likes. The
protections are in `hub/src/sponsor.ts` — registration is made out to the
recovered signer, never to an address from the request body.

---

## 5. Check it

```bash
cd hub && ENS_REGISTRY=0x… npx tsx scripts/verify-ens.ts alice
```

This asks **viem** — a standard ENS client — to resolve the name through the real
Universal Resolver. If it passes, other wallets resolve it too.

---

## What a name costs

Measured on a real EVM, not estimated:

| | Gas | @1 gwei | @20 gwei |
|---|---|---|---|
| Register, EVM address only | 80,919 | 0.00008 ETH | 0.0016 ETH |
| Register, all three chains | 211,125 | 0.00021 ETH | 0.0042 ETH |
| Deploy (once) | 1,749,596 | 0.0017 ETH | 0.035 ETH |

On Sepolia this is faucet money. On mainnet, a name with all three addresses is
a few dollars at ordinary gas prices.

**The user needs a gas token for this**, which is the one place Mercury's "never
hold gas" promise does not reach — ENS lives on Ethereum and writing to it costs
Ethereum gas. `register` takes the owner as a parameter rather than using
`msg.sender`, so you can pay on a user's behalf from a sponsor wallet without
redeploying anything.

---

## Afterwards

- **Names outlive you.** Nothing of yours has to keep running for
  `alice.mercurywallet.eth` to resolve — the records are in contract storage,
  read directly by any ENS client.
- **Users own their names.** `transferName` and `setRecords` are theirs, not
  yours. You cannot repoint someone's name; only reserve unclaimed ones.
- **Renewal** is on the parent `mercurywallet.eth` (expires Sep 2027). If that
  lapses, every subname stops resolving with it.
