# syntax=docker/dockerfile:1.7
# Multi-stage build for the orchestrator service (and the remediation-mcp it
# spawns as a stdio subprocess). Dashboard is hosted separately via Firebase
# Hosting and is intentionally not included in this image.

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: builder. Full toolchain so native modules (better-sqlite3) compile.
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy lockfile + every workspace manifest first so `npm ci` is cacheable.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/remediation-mcp/package.json ./packages/remediation-mcp/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/dashboard/package.json ./packages/dashboard/

# Install all workspaces' deps. Dashboard's dev deps come along for the ride
# but get pruned below before the runtime stage.
RUN npm ci --workspaces --include-workspace-root

# Copy TS configs + source for the workspaces we actually build into this image.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/remediation-mcp ./packages/remediation-mcp
COPY packages/orchestrator ./packages/orchestrator

# Build sequentially so cross-workspace project references resolve.
RUN npm run build --workspace @sre-sentinel/shared \
 && npm run build --workspace @sre-sentinel/remediation-mcp \
 && npm run build --workspace @sre-sentinel/orchestrator

# Drop dev deps before copying node_modules into the runtime stage.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: runtime. Slim image, non-root user, no build tools.
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules and built artefacts.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/remediation-mcp/package.json ./packages/remediation-mcp/
COPY --from=builder /app/packages/remediation-mcp/dist ./packages/remediation-mcp/dist
COPY --from=builder /app/packages/orchestrator/package.json ./packages/orchestrator/
COPY --from=builder /app/packages/orchestrator/dist ./packages/orchestrator/dist

# `node` user ships in the official image. SQLite needs a writable data dir.
RUN mkdir -p /app/packages/orchestrator/data \
 && chown -R node:node /app/packages/orchestrator/data
USER node

# Cloud Run injects PORT; config.ts reads it. EXPOSE is documentary only.
EXPOSE 8080

CMD ["node", "packages/orchestrator/dist/index.js"]
