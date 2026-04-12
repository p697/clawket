<p align="center">
  <img src="./assets/clawket-hero.png" alt="Clawket" />
</p>

# Clawket

[![npm version](https://img.shields.io/npm/v/@p697/clawket)](https://www.npmjs.com/package/@p697/clawket)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[Follow on X](https://x.com/cavano697)

[中文说明](./README.zh-CN.md)

Clawket is an open-source mobile app for managing your AI agents on the go. It currently supports [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/NousResearch/hermes-agent), and is available on iOS and Android.

<p align="center">
  <a href="https://apps.apple.com/app/id6759597015">
    <img src="./assets/clawket-app-store.png" alt="Scan to download Clawket on the App Store" width="180" />
  </a>
</p>
<p align="center">
  <strong>Scan to open the <a href="https://apps.apple.com/app/id6759597015">App Store</a> on your iPhone.</strong>
</p>

## Key Features

- **📱 Mobile control for OpenClaw** — Chat, manage agents, configure models, schedule cron jobs, and monitor sessions — all from your phone
- **🔒 Secure by default** — Token-based authentication + TLS encryption for both relay and direct connections
- **🌐 Flexible connectivity** — Connect via cloud relay, local network, or Tailscale — no port forwarding needed
- **🖥️ Full remote console** — Manage agents, channels, skills, files, devices, and logs without touching a terminal
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

Clawket supports two connection paths:

- **Relay mode** — Use `relay-registry` + `relay-worker` for a cloud-backed connection with automatic pairing.
- **Direct mode** — Connect directly via LAN IP, Tailscale IP, or any custom gateway URL — no relay infrastructure needed.

## How It Works

1. Run `clawket pair` on your Mac/PC — the bridge auto-detects which local backends are available and prints one or more time-limited QR codes.
2. Run `clawket pair --local` if you want direct local pairing instead of relay-backed pairing.
3. Scan the QR with the Clawket mobile app to trust that machine.
4. In relay mode, the registry verifies the pairing and the relay worker carries real-time WebSocket traffic between your phone and the bridge.
5. In direct mode, the app connects straight to your backend bridge over LAN, Tailscale, or another direct URL — no relay needed.
6. After the first pairing, reconnection is automatic.

Current pairing behavior:

- If the machine only has OpenClaw, `clawket pair` and `clawket pair --local` behave the same as before.
- If the machine only has Hermes, `clawket pair` and `clawket pair --local` generate a Hermes local bridge QR.
- If the machine has both OpenClaw and Hermes, Clawket prints one QR per backend and clearly labels them.

## Workspace Layout

| Path | Description |
|------|-------------|
| `apps/mobile` | Expo / React Native mobile app |
| `apps/relay-registry` | Cloudflare registry worker |
| `apps/relay-worker` | Cloudflare relay worker |
| `apps/bridge-cli` | Publishable `@p697/clawket` bridge CLI |
| `packages/bridge-core` | Pairing / config / service helpers |
| `packages/bridge-runtime` | Bridge runtime |
| `packages/relay-shared` | Shared relay protocol & types |

## Quick Start

If you only want to run the mobile app locally, start here. You do not need to understand Relay, Registry, or build the bridge from source first.

### Run the Mobile App

For iOS development on macOS:

```bash
npm install
npm run mobile:sync:native
npm run mobile:dev:ios
```

This command prepares the embedded Office web assets and launches the iOS dev build.

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

- OpenClaw uses relay pairing by default
- Hermes uses local bridge pairing for now
- If both are available, you get one QR code per backend

For direct local pairing without relay infrastructure:

```bash
clawket pair --local
```

To force a specific backend:

```bash
clawket pair --backend hermes
clawket pair --local --backend hermes
```

Then scan the generated QR code in the app.

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
- To run relay infrastructure: a Cloudflare account

## Self-Hosting

Clawket is designed so the public repository can be cloned and run without depending on an official hosted backend. You can use either a relay-backed setup that you operate yourself, or a pure local/direct setup over LAN, Tailscale, or another custom gateway URL.

Key defaults for self-hosters:

- `clawket pair` requires `--server` or `CLAWKET_REGISTRY_URL` — no hardcoded registry
- `clawket pair --local` works without any Cloudflare infrastructure
- OpenClaw pairing state remains in its legacy config, while Hermes pairing state is stored separately, so upgrading the bridge does not break existing OpenClaw pairings
- Checked-in `wrangler.toml` files use placeholder bindings and `example.com` endpoints only
- If analytics, support, or legal links are unset, the app disables or hides those integrations
- If RevenueCat is unset, the app skips subscription billing and defaults to unlocked Pro access

For the full distribution model, read [SELF_HOSTING_MODEL.md](./SELF_HOSTING_MODEL.md).

### Self-Hosting Docs

- [docs/self-hosting.md](./docs/self-hosting.md)
- [docs/relay/CONFIGURATION.md](./docs/relay/CONFIGURATION.md)
- [docs/relay/LOCAL-DEVELOPMENT.md](./docs/relay/LOCAL-DEVELOPMENT.md)
- [docs/relay/ARCHITECTURE.md](./docs/relay/ARCHITECTURE.md)

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
