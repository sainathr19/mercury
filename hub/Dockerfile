# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
#  Mercury hub.
#
#  There is no separate relayer image. /gateway/relay is a route on this server,
#  and it shares three things with the name sponsor: the wallet that pays, the
#  gas-price ceiling, and the on-disk spend ledger. Splitting them into two
#  containers would split one balance across two processes that cannot see each
#  other's reservations — which is exactly the concurrency hole budget.ts was
#  written to close.
#
#  Built as compiled JS rather than run through tsx: the runtime image then
#  carries no TypeScript, no solc and no dev tree at all — a third of the size
#  and a much smaller thing to have listening on a public port.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=24.4.0

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── prod deps ────────────────────────────────────────────────────────────────
# A second, independent install rather than `npm prune`, so the runtime tree is
# built from the lockfile and contains only what `dependencies` asks for.
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev \
 # 23 MB of compiler that --omit=dev keeps: typescript is an OPTIONAL, types-only
 # peer of viem/abitype/ox, so the lockfile does not mark it dev and npm installs
 # it into the production tree. Nothing loads it at run time.
 && rm -rf node_modules/typescript

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime

# Node as PID 1 gets no default signal disposition, so an unwrapped process
# ignores SIGTERM and every `docker stop` waits out the full 10s timeout before
# being killed. tini reaps and forwards.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/dist         ./dist
COPY package.json ./

# Budget.load()/persist() resolve their ledger paths against the working
# directory, so `SPONSOR_LEDGER=data/...` lands here. It must exist and be
# writable by the unprivileged user before the first sponsored claim, not after.
RUN mkdir -p /app/data && chown -R node:node /app/data

# This declaration does NOT make the data durable, and it is worth being blunt
# about because it reads as though it does. VOLUME creates an ANONYMOUS volume,
# freshly for every container, and most platform runtimes ignore the instruction
# outright. It survives `docker restart`; it does not survive a deploy.
#
# Observed here: with this line present, a redeploy reset the spend ledgers
# within the same UTC day — every wallet got its sponsorship allowance back and
# the day's spend went to zero, while the API kept reporting those numbers as if
# they meant something.
#
# Durability comes from the ORCHESTRATOR mounting storage here: the named volume
# in docker-compose.yml, or a platform volume (Fly/Railway/Render) on the
# deployed instance. The hub reports which it got — see src/storage.ts, and the
# `storage` block on GET /names/status.
VOLUME ["/app/data"]

USER node
EXPOSE 8787

# Uses the runtime's own fetch — no curl or wget in the image to reach for.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
