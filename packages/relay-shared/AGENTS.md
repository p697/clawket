# Relay Shared

Shared relay protocol and types package inside the Clawket monorepo. This package is consumed by `apps/relay-registry`, `apps/relay-worker`, and bridge/mobile layers.

## Hermes Relay Isolation Rule

When implementing Hermes relay support:

1. Do not change OpenClaw relay public routes, storage keys, or existing worker bindings as part of Hermes rollout work.
2. Hermes relay must use separate worker services, separate KV bindings, separate Durable Object classes, and separate bridge/mobile state.
3. Reuse implementation helpers only when doing so does not change OpenClaw deploy units or public contracts.
4. Do not switch the product-facing shared `pair` command from Hermes local to Hermes relay until the isolated Hermes relay stack is validated end-to-end.
5. In mobile/runtime code, treat relay behavior as a transport concern. Hermes relay connection decisions must key off `transportKind === 'relay'` or shared transport resolvers, not legacy `mode === 'relay'` checks.
6. For local Hermes relay testing, the registry must advertise a device-reachable relay URL. Do not emit `127.0.0.1` or placeholder example domains in pairing QR payloads when the target test path is a real phone or another device.
