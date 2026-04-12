# Local Development

This guide covers local development for the registry worker and relay worker. It does not require any private infrastructure.

## 1. Install Dependencies

```bash
cd /path/to/clawket
npm install
```

## 2. Prepare Local Wrangler Overrides

Create untracked local override files before remote dev or deploy work:

```bash
cp apps/relay-registry/wrangler.local.example.toml apps/relay-registry/wrangler.local.toml
cp apps/relay-worker/wrangler.local.example.toml apps/relay-worker/wrangler.local.toml
```

Then replace the placeholder values with resources from your own Cloudflare account.

Important:

1. Do not put real account IDs or KV IDs into tracked `wrangler.toml` files.
2. If your Wrangler login can access multiple accounts, set `account_id` explicitly in both local override files.

## 3. Start The Registry Worker

```bash
npm run relay:dev:registry
```

The local endpoint is usually `http://127.0.0.1:8787`.

## 4. Start The Relay Worker

In a second terminal:

```bash
npm run relay:dev:worker
```

The local endpoint is usually `http://127.0.0.1:8788`.

## 5. Register A Gateway

```bash
curl -X POST http://127.0.0.1:8787/v1/pair/register \
  -H 'content-type: application/json' \
  -d '{"displayName":"Demo Gateway","preferredRegion":"us"}'
```

Example response:

```json
{
  "gatewayId": "gw_...",
  "relaySecret": "grs_...",
  "relayUrl": "ws://127.0.0.1:8788/ws",
  "accessCode": "ABC234",
  "accessCodeExpiresAt": "2026-03-22T00:00:00.000Z",
  "displayName": "Demo Gateway",
  "region": "us"
}
```

## 6. Claim The Access Code

One-time pairing `accessCode` values are 6-character uppercase codes from `ABCDEFGHJKMNPQRSTVWXYZ23456789`. Claim remains backward-compatible with older unclaimed 6-digit numeric codes.

```bash
curl -X POST http://127.0.0.1:8787/v1/pair/claim \
  -H 'content-type: application/json' \
  -d '{"gatewayId":"<gatewayId>","accessCode":"<accessCode>","clientLabel":"iPhone"}'
```

## 7. Verify A Pairing Token

Use either a `relaySecret` or a `clientToken`:

```bash
curl -H 'Authorization: Bearer <relaySecret-or-clientToken>' \
  http://127.0.0.1:8787/v1/verify/<gatewayId>
```

## 8. Connect To The Relay WebSocket

Gateway example with legacy query-token auth:

```bash
npx wscat -c 'ws://127.0.0.1:8788/ws?gatewayId=<gatewayId>&role=gateway&token=<relaySecret>'
```

Client example with bearer auth:

```bash
npx wscat \
  -c 'ws://127.0.0.1:8788/ws?gatewayId=<gatewayId>&role=client&clientId=test-client' \
  -H 'Authorization: Bearer <clientToken>'
```

You can replace `wscat` with any equivalent WebSocket client or your own bridge/client implementation.

## 9. Run Tests

```bash
npm run typecheck
npm run test
npm run relay:test:integration
```

## 10. Deploy To Your Own Cloudflare Account

Before deploys, confirm the current account:

```bash
npm run relay:cf:whoami
```

Deploy commands:

```bash
npm run relay:deploy:registry
npm run relay:deploy:worker
```

These scripts automatically prefer `wrangler.local.toml` when present.

## 11. Hermes Relay Local Development

Hermes relay uses separate workers and separate Wrangler configs:

```bash
npm run relay:dev:hermes-registry
npm run relay:dev:hermes-worker
```

Hermes deploy commands:

```bash
npm run relay:deploy:hermes-registry
npm run relay:deploy:hermes-worker
```

Important:

1. Keep Hermes KV and DO resources separate from OpenClaw.
2. Do not point Hermes local configs at the production OpenClaw registry or relay.
3. Do not replace the existing OpenClaw workers when testing Hermes relay rollout.

### Hermes Relay End-To-End Smoke Flow

Start the isolated Hermes workers in two terminals:

```bash
npm run relay:dev:hermes-registry
npm run relay:dev:hermes-worker
```

Generate a Hermes relay QR in a third terminal:

```bash
npm run bridge:pair:relay:hermes -- --server http://127.0.0.1:8787
```

That prints a Hermes Relay QR in the terminal and writes a PNG file. Scan it in Clawket to save a Hermes relay connection.

Then start the Hermes relay runtime in a fourth terminal:

```bash
npm run bridge:run:relay:hermes
```

If you need to start a standalone local Hermes bridge first, you can still use:

```bash
npm run bridge:hermes:dev:once
```

Recommended manual verification order:

1. Pair with `bridge:pair:relay:hermes`
2. Start the bridge-to-relay runtime with `bridge:run:relay:hermes`
3. Open the saved Hermes connection in Clawket
4. Verify chat connect, Console entry, and reconnect after background/foreground

### Hermes Relay On A Real Device

For a phone or any device outside the local machine, do not use the `127.0.0.1` local-only Hermes relay workers. Instead use the device-aware scripts, which detect the current LAN IP and make the registry return a real reachable relay URL:

```bash
# Terminal 1
npm run relay:dev:hermes-registry:device

# Terminal 2
npm run relay:dev:hermes-worker:device

# Terminal 3
npm run bridge:pair:relay:hermes:device

# Terminal 4
npm run bridge:run:relay:hermes
```

If auto-detection picks the wrong interface, pass the host explicitly:

```bash
npm run relay:dev:hermes-registry:device -- --public-host 192.168.31.41
npm run relay:dev:hermes-worker:device -- --public-host 192.168.31.41
npm run bridge:pair:relay:hermes:device -- --public-host 192.168.31.41
```
