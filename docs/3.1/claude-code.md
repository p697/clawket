# Claude Code 3.1 extension

Status: owner authorized implementation and testing on 2026-09-26. This document defines the implementation scope; it does not authorize distribution or Production deployment. Research evidence: [Desktop and CLI feasibility](../research/claude-code-desktop-cli-feasibility-2026-09-26.md).

## Product boundary

One Claude Code backend connects the user's computer. Discover local Code projects and native Desktop/CLI history, preserve cwd, and reuse the existing project picker and chat header subtitle. Claude Chat, Cowork, cloud projects, a terminal emulator, Git management and worktree management are outside this increment.

Use the official Agent SDK with the user's installed, unmodified Claude Code executable. Default macOS/Windows pairing prefers Claude Desktop's Code host runtime; an independently installed CLI remains the fallback. Authentication completes through Claude's own flow on the computer; Clawket does not collect, store, transmit or expose Claude account credentials. The owner selected native CLI login for the original QA after reviewing the difference between DeepSeek compatibility and Anthropic's support policy for non-Claude models.

## Ownership and discovery

Use official SDK session discovery/history and `claude agents --json --all` for live ownership evidence. Saved project metadata and optional, version-sensitive Desktop metadata may supplement discovery, never confer write authority. SDK/programmatic sessions are excluded from the native recent list unless Clawket owns them. Project identities are opaque and scoped to the paired device; a missing directory remains visible and cannot silently become another cwd.

A discovered transcript is not a writable session. Busy, idle and waiting all mean an existing owner is still present. Unknown ownership fails closed. Arbitrary active Desktop/TUI takeover is not advertised; never kill another application's process or start a second writer. Original-session continuation and explicit branching are separate operations. Desktop round-trip continuity requires actual UI verification, not only a successful SDK resume.

## Owned execution

Keep streaming input open across turns in a bounded number of SDK processes. Serialise session mutations and persist bounded acceptance fingerprints before acknowledging a send; retries with uncertain outcomes never cause an automatic resend or fork. Close only owned children. Cancellation must wait for native settlement; an interrupt receipt is not completion. Reconcile streams with native history using native message and tool IDs, preserving whitespace and tool boundaries.

Preserve project instructions, skills, MCP configuration and native deny rules. Start in ordinary permission mode, never implicit bypass. Native model catalogs and supported effort levels determine the UI. Temporary changes are session scoped, not writes to global Claude settings.

Permissions, plan approval, AskUserQuestion and MCP/user dialogs are distinct interactions. Support original question text mapping, single/multiple selection and custom answers. Phone dismissal does not answer a pending question. Pending requests survive transport loss, settle only once, and retire when the native request is cancelled. Declare only dialog kinds the client can render; an unexpected undeclared dialog must not be answered as though the user cancelled it.

## Verification order

1. One isolated QA project: real native CLI/SDK conversation, same-session resume, cwd and native history.
2. Owned streaming, tool permissions, questions, interruption, reconnect and duplicate-send regression tests with self-contained fixtures.
3. Desktop and CLI discovery plus explicitly released-session continuation; protect active owners and verify the return to native UI.
4. Authenticated Bridge connection and mobile project/chat/interaction flows, iOS and physical Android.
5. Narrow OpenClaw, Hermes, Pi and Codex regressions. Isolated Preview only after compatibility gates; no existing backend deployment units are repurposed.

Follow the root resource rule: one test process, no broad local suite, and no tests alongside other builds or simulators unless the owner explicitly grants a narrower exception. Record measured evidence and limitations in PROGRESS; do not advertise unverified native-control capabilities.

## Local commands and current candidate

`clawket pair --backend claude-code` pairs the computer; `--project /absolute/path` limits discovery and new conversations to that project. `--local` uses a token-authenticated local WebSocket. `--preview` selects only Claude's isolated Preview resources. `clawket claude-code start|restart|stop|status|doctor|logs|reset` keeps the same pairing scope and environment; reset retains native history. Desktop-first discovery is a source change awaiting a separately authorized Bridge publication.

The implementation uses official `resume` to continue released native histories under the same native ID, opaque mobile key and cwd. Native discovery/metadata remain read-only; only an explicit send or model selection can adopt a discovered session. Fresh native-owner evidence and a machine-wide Clawket writer lock are required before resume; idle, busy, waiting and unknown owners all block continuation. Imported sessions release the owned SDK process after each settled turn so native clients can later resume them. No arbitrary live Desktop takeover is advertised. Native rename/reset/delete remain unavailable after continuation.

Session descriptors expose `canContinue` and an optional `continuationBlockedReason` (`in_use`, `ownership_unknown`, `project_unavailable`). A regular composer appears for available native sessions; blocked sessions explain the reason and offer an explicit preserved-context copy via official `forkSession` as the primary action, plus a status recheck that reports a still-occupied result in place (owner decision 2026-09-30; wording in the mobile `AGENTS.md`). Claude Desktop keeps idle conversations as owners until they are archived, so the explanation names archiving or exiting rather than closing. Missing directories block both continuation and branching. Viewing history or model choices never starts the original session. Existing owned sessions use native `resume` after fresh ownership checks. History opens the newest 100 projected messages and loads earlier pages with stable positional cursors, with a visible 10,000-native-message safety limit. SDK history does not expose original message timestamps; do not invent historical times.

The SDK stays an external production dependency of the CLI bundle, while `pathToClaudeCodeExecutable` always selects the installed Desktop host or native/npm CLI. Minimum supported Claude Code runtime: 2.1.280; SDK pinned to 0.3.283. Unsupported steer/effort setters, skill-management UI and undeclared SDK dialogs are not advertised.

### Desktop-first executable discovery

Owner decision 2026-10-01: when Desktop and CLI coexist, prefer Desktop; Desktop-only and CLI-only machines must also pair. The shared resolver is used by `pair choose`, direct pairing, restart and native owner queries. Keep automatic configuration as the symbolic `claude` command so a later Desktop update can be discovered; explicit paths/custom commands, including saved configurations, remain authoritative.

Desktop downloads its Code runtime separately from the GUI. macOS host layouts are `~/Library/Application Support/Claude/claude-code/<version>/claude.app/Contents/MacOS/claude` and the older `<version>/claude`. Windows uses `%APPDATA%/Claude/claude-code/<version>/claude.exe` (defaulting to the user's roaming profile when APPDATA is absent). These version-sensitive layouts are supported by read-only inspection of the installed Desktop 2.16120.0 runtime manager; the Windows layout is also recorded in [the upstream issue](https://github.com/anthropics/claude-code/issues/72242). Choose numeric versions newest first and require a runnable file; incomplete downloads, GUI executables and `claude-code-vm` guest binaries do not qualify. If no runnable Desktop runtime exists, retain PATH and `~/.local/bin` CLI discovery. Do not silently fall back after a selected executable fails version or startup checks.

Only installing the desktop GUI does not prove the Code runtime is present. Missing-runtime guidance asks the user to open the Code tab or install the CLI; sign-in stays native. Desktop credentials are never extracted or copied. Pairing a Desktop-backed runtime retains existing history discovery and released-session continuation; it does not permit writing to a still-owned Desktop conversation.

Self-contained resolver tests cover macOS/Windows installation combinations and selection boundaries. Explicit native verification: `CLAWKET_CLAUDE_DESKTOP_LIVE=1 npm run --workspace @clawket/bridge-runtime test:claude-desktop-integration`. It requires authenticated macOS Desktop Code, exercises native models and two same-session replies in an isolated project, and fails when prerequisites are absent. It is excluded from the CI-safe gate. Native Windows acceptance and a truly Desktop-only account profile remain separate from filesystem fixtures and coexistence-machine evidence.

Claude model rows retain the native alias as the write identity and expose SDK `resolvedModel` as a searchable secondary label. Never hardcode a moving alias’s concrete version. Preview Registry/Relay use independent `ClaudeCodeRelayRoom`, KV, rate-limiter namespace and pairing/sync secrets; `npm run test:claude-code:relay` tests secure pairing, request origin, streams and reconnect against local Workers.

Native model-switch records and interruption markers are excluded from displayed human turns; ordinary text discussing commands remains intact. Device and native evidence, with remaining coverage limits, is recorded in [candidate QA](claude-code-qa-2026-09-26.md).

Device pairing preserves its scope across background launch and supplements SDK session directories with saved project keys from the standard `~/.claude.json`. Unavailable paths remain visible but cannot host a new chat. Custom `CLAUDE_CONFIG_DIR` installations currently use SDK discovery only, avoiding accidental import from the default Claude account. New chat reuses the shared project picker; this selects an existing local project, not an arbitrary new filesystem directory.

### Local display names

Connection labels default to the product name (`Codex` / `Claude Code`). The sole device Agent follows the saved local label across the roster, Agent lists, profile and chat identity, including cached/offline reloads. Renaming updates presentation without reconnecting or renaming native sessions. Mobile normalizes the exact legacy `· Computer` default during new pairing while retaining custom names. Existing saved labels remain user-controlled.
