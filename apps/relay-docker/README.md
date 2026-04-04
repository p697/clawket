# Clawket Self-Hosted Relay (Docker)

`relay-docker` is the self-hosted Docker deployment of Clawket's relay stack. It runs the registry HTTP API and the relay WebSocket server inside one Node.js process, with one shared in-process KV layer and optional SQLite persistence.

## What This Deployment Supports

- One logical deployment unit: one registry + one relay process.
- Optional multiple public relay URLs via `RELAY_REGION_MAP`, but every URL must still route to this same deployment.
- Persistent pairing records when `KV_PERSIST_PATH` points to a writable SQLite file.

It does not provide cross-node coordination, distributed room ownership, or multi-instance token propagation.

## Quick Start

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env with your domains and persistence path
```

### 2. Build and Run

```bash
docker compose up -d --build

docker compose logs -f

curl http://localhost:3001/v1/health
curl http://localhost:3002/v1/health
```

The checked-in `docker-compose.yml` builds from the local repository by default so the container matches the code in this workspace.

### 3. Configure nginx

Copy `nginx.conf.example` and replace `registry.example.com` / `relay.example.com` with your real domains. The relay domain only exposes:

- `GET /v1/health`
- `WS /ws`

## Architecture

```
┌─────────────────────────────────────────────┐
│           Single Node.js Process            │
│                                             │
│  Registry HTTP API (:3001)                  │
│  ├── POST /v1/pair/register                 │
│  ├── POST /v1/pair/access-code              │
│  ├── POST /v1/pair/claim                    │
│  ├── GET  /v1/verify/:gatewayId             │
│  └── GET  /v1/health                        │
│                                             │
│  Relay WebSocket Server (:3002)             │
│  ├── WS   /ws                               │
│  └── GET  /v1/health                        │
│                                             │
│  Shared MemoryKV (+ optional SQLite)        │
│  Room Manager (one room per gatewayId)      │
└─────────────────────────────────────────────┘
```

## Security Notes

- The relay no longer exposes an HTTP token-sync endpoint. Registry and relay share the same in-process KV state directly.
- Registry JSON request bodies are hard-limited because the API only accepts small pairing payloads.
- If `KV_PERSIST_PATH` is set but SQLite cannot open or write the database, startup or writes fail immediately instead of silently falling back to memory-only behavior.

## Environment Variables

See [`.env.example`](.env.example) for the full list.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `REGISTRY_PORT` | `3001` | Registry API port |
| `RELAY_PORT` | `3002` | Relay WebSocket port |
| `RELAY_URL` | `ws://localhost:3002/ws` | Public relay WebSocket URL |
| `RELAY_REGION_MAP` | _(empty)_ | Optional region → public WebSocket URL map for this same deployment |
| `KV_PERSIST_PATH` | _(empty)_ | Writable SQLite path for persistent pairing records |

## Differences from Cloudflare Deployment

| Feature | Cloudflare | Docker |
|---|---|---|
| KV Storage | Cloudflare KV | In-process memory + optional SQLite |
| Room State | Durable Objects | In-memory per process |
| WebSocket | Hibernatable WS | `ws` library |
| Scaling | Edge / multi-region platform primitives | Single deployment unit |
| Region Detection | `request.cf.country` | `X-Real-Country` header |
| Heartbeat | DO alarms | `setTimeout` alarms |

## Persistence

With `KV_PERSIST_PATH` set:

- Pairing records survive process restarts.
- Active WebSocket connections are lost on restart and clients must reconnect.
- Startup fails if the SQLite file cannot be opened.

Without `KV_PERSIST_PATH`:

- The service runs in memory-only mode.
- All pairing state is lost on restart.

## Development

```bash
npm install

npm run --workspace=@clawket/relay-docker dev
npm run --workspace=@clawket/relay-docker typecheck
npm run --workspace=@clawket/relay-docker build
```
