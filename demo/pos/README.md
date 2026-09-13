# Mercury POS — the coffee-shop demo

A till. Type an amount, hit **Accept payment**, and it shows a QR. Scan it with
Mercury, approve, and the screen turns green the moment the money lands — about
a second on Arc.

```
  till                        phone                     Arc
  ──────────────────────────────────────────────────────────────────
  amount → QR (EIP-681)   →   scan: "Paying Starbucks, $3.00"
                              approve, sign            →  transfer
  poll eth_getLogs        ←──────────────────────────────  Transfer log
  "Payment received"          "Sent"
```

## Run it

```bash
cp .env.example .env      # put YOUR wallet address in VITE_MERCHANT_ADDRESS
npm install
npm run dev               # --host is on, so the phone can reach it too
```

Open the printed `http://192.168.x.x:5173` on the laptop. The phone only needs
to scan the QR — it never loads this page.

## Why it feels instant

The till polls `eth_getLogs` every 1.2s from the block it armed on, filtered to
transfers **into** the merchant address. On Arc a block is about half a second,
so the log is usually there on the first or second poll.

Two Arc-specific details, both learned the hard way and written up in the repo's
`FEEDBACK.md`:

- **One emitter, not two.** Arc emits ERC-20-shaped `Transfer` logs from both the
  USDC contract (`0x3600…`, 6dp) and the native emitter (`0xffff…fffe`, 18dp). An
  ERC-20 `transfer()` emits from both; a plain value send emits only from the
  native one. Watching the native emitter alone and scaling 18dp → 6dp sees every
  payment exactly once, however the payer sent it. Watching both double-counts.
- **A balance fallback.** If a credit ever arrives without a log this filter
  matches, a `balanceOf` delta against the armed baseline still closes the sale.

Partial payments are surfaced rather than swallowed: send $2 against a $3 tab and
the screen says so and keeps waiting, because a customer who underpaid must not
be left watching a spinner that will never stop.

## The QR

EIP-681 — the dialect Mercury's own scanner reads, and generic enough for any
other wallet:

```
ethereum:0x3600…0000@5042002/transfer?address=<merchant>&uint256=3000000&label=Starbucks
```

`label` is not in EIP-681; it is how Solana Pay and BIP-21 name the payee, and
parsers that do not know it ignore it. Mercury reads it so the customer approves
"Starbucks" rather than a hex string they cannot verify. The **address** is still
the only thing that decides where the money goes — anyone can write any label.

## Configuration

| Variable | Meaning |
|---|---|
| `VITE_MERCHANT_ADDRESS` | The address that gets paid. No default: the app refuses to arm a payment rather than show a QR that pays nobody. |

The RPC is proxied by the dev server (`/rpc` → `rpc.testnet.arc.io`) so the page
never depends on a CORS header we do not control.
