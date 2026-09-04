# Preview Environment

Preview is Clawket's isolated pre-release environment for the OpenClaw Relay path. It exists so server and protocol changes can be validated with real Apps and Bridges before Production deployment.

## Product behavior

1. Enable Debug Mode in the mobile Settings screen.
2. Add a connection, open Quick Connect, and select `Preview` under Server Environment.
3. On the OpenClaw machine, run:

```bash
clawket pair --preview
```

4. Open the generated pairing page on the phone, enter its pairing code in the App, or scan the compatibility QR. Preview connections carry a visible Preview badge and continue to use the normal OpenClaw Relay feature set.

`clawket pair --preview` opens the secure pairing page by default. Use `--no-open` for headless or scripted runs. The page URL contains its decryption key and human code only in the URL fragment, so Cloudflare receives neither value during the page request.

Preview is intentionally discoverable but carries no stability guarantee. The App rejects an official Preview QR when Debug Mode is disabled and rejects an official Production/Preview QR that does not match the selected environment. Self-hosted URLs remain unrestricted.

## Isolation boundary

Production and Preview have separate:

- Registry and Relay Workers
- pairing KV and Durable Object state
- Registry-to-Relay sync secrets
- Bridge pairing files and access codes
- gateway/client credentials

Preview is still `backendKind=openclaw` with `transportKind=relay`. Environment must not be modeled as another transport. Hermes remains on its own workers and is not enrolled into this environment.

The installed Bridge service reads both `~/.clawket/bridge-cli.json` and `~/.clawket/bridge-cli.preview.json`. When both exist it runs independent Relay runtimes, allowing Production and Preview connections to stay available at the same time.

## Operator setup

Copy the checked-in examples to ignored account-bound configs:

```bash
cp apps/relay-registry/wrangler.preview.example.toml apps/relay-registry/wrangler.preview.local.toml
cp apps/relay-worker/wrangler.preview.example.toml apps/relay-worker/wrangler.preview.local.toml
```

Use Preview-only KV and Durable Object resources. Configure the Registry `RELAY_SYNC_SERVICE` binding to the Preview Relay and set the same `PAIRING_SYNC_SECRET` on both workers.

For six-digit pairing, generate one random secret of at least 32 characters and set it as the `PAIRING_TICKET_SECRET` Wrangler secret on both Preview workers. Do not place it in `[vars]`, source control, terminal output, or test reports. Relay health advertises the secure-pairing capability only when this secret is valid, and Registry checks that live capability before it shows a six-digit code.

Set `PAIR_PUBLIC_BASE_URL`, `APPLE_APP_IDS`, and the Android package/fingerprint vars on the Preview Registry. iOS Universal Links require the associated-domain entitlement in the signed App; Android App Links require the certificate fingerprint that signed the installed build. The page's `Open Clawket` custom-scheme button remains the fallback while native association caches update.

Local iOS Debug builds omit Associated Domains by default so developers can install with an existing provisioning profile; pairing links still work through the `clawket://` fallback. Set `CLAWKET_IOS_DEV_UNIVERSAL_LINKS=1` only to test Universal Links with a profile that explicitly enables Associated Domains. Release builds keep the entitlement and therefore require the Apple agreement/capability/profile setup to be current.

Deploy only Preview:

```bash
npm run relay:deploy:preview-worker
npm run relay:deploy:preview-registry
```

Deploying Relay first is the fastest rollout path. Release ordering is nevertheless compatibility-safe: new Relay with old Registry is inert; new Registry with an old or unavailable Relay automatically falls back to the legacy code; new App and Bridge retain QR/link and legacy-code support.

The deploy wrapper requires an account-locked local config and refuses a missing config file. It does not reuse `wrangler.local.toml` for these commands.

## Release verification

With a local Preview Bridge paired and running, execute:

```bash
npm run relay:test:preview-product
```

The smoke test refreshes a real Preview access code; completes the six-digit proof and ephemeral-key handshake; decrypts the invitation locally; verifies invitation invalidation after claim, Relay client authentication, Bridge presence, and delivery of an OpenClaw `connect.challenge`. It prints only sanitized check names and never prints credentials.

Before a Production promotion, also run:

```bash
npm run check:required
```

Preview success is a release signal, not a substitute for compatibility tests or an automatic Production promotion.
