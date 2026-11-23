# syntax=docker/dockerfile:1
# ---- base ----------------------------------------------------------------------
FROM node:26-trixie-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit pnpm@12.21.0
WORKDIR /app

# ---- deps ----------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

# ---- dev: source is bind-mounted by compose.dev.yaml ----------------------------
FROM deps AS dev
COPY . .
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# ---- builder -------------------------------------------------------------------
FROM deps AS builder
COPY . .
RUN pnpm build

# ---- runtime -------------------------------------------------------------------
FROM node:26-trixie-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
