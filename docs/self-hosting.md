# Self-Hosting Clawket

This guide is for operators who clone the public repository and run Clawket on infrastructure they control. The repository is usable without a private hosted dependency baked into its source.

## Public-Source Boundary

The repository includes:

- the iOS and Android app source
- the Bridge CLI and OpenClaw/Hermes runtimes
- the shared Registry and Relay Worker source
- direct LAN, Tailscale, and custom-endpoint pairing
- Cloudflare templates and self-hosting documentation

Public product endpoints and app identifiers appear in official release profiles and compatibility code. They are not secrets. Deployment templates use placeholders; supply your own account, service endpoints and credentials in ignored local overrides. Bring your own direct connection or Relay infrastructure and enable only the optional integrations you operate. Historical operator metadata is documented in the audit report; no promise of a metadata-free Git history is made.

YouMind Sprite uses its own optional HTTPS adapter and account flow. It is not deployed by the Relay workspaces and is not a Relay transport kind.

## What You Need

- Node.js 22.x and npm
- an OpenClaw or Hermes host that the Bridge can control
- Xcode or Android/Expo tooling only when building the mobile app
- a Cloudflare account only when running Relay infrastructure

Clawket supports a Relay-backed path and a direct path over LAN, Tailscale, or another custom endpoint. Relay is transport; it is not the agent runtime or operator workstation.

## 1. Install Dependencies

```bash
git clone <your-fork-or-clone-url>
cd clawket
npm install
```

## 2. Choose a Connection Path

### Option A: Direct local or Tailscale pairing

Pair every detected local-capable backend:

```bash
npm run bridge:pair:local
```

To select one backend:

```bash
npm run bridge:pair:local -- --backend openclaw
npm run bridge:pair:local -- --backend hermes
```

For an explicit OpenClaw LAN, Tailscale, or custom Gateway URL:

```bash
npm run bridge:pair -- --local --backend openclaw --url ws://100.x.x.x:18789
```

The mobile app can scan or import the generated payload and connect directly.

### Option B: Relay-backed pairing with Cloudflare

Registry and Relay share one policy-driven implementation for OpenClaw and Hermes, but each backend and environment must use separate Worker services, KV namespaces, Durable Object namespaces, and secrets.

## 3. Prepare Cloudflare Worker Config

Copy the open-source-safe OpenClaw templates into ignored local overrides:

```bash
cp apps/relay-registry/wrangler.local.example.toml apps/relay-registry/wrangler.local.toml
cp apps/relay-worker/wrangler.local.example.toml apps/relay-worker/wrangler.local.toml
```

For a Hermes Relay instance, use the Hermes templates in the same workspaces:

```bash
cp apps/relay-registry/wrangler.hermes.local.example.toml apps/relay-registry/wrangler.hermes.local.toml
cp apps/relay-worker/wrangler.hermes.local.example.toml apps/relay-worker/wrangler.hermes.local.toml
```

Fill in your own `account_id`, KV and Durable Object bindings, `RELAY_REGION_MAP`, `REGISTRY_VERIFY_URL`, and optional shared secrets. Keep tracked Wrangler files generic and never reuse OpenClaw resources for Hermes.

## 4. Run or Deploy Relay Infrastructure

OpenClaw local development:

```bash
npm run relay:dev:registry
npm run relay:dev:worker
```

Hermes local development:

```bash
npm run relay:dev:hermes-registry
npm run relay:dev:hermes-worker
```

Before deploying, confirm the selected account. Then deploy only the intended backend pair:

```bash
npm run relay:cf:whoami
npm run relay:deploy:registry
npm run relay:deploy:worker
```

Hermes uses the corresponding `relay:deploy:hermes-registry` and `relay:deploy:hermes-worker` commands. Every deploy wrapper runs the compatibility gate first.

## 5. Pair the Bridge Against Your Registry

For OpenClaw:

```bash
npm run bridge:pair -- --backend openclaw --server https://registry.example.com
```

For Hermes:

```bash
npm run bridge:pair:relay:hermes -- --server https://hermes-registry.example.com
```

You may set `CLAWKET_REGISTRY_URL` or `CLAWKET_HERMES_REGISTRY_URL` instead. Hermes Relay pairing also tries to start the Clawket-managed local Bridge and Relay runtime.

## 6. Configure the Mobile Build

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and set only the public values needed by your build. Examples include your support, documentation, privacy, and terms links. For device signing set your own `EXPO_APPLE_TEAM_ID`. For EAS, create/link your own project and supply `EXPO_EAS_OWNER` and `EXPO_EAS_PROJECT_ID`; local simulator development needs neither.

Provide those identity variables in the selected EAS build environment as well as locally when cloud builds need them. Ignored `.env.local` files are not a cloud configuration mechanism. This audit preserved local official identities but did not update or validate remote EAS identity variables.

Before signing a fork for your own devices/store account, replace `ios.bundleIdentifier` and `android.package` in `apps/mobile/app.json`. Align `extra.eas.build.experimental.ios.appExtensions` bundle and application-group identifiers with that identity, and register the app group with your own team. Replace/remove official Associated Domains if you operate your own link host. The default Clawket identifiers and artwork describe this project; they do not grant access to its signing accounts.

Optional private services are configured at build time:

- PostHog: `EXPO_PUBLIC_POSTHOG_ENABLED`, `EXPO_PUBLIC_POSTHOG_HOST`, and `EXPO_PUBLIC_POSTHOG_API_KEY`
- RevenueCat: `EXPO_PUBLIC_REVENUECAT_ENABLED`, the platform API key, and the Pro entitlement/offering identifiers

In community builds, including Release/Archive, an unconfigured integration stays disabled or hidden; when RevenueCat is disabled, subscription billing is skipped and Pro is unlocked. Leave `CLAWKET_OFFICIAL_BUILD` unset (or `0`). Your own `EXPO_PUBLIC_SPEECH_URL` may point to your service. The EAS `community` profile is for your own store build; choose your bundle/package identifiers and signing credentials before distributing a fork. The tracked `production`/`testflight` profiles and the maintainer's ignored local environment set `CLAWKET_OFFICIAL_BUILD=1`, which requires analytics, billing and `wss://speech.clawket.ai/v1/speech`. Release checks still reject malformed settings and debug billing overrides in either mode.

Recommended checks:

```bash
npm run mobile:config:show
npm run mobile:config:check
npm run mobile:config:check:ios
```

Direct Xcode builds read `apps/mobile/.env.local` through `apps/mobile/ios/.xcode.env`, so bundle-time `EXPO_PUBLIC_*` values stay aligned with Expo config.

When adding a mobile environment variable, add it to `.env.example`, expose it through `src/config/public.ts` when needed at runtime, update the public-config validator when release validation should enforce it, and rerun the platform config check.

## Privacy and Secrets

- Relay forwards live traffic and does not persist message content.
- Message caches stay on the device and deleting a connection clears that connection's cache.
- Analytics must not include message text, prompts, raw identifiers, credentials, invitation material, or secret-bearing URLs.
- Keep operator account/namespace IDs, service credentials, signing material and private release configuration in ignored files. Public endpoint names and public SDK identifiers alone do not grant administrative access.

The optional YouMind integration currently uses a client HMAC value. Do not supply a server secret through `EXPO_PUBLIC_YOUMIND_APP_SECRET`; all client configuration is extractable. YouMind account/service access is independent of self-hosted OpenClaw/Hermes operation.

Store private values in your environment, ignored local config, or release pipeline.

## 7. Verify

```bash
npm run check:required
npm run test:compat
```

Then validate the real flow: start or deploy the selected connection path, pair the Bridge, scan or import the result, and confirm that the app uses your endpoints.

## Related Docs

- [Relay configuration](./relay/CONFIGURATION.md)
- [Relay local development](./relay/LOCAL-DEVELOPMENT.md)
- [Relay architecture](./relay/ARCHITECTURE.md)
