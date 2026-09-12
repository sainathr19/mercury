# Mercury

**The wallet for everyday money.**

Send USDC to a name. No addresses to read out, no gas token to buy first, no
bridge to claim from — your money spends wherever it already is.

```
sainathr.mercurywallet.eth ──► ENSIP-10 wildcard resolution
                           ──► MercuryNameRegistry (Sepolia)
                           ──► the recipient's EVM / Solana / Bitcoin addresses
```

```
USDC on Sepolia ──► Circle Gateway (one unified balance)
                ──► burn intent, attested in ~1s
                ──► Mercury hub mints on the destination chain
                ──► recipient holds spendable USDC, having paid no gas
```

## What it does

- **Pay a name.** `name.mercurywallet.eth` is a real ENS name, resolved through
  ENSIP-10 wildcard resolution against a registry we deployed. No server sits
  behind it — any wallet or explorer that speaks ENS can find you.
  Claiming is sponsored: the hub pays the gas, so a new wallet with a zero
  balance can still get a name.
- **Instant cross-chain sends.** One Circle Gateway balance, spendable on any
  supported chain in about five seconds. The recipient needs no gas token on
  the destination — the hub's relayer submits the mint.
- **Swaps.** Cross-chain atomic swaps through Garden on testnet and Flashnet
  Orchestra on mainnet. Bitcoin and EVM sources are funded by this wallet;
  see *Limits* for what is not.
- **One asset on Arc.** Arc's gas token *is* USDC, so on that chain the wallet
  never stops to tell you to go buy ETH first.
- **Private on request.** A per-payment toggle routes through a fresh ERC-5564
  stealth address. See *Privacy* for exactly what that hides.
- **A dApp browser** with WalletConnect, so the wallet works with apps it has
  never heard of.

## Layout

| Path | What |
|---|---|
| `app/` | Expo / React Native wallet. Holds the keys and does all signing. 422 tests. |
| `hub/` | **Holds a funded key.** Gateway mint relayer, ENS name sponsor, and a proxy for The Graph. See `hub/README.md`. |
| `contracts/` | `MercuryNameRegistry.sol` — the ENS subname registry. |
| `subgraph/` | The Graph: USDC/EURC transfers and ERC-5564 announcements on Arc. |
| `specs/` | Per-service detail. |

`shared/` exists but nothing imports it; the app and the hub each keep their own
chain registry.

## Running it

### The app

Signing and key storage live in a Rust core exposed as a React Native turbo
module. It is a separate, private checkout — `npm install` cannot fetch it — so
it is linked in by path, and Metro, TypeScript and Jest each resolve
`mercury-wallet-core` to that link:

```bash
ln -s /path/to/the/wallet-core-checkout app/vendor/wallet-core
cd app
cp .env.example .env            # see the file: every variable is documented
npm ci
npx expo start --dev-client
```

`app/vendor/` is gitignored. Without the link the app will not bundle; there is
no stub, because a wallet that starts without its signer would be worse than one
that refuses to start.

Building for a simulator: `npx expo prebuild --platform ios` then open the
workspace. If `pod install` fails with `Unicode Normalization not appropriate
for ASCII-8BIT`, your shell has no UTF-8 locale — `export LANG=en_US.UTF-8`
fixes it, and `expo prebuild` will otherwise report success while leaving no
`Podfile.lock`.

### The hub

```bash
cp hub/.env.example hub/.env    # fill in; every variable is documented there
docker compose up --build -d
curl localhost:8787/healthz
```

`hub/README.md` covers what the deployment has to provide. Two things bite
hardest in practice:

- **`RPC_<chainId>` per chain.** The public endpoints viem ships are the first
  thing a provider rate-limits by IP, and a datacenter address is exactly the
  shape they refuse. A chain the relayer cannot read is a chain it cannot
  deliver to. `GET /gateway/domains?environment=testnet` reports `ready: null`
  for an unreachable RPC and `ready: false` for an unfunded one — they are
  different problems.
- **A persistent `/app/data`.** The spend ledgers live there. On ephemeral
  storage they reset every deploy and every wallet gets its sponsorship
  allowance back, which makes the caps decorative.

## Tests

```bash
cd app && npm test        # 422 across 49 suites
cd hub && npm test        # 16
```

Both trees typecheck with `npx tsc --noEmit`.

## Limits

Split deliberately, because the two halves mean different things.

### Cannot be done here

- **Secure Enclave on a simulator.** Keys fall back to the software keychain;
  Settings says so rather than implying hardware backing. Real hardware needs a
  device.
- **Background payment alerts on a simulator.** iOS does not run background
  tasks there at all. The app detects this and skips registration.
- **Redirecting or reclaiming a Gateway burn.** The destination is signed inside
  Circle's attestation. Once a burn is accepted the money has moved, which is
  why delivery is checked *before* signing and the signed claim is written to
  disk *before* the relay is attempted.
- **Quoting a Gateway fee in advance.** Circle prices a transfer only in answer
  to a signed burn intent, so no exact figure exists before you commit. The app
  states that a fee applies, shows the previous charge as an estimate, and
  reports the exact amount afterwards.

### Built, but blocked from outside

- **Swaps out of Solana.** Its funding instruction is not an EVM call and has
  not been observed; `fundingPlan` refuses rather than guessing. Bitcoin and EVM
  sources work.
- **Swaps involving Arc.** Garden defines a market but has no liquidity behind
  it — every Arc route answers `insufficient liquidity`. Nothing in this wallet
  can change that.
- **Social sign-in.** The Google OAuth client ids in `bridge/hubConfig.ts` are
  blank, so the identity paths they gate are inert.

### Not built

There is no agent, no chat, and no natural-language payment. Earlier drafts of
this file described one; it does not exist.

## Privacy

Payments are **public by default, private on request** — a per-payment toggle
backed by ERC-5564 stealth addresses. Arc is the first chain where that gap
closes end to end: a stealth address elsewhere holds tokens it cannot move
without a gas top-up that deanonymises the recipient, whereas on Arc the note
pays its own way out in the asset it received. So we never sweep, and the
transaction that would link every note back to one identity is never created.

**What it hides: who received. That is all.** The sender, the amount, and the
fact that a private payment happened are all public. This is receipt privacy,
not a mixer. Read [PLAN.md](PLAN.md) §3.10 before describing the privacy
anywhere.

## Security

- The app holds the keys and performs every signature. The hub never sees one.
- The hub's key holds **gas only**. It pays for Gateway mints and sponsored ENS
  registrations, and both are bounded by a spend ledger denominated in ETH with
  a gas-price ceiling — counting operations does not bound cost.
- `POST /gateway/relay` is unauthenticated on purpose: Circle signs the
  attestation and names the recipient inside it, so a caller cannot redirect
  funds. The only abuse is burning our gas, which is what the budget is for.
- Provider credentials live in `hub/.env` and are proxied. `EXPO_PUBLIC_*` is
  inlined into the app bundle at build time and recoverable from the package, so
  nothing secret may go there.
