# Codex desktop runtime preference

Owner decision, 2026-09-30: automatic Codex pairing should prefer the desktop installation whenever both Desktop and a standalone CLI exist.

## Confirmed incident

The referenced phone-created conversation failed after 2,698 ms with native HTTP 400: its selected model was unsupported for the current Codex ChatGPT route. Read-only native RPC showed PATH CLI 0.153.3 returning five picker-visible models, without `gpt-6.1-sol`, while the shared default configuration and failed conversation selected that model. The desktop-bundled executable was 0.159.2 and its native catalog included the model. Including hidden entries did not add it to the old CLI catalog.

The previous model picker and new conversations both used the Bridge-owned CLI App Server. The picker also included the effective current model even when absent from the native catalog; its appearance was not proof of availability. Desktop displayed the shared native history, not evidence that Desktop executed the new phone turn. This is distinct from the earlier token-refresh incident and first-QR validation issue. No Relay failure is needed to explain this explicit native refusal.

## Implemented behavior

On macOS, default `codex` discovery searches runnable known Codex.app/ChatGPT.app bundle layouts in user then system Applications before PATH. A missing/non-executable bundle retains CLI-only support. Explicit `--codex-command` and saved explicit paths remain overrides; an incompatible selected desktop does not silently switch to CLI. Windows/Linux keep their existing resolver because no desktop layout is currently verified there.

Discovery/version inspection and actual RPC startup share this resolver. One Clawket-owned App Server supplies the catalog, initializes new threads and sends their turns. This uses the desktop's bundled executable and native authentication, without copying credentials or attaching to the app's existing stdio. Already Desktop-owned conversations continue over the existing IPC route. Installed standalone CLI files, native configuration and unrelated owners are unchanged.

The exact unsupported-model refusal, plain or inside its known HTTP 400 envelope, now becomes a fixed model-selection/update notice in both live completion and native history. Recognition is bounded to 16 KiB and never exposes provider bodies. Unrecognized errors remain generic. Mobile localizes that fixed notice in 19 languages; installed Apps require an App update to receive its translation.

## Verification and delivery

Focused resolver regressions cover simultaneous desktop/CLI installation, explicit overrides, CLI fallback, executable admission and known bundle layouts. History regressions cover fixed refusal mapping and malformed/unknown/private-bearing responses. Serial runtime/Mobile checks and CI results are recorded on the task PR.

Explicit native integration ran with both local installations present. Automatic discovery selected desktop runtime 0.159.2; its exact native catalog matched the new conversation's choices/default. Project sandbox permissions were confirmed and a fresh isolated test conversation completed a real text reply. The test chat was archived and its owned child stopped. This is computer-side execution evidence, not phone UI acceptance. Ordinary tests retain disposable home profiles; the explicit integration command alone uses native login.

These are source changes, not a package publication or App release. An already running Bridge keeps its child executable until Bridge restart; reconnecting the phone alone cannot change it. Owner phone acceptance remains pending updated Bridge execution. Native defaults are not silently replaced, prompts are not replayed, and no cloud configuration was changed.
