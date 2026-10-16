# Native saved history and physical transcripts

The iOS host keeps three different records: its current working conversation, immutable device-local physical transcript copies, and explicit public saved conversations. None restores backend readiness, send receipts, approvals, model permissions or connection credentials.

Autosave presentation has its own per-route operation UUID, activation and actual-write revision/physical identity. Replacing or explicitly cancelling a scheduled save retires that UUID before waking its storage wait. Expected cancellation and late results cannot publish a draft failure or clear a newer hint. A current real storage failure remains visible; only the latest completed write of the still-current document can clear its own storage hint, leaving replacement media/voice hints intact even if their copy is identical. A changed connection activation fences result hints without suppressing an offline draft write already scheduled for its route. Storage transactions, physical gates, files and outbox identities are unchanged. Seven host regressions exercise the real conversation-store lock, cancelled replacement writes, actual filesystem failures and verified retry/readback; compilation/execution is reported separately from source review.

## Physical transcript transactions

`NativeConversationStore` serializes current/rollback reads and writes, voice draft verification, media import recovery, archive rollover and reference snapshots through the same FIFO. `NativeConversation.historyEpoch` is a local storage generation; `physicalSessionID` contains only an actually observed producer value. Both decode as nil in existing v1 documents. Ordinary writes cannot change either identity. Opaque scope components and physical IDs compare by UTF-8 bytes, including canonically equivalent display strings.

The caller API is:

```swift
establishHistoryScope(scope: NativeHistoryScope, expectedRevision: Int64,
                      epoch: UUID, physicalSessionID: String?) async throws -> NativeConversation

bindPhysicalSession(scope: NativeHistoryScope, expectedRevision: Int64,
                    epoch: UUID, expectedCurrentHash: String,
                    physicalSessionID: String) async throws -> NativeConversation

rollover(scope: NativeHistoryScope, expectedRevision: Int64,
         fromEpoch: UUID?, toEpoch: UUID, physicalSessionID: String?,
         retainingMessageIDs: Set<String>, expectedCurrentHash: String? = nil)
    async throws -> NativeHistoryRollover
```

Initial binding accepts a missing current at revision zero, or an empty transcript without a previous physical identity; it preserves the draft and files. An empty current with an established local epoch and nil physical ID can adopt the first actual physical ID in that same epoch. Nonempty legacy data with nil identity must roll over. Repeating the same verified completed operation returns its committed value; different evidence is rejected.

Before rollover the host must freeze the actual observed scope and hold its outbox. It supplies a new UUID, exact previous revision/epoch and exact IDs to retain. Only existing local user outbox items in queued/held/sending/uncertain/failed states may remain in the new current. Their render IDs, idempotency keys, text, delivery values and files are unchanged; the draft and draft resource IDs are unchanged. Cursor and has-more state clear. The store emits no RPC and never replays input. The host must separately retire late voice/media/model work when publishing a replacement physical epoch, even when its logical route and draft stay the same. The actual host now invokes this transaction after a current accepted head supplies a different actual physical ID, or once for a captured reset/delete ACK, including when the post-ACK catalog read failed. ACK receipt IDs describe the previous physical session and never become the new ID. The ACK replacement initially has a nil physical ID; a subsequent accepted head can bind that actual ID in the same epoch only when every remaining row is a held/uncertain/failed owned input. Binding checks the original raw hash, revision, epoch and exact completed replacement, preserving unknown fields without creating another archive.

Before reset/delete dispatch the host durably saves `physicalMutationUnconfirmed` and holds the outbox. Proven non-dispatch restores the preceding intent state; an unknown outcome retains it across cold reads. The same/missing physical ID or an older page cannot clear that intent. A different actually observed physical ID or another explicit successful reset/delete can establish the replacement. Retained inputs keep their original epoch; only explicit Send now on a known held item moves that item to the current epoch. Unknown deliveries cannot take that action. New wire input also requires a current accepted head after each connection generation.

The synchronous host operation fence precedes all storage awaits. It retires exact picker/voice/model/read scopes and pending editing, preserves concurrent composer edits/resources during adoption, and adopts a completed local transaction even if its originating wire read becomes stale. Unknown storage commits lock only that route until verified cold recovery. Same-socket late live events require the current epoch's actual input key, a current send receipt, or an actual active run from an accepted head; clocks, prose and arrival order grant nothing. Unknown live lineage triggers a bounded read rather than selecting an older run. Work records are epoch-scoped and remain locally inspectable; consent drafts use epoch-specific local correlation keys, without persisting wire authority.

These host and storage regressions are separate from actual phone/backend reset, network interruption and archive acceptance; those remain in the device matrix.

The protected `NativeConversations/History` directory holds a raw body and a separate small manifest per archive. The body is the exact original current bytes, including unknown legacy fields, without a wrapper that reduces the 8 MiB record limit. List reads load manifests only; selecting a copy verifies and decodes that body. The original draft is preserved in the body but is not shown as a restored composer or portable transcript.

A replacement is staged before a durable immutable intent. Only the original SHA-256 or the exact staged replacement may be current during recovery; an unrelated third version is never overwritten. The original body/manifest and verified rollback precede the current replacement. Current readback precedes intent removal. Failures after intent publication hold the process as `commitUncertain`; reopening completes the same transaction without replay. Uncommitted preparation files are duplicates and may be cleaned only outside a durable intent. Corrupt archives prevent their open and media reclamation; they do not silently become an empty library or require discarding a readable unrelated current.

Limits are 128 physical copies, 8 MiB per raw body and 64 MiB for archive/pending/preparation data plus the affected current/rollback transaction's worst atomic footprint. Normal current writes also preflight their actual archive/current/rollback/new-file peak. This is not a claim that every unrelated evictable conversation cache on the device fits 64 MiB. Metadata, counter bounds and filenames are bounded. Full storage rejects before mutation; there is no implicit eviction or truncation.

Archive media ownership includes current, rollback, durable pending replacement and verified original bodies before reclaiming any input file. A corrupt source stops reclamation. Generated artifact metadata stays display context and does not become a permanent strong reference; its existing 24-hour cache remains in effect. Cache keys include the local message history epoch without changing artifact RPC arguments or logical-session quotas. A cached resource pointer cannot bypass its artifact/scope/epoch binding; archive preview supplies the original message epoch and stays offline-only.

## Explicit saved conversations and export

The roster and conversation menu open Saved conversations. Free actions include read, pin/unpin, rename, delete, filters, Save conversation and individual Markdown/JSON export. Selected text remains native TextKit selection. Saved snapshots contain user/assistant text, producer clocks and attachment names only. No frames, credentials, local URLs, attachment bytes, tool actions or live references enter this public schema. Saving the exact scoped content again preserves an existing legacy identity, pin and name. New native IDs are local SHA-256 values; they are not wire identities.

`NativeSavedConversations` preserves the Mobile array schema and 100-entry, 500,000 UTF-16 units per entry, 1,000,000 combined units and 4,000,000 JSON UTF-16-unit limits. Escaping has its own JSON budget. It uses verified current/rollback documents independently of the evictable chat cache. Schema validation participates in rollback recovery; unreadable current plus rollback never means an empty library. A failed mutation stays unconfirmed in process until cold verified recovery. No automatic eviction occurs.

Search and filtered bulk export have a typed verified-entitlement provider. Its default is unavailable; this slice does not invent Pro state, unlock purchases or implement a paywall. The future commerce consumer must bind genuine entitlement evidence before those controls appear. Document versions have no native editor consumer and remain pending.

Opening Export conversation explicitly reads complete backend history through `RuntimeCoordinator.exportHistorySnapshot`. This caller-owned read is separate from UI history coalescing and thinking/model observations; cancellation releases its RPC. Admission caps eight reads, existing backend parameter rules and capability checks remain intact, and local-model history still accepts only its actual main session. The complete operation has a 90-second absolute deadline, at most 100 pages, 10,000 message identities and 2,000,000 UTF-16 units. A changed scope/physical ID, active run, repeated cursor, ambiguous overlap or changed final head rejects the snapshot. Legacy limit-only windows grow to at most 1,000 entries and reject incomplete data instead of labeling it complete. Only exact unambiguous producer IDs may deduplicate an overlap; renderer fallbacks do not gain cross-page authority.

Export projection preserves assistant content and applies the existing Mobile known user-envelope/document-name projection. Markdown and JSON remain technical format names. Portable files omit scopes, runtime metadata and private cache fields. Bulk JSON contains selected saved public copies only. Physical-copy export is separate: the UI explains that it includes only history loaded on this device, and JSON includes `loadedOnDeviceOnly: true`; it never fetches missing old pages.

Previous transcripts is a read-only local list/detail consumer. It exposes no send/edit/approval controls. An explicit attachment tap uses `runtime: nil`, so cached metadata cannot open a remote credential channel. Missing/expired output remains unavailable; local input previews still use bounded prepared pixels and the existing media viewer. No remote avatar or arbitrary artifact URL is loaded here.

Every preparation has an operation UUID retired when its view disappears. A late result releases its unpresented share file; its defer cannot unlock a replacement operation after reappearance. Share files occupy unique protected directories, at most 16 copies/16 MiB each/64 MiB total. An unpublished write uses a fixed filename so a killed preparation remains bounded and age-cleanable. Active shares are never evicted. The shared system activity controller distinguishes creation from actual presentation: unshown dismantled controllers release, while actual handoff retains through system completion. Export completion removes only its temporary copy, never the saved source.

## Verification boundaries

The focused tests use synthetic local data. Physical transaction checkpoints, exact 8 MiB legacy bytes, capacity/counter limits, third-version refusal, UTF-8 identity, symlink rejection, public snapshot bounds, semantic rollback, unknown writes, export pagination/cancellation/projection and share ownership have explicit regressions. macOS core checks and generic iOS compilation are separate from actual iOS execution and USB acceptance. The exact local/CI counts are recorded in `docs/3.0/PROGRESS.md` when verified.

Real reset-to-new-physical host integration, physical cached media/large copy rendering, system share extensions, Pro entitlement binding and same-bundle legacy adoption remain separate acceptance items. Existing real-device voice evidence remains recorded by the program owner in VOICE; this slice neither replaces nor broadens it.
