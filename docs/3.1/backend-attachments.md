# Backend-delivered images and files

Publication follow-up: Bridge 3.1.5 was published on 2026-09-30; see the [release record](bridge-3.1.5-release.md). The implementation/testing scope below is historical; App distribution and Production services remain unchanged.

Owner-authorized extension, 2026-09-30. This is local candidate implementation and Preview testing, not a Production deployment or package/App release.

## Capability and delivery

All five backends can deliver existing images and supported files to Clawket. Image generation still depends on the backend's configured model/tools. Receiving an image does not require a vision-capable text model.

| Backend | Delivery source | Negotiation |
| --- | --- | --- |
| OpenClaw | Native managed artifacts, with native download authorization | See [OpenClaw attachments](openclaw-attachments.md) |
| Hermes | Assistant Markdown/`MEDIA:` references under configured local terminal cwd or Hermes outputs | `bridge.artifacts.v1` |
| Pi | Assistant file links under the paired project; native assistant image blocks | `health.artifacts: true` |
| Codex | Assistant file links under the verified thread project; successful native `imageGeneration.result` | `health.artifacts: true` |
| Claude Code | Assistant file links under the native/owned session's verified project | `health.artifacts: true` |

Use ordinary Markdown delivery, for example `![Preview](output.png)` and `[Report](report.pdf)`. Relative paths resolve against the authorized project; absolute paths must remain inside that scope. A fenced example is not an attachment. Inline-code file references retain the existing workspace-file behavior, but user messages and arbitrary tool arguments never authorize retrieval. Ordinary tool images (such as a file inspection or browser screenshot) are not automatically published as final attachments. Files outside the allowed roots, remote/container paths without a local authorized file and unavailable/deleted files are not silently fetched elsewhere.

Native capabilities were checked against installed sources/schema: Hermes API `MEDIA:` image conversion (which does not itself deliver arbitrary documents), Pi's [message types](https://pi.dev/docs/latest/message-types) and [RPC](https://pi.dev/docs/latest/rpc-commands), Claude's [tool result content](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), and the installed Codex App Server generated `ImageGenerationItem` schema. A tool result containing an image is distinct from an assistant's explicit delivery. Native Claude/Pi tool images remain tool context unless the assistant delivers a supported local reference.

## Data and safety boundaries

- Files stay on the user's computer. The authenticated Bridge serves 128 KiB chunks over the existing direct/Relay connection. No CDN, public file endpoint, new cloud bucket or persisted Relay payload is added. Existing native histories and phone-local cache/save behavior remain local to the user.
- A client supplies a session key and opaque artifact/handle ID, never an arbitrary path or URL. Project roots come from native/paired session metadata. No native writer takeover, permission escalation, credentials migration or external Hermes modification is introduced.
- File IDs include session, canonical path and file identity/version. Regular files only; reject traversal, symlink components, hardlinks, hidden/private files and configuration/credential names. Revalidate inode, size and modification metadata before and after every read.
- Files are at most 10 MiB. Supported extensions are PNG/JPEG/GIF/WebP, PDF/TXT/Markdown/CSV/JSON, ZIP, DOCX/XLSX/PPTX, SVG/HTML and selected text source/log files. SVG/HTML are downloadable documents, not active content rendered by Clawket. Raster previews have the existing 16-million-pixel cap.
- Native inline generated images are limited to 5 MiB each, 20 MiB and 128 entries per service in memory, expiring after two minutes. They become IDs in mobile history, not cached Base64 transcripts. File metadata handles expire after 15 minutes, with at most 128 entries. Up to 256 RAM-only native page references allow a bounded reauthorization of an expired handle without scanning all history. Reset/delete/stop and pending-read generation fences retire authority.
- Old Bridges omit the negotiation and retain their existing behavior. Pi history keeps existing inline assistant images for old readers; new readers explicitly request `artifacts: true` to receive opaque references. Image input capability flags are unchanged. Cloud frame limits remain 8 MiB. Downloads are serialized by the shared UI, bounded and discarded after a connection/session/access change. See the OpenClaw attachment document for phone cache retention and share-grant cleanup.
- Successfully resolved local links are replaced by attachment cards in the additive `artifactDisplayText` projection; legacy wire text and native transcripts remain unchanged. External links, unresolvable paths and code examples remain ordinary text. Images use the same viewer, zoom, copy-pixels and photo-save controls across backends; files use the system sharing UI.

## Real-device acceptance

Device: Samsung SM-A566B, Android 16, existing `connectionqa` development app, isolated Preview connections. No new signed app, package publication or Production changes. Installed native versions: Codex CLI 0.153.3, Pi 0.87.1, Claude Code 2.1.283; Hermes checkout `9dd6634`.

Real phone composer sends went through each native backend/model: Codex GPT-6 Astra, Claude Code Claude Opus 5.5, Pi Qwen 3.5 Plus, Hermes DeepSeek Flash. All four delivered the same existing 795,153-byte PNG and 89-byte UTF-8 TXT. Both files were downloaded on Android and matched the computer originals by SHA-256 for every backend. Each file card opened the Android sharing flow. All four image viewers were opened; Hermes image copy and photo-library save returned the actual 1254×1254 pixels. OpenClaw's separate prior acceptance covers native generation, download and ordinary-session recovery.

Pi first returned the TXT link inside a fenced example, which correctly did not authorize a file. An explicit actual Markdown link in its next reply delivered the TXT. Hermes initially claimed its API could not send a document; the Bridge attachment transfer nevertheless delivered it correctly. Agent prose alone is not delivery evidence.

Private screenshots and test helpers live under ignored `docs/3.0/evidence/multi-backend-media-20260930/`. Fixture hashes: PNG `0b6e48257c51959bc4a3b1660e4ff33814cacdbd8f6c04f958a18870bc028e25`; TXT `4f9f14d64ae8a183d7d28b743272a7476ca424c1952e1af223ce54089a8143b2`.

After the final display-projection change, all four local QA Bridges were restarted and the phone App cold-started. Reopening each native session restored its image/file cards without duplicate deliveries; fresh Android downloads again matched both fixture hashes for all four. A new Hermes reply also rendered image-only/file-only content correctly in realtime. Automated verification is recorded in the progress log. Native Codex image-generation mapping has protocol regressions; the four-backend phone acceptance above uses an existing image, and does not claim every configured model can generate images. Physical iOS, Windows hosts and remote/container file delivery are not covered by this device run.
