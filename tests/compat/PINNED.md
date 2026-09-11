# Compatibility fixture provenance

The compatibility gate must not manufacture a release history that is absent from the repository. The pins below distinguish a version anchor, the source attached to a shipped build, and later pre-3.0 protocol snapshots.

| Requested lineage | Pin | Confidence | Evidence and use |
|---|---|---|---|
| 2.1.0 version anchor | `bd69e3e09da028839d92321a55e97811fc44cd36` | exact | First source commit that sets the App version to 2.1.0. |
| 2.1.0 shipped production source | `c2bfe068da15837d94dce70c3247fb39759e9c59` | exact | EAS Store build 20109 (`88678af7-…`, 2026-04-20) points at this source revision with appVersion 2.1.0. This is the primary 2.1.0 fixture source. |
| published npm 0.6.4 Bridge source | `a3edb44d89dcd7562f55c83fa5804e9fb1bba81e` | exact registry metadata | `npm view @p697/clawket@0.6.4 gitHead` reports this commit. The source tree still says CLI 0.6.2, so the npm version is recorded as registry provenance rather than rewritten into source history. |
| latest published npm 0.7.0 Bridge source | `bd69e3e09da028839d92321a55e97811fc44cd36` | exact registry metadata | `npm view @p697/clawket@0.7.0 gitHead` reports this commit. This is the latest published pre-3.0 Bridge package found during M0. |
| requested 2.1.1 lineage | `31a857abe4aaa362ec335213c8e381135d3ef0a0` | inferred only | No commit, ref, tag, App source version, or inspected EAS build identifies an exact 2.1.1. This is the only intermediate mobile/Bridge protocol revision found before 2.1.2. Its source package version remains 2.1.0, so its wire `client.version` must not be rewritten to 2.1.1. |
| 2.1.2 version anchor | `3e37a72e95615ace91c387571f0ef62acadd92e5` | exact anchor | Version bump on 2026-08-27. It does not contain pairing-session resolve or `relay.client-pong.v1`. |
| latest pre-3.0 client/server snapshot | `d9c1adae8192839c78cb6e10091551cf342c3a93` | exact snapshot | Contains the additive pairing-session and negotiated client-pong frames required by the 3.0 compatibility specification. It is recorded separately and is not represented as the 2.1.2 release anchor. |
| latest pre-3.0 Bridge snapshot | `9cf26e59dc6269292e8b6769ba1db47023157597` | exact snapshot | Last pre-3.0 Bridge compatibility fixes used by the forwarding fixtures. |

## Historical Bridge build matrix

`legacy-bridge.test.ts` executes `git worktree add --detach` for the npm gitHeads and the c2 / 31a / 3e37 / 9cf source pins, verifies the checkout SHA, builds historical `bridge-core` and `bridge-runtime`, dynamically imports `dist/runtime.js`, and connects it to the current Registry and Relay under `wrangler dev`.

The historical full-monorepo locks contain an already-stale Expo dependency closure and do **not** pass a full `npm ci`; the gate does not claim that they do. It creates a reduced lock containing only the two Bridge workspaces and their exact TypeScript, Node types, ws types, ws, and (where present) tweetnacl records from that commit. If a duplicate historical lock record omits `resolved` / `integrity`, those fields are filled only from the same package name and exact version elsewhere in the same lock. `npm ci` then installs this minimal closure without re-resolving versions, and the test verifies every installed version before compiling.

The input tree and selected-lock fingerprints prove these equivalence groups:

- npm 0.6.4 `a3ed`, npm 0.7.0 / App version anchor `bd69`, and shipped-App snapshot `c2` have the same OpenClaw Bridge closure. Their differences are outside the loaded OpenClaw runtime path, so one content-identical build covers the group.
- inferred 2.1.1 snapshot `31a` and the 2.1.2 anchor `3e37` have the same OpenClaw Bridge closure; the only Bridge-runtime source change is in the excluded Hermes path. The 3e37 mapping is replayed with the later d9c 2.1.2 client wire and is not presented as a d9c Bridge build.
- `9cf` is a distinct pre-3.0 OpenClaw Bridge build.

Each unique artifact performs challenge / connect, `chat.send`, `sessions.list`, and 1.5 MiB attachment round trips through the current Relay. Built artifacts are content-addressed under the Git common directory; the cache manifest and every artifact file are SHA-256 checked, corrupt entries are rejected and rebuilt, and detached worktrees are removed on success or failure.

## Capture status

Recorded/replay date: 2026-09-05.

The committed JSON contains sanitized wire envelopes extracted from the pinned serialization and forwarding boundaries. The compat runner materializes them and sends them through real `wrangler dev` Registry/Relay processes and in-process `BridgeRuntime`/`HermesRelayRuntime` instances. Random identifiers, credentials, ports, and timestamps are replaced by test values or validated with explicit structural matchers.

This is not represented as a packet capture from a downloadable historical App binary. The repository has no exact 2.1.1 source record, and the post-2.1.2 pairing-session/pong additions cannot honestly be attributed to the 2.1.2 version anchor. Those gaps are deliberately visible here so later evidence can strengthen the provenance without changing the frozen frame contract.

## Protocol notes

- Shipped Clawket 2.1.x source sends `method: "connect"`. `connect.start` is retained as a Relay/Bridge compatibility alias and is explicitly annotated as a synthetic alias in the fixture; it is not claimed as a published App capture.
- Connect scopes are executed from each pinned client's `getConnectScopes` / `getDefaultConnectScopes` method and compared with the fixture before the deterministic Ed25519 signature is verified. c2 / 31a use the historical four operator scopes; d9c uses its seven default operator scopes.
- The additive-control regression extracts the exact `handleRawMessage`, `handleRelayControlFrame`, and `parseRelayControlFrame` implementations from c2 / 31a / 3e37 / d9c, transpiles them in memory, and proves an unknown future `relay.ready` event neither closes the client nor prevents the following ordinary frame from reaching the historical downstream dispatcher.
- Hermes does not use OpenClaw's `connect`, `connect.start`, or `connect.challenge` handshake. Its fixture is websocket upgrade, the local Bridge `health` event, and `sessions.list` request/response.
- The 1.5 MiB attachment is stored as a deterministic `$base64` materialization recipe. At replay it becomes exactly 1,572,864 decoded bytes (2,097,152 base64 characters) and a 2,097,412-byte JSON `chat.send` frame. The historical-image test executes each pinned client's exact `preparePendingImagesForSend`, `sendChat`, and `sendRequest` source boundaries. Expo ImageManipulator is replaced only at its platform boundary with deterministic candidate outputs; this is not represented as a true-device compressor capture.
- The pinned pipeline declares a 2 MiB soft target and a 5 MiB hard-limit constant, but if all three compression attempts remain over 5 MiB it returns the smallest candidate instead of rejecting it. The test freezes that source behavior and the resulting serialization boundary (a 5 MiB decoded attachment produces a 6,990,768-byte JSON frame). True-device Expo compression output and visual quality remain human-device validation work rather than a compatibility-gate claim.
- Close code 4010 is pinned against the exported Relay contract and its existing failing-send/rehydration unit paths. A healthy network peer cannot deterministically cause the server-side send exception needed to produce it, so the live Wrangler replay does not claim to trigger 4010 over the wire.
- There are no formal release tags for these versions in the inspected repository history.
