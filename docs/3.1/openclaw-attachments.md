# OpenClaw generated attachments

Owner requested implementation and physical Android verification on 2026-09-29. Cloud persistence, CDN uploads, native upgrades and releases are outside this change.

## Contract

Preserve `artifactId` from native image blocks and nested document `attachment` blocks in history and live finals, including image-only replies. Artifact-capable OpenClaw removes standalone `MEDIA:` delivery lines from live text (fenced examples/prose remain); older peers and Hermes keep their previous text handling. Native 2026.9.1 can send a raw-text final before managed attachments are read back from history. Old cached directive text is retired only in a turn whose authoritative history includes managed artifacts. Cache stable IDs/type/name/MIME only, never Gateway ticket URLs or downloaded bytes in the transcript. Existing inline attachments and Hermes behavior remain unchanged.

Optional backend-neutral `AgentAdapter.artifacts` provides `open(sessionKey, artifactId)` and bounded `read(sessionKey, handle, offset)`. OpenClaw enables native direct reads only when `artifacts.get/download` are advertised; Relay requires negotiated `clawket.artifacts.open/read` on an authenticated isolated local Gateway channel. Unsupported peers show the attachment reference without inventing a URL. Existing workspace `clawket.files` fallback remains separate and unchanged.

The Bridge obtains authority from native artifact RPCs in the requesting client's Gateway session. Preflight metadata rejects inline artifacts above 5 MiB before requesting their whole Base64 response, preserving the 8 MiB frame boundary. Ticketed managed originals are bounded to 10 MiB and downloaded only from exact-resource routes on the configured Gateway origin, without redirects or reusable owner credentials. External URLs and arbitrary host paths are not accepted. Reads are 128 KiB and tied to their session/channel; at most two loaded/loading buffers across the Bridge process expire after two minutes, on completion, or on disconnect. Downloads use a 45-second deadline; the client open RPC allows 60 seconds. Bridge buffers are RAM only, and Relay stores no file payload.

Native direct access uses the same metadata admission and same-origin ticket policy. RN's buffered HTTP fetch requires a bounded Content-Length. It never sends the Gateway owner token to an image URL. Reconnect retires pending work and handles. HTTP reachability is required for managed files on direct connections; a WebSocket tunnel alone does not imply it.

The chat auto-loads visible images, opens them in the existing viewer and offers explicit system sharing/saving. Documents download on tap. Session downloads are serialized and deduplicated, limited to 16 files / 30 MiB; raster previews require a supported MIME and at most 16 million pixels. Session/connection/access changes invalidate old results. Temporary files are deleted on scope disposal except Android files explicitly handed to another app, whose URI grants retain files for up to 24 hours before the next download prunes them (100 MiB / 128-directory aggregate cache admission cap). No active HTML document execution is introduced. Original files remain on the user's machine; offline/deleted artifacts can become unavailable.

## Evidence

The installed OpenClaw 2026.9.1 Agent `Codex UI Operator` generated a 795,153-byte PNG via its native image-generation capability. A CLI Agent call returned the file but did not itself create a Gateway transcript artifact. A subsequent dedicated `chat.send` delivery created a managed image artifact, confirming that the WebChat delivery path is the relevant integration boundary. Private evidence: `docs/3.0/evidence/openclaw-media-20260929/` (ignored).

Verified on the connected Samsung SM-A566B / Android 16 with the existing independent `com.p697.clawket.connectionqa` development app, a local candidate Bridge owner, and the existing isolated OpenClaw Preview Relay. No Relay or Registry deployment was needed.

- Native generation and historical image-only reply: inline preview and fullscreen viewer passed.
- Image and TXT system share sheets opened with the real downloaded files; no message was sent to an external recipient. This verifies the sharing/Save entrypoint, not a Gallery or Downloads save target.
- PNG original versus Android cache: 795,153 bytes; SHA-256 `0b6e48257c51959bc4a3b1660e4ff33814cacdbd8f6c04f958a18870bc028e25`, byte-identical.
- TXT original versus Android cache: 86 UTF-8 bytes; SHA-256 `bf1b14d23a2408b04799efc1f46b6236bdfe8e3518b1034482cd2b2f5b044801`, byte-identical.
- Actual phone composer send requesting both files: reply rendered image and file card. The first pass exposed a retained raw `MEDIA:` bubble; after the fix, a repeated real send produced only the attachments.
- The native direct reader ran against the actual local Gateway using `artifacts.get/download` and same-origin ticket HTTP, reconstructing the identical PNG. This is not a physical-phone LAN/Tailscale HTTP test.
- Hermes Preview phone smoke: a fresh normal message received exactly `HERMES_MEDIA_REGRESSION_OK`; its owner and runtime were not replaced.

Cold process restart and session reentry also passed: four image references and two document references recovered, with zero raw delivery bubbles. Final local checks are recorded below. Screenshots, integrity receipts and private reproduction helpers are under the ignored evidence directory; no credentials or actual file bytes are added to version control.

## Compatibility and delivery

The installed Gateway was OpenClaw 2026.9.1. Capability negotiation, rather than a guessed version floor, decides availability; Gateways without native `artifacts.get/download` and older Relay Bridges do not gain the feature automatically. Existing inline image rendering and workspace file retrieval continue independently. Direct managed downloads require HTTP access to the same Gateway origin. Cloudflare-only WebSocket routes need the new Bridge operation instead.

To deliver this feature to ordinary installed clients, release the updated App and Bridge through the owner's normal release process. This work only changes repository code, local build output and the isolated QA runtime. It does not change OpenClaw source/config, release versions, official packages, Production services, or store builds. iOS native interaction has not been exercised.


## Local verification

All Jest files were run separately with `--runInBand`; Bridge Vitest files used at most two workers. No full suite was run. Verified Mobile files: `gateway-attachments` (7), `openclaw-artifacts` (6), `useAdapterChatEvents` (16), `ArtifactAttachments` (3), `gateway-session-update` (15), `gateway-adapter.lifecycle` (54), `historyMergePolicy` (49), `chat-cache` (42), `session-files` (8), `gateway-client.recorded` (8), `useChatHistoryState` (150), `liveRunThread` (12), `useChatController.queue` (106). Bridge: `openclaw/artifacts` (11), `openclaw/runtime` (66). Mobile and Bridge runtime typechecks, local runtime build, `check:docs` (7 instruction pairs / 5 tests), UI style (230 files) and diff whitespace checks passed. Final repeats after the last refinements passed: attachment mapping 7, adapter lifecycle 54, attachment UI 3 and Mobile types.

Native phone reentry after switching to Hermes and back restored all four image replies and both document references. Confirmed native turns also retired the legacy raw-path bubbles left by the first QA pass. No duplicate attachment was introduced for an unchanged transcript entry. Artifact bytes were requested again via a new scope rather than reusing an expired ticket URL.

## September 30 follow-up: ordinary CLI sessions and attachment interactions

Owner acceptance exposed a missed case in the `main` Agent using Claude CLI: the text final arrives before the native CLI transcript projection is readable. Actual phone requests received `UNAVAILABLE: session history is rebuilding; retry shortly`; the one-shot post-run refresh left the attachment invisible until foreground refresh. The OpenClaw adapter now retries only that exact read-only error at 0.5/1/2/4-second intervals, with a five-attempt cap and connection-generation checks. Other errors and backends keep their existing policies; sends are never retried. Native run/CLI-session provenance reconciles the imported raw MEDIA response and managed attachment final, including the exact cached live final, without broad text deduplication. Paged/cache copies are also reconciled within a turn only when both their managed delivery IDs and normalized display text match; different attachment IDs or user turns remain distinct.

Documents now use an attachment card with filename, type, downloaded size, busy/retry and system-share actions. Image tiles open the shared viewer without a separate Save row. Visible top controls copy actual image pixels to the OS clipboard and save to the photo library; a bottom control toggles zoom and explains pinch/double-tap. Operations prevent duplicate presses and fence feedback across image/visibility changes. Image conversion/save scratch files are cleaned, and gallery permission requests are write-only/photo-specific. These are explicit local OS actions, not uploads or cloud persistence.

Android acceptance in the owner’s ordinary Claude CLI main session confirmed automatic recovery after four rebuilding errors, a real image + TXT reply, document sharing, clipboard pixels (941×2046), a matching photo saved in MediaStore, actual double-tap/control zoom to 2.2×, and cold/foreground restoration without duplicate deliveries. Eight directed Jest files (115 cases), types, UI style, all 19 locale catalogs and docs passed; per-file counts and limits are in PROGRESS. Pinch and iOS were not separately exercised. Private final screenshots: `docs/3.0/evidence/openclaw-media-20260929/cold-attachments-polished.png`, `viewer-actions-final.png`, `viewer-zoom-final.png`. Previous counts above apply only to the earlier transport milestone.
