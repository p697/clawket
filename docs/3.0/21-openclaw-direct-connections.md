# OpenClaw advanced direct connections

Owner decision, 2026-10-06: keep script/code Relay pairing as the default. Only the selected **Connect OpenClaw** guide offers **Local or custom connection**, opening its own `OpenClawDirect` page. Other backend guides and the generic chooser have no advanced entry. Existing saved/local-QR backend compatibility stays intact.

The page supports Local network, Tailscale and Custom transports; backend identity remains `openclaw`. Enter a Gateway address and choose Token or Password. Bare hosts and `http(s)` addresses normalize to `ws(s)` without downgrading TLS; ports, IPv6 and paths survive. Credentials, query strings and fragments in addresses are rejected. Credentials persist only through ConnectionStore/SecureStore and never enter navigation or analytics.

Matching OpenClaw direct endpoints are reused. Retry may change the attempted address, but cannot replace a Relay or another backend. Authentication is replaced completely so an old token cannot override a new password. Keep a saved connection's label. Additional connections use the existing Pro gate; an already saved failed attempt and reopening the matching free endpoint can retry without consuming another slot. Editing a form retires older paywall continuations.

Connect completes only after the current target's OpenClaw handshake reaches `ready`. Duplicate submissions are serialized, failures preserve the form, and a 30-second presentation deadline retires the attempt. Back, blur, unmount and timeout fence late completions and pause only that attempt's active connection; ownership generations prevent an older probe from pausing a successor retry. Existing adapter reconnection, device identity, device approval and functional capabilities remain authoritative.

Pending device approval is an explicit adapter event, not necessarily a runtime error. The coordinator retains only a boolean for its current adapter, clearing it on resolution, ready or retirement. The direct page shows computer approval instructions from this flag even if a pending socket closes with no error text. It never guesses approval from a network timeout.

The coordinator's optional save callback reports the persisted descriptor before waiting for native readiness. This gives setup its exact target for cancellation and for the approval deadline. A late save callback cannot reclaim a successor attempt's ownership.

## Code history

The transport selector disappeared in the 2.1.0 code on 2026-04-18 (`bd69e3e0`); manual address/authentication still survived. The 3.0 shell removed the ConfigTab navigation on 2026-09-05 (`3b7d70d5`), and the same day's cleanup deleted ConfigScreen/manual configuration (`f97c52a2`). These are source commit dates, not verified store release dates. DirectWsTransport, the local QR parser and CLI local pairing remained, so recovery extends their existing runtime rather than introducing another protocol.

## Gateway setup

- Wi-Fi: both devices share a reachable LAN. OpenClaw must listen on LAN (`gateway.bind=lan`) or a custom reachable address, not loopback only. The host firewall and Wi-Fi client isolation must permit the Gateway port (normally 18789).
- `clawket pair local --backend openclaw` remains the local-QR setup flow and can be scanned through the existing OpenClaw guide. It can configure local access and emits the address and authenticated QR; it does not print the token separately.
- Manual authentication: use `openclaw config file` on the computer, then privately read `gateway.auth.token` or `gateway.auth.password` in that file (or resolve its configured secret reference). Current `openclaw config get` redacts credentials, so the help does not promise a plaintext token from that command. Never paste credentials into issue descriptions or logs.
- Tailscale: both devices must be authorized in the same Tailnet. Use `ws://<Tailscale-IP>:18789` with a Gateway bound to `tailnet`, or the trusted `https://<machine>.<tailnet>.ts.net` Serve endpoint (normalized to `wss`). Native Gateway clients still supply Gateway authentication. This page neither installs Tailscale nor changes ACLs.
- Custom: use a reachable Gateway endpoint, preferably `wss` with a certificate trusted by the phone. TLS trust is never disabled. Device approval, when requested, remains on the OpenClaw computer.

## Native policy and build boundary

`app.json` string-loads `plugins/with-openclaw-direct-networking`. This idempotent plugin is the native source of truth; generated Android/iOS files remain ignored. Android's main manifest permits cleartext because user-selected IP endpoints cannot be represented by static domain exceptions. This is an application-wide OS permission; the new product entry is OpenClaw-only, while existing transport policies continue unchanged. The plugin rejects a competing network security configuration for review.

iOS declares Local Network usage, retains `NSAllowsLocalNetworking`, and adds insecure-load exceptions for private IPv4, link-local, loopback, Tailscale CGNAT and private/link-local IPv6 ranges for iOS 17+ ([Apple IP/CIDR exception rules](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity/NSExceptionDomains)). iOS 16 permits direct IP access by default; the IP/CIDR exceptions cover the stricter iOS 17+ behavior ([Apple local networking version rules](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity/NSAllowsLocalNetworking)). Public arbitrary loads remain disabled. Custom public DNS endpoints should use `wss`. Unknown/malformed manifest or ATS input fails prebuild. A native rebuild is needed for installed clients to receive this policy; OTA alone cannot change it.

## Acceptance

Automated coverage verifies endpoint normalization, credential replacement, endpoint reuse, backend isolation, entitlement, cancellation, late probes, timeout, keyboard-aware form controls, masked input, advanced-entry visibility and native policy corruption/idempotence. Default OpenClaw/Hermes pairing and DirectWsTransport regressions remain required.

Physical evidence must distinguish USB deployment from network transport: use the separate Android QA package, enter the computer's LAN Gateway address, complete device approval, verify Agent/session discovery and a harmless QA conversation, return/reconnect, and test invalid credentials. Preserve the installed store package and existing backend pairings. Do not infer Tailscale coverage from a LAN pass; the owner selected LAN first because the devices are not yet in a Tailnet. iOS permission/TLS acceptance requires a later physical iOS check.


2026-10-06 local acceptance: nine affected test files passed serially (344 cases); Mobile types, UI style, config, strict 19-language i18n and agent/documentation checks passed. Clean Android/iOS prebuild and 133 Pods passed. Android Debug and the separate, standalone QA APK built; the installed QA APK is non-debuggable and uses the main cleartext policy, with local debug signing only. No app version change or distribution build.

The USB Android phone connected to the existing computer Gateway over Wi-Fi without an ADB reverse or transport tunnel. Actual UI checks passed for OpenClaw-only entry visibility (absent from the chooser/Hermes guide), empty address validation, masked credentials, keyboard reachability, bad-token authentication and preserved form fields. The correct token produced a fresh QA Android approval request; only that request was approved. The revised page displayed the explicit computer-approval hint, then completed the Gateway handshake and Agent/session discovery. One harmless prompt in a newly created QA session received its exact expected reply. Restarting only the QA App recovered that session/history and a ready connection; explicit Reconnect also returned ready. The connection list contained one entry throughout the retries/restart, displaying backend OpenClaw and transport Local. QA remains installed; own temporary credential/capture files and the Android lease were removed/released. Sanitized local evidence and the QA APK are retained under ignored `docs/3.0/evidence/openclaw-direct-2026-10-06/`.

Xcode 27.0 unsigned arm64 generic iOS Simulator Debug compilation also passed with two build jobs; no Simulator was launched. The compiled App Info.plist retains the Local Network permission description, local-networking allowance, all nine private/CGNAT/IPv6 exceptions and disabled public arbitrary loads. This proves native configuration/build compatibility, not physical iOS permission or network acceptance.
