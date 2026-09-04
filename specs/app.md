# `app/` — the wallet

Expo / React Native, TypeScript, dev build via EAS (Expo Go cannot do remote
push). **Owner: track B.**

**It holds the keys and does all signing.** Everything else in this repo is
optional to it: the hub can be down, and the wallet still shows balances,
history, and sends money.

## Layout

```
app/
  app/                              expo-router
    (auth)/  onboarding · recovery · claim-name
    (app)/   home · send · receive · activity · swap · agent · settings
  src/
    bridge/                         pure logic, no React
      keys.ts       BIP-39/32 → Arc key, SecureStore, biometric gate
      arc.ts        viem client + THE send wrapper
      ens.ts        resolve names, read/write resolver records
      graph.ts      subgraph + Token API clients
      stealth.ts    ERC-5564 derive / recover / scan
      cctp.ts       fund from Base, Arbitrum, OP, Ethereum
      uniswap.ts    USDC ↔ EURC via V2 router
      intent.ts     deterministic NL → Intent (offline, no model)
      hub.ts        agent ask + push registration (all calls optional)
    stores/         zustand: session · portfolio · activity · notes
    ui/             components
```

`bridge/` is pure and React-free so it can be unit-tested in Node without a
simulator. That matters most for `stealth.ts` and `intent.ts`, which are the
two places a bug costs money.

## `arc.ts` — the one send path

Arc's `eth_estimateGas` is unreliable and **receipts do not throw on revert**.
A bare `sendTransaction` anywhere in this codebase is a silent failure waiting
to happen, so there is exactly one way to write to the chain:

```ts
export async function send(tx: TxRequest): Promise<Hex> {
  const hash = await wallet.sendTransaction({ ...tx, gas: tx.gas ?? DEFAULT_GAS });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new TxReverted(hash, receipt);
  return hash;
}
```

Payments go out as **ERC-20 `transfer()`** on the USDC contract, never as a
bare value send — see [subgraph.md](subgraph.md) for why. The recipient can
still pay their own gas either way, because `balanceOf` mirrors the native
balance on Arc.

## `intent.ts` — parsing payments, deterministically

A fixed grammar. No model, no network, works on a plane.

```
send 20 to sainath              → { recipient:'sainath.mercury.eth', amountMinor:20_000000n }
pay sainath.eth 12.50 privately → { …, private:true }
send €5 to bob                  → { …, token:'EURC' }
```

Anything it cannot parse confidently is **rejected**, not guessed — the send
screen stays on the manual form. A parser that guesses wrong sends real money
to the wrong place or in the wrong amount.

Amounts parse straight to `bigint` minor units. Money never becomes a float
outside `formatMinor` ([shared.md](shared.md)).

## `stealth.ts` — ERC-5564

Pure crypto, offline-testable, with published test vectors. Write it
test-first; it depends on nothing and blocks nothing.

```ts
deriveStealth(metaAddress) → { stealthAddress, ephemeralPub, viewTag }
recoverStealth(viewPriv, spendPriv, ephemeralPub) → { address, privKey } | null
scan(announcements, keys) → Note[]     // view-tag prefilter, then ECDH
```

Two rules that are design, not implementation detail:

- **Match view tags on-device.** Pull the batch from the subgraph, filter
  locally. Filtering server-side hands the provider the exact link the scheme
  exists to hide.
- **Never sweep.** Each note is spent *onward* directly. The consolidating
  transaction is what links every note to one identity, and on Arc we never
  have to create it — the note pays its own gas.

## Reading money

Balances and history come from the subgraph, **not RPC**. There is no RPC
fallback for display, which is deliberate: one source of truth, no
reconciliation logic between two disagreeing views.

- **Arc, Base, Ethereum** — our subgraph
- **Arbitrum, OP, Polygon** — Token API (our subgraph isn't deployed there,
  and these are CCTP funding sources users may hold balances on)

`portfolio` merges both into one total. The merge is the price of covering
funding sources we don't index ourselves.

An optimistic row appears from the local tx receipt at broadcast and is
reconciled when the transfer indexes — display steadiness only, never a
substitute for chain truth.

## Screens

| Screen | Does |
|---|---|
| onboarding | create or import → lock → optional name claim. Full flow in [onboarding.md](onboarding.md) |
| home | one balance, recent activity, send/receive |
| send | name → amount → **private toggle** → confirm → sign |
| receive | name + QR; funding options via CCTP |
| activity | subgraph-backed feed, names not hex |
| swap | USDC ↔ EURC via Uniswap V2 |
| agent | ask questions about history (needs hub; degrades cleanly) |
| settings | recovery phrase, notes, stealth meta-address publishing |

## Failure modes

| Failure | Symptom | Response |
|---|---|---|
| Hub down | Agent tab dead | Show unavailable. **Never block home, send, or receive.** |
| Subgraph lagging | Sent payment missing | Optimistic row from the receipt until it indexes |
| Tx reverts | Nothing, on Arc | `send()` asserts `receipt.status` — this is the guard |
| ENS name unresolvable | Can't send | Fall back to raw address entry, say why |
| No stealth meta for recipient | Private toggle impossible | Disable the toggle with a reason; never silently send public |

That last row matters: silently downgrading a private send to a public one
because the recipient lacks a meta-address would be the worst bug in the app.

## Testing

- `bridge/` unit tests in Node, no simulator — `stealth.ts` against published
  ERC-5564 vectors, `intent.ts` against a table of phrasings including ones
  that must be rejected, `chains.ts` conversions round-trip.
- Everything else is verified on two physical phones on day 11.

## Open questions

- ~~Where do stealth notes live on reinstall?~~ **Resolved:** cached in
  `stores/notes`, rebuilt by rescanning announcements from the seed on import
  ([onboarding.md](onboarding.md) Path B step 6). The cache is an optimisation,
  never the source of truth.
- **Does the app need the Token API at all** if funding is limited to Base and
  Ethereum? Would remove the merge entirely. Depends on the day-6 CCTP scope.
- **Biometric on every send, or session-scoped?** Per-send is safer, worse to
  demo. Pick one on day 3 and keep it.
