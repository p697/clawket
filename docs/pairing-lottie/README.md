# Pairing Lottie asset pack

Tracked as Multica **HAB-240** under project *Hermes Pairing Transports Onboarding*.
Linear project: https://linear.app/binary-bros/project/hermes-pairing-transports-onboarding-0aee73d402ae

## How assets were obtained

LottieFiles browse pages are Cloudflare-gated (browser MCP hit the challenge).
Downloads used **LottieHarvest** (`~/Downloads/LottieHarvest`) against the **open GraphQL API + asset CDN** — no Cloudflare, no login:

```bash
lottie-harvest search "bluetooth" --format json --out /tmp/pairing-lottie-harvest
lottie-harvest search "wifi network connect" --format json --out /tmp/pairing-lottie-harvest
lottie-harvest search "share airdrop" --format json --out /tmp/pairing-lottie-harvest
```

User-provided Tailscale anim: `~/Downloads/connectivity.json`.

The specific UUID `9865842e-5002-431a-a0e7-19bc5a7f155b` returned **403** on the CDN (not public / removed). Closest free matches were substituted.

## Mapping

| Transport | File | Source note |
| --- | --- | --- |
| Tailscale | `tailscale-connectivity.json` | User Downloads/connectivity.json |
| Bonjour | `bonjour-network.json` | Harvested “wifi connect” |
| Same Wi-Fi / nearby | `nearby-pulse.json` | Harvested “Network Connecting” |
| Multipeer | `multipeer-bluetooth.json` | Harvested “bluetooth searching” |
| AirDrop | `airdrop-share.json` | Harvested “air drop” |
| Relay / generic link | `link-vector.json` | Harvested “share” |

## Consumers

- Clawket mobile: `apps/mobile/assets/lottie/` (HAB-241)
- Agent Habitat Chat: `assets/lottie/` (HAB-242)
- Hermes App: `HermesFeatures/Resources/Lottie/` + HermesFeature Resources (HAB-243)

## License

Free LottieFiles public animations via open CDN. Keep attribution if the free license on a given asset requires it. Prefer replacing with fully owned motion when branding hardens.
