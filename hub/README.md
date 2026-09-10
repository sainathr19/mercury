# Mercury hub

One HTTP service, three jobs, one funded wallet:

| Route | What it does | Costs gas |
|---|---|---|
| `POST /gateway/relay` | Submits a Circle Gateway attestation on the destination chain so the recipient needs no gas there | yes |
| `POST /names/sponsor` | Registers an ENS subname under `mercurywallet.eth` and pays for it | yes |
| `GET /index/*` | Proxies The Graph so the provider key never ships in the app bundle | no |
| `GET /healthz`, `/names/status`, `/gateway/budget`, `/gateway/domains` | Status and published limits | no |

There is deliberately **no separate relayer process**. The relay and the name
sponsor spend the same wallet against the same on-disk ledger, and `budget.ts`
holds in-flight reservations in memory so concurrent requests cannot each pass a
check none of them could afford together. Two containers would mean two ledgers
and two sets of reservations that cannot see each other — the exact hole the
two-phase reservation exists to close.

## Run it

```bash
cp .env.example .env      # then fill in RELAYER_PRIVATE_KEY, ENS_REGISTRY, TOKEN_API_JWT
docker compose up --build -d   # from the repository root
curl localhost:8787/healthz
```

`docker compose logs -f hub` should open with all three subsystems reporting
configured:

```
mercury hub on 0.0.0.0:8787  relayer=configured
  names: sponsoring mercurywallet.eth via 0x…
  index: proxying The Graph
```

Anything that says `MISSING` or `NOT configured` is an unset variable in `.env`,
not a failure to start — the service comes up either way and refuses the
affected routes with `503` rather than starting in a half-state.

Without Docker: `npm ci && npm run dev`.

## What the deployment has to provide

**A funded relayer.** `RELAYER_PRIVATE_KEY` needs native gas on every chain it
serves — Sepolia for name registration, plus each Gateway destination domain
(`GET /gateway/domains` lists them). It holds gas only; user funds never pass
through it.

**A persistent `/app/data`.** The spend ledgers live there. On ephemeral storage
they reset on every deploy, which hands every wallet its sponsorship allowance
again — so on a platform with no volume, budgets are advisory at best. Compose
mounts a named volume for this.

**A public origin.** The app reaches this at `EXPO_PUBLIC_RELAYER_URL`; a LAN IP
works for development and nothing else.

## Notes on the image

- Multi-stage: TypeScript is compiled in the builder, and the runtime layer
  carries only `dependencies` — no tsc, no tsx, no solc.
- Runs as `node`, not root, with a read-only root filesystem. `/app/data` (the
  ledger volume) and `/tmp` are the only writable paths.
- `tini` is PID 1, so `docker stop` is honoured immediately instead of timing
  out; the server drains in-flight requests on SIGTERM before exiting.
- `.env` and `data/` are in `.dockerignore`. The relayer key must never enter a
  layer — deleting it in a later step does not remove it from the image.
- Health check hits `/healthz` using the runtime's own `fetch`; there is no curl
  or wget in the image.

## Secrets

`.env` is gitignored and is not copied into the image. Pass the variables the
way the platform does it — `fly secrets set`, Railway/Render environment
variables, a Kubernetes secret — not by baking a file in.
