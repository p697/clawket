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

Focused local tests passed: resolver 16, failed history 19, Codex service 149, Mobile system notices 10 and five serial v1 replay files (41 cases). Bridge/Mobile types, strict 19-locale checks and seven instruction pairs/five docs cases passed. The initial source commit passed all required CI, including macOS/Windows and v1 replay; final documentation changes retain the exact-head CI gate on the task PR.

Explicit native integration ran with both local installations present. Automatic discovery selected desktop runtime 0.159.2; its exact native catalog matched the new conversation's choices/default. Project sandbox permissions were confirmed and a fresh isolated test conversation completed a real text reply. The test chat was archived and its owned child stopped. This is computer-side execution evidence, not phone UI acceptance. Ordinary tests retain disposable home profiles; the explicit integration command alone uses native login.

For immediate owner acceptance, authenticated local control confirmed zero active Bridge-owned turns. Backed up the private Clawket configuration, changed only its saved executable command to the verified desktop binary and restarted the existing public Bridge 3.1.6 through its supported lifecycle command. This uses 3.1.6's existing explicit-executable override, without reinstalling or publishing a package. The original owner and child exited; the replacement uses desktop runtime 0.159.2. Authenticated health and sessionless models readback confirmed readiness, Desktop IPC connectivity and eight visible models including the incident model. All pairing/configuration fields except the command remained identical. OpenClaw and unrelated native owners were preserved.

The local connection is ready for phone reconnection without another scan. Automatic desktop preference and the new failure notice are source changes for a future Bridge package; the running 3.1.6 has only the local explicit-command selection. New localized notice copy also requires an App update. An already running Bridge keeps its child executable until restart; phone reconnection alone cannot change it. Native defaults are not silently replaced, prompts are not replayed, and no cloud configuration was changed.


## Package delivery

The owner subsequently confirmed a phone-created conversation succeeds after the local switch and authorized Bridge publication. [Bridge 3.1.7](bridge-3.1.7-release.md) now publicly delivers automatic macOS Desktop priority and fixed unsupported-model guidance; npm `latest`, byte equality and a credential-free public install are verified. The owner's already running 3.1.6 process was not upgraded or restarted again. New Mobile translations still require an App update; existing native conversation phone continuation is not inferred from the successful new conversation.
