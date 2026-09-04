# OpenClaw Connection Compatibility

This document records Clawket's internal OpenClaw connection contract. It is an implementation boundary, not a user-facing mode matrix.

## Pairing flow

1. Bridge detects whether gateway auth is configured without resolving or printing SecretRef values.
2. Mobile advertises `openclaw.bootstrap.mobile-setup.v1` in the existing Relay bootstrap request. Only a Bridge that sees that exact capability invokes `openclaw qr --json --url <gateway-url>` with the actual OpenClaw Gateway URL used by the Bridge—not the Relay transport URL—and extracts the bootstrap token, expiry, and access classification from the setup code.
3. Mobile opens a temporary signed `node` connection with no operator scopes, capabilities, or commands.
4. OpenClaw returns role-bound device credentials in `hello-ok.auth.deviceTokens`.
5. Mobile stores the operator token together with the exact returned scopes and immediately reconnects as the operator. No setup or compatibility choice is shown to the user.

The signed device payload uses the nonce and timestamp from `connect.challenge`. Stored device credentials are scoped to the Relay gateway identity or direct gateway URL so one connection cannot overwrite another.

### Secure pairing invitations

New Bridges also create a short-lived encrypted invitation for the same single-use Relay claim payload:

- The existing compact QR remains the compatibility source of truth and is still printed for old Apps.
- The Registry stores separate TweetNaCl `secretbox` ciphertexts for the one-tap link and legacy human code. It never receives the decoded QR payload or URL key.
- The one-tap key is carried only in the URL fragment. A version-2 Registry advertises `pairing.secure-short-code.v2` only after the live Relay advertises the same capability, then lets the Bridge present a six-digit numeric code.
- The six-digit code is not an encryption key. Registry turns its SHA-256 lookup value into a secret-keyed HMAC KV key, then issues a 90-second Relay ticket scoped only to the matching pairing session.
- Pairing-ticket sockets are isolated from normal Relay clients: they cannot send OpenClaw frames, become the active client, affect Gateway demand, or receive normal Gateway traffic.
- Mobile creates an ephemeral Curve25519 key pair. Bridge verifies a code-bound request proof, encrypts the existing QR payload directly to that public key with TweetNaCl `box`, and adds a code-bound response proof. Registry and Relay never receive the plaintext payload or either ephemeral private key.
- Bridge persists only the active ten-minute responder state in a mode-`0600` Clawket-owned file, accepts at most five handshake starts, and replaces that state whenever a new invitation is created.
- The legacy 12-character encrypted-code payload remains in the invitation for old App/Registry compatibility but is not the primary code shown by version-2 infrastructure.
- Mobile presents the pairing command and code entry as the single primary onboarding path. QR scanning and upload remain available behind a collapsed compatibility entry for legacy Apps, older infrastructure, and self-hosted deployments.
- Mobile decrypts locally, parses the result with the existing QR parser, asks for confirmation, then runs the unchanged single-use claim/save/reconnect flow.
- A successful claim, access-code refresh, or expiry invalidates the invitation. Code resolution is rate-limited per source address.
- If an older Registry does not implement invitation endpoints, the Bridge silently retains the legacy QR-only behavior.

## Backward compatibility

- The supported Gateway protocol range remains 3 through 4.
- A Bridge response without bootstrap strategy metadata is treated as the legacy bound-bootstrap flow.
- A new Bridge treats missing or unknown request capabilities as an old App and issues the legacy bound credential. This is the conservative default; capabilities never upgrade by inference.
- After the App and Bridge explicitly negotiate mobile setup, Bridge writes the legacy `devices/bootstrap.json` record only when the installed OpenClaw CLI does not support the official setup-code command.
- Existing raw token and password configurations remain valid recovery paths.
- Legacy raw device-token strings are read as operator records with unknown scopes and upgraded when OpenClaw returns current role/scope metadata.

## Version-skew matrix

| App | Bridge | Negotiated behavior |
| --- | --- | --- |
| Old | Old | Existing legacy bootstrap contract. |
| New | Old | Old Bridge ignores the additive capability; new App treats an unmarked response as legacy-bound. |
| Old | New | Capability is absent, so new Bridge deliberately issues the legacy bound credential. |
| New | New | Exact capability match enables official mobile setup and automatic operator handoff. |

The secure invitation layer follows the same additive skew rule: old Apps scan the unchanged QR; new Apps can scan that QR or use a link/code emitted by a new Bridge and Registry. A Registry that does not advertise the exact version-2 capability causes the Bridge to keep presenting the legacy 12-character code. Registry also verifies the deployed Relay capability before advertising version 2, so mixed server rollout order fails closed to the legacy path instead of creating an unusable six-digit invitation.

Bootstrap negotiation still uses the existing forwarded control envelope and does not depend on the newer Relay liveness capability described below.

## Relay liveness and recovery

Relay liveness is an additive capability contract:

1. New Apps add `relay.client-pong.v1` to the Relay WebSocket `capabilities` query parameter.
2. A compatible Relay tick adds `ack: "relay.client-pong.v1"`; the App replies with `{ "type": "pong", "ts": <tick-ts> }`.
3. The Relay consumes pong locally and never forwards it to OpenClaw or Hermes.
4. Only capable clients are closed for missing pongs. Old Apps remain connected while their socket is writable and are never treated as dead merely because they have no business traffic.
5. A challenge delivered without a following connect request is a handshake-specific failure and may still be closed after the configured challenge TTL.

If the Bridge cloud socket or its local OpenClaw Gateway session is lost, Relay closes the affected App transport so every App version follows its existing reconnect path and receives a fresh challenge. This avoids an App remaining falsely ready against a replacement Gateway session.

The Bridge resets Relay backoff after a transport pong and resets local Gateway retry backoff only after a successful connect response. Hermes additionally accepts inbound Relay traffic or a stable 30-second connection as health evidence, and uses low-frequency cloud bridge-status polling alongside a real local bridge request/response probe.

## Security and product boundaries

- Bootstrap tokens, decoded setup codes, and device tokens must never be logged.
- SecretRef presence may be reported as configured, but its value must not be copied into Clawket state or output.
- Temporary setup strategy and handoff details stay out of terminal summaries, JSON product output, and mobile settings.
- Hermes backend identity, adapters, transport selection, relay infrastructure, and lifecycle are unaffected by this OpenClaw-specific flow.

## Production and Preview environments

Preview is an isolated service environment for the existing OpenClaw Relay transport. It does not add a backend or transport identity and does not alter the wire protocol.

- Mobile exposes the environment selector only in Debug Mode and checks that official Production/Preview QR codes match the selected environment.
- Custom and self-hosted Registry URLs are not environment-gated.
- Bridge stores Production and Preview pairing state separately and can keep both Relay runtimes connected through the same installed service.
- Registry, Relay, KV, Durable Object state, and pairing credentials are isolated. Preview failure or deployment must not affect Production.
- `clawket pair --preview` is the supported Preview pairing entrypoint; `npm run relay:test:preview-product` exercises the real claim, client authentication, Bridge presence, and OpenClaw challenge path.

## Required regression coverage

- Official setup-code issue and decode.
- Unsupported-CLI legacy fallback.
- SecretRef detection without value exposure.
- Relay strategy forwarding and absent-field compatibility.
- Capability-present official selection plus missing/unknown-capability legacy selection.
- Temporary node handshake, operator handoff persistence, and automatic reconnect.
- Direct QR parsing, expiry rejection, legacy token migration, and gateway-scoped storage.
- Existing OpenClaw token/password and Hermes required suites.
- Encrypted invitation creation/read/resolve, six-digit scoped-ticket handshake, ephemeral payload encryption, Bridge-side attempt limit, expiry/rate-limit handling, and legacy QR/code fallback.
- Capability-negotiated tick/pong, legacy idle preservation, missed-pong expiry, and hibernation attachment persistence.
- Bridge Relay backoff reset, Gateway handshake-qualified reset, and forced App reconnect after unexpected Gateway loss.
