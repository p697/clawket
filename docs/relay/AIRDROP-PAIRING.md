# AirDrop as a pairing helper

AirDrop is **not a persistent transport**. It is a convenient Apple share-sheet for getting a bridge pairing URL from the host to a nearby iOS device without reading a QR code or typing an address.

## How it fits with the other transports

| Transport | Discovery | Persistent data channel |
| --- | --- | --- |
| Tailscale | manual QR / saved profile | yes (WebSocket over tailnet) |
| Bonjour / mDNS | auto-discover on LAN or tailnet | yes (WebSocket over LAN/tailnet) |
| Multipeer | auto-discover nearby devices | yes (MCSession data streams) |
| AirDrop | manual share-sheet | **no** — only hands off the pairing URL |

After AirDrop delivers the URL, the mobile app still connects to the bridge over one of the persistent transports (Tailscale, Bonjour, or plain LAN).

## CLI integration (shipped)

```bash
# Generate a pairing QR + deep link, then open Finder share helpers for AirDrop.
clawket hermes pair local --share-airdrop

# Same for Tailscale / Bonjour / Multipeer payloads:
clawket hermes pair local --transport tailscale --share-airdrop
clawket hermes pair local --transport bonjour --share-airdrop
```

What the host does:

1. Build the Hermes local QR payload (`buildHermesLocalPairingQrPayload`) with optional `transport`.
2. Build a deep link: `clawket://hermes-pair?payload=<urlencoded JSON>`.
3. Write the QR PNG, copy the deep link to the clipboard, and reveal the QR + a small text share file in Finder so you can AirDrop either one.

## Menu bar integration (shipped)

Hermes Bridge Menu Bar → **Pair Device** submenu:

- Local (LAN)
- Tailscale
- Bonjour / mDNS
- Multipeer
- AirDrop Share Sheet…

Each item shells out to `clawket hermes pair local --transport …` (AirDrop adds `--share-airdrop`).

## Client apps

### Clawket mobile

- `GatewayTransportKind` includes `bonjour` and `multipeer`.
- QR parser honors `transport` on `clawket_hermes_local` payloads.
- Deep link route `clawket://hermes-pair` (payload JSON or explicit query params) applies the Hermes bridge config after confirmation.

### Hermes App (iOS / Desktop / Watch via HermesKit)

- `PairingTransport` enum + optional `transport` on `PairingPayload`.
- Legacy `hermes://pair?…&transport=tailscale` decode.
- `PairingPayload(clawketHermesLocalJSON:)` accepts the same JSON the Clawket QR/AirDrop path produces.

## Why not use AirDrop as the actual connection?

AirDrop is peer-to-peer Wi-Fi + Bluetooth, but Apple does not expose a long-lived socket or API for an app to tunnel arbitrary traffic over an AirDrop session. The session exists only for the file/URL transfer. For a persistent connection, use:

- **Tailscale** when both devices are on the same tailnet.
- **Bonjour** when both devices are on the same LAN or Tailscale MagicDNS subnet.
- **Multipeer Connectivity** when you want direct device-to-device streams without any network infrastructure.

## Security note

Whatever URL is shared via AirDrop still contains the bridge token. Treat an AirDrop share the same way you would treat showing someone a QR code: only send it to a device you trust.

## Multica / Linear tracking

| ID | Item |
| --- | --- |
| HAB-239 | Epic: Pairing transports onboarding + Lottie (3 clients) |
| HAB-240 | Shared Lottie asset pack |
| HAB-241 | Clawket mobile onboarding transport cards + Lottie |
| HAB-242 | Agent Habitat Chat onboarding transport + Lottie |
| HAB-243 | Hermes App first-run pair chooser + Lottie |
| HAB-244 | Docs cross-links |

Linear project: https://linear.app/binary-bros/project/hermes-pairing-transports-onboarding-0aee73d402ae  
(Linear free tier blocked new issues — Multica HAB-* are the live tickets.)

Multica project: Hermes Pairing Transports Onboarding

