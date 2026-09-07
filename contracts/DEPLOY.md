# Deploying the offchain resolver

Three things have to line up: a **gateway** that signs answers, a **contract**
that trusts its key, and the **parent name** pointing at that contract. Below is
the order that avoids a broken window in between.

Everything here is on **Sepolia**, matching Arc's testnet-only status. The same
steps work on mainnet — only the RPC and the ENS app URL change.

Deploying and `setResolver` are transactions from your own wallet, so they are
yours to send. Nothing below needs a seed phrase in a terminal.

---

## 1. Make a signing key

```bash
cd hub && npm run ens:setup https://your-hub.example.com
```

Writes the key into `hub/.env` (gitignored) without printing it, and prints the
two constructor arguments for step 3. Safe to re-run — an existing key is kept,
because regenerating one silently would orphan every name the deployed resolver
already trusts.

This key decides where names point, so it is as sensitive as the resolver's
owner. It holds **no funds and needs no gas** — it never sends a transaction.
Only the **address** goes on-chain.

---

## 2. Put the gateway somewhere reachable

The resolver publishes a URL, and whoever is resolving has to be able to fetch
it. Mercury's own client unpacks the batch itself and calls your gateway
directly, so a LAN address works while developing:

```
http://192.168.1.x:8787/ens/lookup/{sender}/{data}.json
```

For **other** wallets and explorers to resolve your names, the URL must be
public HTTPS — their lookups go through ENS's hosted batch gateway, which
fetches server-side and cannot see your laptop. Deploy the hub before you care
about that; the contract's `setUrls` lets you change it later without
redeploying.

Keep `/ens/lookup/{sender}/{data}.json` as the path. `{sender}` and `{data}` are
substituted by the client, literally, and are not yours to rename.

---

## 3. Deploy the contract

`MercuryOffchainResolver.sol` is one file with no imports — paste it into
[remix.ethereum.org](https://remix.ethereum.org), compile with **0.8.24+**,
optimizer on. It compiles clean with default settings (~5.9 KB).

Constructor arguments:

| | |
|---|---|
| `_urls` | `["http://192.168.1.x:8787/ens/lookup/{sender}/{data}.json"]` |
| `_signers` | `["0xYourSignerAddress"]` |

Deploy on **Sepolia**. Save the deployed address.

---

## 4. Point the name at it

On the [Sepolia ENS app](https://sepolia.app.ens.domains), open
`mercurywallet.eth` → **Edit resolver** → paste the deployed address.

From that moment the resolver answers for `mercurywallet.eth` **and everything
under it**. Which is why step 5 sets an apex address: the 2LD's own records now
come from the gateway too, and without one the name itself resolves to zero.

Verified on-chain before writing this: ENSv2's Universal Resolver does descend to
the parent's resolver for subnames even though `mercurywallet.eth` has no
subregistry, so `alice.mercurywallet.eth` reaches the gateway with nothing
further to register.

---

## 5. Configure the hub

```bash
# hub/.env
ENS_SIGNER_PRIVATE_KEY=0x…      # from step 1
ENS_RESOLVER_ADDRESS=0x…        # from step 3
ENS_PARENT=mercurywallet.eth
ENS_APEX_ADDRESS=0x…            # what mercurywallet.eth itself resolves to
NAMES_FILE=data/names.json
```

`npm start` and `npm run ens:verify` read this file. Anything you run with bare
`npx tsx` will not — export the variables in that case.

The gateway refuses to sign for any resolver other than `ENS_RESOLVER_ADDRESS`,
so this has to match what you deployed.

---

## 6. Check it

```bash
cd hub && npm run ens:verify alice
```

The npm scripts pass `--env-file-if-exists=.env`, so `hub/.env` is picked up.
Running the script through bare `npx tsx` does **not** load it — nothing in the
hub depends on dotenv — so either use the npm script or export the variables
yourself.

This asks **viem** — a standard ENS client with its own CCIP-Read — to resolve
the name through the real Universal Resolver. It checks the interface, the
gateway URLs, that your signer is trusted, that the parent points here, and then
resolves the EVM, Solana and Bitcoin records. If it passes, other wallets
resolve it too.

---

## Afterwards

- **Rotate the signer** with `setSigner(new, true)` then `setSigner(old, false)`.
  Names keep working across the change; answers are signed per request.
- **Move the gateway** with `setUrls([...])`. No redeploy, no re-registration.
- **`hub/data/names.json`** is the list of issued names. Public, and worth
  keeping — losing it does not cost anyone money, but it does mean every name
  stops resolving until it is rebuilt.
