# Native media boundary

`ClawketMedia` owns protected local files and ImageIO preparation; `ClawketRuntime` owns backend capability evidence, complete prompt preflight and short-lived output authority. The host owns picker UI, scoped draft/outbox transactions, preview/share presentation and access gates. The maintained host binds these flows through `NativeAppMedia` and `NativeMediaController`; physical-device media acceptance remains separate.

## Import and draft ownership

Create `MediaImportStager` and `MediaLibrary` in dedicated directories inside the app sandbox. **Call `stageFile` synchronously inside `NSItemProvider.loadFileRepresentation`'s completion handler**, then cross into a Task to adopt the owned receipt. Apple deletes that temporary URL when the callback returns. Document picker access remains scoped and coordinated by the host; never persist external URLs. System `/var` and `/tmp` aliases are canonicalized; other symlink descendants and non-regular files are rejected. Source reads use `O_NOFOLLOW`, bounded chunks and before/after descriptor metadata.

```swift
provider.loadFileRepresentation(forTypeIdentifier: identifier) { temporaryURL, error in
    guard let temporaryURL else { return /* host reports a fixed failure */ }
    do {
        let staged = try stager.stageFile(from: temporaryURL, name: name, mimeType: mimeType)
        Task { /* check captured host draft generation, then await library.adopt(staged) */ }
    } catch { /* fixed host failure; preserve accepted drafts */ }
}
```

Imports cap source files at 32 MiB; sequential ImageIO preparation uses 1600/1440/1280 pixel presets and produces at most 5 MiB per item. GIF bytes stay intact; transparent PNGs retain alpha. Previews use transformed dimensions. Input previews normalize the original through bounded preparation first, so normal high-resolution/HEIC photos do not need a full-size UIKit decode. Generated raster previews accept PNG/JPEG/GIF/WebP with a 16-million-pixel source ceiling; SVG/HTML stay documents. A per-image bound never proves that the complete send fits.

Persist owned `MediaResource.id` references and metadata only after adoption succeeds. File URLs retain the original safe filename under an opaque UUID directory. SHA-256 is checked before explicit preparation/preview/sharing. On cold-open, reconcile every already persisted draft/outbox ID with `recoverResource` **before new library mutations**. Persist queue removal before explicit resource deletion. `draftResources` supports reconciliation; no age policy silently evicts a draft. Host picker/paste results must check a captured generation even for A→B→A navigation, and six accepted slots must be reserved serially.

Library metadata has verified current and rollback generations. I/O failure after an atomic replacement has an unknown commit outcome: retain both generations' files, return `commitUncertain`, and block further use until reopen. A staged receipt exposes its stable ID for recovery after an uncertain adoption. Recognized uncommitted UUID directories are reconciled on cold-open; unknown/corrupt metadata never becomes an empty library. Actual disk accounting includes rollback files and pending reservations: at most 128 resources/100 MiB. Staging has its own bounded directory; discard unused receipts explicitly. After verifying the accepted queue on cold-start, `removeUnreferenced(keeping:)` clears only unadopted staging receipts. Filenames, references, URLs and bytes are application data and never diagnostic labels.

## Prompt and capability contracts

`RuntimePrompt.attachments` carries typed image/file, normalized MIME, `Data` and optional name. `validatePrompt(sessionKey:input:)` is local-only; call it before moving an editable outbox. `send` repeats the same validation with the current capability evidence. Transport preflight and dispatch share the complete request constructor and UTF-8 serializer, including the 36-byte request ID and all envelope fields. JSON slash encoding matches `JSON.stringify`, preserving nominal 5 MiB base64 flows. Local frame refusal is `rejectedBeforeDispatch`; remote/copied frame codes never prove that category. An unknown native write stays uncertain and is never replayed.

| Backend | Input | Output negotiation |
|---|---|---|
| OpenClaw | Images and arbitrary files | Exact advertised `clawket.artifacts.open/read`; direct-only `artifacts.get/download` fallback |
| Hermes | Images; bounded document MIME list only with `hermes.documents.v1` | `bridge.artifacts.v1` |
| Codex / Pi | Images after verified health | `health.artifacts === true` |
| Claude Code | Images only with `health.vision === true` | `health.artifacts === true` |
| local-model | Images only with `health.vision === true` | No current output artifact API |

Keep selected-model restrictions independent: `RuntimeModel.supportsImages` is false for known text-only input, true for image input, and unknown when metadata is absent/empty. Apply it only to that conversation's current model metadata. The host supplies localized attachment-only prompt text; Runtime has a non-empty wire fallback.

## Output and cache ownership

`openArtifact(sessionKey:artifactID:)` returns a non-Codable `RuntimeArtifactHandle`; `readArtifact(_:offset:)` checks its captured connection/authentication/socket generation before and after each await. Metadata caps files at 10 MiB and names/opaque IDs to the existing protocol limits. Reads require exact 128 KiB offsets/lengths, total, done and canonical base64, including one empty terminal chunk for a zero-byte file. Handles expire after two minutes, retire on capability loss/new authentication/connection retirement and never authorize another coordinator. Pi requests artifact history only after negotiation; local-model never advertises this output API.

OpenClaw direct downloads retain one absolute 45-second metadata/ticket/body budget. Tickets must share the saved Gateway origin and exact allowed `/api/chat/media/outgoing/` or `/api/artifacts/download/` path prefix. Relay never reinterprets a ticket as a Relay HTTP path. Ephemeral URLSession GETs use no owner credentials, cookies, cache or redirects; every body callback enforces the 10 MiB limit even without Content-Length. Active ticket tasks cancel on scope retirement. Bounded direct bytes stay in memory only for short-lived handles, at most 20 MiB total.

Stable history/live references are exposed through `RuntimeMessage.attachments` and `RuntimeSessionUpdate.finalAttachments`, including image-only finals. Legacy inline content is decoded only on explicit `inlineAttachmentData`/`inlineFinalAttachmentData` consumption, with canonical base64/5 MiB bounds; managed IDs always win over inline bytes. `stageData` moves such legacy content into owned files. SDK/Hermes `artifactDisplayText` is a presentation projection only when real artifact references exist. OpenClaw removes standalone MEDIA delivery directives only on its negotiated path, preserves fenced examples, and history deduplicates only matching managed IDs/text within the same user turn. Raw wire history remains intact.

Pass a captured Runtime handle's read closure to `MediaLibrary.cacheArtifact`. Downloads deduplicate by connection/session/stable artifact ID, reserve capacity before awaiting and reject late invalidated chunks. The host invalidates pending work on scope/access changes; a return to the same route does not revive the old operation. Cache limits are 16 files/30 MiB per conversation within the global disk bound, with 24-hour expiry. Missing/corrupt generated cache entries can refetch; draft corruption stays explicit. Retain a resource through system sharing completion, then release it before expiry/removal. Preview/downloaded bytes and temporary ticket URLs never become managed transcript cache fields.

## Native host transactions

The host exposes system Photos, camera, Files and explicit Paste actions only through actual runtime input capabilities. Known current text-only models reject image inputs; missing metadata remains unknown. Hermes model changes apply globally. Six slots include accepted files and active imports; plaintext paste inserts at the native text view's selection without replacing its identity or composer draft. Provider callbacks copy immediately; document access stays security-scoped/coordinated, and cancellation waits for the captured copy before cleanup. [NSFileCoordinator cancellation](https://developer.apple.com/documentation/foundation/nsfilecoordinator/cancel%28%29) can return before a running accessor finishes.

`NativeConversation.draftResourceIDs` and `NativeMessage.media` hold owned UUIDs separately for composer and outbox. New arrays decode with explicit missing-key defaults in actual version-one documents; unknown versions fail. `NativePendingEdit.originalMedia` freezes the editable queue snapshot, preserves the original idempotency key and never replaces the composer. A persistent ownership journal precedes adoption, so a process exit before conversation commit recovers the original route. Definite import rejection records release; an unknown save retains its pending ownership. Reclamation serializes against document writes and scans the union of every current/rollback conversation reference. Missing or corrupt ownership disables cleanup instead of dropping files.

Send prepares stable resources and validates the complete native envelope before moving the composer or reserving an outbox item. Attachment-only input receives localized prompt text. Runtime validates again at dispatch; unknown sends retain exact resources and identity without replay. Route, activation, selection and draft revisions fence late work, including A→B→A. Operation tokens prevent old completions from unregistering replacements; a serialized artifact-invalidation barrier prevents delayed old-route cleanup from cancelling a new return to that route.

History and existing run-finished updates consume typed attachment projections, including image-only finals. Persisted artifact metadata supplies display context only; loading obtains a fresh current Runtime handle. The host bounds decoded row images, cancels retired loads and supports explicit retry. Raster viewers use bounded pixels, native zoom, pixel copying and add-only Photos authorization. SVG/HTML remain shareable files without image/web preview. Sharing has its own retain: a never-presented controller releases on dismantle, an appeared system controller releases only on completion. Saving owns a separate retain through permission and Photos completion even if its preview closes.

## Sources and acceptance

The Mobile consumers and `packages/agent-protocol` remain the wire oracle: attachment MIME classification, `session-files.ts`, gateway attachment projections, OpenClaw ticket reading and SDK adapter negotiation. Apple's [file representation lifetime](https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(fortypeidentifier:completionhandler:)), [system photo picker](https://developer.apple.com/documentation/photokit/selecting-photos-and-videos-in-ios), [document access](https://developer.apple.com/documentation/uikit/providing-access-to-directories) and [ImageIO thumbnail APIs](https://developer.apple.com/documentation/imageio/cgimagesourcecreatethumbnailatindex(_:_:_:)) define the native import boundary.

Six focused files passed serially under the heavy lease, Swift 6 and two build jobs: MediaLibrary 9 functions/11 inputs, MediaImages 3/4, Attachment 7/17, Artifact 7/22, ArtifactHTTP 3 and actual loopback HTTP 2 (31 functions/59 inputs total). They cover index failures after replacement/protection/read-back, cold-open resources, provider deletion, stale scopes, exact frame/chunk boundaries, six-backend input/five-backend output negotiation, image formats/rotation, real bounded URLSession requests and redirect refusal. Full old-client/native/app gates remain in exact-head PR CI.

Twelve new host regressions cover actual old-v1 reopen, import crash recovery/rejection, unknown save preservation, current+rollback ownership, attachment-only queue editing, uncertain send identity, provider receipt recovery, preview/share handoff lifetimes, replacement-operation fencing, current/global model gates and high-resolution input versus strict generated-image limits. The generic unsigned app/test build and exact-head CI results are recorded in `docs/3.0/PROGRESS.md`. System picker/cloud loading, camera/HEIC, mixed paste, real backend media sends, generated-image viewing/sharing and phone recovery still require the designated USB QA acceptance; a resource-library test or generic build does not prove those flows. No distribution package or release is implied.
