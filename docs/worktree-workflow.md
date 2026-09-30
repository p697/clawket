# Branch and worktree workflow

The rule lives in the root `AGENTS.md` (Branch and Worktree Rule). This page holds the commands, the machine setup and the tool integrations. Every command below is `node scripts/worktree.mjs <command>` (`npm run worktree -- <command>` works too); `--help` lists them.

## Layout

- **Primary checkout**: the directory that holds `.git`. It stays on a clean `main`; the owner's launchd Bridge service runs its `apps/bridge-cli/dist`.
- **Worktree root**: `git config clawket.worktreeRoot <absolute path>` in the primary checkout (repository-local, shared by all worktrees). `CLAWKET_WORKTREE_ROOT` overrides it; without either, the root is a `<checkout>-worktrees` directory beside the primary checkout. The script refuses roots inside the primary checkout (its Metro, Jest and document checks would scan nested copies) and temporary directories (a restart clears them).
- **Owner's Mac**: `/Volumes/Lucy-SSD/clawket-worktrees`. The internal disk cannot hold per-worktree dependencies: a fresh `npm ci` takes about 1.5 GiB, and generated `android/` and `ios/` projects add several GiB once built.
- A worktree is `<root>/<branch with / replaced by ->`. iOS DerivedData for it goes to `<root>/.derived-data/<worktree>`; `paths derived-data` prints the path, and `finish`/`remove` delete it.

## Task lifecycle

```bash
node scripts/worktree.mjs create claude/pairing-copy   # branch from fresh origin/main; prints the path
cd /Volumes/Lucy-SSD/clawket-worktrees/claude-pairing-copy
# edit, run the narrowest checks, commit
git push -u origin claude/pairing-copy
gh pr create --base main --fill
# once the required checks pass on a branch that is current with main:
gh pr merge --squash
node scripts/worktree.mjs finish                        # fast-forward main, remove worktree and branch
```

- `create` links the local files below and runs `npm ci`. Pass `--no-install` for documentation-only work; `bootstrap` later re-links and installs. An existing local or remote branch is attached instead of recreated.
- When `main` moves under an open PR: `git fetch origin && git rebase origin/main && git push --force-with-lease` (or `gh pr update-branch`), then wait for the checks again. Claude desktop worktree sessions may use the app's base-branch sync instead.
- Wait for checks with the tool's CI notifications or `gh pr checks <number> --watch`; the required gate usually takes a few minutes, and the Windows and macOS Bridge jobs run only when a change can affect the desktop Bridge. A red required check is fixed in the same branch; never merge around it.
- Do not use `gh pr merge --delete-branch`: it tries to check out `main` inside the task worktree, which git refuses because the primary checkout holds `main`. `finish` deletes the local branch after confirming the PR merged at the local head; GitHub deletes the remote branch.
- `finish` deletes the directory it runs in; continue from the primary checkout path it prints.
- To park unfinished work, push the branch and run `remove`: it requires a clean worktree whose commits exist on a remote branch, and keeps the branch. Never delete an unmerged branch.
- `sync-main` fast-forwards the primary checkout on its own. It stops, without stashing or resetting, when local edits there would be overwritten.

## Owner acceptance

Decided work merges as soon as its own verification and CI pass; the owner accepts it on builds of `main`, and fixes become new tasks. A PR waits as a draft only when the owner asked to review it first or its design is still open. Merging never packages, uploads, deploys or publishes anything: those remain under the Release Authorization Rule.

## Local files

`bootstrap` (and `create`) link these ignored primary-checkout files into the worktree rather than copying them: `apps/*/.env*.local`, `apps/*/.dev.vars*`, `apps/*/wrangler*.local.{toml,jsonc}` and `docs/*/evidence`. A link is created only when git ignores it inside the worktree, so it can never be committed; removing a worktree deletes the links, not their targets, and evidence written from a worktree stays in the primary checkout. Release signing material is not linked: authorized release packaging links it explicitly.

Never link or copy another checkout's `node_modules`. Workspace packages (`@clawket/*`, `@p697/clawket`) are relative links, so a shared `node_modules` resolves them to the other checkout's source and tests silently exercise the wrong code.

## Devices and heavy work

One phone, a few simulators and 16 GB of memory are shared by every agent. Hold a lease while using them:

```bash
node scripts/worktree.mjs lease acquire android --note "QA install of claude/pairing-copy"
node scripts/worktree.mjs lease release android
node scripts/worktree.mjs lease status
```

| Resource | Covers |
|---|---|
| `android` | the USB Android phone (`adb`, installs, Maestro) |
| `ios` | a physical iPhone or iPad |
| `simulator` | booting or driving an iOS simulator |
| `heavy` | native builds, typechecks and test runs broader than one file |

Leases last two hours by default (`--ttl 45m`, at most 12 hours), renew when their holder acquires them again, and can be taken over once expired. A busy lease exits with status 3 and names its holder. They live in the shared `.git/clawket-leases/`; a corrupted lease file fails closed until it is inspected and replaced with `--force`.

- **Android**: `ANDROID_SERIAL` selects the phone and `METRO_PORT` gives each worktree its own Metro for Debug builds (`npm run mobile:dev:android`). The Gradle cache stays in the machine-wide `GRADLE_USER_HOME`. Phone builds use the QA application ID (`-Pclawket.qa=true`, see "Local QA package" in `apps/mobile/docs/android-build.md`): `com.p697.clawket.qa` installs beside the store app, and agents never uninstall the store app to make room.
- **iOS**: build with `-derivedDataPath "$(node scripts/worktree.mjs paths derived-data)"` so worktrees never share build products.
- **Acceptance builds of `main`** are made from the primary checkout after `sync-main`, under the device lease, only when the owner asks for one.

## Tool integration

**Claude Code.** The primary checkout's `.claude/settings.local.json` routes Claude's own worktree creation through the script, so desktop worktree sessions, `claude --worktree`, `EnterWorktree` and subagent isolation land under the worktree root:

```json
{
  "hooks": {
    "WorktreeCreate": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/worktree.mjs\" claude-hook create", "timeout": 120 }] }],
    "WorktreeRemove": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/worktree.mjs\" claude-hook remove", "timeout": 120 }] }]
  }
}
```

A Claude worktree named `x` becomes branch `claude/x`. The hook skips `npm ci` so sessions start quickly; run `bootstrap` before JS tooling. Removal refuses worktrees with uncommitted or unpushed work, so Claude keeps them. Claude's project memory and permission approvals are shared with the primary checkout.

**Codex.** The Codex app's Worktree mode keeps worktrees in `~/.codex/worktrees`, which cannot be moved and sits on the owner's small internal disk. Start Codex threads in Local mode on the primary checkout and run `create` before editing.

**Anyone else** runs the same commands.

## Recovery

- `list` shows every worktree with its uncommitted count and problems: temporary location, missing directory, outside the root, or a dirty primary checkout. `git worktree prune` clears entries whose directories are gone.
- `adopt <agent>/<topic> <path>...` moves uncommitted primary-checkout changes into a new task worktree based on the primary checkout's `HEAD`. It copies each listed path, verifies every copy byte for byte, and only then restores those paths in the primary checkout; a path edited again during the move stays where it is and is reported. Adopt only with the owning session's agreement or after it has ended.
- Never `git stash` or reset in the primary checkout: several sessions share it until their work is adopted.

## Repository protection

`main` requires a pull request, the four Required checks jobs and a branch that is current with `main`; administrators are included, so agents cannot bypass it with the owner's credentials. Merged branches are deleted automatically.
