<p align="center">
  <img src="./assets/clawket-hero.png" alt="Clawket" />
</p>

# Clawket

[![npm version](https://img.shields.io/npm/v/@p697/clawket)](https://www.npmjs.com/package/@p697/clawket)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[Follow on X](https://x.com/cavano697)

[中文说明](./README.zh-CN.md)

Clawket 3.0 is the session control tower for self-hosted agents: see what every agent is doing, enter a conversation in one step, and take control when needed. It supports [OpenClaw](https://github.com/openclaw/openclaw), [Hermes](https://github.com/NousResearch/hermes-agent), and chat with YouMind Sprite on iOS and Android.

<p align="center">
  <a href="https://apps.apple.com/app/id6759597015">
    <img src="./assets/clawket-app-store.png" alt="Scan to download Clawket on the App Store" width="180" />
  </a>
</p>
<p align="center">
  <strong>Scan to open the <a href="https://apps.apple.com/app/id6759597015">App Store</a> on your iPhone.</strong>
</p>

## Key Features

- **📱 One agent roster** — See recent activity, unread work, and items that need attention across connections
- **💬 One continuous thread** — Chat, inspect runs and approvals, and switch sessions without a second runtime
- **🛠️ Backend-aware controls** — Manage the models, skills, schedules, files, devices, and logs each backend actually supports
- **✨ YouMind Sprite chat** — A dedicated adapter provides text chat, history, streaming, and abort without treating Sprite as a Relay backend
- **🔒 Private by design** — Relay forwards traffic without storing messages; local message caches are scoped to each connection
- **🌐 Flexible connectivity** — Connect through Relay, a local network, Tailscale, or a custom endpoint
- **💻 Local model chat (Preview)** — Talk to a model running on your own computer through llama.cpp, Ollama, or any OpenAI-compatible server; the conversation stays on that computer
- **🏗️ Self-hostable** — Run your own relay infrastructure, or skip it entirely with direct LAN/Tailscale connections
- **📦 Open source monorepo** — Mobile app (Expo/React Native), relay workers (Cloudflare), and bridge CLI — all in one repo, build from source

## Architecture

```text
┌──────────────┐        pairing / control         ┌──────────────────┐
│ mobile app   │ ◄──────────────────────────────► │ bridge CLI/runtime│
└──────────────┘                                   └──────────────────┘
        │                                                   │
        │ pair / claim / verify                             │ local gateway control
        ▼                                                   ▼
┌──────────────────┐     route / auth / websocket    ┌──────────────┐
│ relay-registry   │ ◄─────────────────────────────► │ relay-worker │
└──────────────────┘                                  └──────────────┘
```

For OpenClaw and Hermes, Clawket supports two connection paths:

- **Relay mode** — Use `relay-registry` + `relay-worker` for a cloud-backed connection with automatic pairing.
- **Direct mode** — Connect directly via LAN IP, Tailscale IP, or any custom gateway URL — no relay infrastructure needed.

YouMind Sprite uses its own HTTPS adapter. It is a supported chat backend, not a Relay service instance or transport kind.

## How It Works

1. Run `clawket pair` on your Mac/PC — the bridge auto-detects which local backends are available and prints one or more time-limited QR codes.
2. Run `clawket pair local` if you want direct local pairing instead of relay-backed pairing (`--local` remains a compatibility alias).
3. Scan the QR with the Clawket mobile app to trust that machine.
4. In relay mode, the registry verifies the pairing and the relay worker carries real-time WebSocket traffic between your phone and the bridge.
5. In direct mode, the app connects straight to your backend endpoint over LAN, Tailscale, or another direct URL — no relay needed.
6. After the first pairing, reconnection is automatic.

Current pairing behavior:

- `clawket pair` uses Relay for every detected backend and prints one labeled result per backend.
- After Hermes Relay pairing, the CLI also tries to start the Clawket-managed local bridge and Relay runtime so the code is immediately usable.
- `clawket pair local` is the explicit local-only path and likewise prints one result per detected local-capable backend.

## Workspace Layout

| Path | Description |
|------|-------------|
| `apps/mobile` | Expo / React Native mobile app |
| `apps/relay-registry` | Cloudflare registry worker |
| `apps/relay-worker` | Cloudflare relay worker |
| `apps/bridge-cli` | Publishable `@p697/clawket` bridge CLI |
| `packages/agent-protocol` | Backend-neutral adapter contracts, capabilities, and fixtures |
| `packages/bridge-core` | Pairing / config / service helpers |
| `packages/bridge-runtime` | Bridge runtime |
| `packages/relay-shared` | Shared relay protocol & types |

The two Relay workspaces deploy OpenClaw and Hermes from one policy-driven codebase. Production and Preview still use separate Worker services, KV namespaces, Durable Object namespaces, and credentials for each backend.

## Quick Start

If you only want to run the mobile app locally, start here. You do not need to understand Relay, Registry, or build the bridge from source first.

### Run the Mobile App

For iOS development on macOS:

```bash
npm install
npm run mobile:sync:native
npm run mobile:dev:ios
```

This synchronizes the native project and launches the iOS development build.

For Android development:

```bash
npm install
npm run mobile:sync:native
npm run mobile:dev:android
```

### Connect to OpenClaw or Hermes

If you already installed the published bridge CLI from npm, pair it separately:

```bash
npm install -g @p697/clawket
clawket pair
```

This command auto-detects OpenClaw and Hermes on the machine:

- OpenClaw and Hermes use Relay pairing by default
- Hermes pairing also tries to start its Clawket-managed local bridge and Relay runtime
- If both are available, you get one QR code per backend

For direct local pairing without relay infrastructure:

```bash
clawket pair local
```

To force a specific backend:

```bash
clawket pair --backend hermes
clawket pair local --backend hermes
```

Then scan the generated QR code in the app.

### Chat with a Local Model (Preview)

Clawket can also chat with a model that runs on your own computer: llama.cpp, Ollama, or any server that speaks the OpenAI chat API (LM Studio, vLLM, and others). A Bridge on that computer keeps the conversation and calls the model; the Relay only forwards frames. Chat history and model API keys never leave the computer.

This is a Preview feature. In the app, open Account Settings → Advanced settings, turn on Debug Mode, set Relay Environment to Preview, then add a connection and choose Local model. The published npm CLI does not include it yet, so run the Bridge from this checkout with Node.js 22:

```bash
npm ci
npm run bridge:build
node apps/bridge-cli/dist/index.js local-model pair --preview
```

Start your model server before pairing. The defaults expect `llama-server` on port 8080; other servers need their engine and address:

| Model server | Extra flags |
| --- | --- |
| llama.cpp (`llama-server`, port 8080) | none |
| Ollama | `--engine ollama --base-url http://127.0.0.1:11434` |
| LM Studio, vLLM, or another OpenAI-compatible server | `--engine openai-compatible --base-url http://127.0.0.1:<port>` |

The Local model step in the app shows the same flags for each server. Keep the command running and type the six-digit code it prints into the app; `local-model run` restores the saved connection later. Options such as endpoint files, llama.cpp presets, image input, and the current limits are documented in [docs/3.0/15-local-model.md](./docs/3.0/15-local-model.md).

### Need More Than the Default Path?

- If you only want to run the mobile app, the commands above are enough.
- If you want to self-host Relay / Registry or build the bridge from source, continue with the self-hosting docs below.

### Relay / Registry

1. Copy local Cloudflare templates:

```bash
cp apps/relay-registry/wrangler.local.example.toml apps/relay-registry/wrangler.local.toml
cp apps/relay-worker/wrangler.local.example.toml apps/relay-worker/wrangler.local.toml
```

2. Fill in your own account-bound values.
3. Start local workers:

```bash
npm run relay:dev:registry
npm run relay:dev:worker
```

### Bridge

For relay mode, pair against your own registry:

```bash
npm run bridge:pair -- --server https://registry.example.com
```

Or:

```bash
CLAWKET_REGISTRY_URL=https://registry.example.com npm run bridge:pair
```

For direct local pairing without relay infrastructure:

```bash
npm run bridge:pair:local
```

For explicit Hermes pairing:

```bash
npm run bridge:pair:hermes
npm run bridge:pair:local:hermes
```

For an explicit local, Tailscale, or custom gateway URL:

```bash
npm run bridge:pair -- --local --url ws://100.x.x.x:18789
```

## Mobile Configuration

You can ignore this section if you only want to run the app locally with the default open-source settings.

Optional app configuration lives in [`apps/mobile/.env.example`](./apps/mobile/.env.example). Copy it to `.env.local` only if you want to customize your own build with public settings such as docs links, support links, legal links, or optional integrations.

If you leave these values unset, the app keeps the open-source-safe defaults and hides optional integrations that are not configured.

Inspect or validate your config:

```bash
npm run mobile:config:show
npm run mobile:config:check
```

For direct Xcode iOS builds, the bundling phase sources `.env`, `.env.local`, `ios/.xcode.env`, and `ios/.xcode.env.local` automatically, so `EXPO_PUBLIC_*` values are available without a wrapper command.

## Prerequisites

Choose the prerequisites that match what you want to do:

- To run the iOS app locally: macOS, Xcode, Node.js 20+, and npm
- To run the Android app locally: Node.js 20+, npm, and Android Studio
- To use the published bridge CLI: Node.js 20+ and npm
- To chat with a local model (Preview): Node.js 22, this checkout, and a running llama.cpp, Ollama, or OpenAI-compatible server
- To run relay infrastructure: a Cloudflare account

## Self-Hosting

Clawket is designed so the public repository can be cloned and run without depending on an official hosted backend. You can use either a relay-backed setup that you operate yourself, or a pure local/direct setup over LAN, Tailscale, or another custom gateway URL.

Key defaults for self-hosters:

- A self-hosted OpenClaw Registry is selected with `--server` or `CLAWKET_REGISTRY_URL`; its endpoint is not hardcoded in the source checkout
- `clawket pair local` works without any Cloudflare infrastructure
- OpenClaw pairing state remains in its legacy config, while Hermes pairing state is stored separately, so upgrading the bridge does not break existing OpenClaw pairings
- Checked-in `wrangler.toml` files use placeholder bindings and `example.com` endpoints only
- If analytics, support, or legal links are unset, the app disables or hides those integrations
- If RevenueCat is unset, the app skips subscription billing and defaults to unlocked Pro access

For the full distribution model, read [docs/self-hosting.md](./docs/self-hosting.md).

### Self-Hosting Docs

- [docs/self-hosting.md](./docs/self-hosting.md)
- [docs/relay/CONFIGURATION.md](./docs/relay/CONFIGURATION.md)
- [docs/relay/LOCAL-DEVELOPMENT.md](./docs/relay/LOCAL-DEVELOPMENT.md)
- [docs/relay/ARCHITECTURE.md](./docs/relay/ARCHITECTURE.md)

## Privacy

- Relay forwards live traffic and does not persist message content.
- Message caches stay on the device and deleting a connection clears that connection's cache.
- Product analytics use low-cardinality diagnostics and usage events; they do not include message text, prompts, raw identifiers, credentials, or secret-bearing URLs.
- Pairing credentials and release-only service keys stay out of the repository.

## Verification

If you are only checking that the mobile app can run locally, start with:

```bash
npm run mobile:config:check:ios
npm run mobile:test -- --runInBand
```

If you are working on the full repository or preparing an open-source release, run the broader checks:

```bash
npm run typecheck
npm run test
```

If you are validating the real connection flow end to end:

```bash
npm run mobile:config:check:ios
npm run relay:test
npm run bridge:test
```

Then verify the real flow manually: pair the bridge, launch the app, scan pairing data, and confirm the session uses your own endpoints.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

Unless a subdirectory states otherwise, this repository is licensed under [AGPL-3.0-only](./LICENSE).

The directory [`apps/mobile/modules/clawket-speech-recognition`](./apps/mobile/modules/clawket-speech-recognition) is excluded from the root AGPL grant and remains proprietary under its own local license notice.
