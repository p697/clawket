# Official connection domains

Owner decision 2026-10-06: official Registry and Relay traffic uses `clawket.ai`. Roll out custom domains first, migrate clients and saved pairings, then retire Workers aliases after compatibility acceptance. The owner explicitly authorized the Cloudflare operations for this migration. App distribution and Bridge publication remain separate release decisions.

## Service map

All Registry URLs use HTTPS; Relay URLs use WSS with `/ws`. Production and Preview continue to use their existing isolated Workers, KV, Durable Objects, service bindings and credentials. A custom domain attaches to the existing Worker; it does not redirect a WebSocket or move a room.

| Backend | Environment | Registry hostname | Relay hostname |
|---|---|---|---|
| OpenClaw | Production | registry.clawket.ai | relay.clawket.ai |
| OpenClaw | Preview | registry-preview.clawket.ai | relay-preview.clawket.ai |
| Hermes | Production | hermes-registry.clawket.ai | hermes-relay.clawket.ai |
| Hermes | Preview | hermes-registry-preview.clawket.ai | hermes-relay-preview.clawket.ai |
| Codex | Production | codex-registry.clawket.ai | codex-relay.clawket.ai |
| Codex | Preview | codex-registry-preview.clawket.ai | codex-relay-preview.clawket.ai |
| Claude Code | Production | claude-code-registry.clawket.ai | claude-code-relay.clawket.ai |
| Claude Code | Preview | claude-code-registry-preview.clawket.ai | claude-code-relay-preview.clawket.ai |
| Pi | Production | pi-registry.clawket.ai | pi-relay.clawket.ai |
| Pi | Preview | pi-registry-preview.clawket.ai | pi-relay-preview.clawket.ai |
| Local model | Independent isolated service | local-model-registry.clawket.ai | local-model-relay.clawket.ai |

Local model retains its existing `clawket-local-model-*-preview` infrastructure and is offered in every App environment. There is no Production twin. Other Workers retain `clawket-<backend>-<role>[-preview]` names (OpenClaw omits the backend segment). Those names identify resources, not advertised public hostnames.

## Compatibility

`packages/bridge-core/src/official-relay.ts` is the sole exact official hostname map. It is pure TypeScript: Mobile and Registry import that one source module directly, without importing the Node-based Core barrel; CLI consumes its compiled export. This source boundary is intentional. Only exact known aliases migrate, with protocol, backend and environment fences. Custom/self-hosted domains, paths and credentials remain supported; a hostname merely ending in `workers.dev` is not an official identity.

Bridge normalizes saved URLs at read time and treats old/new Registry aliases as one identity during explicit pairing refresh. IDs, secrets, local tokens and existing encrypted invitations are preserved. Pi and local-model reuse an existing pairing on the same Registry. Mobile persists address-only migration through its current/rollback secure-store transaction and keeps active/free selections. Secure invitation decryption and backend/environment checks retain the existing path.

Registry projects old stored `relayUrl` values onto the canonical hostname when reading a pairing, including secure six-digit resolution. No bulk credential rewrite is required. Invitation creation through a retained official Workers host returns that legacy host for released Apps whose allowlist predates the custom domain. Creation through the canonical host returns the canonical link. The hostname check is exact and fenced to the same configured service/backend; custom public-base behavior is unchanged. New registrations use the canonical `RELAY_REGION_MAP`, invitation URLs use `PAIR_PUBLIC_BASE_URL`, and Relay verification uses its same-environment canonical Registry. Secret values and resource namespaces are unchanged. The OpenClaw packaged challenge fallback is removed; browser challenge exemptions cover the official machine APIs instead.

Old `*.clawket.workers.dev` routes stay enabled temporarily so released clients, saved URLs and outstanding invitations continue to work. Do not retire them before the required legacy-client compatibility window and actual upgraded-client acceptance. HTTP redirects are not a substitute for WebSocket aliases. Retiring aliases is a separate live configuration action after those criteria are met.

## Edge admission and links

The machine-API skip rule matches the exact 11 Registry hosts for `/v1/`, `/v2/` and native association files, and the exact 11 Relay hosts for `/ws` and `/v1/health`. Existing Hermes bridge-status and Speech exemptions remain. It skips managed firewall/SBFM and the existing challenge products, never rate limiting. The Relay guard remains 120 `/ws` requests/minute/IP; pairing remains 20 session requests/minute/IP, including Hermes claim-code. Both return JSON 429, with the original 60-second periods/mitigation and `(cf.colo.id, ip.src)` keys. Worker admission limits remain unchanged.

The App declares the nine secure-invitation Registry domains (Hermes retains its existing pairing flow). iOS associated-domain and Android intent-filter additions require a new native App build. Association responses use approved public App IDs; Android verified links additionally require the actual distribution signing certificate. Do not infer a Play signing fingerprint from an upload/development certificate. Manual codes and QR claims do not depend on native link verification.

## Operation and recovery

Before mutations, export source modules, settings, deployment/version IDs, custom-domain bindings and WAF rules. Validate complete source bytes against SHA-256; truncated connector output is not a rollback artifact. Private evidence for this operation: `/Volumes/Lucy-SSD/clawket-release-evidence/connection-domains-20261006/`. `before-complete` holds all 11 Registry sources and both primary Relay sources with verified hashes; the manifest anchors all 22 sources. `before` contains the earlier truncated exports and must never be used for deployment or compatibility verification.

Deploy only after the v1 replay gate and the production-snapshot service matrix pass. Preserve existing compatibility dates, observability (query redaction on, invocation logs/traces off), namespace IDs, migration tags and secret bindings. Config-only Relay changes use the exact exported live module. Registry changes use the one fixed candidate bundle. Read back source hashes, deployed versions and bindings after each upload, probe TLS/health, and exercise synthetic pairing across old/new hostnames in the same room. This checks transport and pairing, not native inference or phone acceptance.

Mirror the approved public URL/custom-domain changes into ignored operator configs so a future Wrangler deployment cannot restore old advertised addresses. Checked-in community templates use owned-domain placeholders with `workers_dev=false`; no official account IDs or credentials are required for community builds. Official operator configs retain `workers_dev=true` only during this compatibility stage.

To recover, keep both hostname bindings and restore the recorded prior settings/source version while preserving the established registration-limiter migration. Do not delete namespaces, roll back secrets, or redeploy a pre-migration Registry without its forward recovery bundle. Source rollback is local protocol evidence, not proof of a Cloudflare migration rollback. Alias retirement should itself retain a reversible configuration plan.

## Deployment evidence

Pending the fixed candidate rollout; domain bindings and WAF expansion are already applied. All 22 canonical TLS/JSON health endpoints returned 200 before service configuration changes. The final deployment anchors and synthetic transport results are recorded below after rollout.
