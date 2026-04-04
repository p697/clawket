# ---------- Build Stage ----------
FROM node:22-alpine AS builder

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
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --workspace=@clawket/relay-docker --workspace=@clawket/shared --include-workspace-root --ignore-scripts

# Build relay-docker (tsc)
RUN npm run --workspace=@clawket/relay-docker build

# Also compile the shared package for production runtime.
# Do not swallow compile failures here; relay-docker imports @clawket/shared at runtime.
RUN cd packages/relay-shared \
    && npx tsc -p tsconfig.json --outDir dist --declaration \
    && sed -i "s|'./protocol'|'./protocol.js'|g" dist/index.js

# ---------- Production Stage ----------
FROM node:22-alpine

WORKDIR /app

# Copy compiled relay-docker output
COPY --from=builder /build/apps/relay-docker/dist/ ./dist/
COPY --from=builder /build/apps/relay-docker/package.json ./

# Copy the shared package (source and compiled output) — needed at runtime as workspace dep
COPY --from=builder /build/packages/relay-shared/ ./node_modules/@clawket/shared/

# Fix package.json to point to compiled TS so Node.js 22 doesn't try to strip types in node_modules
RUN sed -i 's|"src/index.ts"|"dist/index.js"|g' ./node_modules/@clawket/shared/package.json

# Install production dependencies only (ws, better-sqlite3)
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3

# Create data directory for SQLite persistence
RUN mkdir -p /data

EXPOSE 3001 3002

ENV NODE_ENV=production
ENV KV_PERSIST_PATH=/data/kv.sqlite

VOLUME /data

CMD ["node", "dist/server.js"]
