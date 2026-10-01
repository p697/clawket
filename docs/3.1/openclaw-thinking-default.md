# OpenClaw inherited thinking · issue #46

OpenClaw `chat.send.thinking` is optional. Absence means follow the Gateway's session/model configuration; `off` explicitly disables thinking and is invalid for some models. The Mobile adapter and protocol helper must omit the field unless a per-message preference was supplied. Keep explicit levels unchanged, including `off`. A `/think` command must not acquire an implicit per-message override. Do not select a universal substitute such as `low`.

This is a client fix. Bridge/Relay forward the existing request contract; no new protocol, backend settings migration or service publication is needed. Existing installed clients need a client update to receive it. Hermes serialization remains unchanged.

The Mobile recorded-boundary test explicitly requests the historical fixture's `off`; the immutable v1 fixtures and server replay remain unchanged. New request tests separately verify inherited and explicit values. Real-model checks use fresh, labelled QA sessions and do not modify existing sessions, global defaults, credentials or host networking.

## Verification · 2026-09-29

Before the fix, the new adapter omission case failed and protocol-helper cases failed for omission and explicit `high`. After the fix, four focused Mobile files passed: `gateway-adapters.recorded.test.ts` (36), `gateway-client.legacy-parity.test.ts` (127), `gateway-client.recorded.test.ts` (8), and `useChatController.contract.test.ts` (57), totaling 228 cases. Mobile TypeScript, v1 `live-replay.test.ts` (8 OpenClaw/Hermes cases), instruction checks (7 symlink pairs / 5 checker cases), and diff whitespace checks passed. Other compatibility files were not rerun; this is not a full repository test claim.

One fresh labelled QA session on the existing local Gateway was used for real model calls. GPT-6 Astra completed inherited-high, explicit-low and subsequent inherited-high turns; DeepSeek Flash completed inherited-off and explicit-off turns after a session-only model switch. A fresh RPC connection read back all five completed replies exactly once. Explicit per-message low did not replace the session's high setting. The initial exact-string check rejected a harmless trailing period; the actual completed reply and unique history record were separately verified, with the original result retained.

Android physical-device QA used `com.p697.clawket.connectionqa`, the current workspace Metro bundle and an existing OpenClaw connection. The fresh QA session was restored to GPT-6 Astra/high. A normal phone send completed; after force-stopping/reopening only the QA App and selecting the same session, history and model/thinking state remained correct, and a second phone send completed. Native history confirmed both phone prompts and final replies once each, with no tools. Screenshots `11-reply.png`, `16-cold-history.png` and `19-followup-reply.png` were inspected. Existing user sessions, pairing credentials and global defaults were not modified. The labelled QA conversation remains available for owner inspection; no new connection was created.

Limits: the available local CLI reports OpenClaw 2026.9.1, while the issue reports 2026.9.6. The local Gateway accepted the old explicit-off control, so the reported model rejection was **not** reproduced on this environment. The serialization defect is independently reproduced by the regression tests, and successful real calls do not establish all model/version combinations. iOS was not retested this round. No client package, server deployment or npm publication was initiated.

Private sanitized result summaries and raw QA-only diagnostics: `~/.clawket/testing/issue-46-20260929/`. No credentials or user conversations are committed here. Issue: https://github.com/p697/clawket/issues/46.

## Per-model levels · 2026-10-01

Owner report on 2026-10-01: the model sheet offered OpenClaw sessions a static list (off, minimal, low, medium, high, xhigh, adaptive). On GPT-6-Astra it showed `Minimal` and `Adaptive` but not `Max`; the Gateway refused `Adaptive` and the choice snapped back to `Medium`. Each choice also posted a visible `/think <level>` message and a reply.

OpenClaw 2026.9.1 already resolves the levels per session from the session's model, agent runtime and catalog. These are read-only findings from the installed Gateway (`dist/session-utils-model-*.js`, `dist/sessions-patch-*.js`):

- `sessions.list` rows report:
  - `thinkingLevels` (`{ id, label }`) and `thinkingOptions` (labels);
  - `thinkingDefault`;
  - the stored `thinkingLevel`, and the `effectiveThinkingLevel` (stored, else default).
- `sessions.patch { key, thinkingLevel }`:
  - rejects a level the model does not support;
  - with `null`, clears the override;
  - on a model change, normalizes an unsupported stored level to a supported one.
- The patch result's `resolved` names the model, its `thinkingLevels`, and the level in effect.

Clawket now does the following:

- **Reading:** the OpenClaw adapter reads these levels with the session (`ModelSelectionState.thinkingLevels`). The order is depth, then `adaptive` last; unknown IDs are dropped. It marks the level in effect and takes the new model's levels from the `sessions.patch` result after a model switch.
- **Writing:** once a Gateway has reported levels, choices go through `sessions.patch` `thinkingLevel`, which posts no chat message. Older Gateways keep the static list and `/think <level>`.
- **Unchanged:** sends still omit `chat.send.thinking` unless a per-message preference is supplied (issue #46 above). Displaying the level in effect adds no per-message override.

