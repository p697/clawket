# ---------- Build Stage ----------
FROM node:22-alpine AS builder

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /build

# Copy root workspace files
COPY package.json package-lock.json ./
COPY tsconfig.relay-base.json ./

# Copy shared package (source — used as workspace dependency)
COPY packages/relay-shared/ ./packages/relay-shared/

# Copy relay-docker app
COPY apps/relay-docker/ ./apps/relay-docker/

# Install ALL dependencies (including devDependencies for build)
# Use npm install so this image can still build when the monorepo lockfile changes outside relay-docker.
# --ignore-scripts: skip root postinstall (mobile-only setup not needed here)
RUN npm install --workspace=@clawket/relay-docker --workspace=@clawket/shared --include-workspace-root --ignore-scripts --registry=${NPM_REGISTRY}

# Build relay-docker (tsc)
RUN npm run --workspace=@clawket/relay-docker build

# Build the shared package runtime bundle for production consumption.
RUN npm run --workspace=@clawket/shared build

# ---------- Production Stage ----------
FROM node:22-alpine

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app

# Copy compiled relay-docker output
COPY --from=builder /build/apps/relay-docker/dist/ ./dist/
COPY --from=builder /build/apps/relay-docker/package.json ./

# Copy the shared package runtime artifacts prepared by its dedicated build script
COPY --from=builder /build/packages/relay-shared/dist/ ./node_modules/@clawket/shared/

# Install production dependencies only (ws, better-sqlite3)
RUN npm install --omit=dev --ignore-scripts --registry=${NPM_REGISTRY} \
    && npm rebuild better-sqlite3

# Create data directory for SQLite persistence
RUN mkdir -p /data

EXPOSE 3001 3002

ENV NODE_ENV=production
ENV KV_PERSIST_PATH=/data/kv.sqlite

VOLUME /data

CMD ["node", "dist/server.js"]
