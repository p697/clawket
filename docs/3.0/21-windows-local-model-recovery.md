# Windows local-model Preview recovery

## Incident evidence — 2026-09-12

Evidence was captured before starting any replacement Bridge. The Windows host had **no Bridge Node process** and no Clawket logon task/service/startup entry. The previous invocation was a foreground `local-model pair` process. There was no persistent output log for that invocation.

The System event log shows Windows Update initiating planned restarts (`MoUsoCoreWorker.exe`, followed by `TrustedInstaller.exe`). UTC events include:

| UTC on 2026-09-11 | Evidence |
|---|---|
| 18:29:04 | User32 1074: planned OS service-pack restart |
| 18:38:15 | Kernel-General 1: clock advanced from 18:29:59 by 496.150 seconds |
| 18:38:51 / 18:38:56 | Event log stopped / OS shutdown |
| 18:39:06, 18:40:16, 18:41:15 | Successive boots; additional planned update restarts between them |

The user-provided cloud disconnect was 18:37:20.788 UTC, code 1006. Clock correction prevents exact event alignment. The supported cause of **continued offline state** is loss of the foreground process across update/reboot, with no automatic restoration. The exact first socket failure (shutdown versus transient network failure) cannot be proved from the retained logs. No sleep event was found in that shutdown window; this is not proof that sleep is generally safe.

Current network checks independently passed: Node DNS resolution, TCP/TLS with normal certificate validation (TLS 1.3), HTTP response, and an expected HTTP 400 from an unauthenticated WebSocket request. DNS returned synthetic IPv4/IPv6 addresses, and a MetaTunnel adapter plus Clash processes were active. WinINET proxy, WinHTTP proxy and Node proxy environment variables were unset. Thus the working route currently includes a transparent tunnel; historical direct-connect health was not proved. No DNS, proxy, firewall, TLS or global network setting was changed.

Private raw evidence is under ignored `docs/3.0/evidence/windows-overnight/`. It is not part of the PR. Diagnostics must not print configuration, authenticated URLs, tokens, pairing codes, close reason text or message bodies.

## Fix and boundaries

- `scripts/bridge/windows-local-model.ps1` installs a per-user HKCU Run launcher, an independent CLI snapshot with pinned direct dependency versions, and a detached Node supervisor. It restores an **existing** runtime config; never runs `pair` or refreshes credentials. One config per directory.
- An exclusive local control pipe prevents duplicate supervisors before any child starts. The supervisor owns one CLI child through IPC. Stop and parent IPC loss clean up the child; explicit stop cancels retry, with a 10-second forced-child-exit fallback. It never stops a model server or arbitrary port owner.
- Failed child starts wait 30/60/120/240/300 seconds (300-second cap). A successful startup after model health and authenticated Relay readiness resets this backoff. A mere socket open does not. Relay reconnects retain their existing 2/4/8/16/30-second capped backoff, reset only by authenticated `relay.ready`.
- Every upgraded local-model Relay socket has a 15-second application-readiness deadline, including reconnects. This is separate from the existing 15-second WebSocket upgrade timeout. Stop/replacement clears deadlines and heartbeat/retry timers; stale error/close/message callbacks cannot affect a replacement.
- Rotating JSONL diagnostics keep fixed events, UTC times, process IDs, close/error codes and retry timings only (approximately 1 MiB plus one previous file). Arbitrary child output is discarded.
- Shared OpenClaw/Hermes runtime, Relay protocol/owner lease, mobile behavior and server deployments are unchanged. Mac's Relay proxy and mobile backoff work is not duplicated. Remote main was checked before implementation and again during investigation.

This is **logon recovery**, not a pre-login system service. Model availability remains an independent prerequisite. An unexpected supervisor crash cleans up its child but requires Start or the next login; child crashes are retried automatically. Status `ready` indicates Relay readiness, not continuous proof that inference remains available.

## Install / operate / roll back

After `npm ci`, run the required checks and `npm run test:compat`, then `npm run bridge:build` and `npm run bridge:cli:verify-package`. In PowerShell from the checkout:

```powershell
$config = "$env:USERPROFILE/.clawket/local-model-phone-test/runtime.json"
./scripts/bridge/windows-local-model.ps1 -Action Install -ConfigPath $config
./scripts/bridge/windows-local-model.ps1 -Action Start -ConfigPath $config
./scripts/bridge/windows-local-model.ps1 -Action Status -ConfigPath $config
./scripts/bridge/windows-local-model.ps1 -Action Stop -ConfigPath $config
```

Use the path of the already paired configuration. Do not invoke `pair` to repair an offline owner. On update, Stop before Install/Start. The installed directory is the config's sibling `windows-service/`; startup uses absolute paths and is independent of a terminal or checkout cwd. Node and npm must be installed. HKCU Run executes after this Windows user logs in; the model also needs to be available then.

`Uninstall` stops the supervisor and removes only its own HKCU Run entry. It preserves pairing, history and versioned bundles. To revert an upgrade: Stop, restore `installation.json.previous` and `local-model-supervisor.mjs.previous` to their original filenames, then Start. Keep the release directories referenced by those manifests. To return to foreground operation, Uninstall and run `node apps/bridge-cli/dist/index.js local-model run --config $config` from the desired checked-out/build version. There is no production deployment or npm publication in this change.

The repository gate also exposed a pre-existing Windows Jest transform mismatch for the ESM-only `remend` dependency introduced on main. The transform now accepts both path separators, with a focused path regression; mobile product code and dependencies are unchanged. The existing ACL test could also turn a PowerShell module-load error into a false zero-access result. It now imports the invoked shell's security module explicitly, stops on errors, and tests a missing path; no production permission implementation changed.

## Validation and limits

Windows host measurements (Node 22.23.2, existing Flash-Next server, original phone pairing):

| Test | Result |
|---|---|
| First detached startup | Model startup health plus authenticated public Preview `relay.ready` in 1.56 s |
| Exact installed logon VBS launcher | Ran successfully after its invoking process exited; one measured run took 21.01 s including lease contention (final installation) |
| Three simultaneous duplicate launches | Same supervisor and child PID; no additional Bridge owner |
| Graceful Stop | Both processes exited and port 17880 could be rebound in 0.123 s |
| Immediate public Preview restart | HTTP 409 during old-owner lease; automatically ready in 61.79 s with bounded retries |
| Installed Bridge real model request after restart | Authenticated local WebSocket → Bridge → actual model completed in 1.045 s; validated translated content without logging it |
| Real socket outage with controlled local Relay | Listener unavailable for 7 s; recovery 7.025 s after listener restoration; real model generation succeeded before (0.758 s) and after (0.729 s); two accepted connections total |
| Forced supervisor exit | Actual child exited via IPC loss in 0.062 s; manual Start restored public owner in 61.73 s; no orphan |
| Pairing preservation | Runtime config SHA-256 unchanged before/after installation and initial live tests |
| Regression tests | Exclusive process ownership, child-failure backoff, stop cancellation, diagnostic redaction, stale callbacks, ready-only reset, reconnect readiness timeout and timer/listener cleanup |

HTTP 409 here is an expected **owner lease refusal**, not DNS/TLS failure. The cloud intentionally retains the old owner identity briefly; the new child uses a fresh identity. Do not remove this protection or repeatedly restart to defeat it. The original foreground CLI could exit on its 30-second startup readiness timeout; the supervisor now retries that exit rather than remaining permanently offline.

The controlled outage test uses real sockets and the actual local model, but a **local test Relay**, not a physical NIC outage or the public Worker. Reproduce explicitly:

```powershell
$env:CLAWKET_RECOVERY_CONFIG = $config
npx vitest run tests/integration/local-model-recovery.test.ts
node --test scripts/bridge/local-model-supervisor.test.mjs
```

Outstanding: physical Modern Standby sleep/wake, real NIC switching, reboot/login after installation, another overnight run, and phone TestFlight end-to-end reconfirmation with its existing client credential. This host supports only network-disconnected S0 standby; querying wake timers required elevation, so automatic wake was not guaranteed and no unattended sleep/reboot was forced. The authenticated public owner connection and local inference test are separate evidence, not a claim of a newly completed phone-to-cloud inference test. macOS execution is left to the added CI matrix; these Windows installation commands are not a macOS service implementation.

Final checks: `npm run check:required` passed (Mobile 256 suites / 2,482 tests), compatibility replay 36/36, package verification passed, and the explicit real-model recovery test passed. After strengthening the ACL assertion, its four tests and documentation checks were rerun. The installed snapshot and supervisor match the reviewed files; one supervisor/child remains running with original credentials. No cloud deployment was performed.
