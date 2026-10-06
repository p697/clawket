# OpenClaw advanced direct connections

Owner decision, 2026-10-06: keep script/code Relay pairing as the default. Only the selected **Connect OpenClaw** guide offers **Local or custom connection**, opening its own `OpenClawDirect` page. Other backend guides and the generic chooser have no advanced entry. Existing saved/local-QR backend compatibility stays intact.

The page supports Local network, Tailscale and Custom transports; backend identity remains `openclaw`. Enter a Gateway address and choose Token or Password. Bare hosts and `http(s)` addresses normalize to `ws(s)` without downgrading TLS; ports, IPv6 and paths survive. Credentials, query strings and fragments in addresses are rejected. Credentials persist only through ConnectionStore/SecureStore and never enter navigation or analytics.

Matching OpenClaw direct endpoints are reused. Retry may change the attempted address, but cannot replace a Relay or another backend. Authentication is replaced completely so an old token cannot override a new password. Keep a saved connection's label. Additional connections use the existing Pro gate; an already saved failed attempt can retry without consuming another slot.

Connect completes only after the current target's OpenClaw handshake reaches `ready`. Duplicate submissions are serialized, failures preserve the form, and a 30-second presentation deadline retires the attempt. Back, blur, unmount and timeout fence late completions and pause only that attempt's active connection; ownership generations prevent an older probe from pausing a successor retry. Existing adapter reconnection, device identity, device approval and functional capabilities remain authoritative.

## Gateway setup

- Wi-Fi: both devices share a reachable LAN. OpenClaw must listen on LAN (`gateway.bind=lan`) or a custom reachable address, not loopback only. The host firewall and Wi-Fi client isolation must permit the Gateway port (normally 18789).
- `clawket pair local --backend openclaw` remains the local-QR setup flow and can be scanned through the existing OpenClaw guide. It can configure local access and emits the address and authenticated QR; it does not print the token separately.
- Manual Token authentication: retrieve the credential privately on the computer with `openclaw config get gateway.auth.token`. For Password, use `openclaw config get gateway.auth.password`. Never paste credentials into issue descriptions or logs.
- Tailscale: both devices must be authorized in the same Tailnet. Use `ws://<Tailscale-IP>:18789` with a Gateway bound to `tailnet`, or the trusted `https://<machine>.<tailnet>.ts.net` Serve endpoint (normalized to `wss`). Native Gateway clients still supply Gateway authentication. This page neither installs Tailscale nor changes ACLs.
- Custom: use a reachable Gateway endpoint, preferably `wss` with a certificate trusted by the phone. TLS trust is never disabled. Device approval, when requested, remains on the OpenClaw computer.

## Native policy and build boundary

`app.json` string-loads `plugins/with-openclaw-direct-networking`. This idempotent plugin is the native source of truth; generated Android/iOS files remain ignored. Android's main manifest permits cleartext because user-selected IP endpoints cannot be represented by static domain exceptions. This is an application-wide OS permission; the new product entry is OpenClaw-only, while existing transport policies continue unchanged. The plugin rejects a competing network security configuration for review.

iOS declares Local Network usage, retains `NSAllowsLocalNetworking`, and adds insecure-load exceptions for private IPv4, link-local, loopback, Tailscale CGNAT and private/link-local IPv6 ranges for iOS 17+. Public arbitrary loads remain disabled. Custom public DNS endpoints should use `wss`. Unknown/malformed manifest or ATS input fails prebuild. A native rebuild is needed for installed clients to receive this policy; OTA alone cannot change it.

## Acceptance

Automated coverage verifies endpoint normalization, credential replacement, endpoint reuse, backend isolation, entitlement, cancellation, late probes, timeout, keyboard-aware form controls, masked input, advanced-entry visibility and native policy corruption/idempotence. Default OpenClaw/Hermes pairing and DirectWsTransport regressions remain required.

Physical evidence must distinguish USB deployment from network transport: use the separate Android QA package, enter the computer's LAN Gateway address, complete device approval, verify Agent/session discovery and a harmless QA conversation, return/reconnect, and test invalid credentials. Preserve the installed store package and existing backend pairings. Do not infer Tailscale coverage from a LAN pass; the owner selected LAN first because the devices are not yet in a Tailnet. iOS permission/TLS acceptance requires a later physical iOS check.
