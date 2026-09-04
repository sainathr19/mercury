# `hub/` — agent, push, and ops scripts

A small Hono service plus a scripts directory. **Owner: track A.**

**It holds no user keys, no user funds, and no directory.** It does hold one
key of its own, used solely to sign subname issuances. ENS is the directory
([shared.md](shared.md)); the device holds the keys.

**It is not on the critical path, with one exception.** Kill the hub and the
wallet still shows balances, history, and sends money. Only natural-language
history and push notifications stop. Protect this property: if a feature would
put the hub between the user and their money, it belongs in the app instead.

The exception is **sponsored name issuance** ([onboarding.md](onboarding.md)).
It is confined to onboarding, and even there the name is skippable — a hub
outage yields a working unnamed wallet, never a blocked user.

## Why it exists at all

Three reasons, all of which need a server:

1. **The LLM API key.** Anything shipped in a React Native bundle is
   extractable from the `.ipa`.
2. **Push fan-out.** Something has to watch for incoming payments while the app
   is closed.
3. **Sponsored name issuance.** A new user has no funds on any chain, so we pay
   for their subname out of the subregistry we own. This needs our key, which
   means a server. See [onboarding.md](onboarding.md).

Remove all three and there is no hub. That is a legitimate three-service version of
Mercury; it costs natural-language history and real notifications.

## Layout

```
hub/
  src/
    index.ts      Hono app, routes, CORS
    agent.ts      NL → GraphQL → NL
    push.ts       token registry + poller + Expo push
    graph.ts      its own Graph client (NOT shared with the app)
    names.ts      subname issuance + the issuance index
  scripts/
    check-arc.ts          connectivity + balance sanity
    ens-register.ts       claim mercury.eth on Sepolia
    ens-subregistry.ts    deploy the subregistry
    ens-set-records.ts    write addr(coinType) + text records
    ens-issue-subname.ts  issue <user>.mercury.eth
    seed-uniswap-pool.ts  add USDC/EURC liquidity at a sane rate
```

`scripts/` are one-shot operational tools, run by hand with `tsx`. They live
here because they are Node + TypeScript + viem — the same environment the
service already has — and a separate package for six scripts is not worth its
`node_modules`.

## `POST /agent/ask`

The only interesting endpoint. **Read-only. It cannot move money.**

```ts
// request
{ question: string, context: { arcAddress: string, name?: string } }

// response
{ answer: string,          // prose
  data: unknown[],         // the actual rows
  query: string }          // the GraphQL that ran
```

Pipeline:

1. LLM turns the question into a GraphQL query against the schema in
   [subgraph.md](subgraph.md). The schema goes in the system prompt.
2. Hub executes it — **against an allowlist of query shapes**, not arbitrary
   GraphQL. A model emitting an unbounded query is a denial-of-service on our
   own indexer.
3. LLM phrases the rows as prose.

**The app renders numbers from `data`, never by parsing `answer`.** A
hallucinated figure in the prose can then never reach the screen as a value the
user might act on. `query` is returned so the UI can show its work.

**`context.arcAddress` is supplied by the client and is not authenticated.**
That is acceptable *only* because everything queryable is already public
on-chain data — the endpoint reveals nothing a block explorer wouldn't. Do not
add anything private to this endpoint without adding auth first.

## `POST /name/claim`

Issues `<name>.mercury.eth` from our subregistry, paid with our key. Full
protocol, signed-message format and validation order in
[onboarding.md](onboarding.md). Summary of the hub's obligations:

```ts
{ name, address, stealthMeta, timestamp, signature } → { name, txHash }
```

1. Recover the signature to `address`, else 401
2. `timestamp` within ±5 minutes
3. Name valid, not reserved, unclaimed
4. **`address` does not already own a name** — one per address
5. Rate limit per IP
6. Issue the subname and set `addr(2152525650)` + the stealth text record in
   **one** transaction

**This endpoint spends real money** — every call costs Sepolia gas from our
key. It is the only hub endpoint that does, and it is the only reason the hub
holds a key at all. That key signs name issuances and nothing else; it never
touches user funds.

Keep an issuance index (`address → name → txHash`) — it backs the
one-per-address check and the reverse lookup used by wallet import.

## `POST /push/register` and the poller

```ts
{ expoPushToken: string, arcAddress: string, viewTags?: number[] }
```

The poller queries the subgraph on an interval for transfers to registered
addresses since the last seen block, and pushes `IncomingPayment`
([shared.md](shared.md)) for anything new.

For private receipts the client registers **view tags, not addresses** — the
hub learns that someone is watching 1/256 of announcements and nothing more.
Sending stealth addresses here would hand the hub exactly the link the scheme
exists to hide.

State is a single SQLite table (`token, address, tags, lastBlock`). No ORM.
It is a cache: losing it costs a re-register, not money.

## Deployment

One container, one process, one env file. Fly or Railway — whichever deploys
faster on day 6; nothing here is platform-specific.

```
LLM_API_KEY=        # server-only, never in the app
GRAPH_API_KEY=      # the hub's own key, separate from the app's
SUBGRAPH_URL_ARC=
PORT=
```

Two Graph keys on purpose. If the hub's poller trips a rate limit, the wallet
keeps working.

## Failure modes

| Failure | Symptom | Response |
|---|---|---|
| Hub down | No agent, no push, no new names | Wallet unaffected. Agent tab shows unavailable; onboarding falls through to the claim banner. |
| Sepolia key dry | Every claim fails | Monitor the balance. A dry key on demo day looks exactly like a broken product. |
| LLM times out | Agent hangs | 10s timeout → "couldn't answer that", never a partial answer |
| LLM emits invalid GraphQL | Query fails | Reject against the allowlist, retry once, then decline |
| Poller falls behind | Late notifications | It is a cache — the app's own subgraph reads are the source of truth |
| SQLite lost on redeploy | Push tokens gone | App re-registers on next launch. Make registration idempotent and cheap. |

## Explicitly not here

- **Payment parsing.** *"Send sainath 20"* is a fixed grammar handled
  deterministically **in the app**, offline. A model that reads `20` as `200`
  moves real money, so nothing that can hallucinate goes near the write path.
- **The directory.** ENS.
- **Read proxying.** The app queries The Graph itself.
- **Any signing.** Ever.

## Open questions

- **Is the poller the right shape for push?** An interval poll is simple and
  survives restarts. Graph offers no webhooks. If interval latency looks bad in
  the rehearsal, shorten the interval before redesigning — it is one constant.
- **Does the agent need conversation history?** Single-shot Q&A is cheaper and
  has no state. Add history only if the demo script actually needs a follow-up
  question.
- **Rate limiting.** Unauthenticated `/agent/ask` in front of a paid LLM key is
  an obvious abuse vector. A per-IP limit is enough for a testnet demo; do not
  ship this shape anywhere real without auth.
