# Onboarding — first run

The path from a cold install to a working wallet. **Owner: track B**, with one
hub endpoint owned by track A.

Referenced by [app.md](app.md) (screens) and [hub.md](hub.md) (the claim
endpoint).

## The constraint everything else follows from

**A new user has no funds on any chain.** Not Arc, not Sepolia. But ENSv2
registration lives on Sepolia and costs gas plus a stablecoin fee. A user
cannot pay for their own name, and telling them to go find Sepolia ETH first
would end onboarding for almost everyone.

The fix comes out of the architecture rather than being bolted on: **we own
`mercury.eth` and its subregistry, so issuing `alice.mercury.eth` is our
transaction, signed with our key.** The user proves they hold a private key by
signing a message; the hub issues the subname and writes the records. The user
pays nothing and needs nothing.

**This makes the hub required for onboarding** — a deliberate exception to the
rule in [README.md](README.md) that the hub is never on the critical path.
After onboarding the wallet is independent again: sending, receiving and
history never touch the hub. Keep the exception this narrow.

## Two invariants

**The seed is persisted before anything touches the network.** Every step
after that is resumable, and no failure can lose a wallet.

**Onboarding state is derived, never stored.** There is no
`onboardingStep` enum to get out of sync with reality:

```ts
if (!hasSeed())            return 'welcome';
if (!hasLock())            return 'set-lock';
if (!hasName())            return 'ready-unnamed';   // banner on home
                           return 'ready';
```

A user who force-quits mid-claim relaunches into `ready-unnamed` with a
working wallet and a banner. Nothing is stuck, because there is no stored step
to be stuck in.

## Path A — new wallet

| # | Screen | What happens, and where |
|---|---|---|
| 1 | Welcome | **Create** / **I already have a wallet** |
| 2 | Generate | BIP-39 12 words, generated **on device**. Never transmitted |
| 3 | Recovery phrase | Display, then verify 3 words at random. No skip |
| 4 | Set lock | Face ID / passcode. **Seed → SecureStore behind it. Wallet now exists.** |
| 5 | Choose name | Live availability check against the subregistry as they type |
| 6 | Claim | App signs the claim message → `POST /name/claim` |
| 7 | Issue | Hub issues `alice.mercury.eth` and sets `addr(2152525650)` + the stealth meta-address text record **in one transaction** |
| 8 | Confirm | ~12s Sepolia block. App polls resolution until the name resolves to its own address |
| 9 | Fund | Balance is zero. Offer: faucet, receive by name, or CCTP from another chain |
| 10 | Home | |

Step 7 sets the stealth meta-address **during the claim**, not later. Private
receive then works from the first minute. Deferring it means a second
transaction and a user who cannot receive privately until they discover a
settings screen.

Step 5 is skippable. See *Deferred claim* below.

## Path B — import

| # | Screen | What happens |
|---|---|---|
| 1 | Welcome | "I already have a wallet" |
| 2 | Enter phrase | 12/24 words, BIP-39 wordlist validated as they type, checksum checked before deriving |
| 3 | Derive | Same derivation as Path A → Arc address |
| 4 | **Reverse lookup** | Does this address already own a `*.mercury.eth`? **Yes** → restore that identity, skip the claim. **No** → Path A step 5 |
| 5 | Set lock | Face ID / passcode |
| 6 | **Rescan** | Pull announcements from the subgraph, match view tags on-device, rebuild the notes list |
| 7 | Home | Full history from the subgraph |

Step 6 settles the open question in [app.md](app.md) about notes surviving a
reinstall: **they do.** The seed regenerates the view key and the subgraph
holds every announcement, so nothing was ever stored only on the device. It
just takes a scan.

Step 4 is what makes reinstall painless — the user is not asked to pick a name
again, and does not discover their own name is "taken."

## The claim protocol

### Request

```ts
POST /name/claim
{
  name: string,          // 'alice'
  address: string,       // 0x… the Arc address
  stealthMeta: string,   // 0x… 66 bytes: spendPub ‖ viewPub
  timestamp: number,     // unix seconds
  signature: string      // EIP-191 personal_sign over the message below
}
```

The hub cannot derive `stealthMeta` — it never sees the seed — so the app
supplies it and the signature covers it.

### Signed message

```
Mercury name claim
name: alice
address: 0x1234…
stealth: 0xabcd…
issued: 1757000000
```

Human-readable on purpose: it renders legibly in any signing UI, so a user can
see they are claiming a name and not authorising a transfer.

### Hub checks, in order

1. Signature recovers to `address` — otherwise 401
2. `timestamp` within ±5 minutes of now — bounds replay
3. `name` matches `^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$` and is not reserved
4. `name` is unclaimed in the subregistry
5. **`address` does not already own a name** — one per address
6. Rate limit per IP

Then issue the subname, set both records, and return `{ name, txHash }`.

### On one-name-per-address

Enforced hub-side, against its own issuance index. This is **not** a sybil
defence — a determined user generates another address and claims again. It
exists to stop accidental double-claims and casual name-squatting, and to keep
our Sepolia balance from being drained overnight by a script. Say that plainly
rather than implying a guarantee we do not have.

### Reserved names

`admin`, `support`, `mercury`, `root`, `help`, `about`, `api`, `www`, `arc`,
`circle`, `ens`. Cheap to add, impossible to reclaim later.

## Deferred claim

The name is **skippable**. A wallet with no name still receives (by address),
sends, swaps and shows history — everything except being paid by name.

- Home shows a persistent banner: *"Claim your name so people can pay you
  without an address."*
- Dismissible for the session; returns on next launch.
- Tapping resumes at Path A step 5.
- The receive screen shows the raw address with an inline prompt to claim.

Skippable also means a **hub outage never blocks a new user.** They get a
working wallet and claim later. That is the whole reason for this design.

## Failure modes

| Failure | Response |
|---|---|
| Name taken | Caught by the live check at step 5, before anything is signed |
| Hub unreachable at claim | Wallet already exists. Fall through to `ready-unnamed` + banner |
| Claim transaction reverts | Same. Never strand the user mid-onboarding |
| User force-quits mid-claim | Seed saved at step 4; relaunch derives `ready-unnamed` |
| Invalid recovery phrase | Checksum-validated before deriving; error names the bad word |
| Sepolia congested, claim slow | Poll with a visible timer; offer "continue, we'll finish in the background" |
| Our Sepolia key runs dry | **Claims fail for everyone.** Alert on balance; see open questions |

## Security notes

- The seed **never leaves the device** and is never sent to the hub in any
  form, including during claim.
- The claim signature authorises a name issuance and nothing else. It cannot
  move funds — it is not a transaction.
- `stealthMeta` is public by design; publishing it is the point.
- The recovery phrase screen must disable screenshots where the platform
  allows it, and must never be logged.

## Open questions

- **Can we set an ENS reverse record on the user's behalf?** If yes, Path B
  step 4 resolves through ENS directly and import stops needing the hub. If
  no, reverse lookup is a hub index and import degrades without it — the user
  can still import and use the wallet, but their name appears only once the
  hub is reachable. **Resolve during the day-1 ENSv2 spike.**
- **Funding a fresh wallet (step 9) is unsolved beyond a faucet link.** For
  the demo that is fine. A recipient who has never held USDC and is paid by
  name has a working wallet and no way to have obtained gas — which works only
  because on Arc the payment itself is spendable.
- **Our Sepolia key is a single point of failure.** Every claim spends it.
  Monitor the balance and top it up before day 11; a dry key on demo day looks
  exactly like a broken product.
