# Mercury

**The wallet for everyday money.**

Send USDC to a name. No addresses, no gas token, no bridging — your money
works wherever it already is.

```
sainath.mercury.eth ──► ENSv2 Permissioned Resolver ──► Arc address
                    ──► real USDC transfer on Arc
                    ──► subgraph indexes it ──► recipient's feed updates
                        and they can spend it. No gas token. Ever.
```

## Why this isn't another multichain wallet

Chain coverage is a commodity — every wallet will list Arc within a week of
mainnet. Mercury competes on how paying someone actually feels:

- **Pay a name.** No address appears anywhere in the UI. ENS isn't a lookup
  bolted on the side; it *is* the directory, and there is no server behind it.
- **One asset, ever.** On Arc the gas token is USDC, so the wallet never stops
  to tell you to go buy ETH first. That cliff is the most common reason a
  first crypto payment fails, and this chain deletes it.
- **Your money follows you.** Fund from Base, Arbitrum, OP, Ethereum or Solana
  via CCTP V2 / Circle Gateway and spend on Arc. One balance, many chains.
- **An agent that reads your history** — pay by sentence, and ask real
  questions about your spending. It can only ever *propose*; the device signs.
- **Private when you want it.** One toggle on the send screen routes the
  payment through a fresh ERC-5564 stealth address.

## Layout

| Path | What |
|---|---|
| `app/` | Expo / React Native wallet, 100% TypeScript. Holds the keys, does all signing. |
| `subgraph/` | The Graph — USDC/EURC transfers + ERC-5564 announcements on Arc, Base, Ethereum |
| `hub/` | Agent endpoint + push, plus `scripts/` for on-chain setup. No keys, no funds, no directory — and not on the critical path. |
| `shared/` | The seam: types, chain config, and the one decimals boundary |

See [PLAN.md](PLAN.md) for scope and the day-by-day, and [specs/](specs/)
for per-service detail.

## Privacy

Payments are **public by default, private on request** — a per-payment toggle
backed by ERC-5564 stealth addresses. Arc is the first chain where that
gap closes end to end: a stealth address elsewhere holds tokens it can't
move without a gas top-up that deanonymises the recipient, whereas on Arc the
note pays its own way out in the asset it received. So we never sweep, and the
transaction that would link every note back to one identity is never created.

**What it hides: who received. That's all.** The sender, the amount, and the
fact that a private payment happened are all public. This is receipt privacy,
not a mixer. [PLAN.md §3.10](PLAN.md) is explicit about the limits — read it
before describing the privacy anywhere.

## Status

Day 1. Nothing works yet.
