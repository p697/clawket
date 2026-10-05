# Existing Desktop conversation continuation · 2026-10-05

The owner reported that new Codex chats worked but several imported Desktop chats could not send on Bridge 3.1.11 and a client built from current main. The supplied failure details were `Desktop connection interrupted; check the task before retrying.` The outer Mobile notice alone did not identify the failing transport.

## Evidence

- The running local Production Codex owner reported Bridge 3.1.11. Its selected desktop-bundled executable reported native 0.160.0. Pairing scope remained device-wide. No process, pairing or live configuration was replaced during investigation.
- The installed Desktop owner-discovery predicate requires `params.hostId` to match `local`. Clawket omitted that field in foreground queries and background idle probes; the existing test substitutes did not enforce the native predicate.
- A read-only framed query against one real, indexed Desktop thread returned `no-client-found` after 10,004 ms with the old shape. The same thread returned a confirmed owner in 7 ms with `hostId: local`. Two other sampled native threads returned no owner with either shape; this is not evidence that every thread is Desktop-owned.
- Native Desktop logs contain four `ipc-connection-reset` records at 12:11:37 UTC in the reported test window. This supports an IPC reset, not its initiating cause. The old Bridge log recorded Relay lifecycle and native RPC diagnostics but no Desktop IPC rejection/close causes; it cannot retrospectively distinguish a socket loss, reader failure or consumer exception.
- A private, isolated candidate observer followed the same real thread for ten seconds, processed four snapshots and retained a live IPC connection with no projection exception. Native requests were restricted to read methods; zero prompt/resume/settings writes were dispatched. Its own child, socket and metadata directory were retired. This observation is not a successful phone-originated model turn or Desktop GUI retry test.

## Change

Normalize the native local host scope at the IPC call boundary, covering both foreground queries and direct background probes. Reject explicit foreign/malformed scopes. Recover one socket interruption during read-only owner discovery by reconnecting and querying again. Do not retry a submitted turn, settings write, handler error or timeout, and do not weaken imported-thread ownership/idle-history checks.

Persist fixed Desktop IPC metadata through an explicit CLI field allowlist: operation, reason, pending count and optional frame size. Separate oversized/invalid frames, consumer failure and socket loss without recording native errors, user content, paths, credentials or identities.

Regression coverage includes native host-scoped framed continuation for two imported-thread turns, durable duplicate-input suppression, absence of local `thread/resume`/`turn/start`, background discovery scope, malformed-scope rejection, bounded reconnect, unknown delivered-turn retention and diagnostic redaction. The new protocol cases fail against the preceding implementation. Narrow local tests and exact-head CI results belong in the task/PR record.

## Delivery boundary

This is a Bridge code fix. It does not change the Mobile bundle or any Worker. A running 3.1.11 Bridge retains the bug until explicitly updated with the fix. Package publication remains a separate owner-authorized stage; no version bump, npm publication, service deployment or replacement of the owner's running Bridge was performed here. Phone-originated continuation of the affected Desktop chat remains an acceptance requirement after updating the Bridge.
