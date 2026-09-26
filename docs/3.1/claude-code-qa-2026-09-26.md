# Claude Code candidate QA — 2026-09-26

This is an unreleased development candidate. Preview deployment, local Bridge execution and development-client testing are distinct from Production deployment or app/package publication. No Production release has been performed.

## Native and device evidence

- Installed, unmodified Claude Code CLI 2.1.280, official Agent SDK 0.3.283, official CLI account authentication. No Desktop credential extraction or alternate-model provider.
- Isolated project: native first response, original owned session resume, two-turn context, native history, duplicate-send suppression and real AskUserQuestion single/multiple choice.
- Android physical device (SM-A566B, Android 16): local QR pairing, project selection, new chat and exact reply. A multi-choice question retained both answers after force-stopping/reopening the app; the native model confirmed both selections.
- iOS 27 simulator: local QR pairing and exact reply; native single-choice form, custom answer received by the model, real Write permission allowed and filesystem content verified. After leaving/reentering the conversation, a second pending permission was recovered and denied; the target file remained absent and the model stopped without retrying.
- Android Preview: official six-digit secure pairing and confirmation, isolated Registry → Relay → Bridge → official CLI, exact `CLAUDE_PREVIEW_OK` reply. Connection/history recovered following an intentional Bridge stop/restart. A second turn sent through the authenticated Preview protocol remembered the phrase from before restart; its reply appeared on the Android device. This is recovery evidence, not a measured automatic-reconnect latency guarantee.

Private screenshots and executable QA evidence remain under `~/.clawket/testing/claude-code-implementation-20260926/`. QR codes, pairing credentials, native transcripts and account data must not be committed.

- Both iOS and Android model sheets were visually inspected with native resolved IDs. Selecting Sonnet on iOS produced `IOS_SONNET_OK`; native history confirms `claude-sonnet-5`.
- iOS Stop task during a real AskUserQuestion cleared the pending question only after native termination. A subsequent image message identified Red/Blue correctly and remained in native history. The image was submitted through the authenticated Bridge protocol and rendered on iOS; this does not claim mobile photo-library upload coverage.
- Official SDK `forkSession` on the isolated native QA conversation: the fork retained the remembered phrase, used a new native ID, and the source history was byte-for-byte unchanged through the SDK projection. Full native-import/fork UI navigation remains a separate owner acceptance check.

## Issues found and corrected

- Claude was missing from the rendered onboarding chooser despite having a configured option.
- Batched multi-selection taps could overwrite the previous selection. The form now uses the latest draft for each toggle; radio behavior is preserved.
- An approval snapshot lacked the shared chat controller's session envelope. Live requests displayed, but pending consent disappeared after reopening a chat. The Claude adapter now supplies the envelope; real pending-request recovery and denial were retested.
- Normalized tool rows now retain their canonical native call identity across live/history refresh, avoiding duplicate tool cards; legacy result-ID fallback is unchanged.
- Native `/model` command envelopes and interruption markers appeared as user bubbles after history refresh. Exact native envelopes are now omitted, while ordinary text discussing commands remains visible.
- Native model aliases were shown without their concrete model IDs. Preserve SDK `resolvedModel` as an optional, searchable secondary label, while keeping the native alias as the selection identity. Do not hardcode an alias's current model version.
- Stopping a structured question must use native interruption and retain the pending state until native termination; denying its tool callback alone does not prove task cancellation.
- First-turn model metadata is persisted from native initialization. Owned/forked native IDs are excluded from duplicate discovery rows.

## Isolated Preview deployment

- Registry: `clawket-claude-code-registry-preview`, version `c79b5941-3f4e-419c-a917-dd1075418c97`.
- Relay: `clawket-claude-code-relay-preview`, version `17c3089b-f8a7-4d3a-a50c-e5c06cc71635`.
- Independent KV, `ClaudeCodeRelayRoom`, Registry rate-limiter namespace and newly generated ticket/sync secrets. Other backend deployment units were not deployed.
- Compatibility date stays at 2026-09-17, matching the pinned 4.131.0 toolchain's supported workerd date; a newer unsupported date failed local startup and was corrected before deployment.
- All five v1 replay files passed individually before deployment: fixtures 8, historical client 7, historical image 9, legacy Bridge 9, live replay 6 (39 total).
- `tests/claude-code-relay/relay.test.ts`: secure pairing, invalid proof rejection, two-client response isolation, streaming broadcast, reconnect and offline rejection against local Workers.

## Product limits

Desktop/CLI discovery and native history are read-only. Explicit branching uses official `forkSession`; Clawket-owned sessions may resume only after fresh ownership checks. Arbitrary live Desktop/TUI takeover and original imported-session continuation are not implemented. Historical timestamps are unavailable from the SDK and are not invented. Unsupported steer, effort controls, skill-management and undeclared SDK dialogs are not advertised. Native authentication/MCP authorization remains on the computer.

The public npm package and Production services do not yet contain this candidate. Generic installed-backend autodetection still covers the original OpenClaw/Hermes bundle; Claude uses the explicit `pair --backend claude-code` onboarding command. Validation is narrow and serial under the owner's resource rules, not a claim that the full repository gate was run.

## Focused verification

Files were run individually, serially (no full repository suite):

- Runtime `claude-code/{history,catalog,interactions,owners,session,store,history-page,service,server,models}.test.ts`; affected history/service/session/models files rerun after final changes.
- CLI `claude-code.test.ts`; protocol `capabilities.test.ts`.
- Mobile `claude-code.test.ts`, `AgentQuestions.test.tsx`, `question-drafts.test.ts`, `ModelPickerModal.test.ts`, `ModelPickerModal.view.test.tsx`.
- Existing-backend regression files `gateway-adapters.recorded.test.ts`, `gateway-adapter.lifecycle.test.ts`, `pi.test.ts`, `codex.test.ts` passed. These are recorded/self-contained tests, not a claim of new live OpenClaw/Hermes model conversations in this session.
- Native SDK/CLI smoke, live Preview resume, native fork, permission allow/deny, question cancellation and image evidence are retained privately. A Maestro `hideKeyboard` step failed; the same iOS send was completed and verified through native UI automation. Failed automation attempts were not counted as passing flows.

Final checks: Bridge development bundle/runtime compilation, mobile TypeScript, design-system checks (218 UI files), i18n (19 locales) and agent documentation checks passed. `useChatHistoryState.test.ts` additionally covers native tool identity and existing OpenClaw/Hermes history behavior. No signed distribution artifact was prepared.

## Device discovery follow-up

The earlier device coverage used explicit QA-project pairings, so it did not prove native project discovery on the phone. Owner feedback exposed this gap. Additionally, first-time default detached pairing lost its device flag when the parent appended a new `--config` path; the child could create a project-scoped configuration. Scope propagation is now explicit and tested through parent/child invocation. Existing project pairings remain restricted and are not silently migrated.

The normal default Preview pairing command now creates a device-scoped connection with the persistent Chats fallback. Read-only discovery found 17 project directories and 113 native sessions; an actual native history page loaded 100 messages. Standard native saved project keys supplement conversation-derived directories; unreadable/malformed metadata degrades safely, and custom Claude homes do not import the default account's registry.

Android: normal secure pairing → native conversation list → New conversation → shared project picker → select the actual Clawket repository → real model reply confirming `/Users/lucy/Desktop/me/clawket`. This is a different cwd from the Chats fallback and the original isolated QA project. No files were changed by the model. iOS: enabled the existing Preview debug setting, securely paired the same device connection, saw native conversation titles/projects, selected Chats in the shared New conversation picker, and received the exact `/Users/lucy/Documents/Clawket/Chats` reply. The earlier iOS pairing attempt targeted the non-Preview environment while Debug Mode was off and failed; it was not counted as a successful pairing. Both devices remain on the new device connection; old explicit QA-project connections remain scoped.

Follow-up focused tests: CLI `claude-code.test.ts` (6), runtime `catalog.test.ts` (4), `saved-projects.test.ts` (1), `service.test.ts` (7). macOS canonical `/private/var` paths required correcting the fixture expectation; the final parent/child scope regression passes.
