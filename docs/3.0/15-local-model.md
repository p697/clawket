# Local model connections

The owner authorized this additive backend on 2026-09-11. Existing OpenClaw,
Hermes and YouMind contracts stay compatible. Implementation is on
`feat/local-model-bridge`; it is not an npm or app-store release.

## Architecture

The mobile `LocalModelAdapter` uses the existing chat UI and WebSocket transport.
The Node Bridge owns a persisted main conversation and translates bounded chat
RPCs into OpenAI-compatible streaming requests. It supports llama.cpp, Ollama
and explicitly configured compatible endpoints. The cloud handles pairing and
WebSocket forwarding; it does not store chat history or expose the inference API.

Backend identity is `local-model`, independently of `transportKind: relay`.
The gateway-shaped pairing wire (`gatewayId`) is reused on isolated resources.
Six-digit pairing requires the existing v2 ticket/proof exchange; six digits are
never an offline encryption key. Claimed credentials and model API keys remain
on their respective devices. Relay uses transport encryption, not chat E2EE.

## Run from a checkout

Use Node 22, then `npm ci` and `npm run bridge:build`. Start a local model server.

```sh
node apps/bridge-cli/dist/index.js local-model pair
```

The command checks model health and waits for Relay readiness before printing
the code and terminal QR. Keep it running. The app's Local model entry accepts
that code in every environment: the local-model Registry is dedicated and has no
Production twin, so the owner decided on 2026-09-19 that neither Debug Mode nor
the selected Relay Environment gates the entry, the six-digit code, the link or
the QR (`isEnvironmentIndependentRegistry`). `--preview` is accepted for
compatibility and changes nothing for local models. `--qr-file path.png` exports the same QR. Later, restore the
saved connection with `local-model run`; a new `pair` creates a new invitation.

Options: `--base-url` (default `http://127.0.0.1:8080`), `--engine` (`llamacpp`,
`ollama`, `openai-compatible`), `--endpoints path.json`, `--config path.json`,
`--port` (Bridge port, default 17880), `--registry`, and `--name`.

The app's Local model step offers llama.cpp, Ollama and Other tabs and
prints the matching command: Ollama adds `--engine ollama --base-url
http://127.0.0.1:11434`, Other adds `--engine openai-compatible --base-url
http://127.0.0.1:1234` (LM Studio's default; edit the port). When no server
answers, the server rejects `/v1/models`, or it lists no models, the CLI names
the address and what to start or pass instead of printing `fetch failed`.

An endpoint file is an array of `{id,name,baseUrl,model,engine,contextWindow,
maxOutputTokens,apiKey?,vision?}`. It stays on the computer. Without one, the CLI
discovers `/v1/models`. Model switching selects only those configured models;
it never executes model-supplied commands or downloads arbitrary model IDs.

For llama.cpp, use its standard router with `--models-preset models.ini
--models-max 1`. Presets refer to existing GGUF files and optional projectors.
`/props?model=...` loads the selected preset and verifies live vision support.
Switching large models takes substantially longer than generating the first
token. Keep the router on loopback. Ollama selects an installed model by ID.

## Guarantees and limits

- One main conversation per Bridge, shared by its paired devices. Global model
  selection is serialized against generation. Unsupported Agent controls stay hidden.
- A request is saved before its acknowledgement; retrying the same idempotency
  key cannot generate a duplicate. Conflicting reuse is rejected. Interrupted
  runs are not replayed automatically after restart.
- Cancel aborts the upstream HTTP request. Disconnecting a phone leaves the
  run on the computer; reconnect reads persisted history.
- PNG/JPEG uploads require a live vision-capable model. Flash-Next's current
  deployment is text-only. Previous image messages remain visible after switching
  back to text-only models, but their pixels are omitted from that model's context.
- WebSocket messages are limited to 8 MiB, image inputs share a bounded envelope,
  and history is paginated by serialized size. Context trimming drops complete
  oldest turns. The budget is conservative, not an exact tokenizer measurement.
- Native iOS/macOS builds require a Mac. An adapter test on Windows is not a
  phone UI or camera/gallery permission test.

## Preview deployment

Copy each `wrangler.local-model.preview.example.toml` to
`wrangler.local-model.preview.local.toml` and set account, KV and service URLs.
Use one dedicated KV namespace shared by these two new workers, plus their own
Durable Object namespaces. Do not reuse another backend's resources.

Both workers require two independent shared secrets: `PAIRING_TICKET_SECRET`
for secure invitations and `PAIRING_SYNC_SECRET` for immediate credential
mirroring. Missing sync configuration can make a new claim intermittently fail
until KV propagates. Keep secrets out of TOML and logs.

Before every code deployment, run `npm run test:compat`. Use the repository
Wrangler wrapper and select the local-model Preview config explicitly. No
Production deployment is part of this feature rollout.

## Validation

`tests/integration/local-model.e2e.test.ts` runs actual local Workers with a
deterministic model endpoint. `local-model.preview.test.ts` is opt-in and sends
real inference through the public Preview services using the actual mobile
adapter. Set `CLAWKET_LOCAL_MODEL_PREVIEW_SMOKE=1`; optionally provide
`CLAWKET_MODEL_ENDPOINTS` and `CLAWKET_TEST_VISION_MODEL` to test real switching
and the included deterministic red-circle PNG. Evidence excludes credentials
and is written under ignored `docs/3.0/evidence/local-model/`.

## Windows and macOS development

Install Node 22 and run `npm ci`, then `npm run bridge:build`. No Bash is
required for the Bridge build or local-model commands. To also start an installed
llama.cpp router, add `--llama-server <executable> --models-preset <models.ini>`
to pairing; `local-model run` reuses these paths after restart. The router stays
on loopback and loads at most one preset. The Bridge does not terminate another
model server occupying the requested port.

Android: install JDK 17 and the Android SDK, set `JAVA_HOME` and `ANDROID_HOME`,
then run `npm run --workspace clawket build:android:preview`. This creates only
a debug APK. After installing it on a device, `npm run mobile:dev:android`
configures adb reverse and starts Metro; use `ANDROID_SERIAL` when multiple
devices are connected. iOS native builds still require macOS/Xcode.

## Windows acceptance evidence (2026-09-11)

- Real public Preview run: CLI six-digit proof/claim, actual Mobile adapter,
  Flash-Next streamed translation, saved history and reconnect passed twice.
- Latest output: `效果持续5秒。`; measured first token 4,578 ms during concurrent
  native builds. This is a functional smoke measurement, not a model benchmark.
- Real global switch to Qwen3.6 vision took 35,499 ms; the included red-circle
  PNG was recognized as `Red`, its image survived history reload, and switching
  back to Flash-Next passed. Full test including both model loads: 106,962 ms.
- Original Flash-Next server on port 8080 was restored and health-checked.
- Deterministic Worker integration covers two clients and request routing;
  historical protocol replay protects OpenClaw and Hermes compatibility.
- Full `npm run check:required`, 36 historical compatibility replays, the new
  real-Worker integration and CLI package verification passed. Both lockfile
  audits report zero high/critical findings (moderate/low findings remain).
- Windows Android arm64 debug APK build passed (532 Gradle tasks). It uses
  Metro for JavaScript; no release signing or publication was performed.
- Physical phone UI/gallery permissions and macOS execution remain distinct
  acceptance tasks; Windows adapter tests do not establish those results.
- Only isolated local-model Preview Workers were deployed. Production, npm and
  app stores were not published; delivery is a pull request.

## Review follow-up: idle and outage stability

Relay handshakes use `health` to avoid OpenClaw challenge tracking; direct
connections still authenticate with `connect`. Backend handshake failure uses
exponential reconnect backoff, reset only after successful handshake. The local
adapter allows three 30-second heartbeat intervals before declaring a dead link.

Health probes inspect the router's advertised model state and reject unloaded
presets without invoking the auto-loading props endpoint. Explicit model
selection retains its 180-second loading budget. Standalone llama.cpp endpoints
without router state keep live capability discovery.

The CLI minimum is Node 20.3.0 because [AbortSignal.any](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals)
was added in that version; Node 22 remains the documented development version.

Verified with the actual Mobile adapter against public Preview: one socket stayed
ready for 95 seconds with only heartbeat traffic, no reconnect or replacement,
and history remained readable afterwards. The test distinguishes late close
events from deliberately retired sockets. Full required checks, 36 compatibility
replays, real-Worker integration and CLI package verification also passed.
