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

The machine-API skip rule matches the exact 11 Registry hosts for `/v1/`, `/v2/`, `/pair/ps_` invitation pages and native association files, and the exact 11 Relay hosts for `/ws` and `/v1/health`. Existing Hermes bridge-status and Speech exemptions remain. It skips managed firewall/SBFM and the existing challenge products, never rate limiting. The Relay guard remains 120 `/ws` requests/minute/IP; pairing remains 20 session/page requests/minute/IP, including Hermes claim-code and the same `/pair/ps_` pages. Both return JSON 429, with the original 60-second periods/mitigation and `(cf.colo.id, ip.src)` keys. Worker admission limits remain unchanged.

The App declares the nine secure-invitation Registry domains (Hermes retains its existing pairing flow). iOS associated-domain and Android intent-filter additions require a new native App build. Association responses use approved public App IDs; Android verified links additionally require the actual distribution signing certificate. Do not infer a Play signing fingerprint from an upload/development certificate. Manual codes and QR claims do not depend on native link verification.

## Operation and recovery

Before mutations, export source modules, settings, deployment/version IDs, custom-domain bindings and WAF rules. Validate complete source bytes against SHA-256; truncated connector output is not a rollback artifact. Private evidence for this operation: `/Volumes/Lucy-SSD/clawket-release-evidence/connection-domains-20261006/`. `before-complete` holds all 11 Registry sources and both primary Relay sources with verified hashes; the manifest anchors all 22 sources. `before` contains the earlier truncated exports and must never be used for deployment or compatibility verification.

Deploy only after the v1 replay gate and the production-snapshot service matrix pass. Preserve existing compatibility dates, observability (query redaction on, invocation logs/traces off), namespace IDs, migration tags and secret bindings. Config-only Relay changes use the exact exported live module. Registry changes use the one fixed candidate bundle. Read back source hashes, deployed versions and bindings after each upload, probe TLS/health, and exercise synthetic pairing across old/new hostnames in the same room. This checks transport and pairing, not native inference or phone acceptance.

Mirror the approved public URL/custom-domain changes into ignored operator configs so a future Wrangler deployment cannot restore old advertised addresses. Checked-in community templates use owned-domain placeholders with `workers_dev=false`; no official account IDs or credentials are required for community builds. Official operator configs retain `workers_dev=true` only during this compatibility stage.

To recover, keep both hostname bindings and restore the recorded prior settings/source version while preserving the established registration-limiter migration. Do not delete namespaces, roll back secrets, or redeploy a pre-migration Registry without its forward recovery bundle. Source rollback is local protocol evidence, not proof of a Cloudflare migration rollback. Alias retirement should itself retain a reversible configuration plan.

## Deployment evidence

Completed 2026-10-06 (UTC 08:25–08:46 uploads): 18 added domain bindings, all 22 official hosts attached to their original service. Eleven Registries use the fixed candidate. Nine Relay uploads change configuration only; OpenClaw and Hermes Production Relays retain their existing deployment because their canonical verification URLs were already correct. All 11 Relay module hashes match their pre-migration source. All 22 service readbacks preserve namespace/secret/service bindings, compatibility settings, observability and the existing `v1` migration tag. No DO migration or credential rotation was performed.

Fixed module SHA-256:

- Registry (11 services): `e27b1fb19e1e34059f6e021f44f4854fa5b1a8fd2792eaa4e6806001f9b8fa0b`.
- Relay (10 services): `22afaffeb4c5cf65710ff4fc83f965cf30c23f7fd4c9668f05151e4aef33ff91`.
- Independent local-model Relay: `4ba9ee988b036f3f293cc4bab1795f873e7397aff6804d9f09e0bf1f14be67dc`.

| Worker | Version ID | Deployment ID | Source above |
|---|---|---|---|
| clawket-registry | `15d475e4-ca53-4d79-a926-ea9ea9a90a2e` | `a46ec305-d730-469a-9ab8-d1ddbbdc54e4` | Registry |
| clawket-relay | `267ef8c2-ef47-4e24-a2b1-dbf509fb9fdc` | `4f52c448-2f1e-4deb-9a1d-e4541e23bbd5` | Relay |
| clawket-registry-preview | `06332903-adde-43bb-9d52-a01e17775b5d` | `7b177f35-51ea-4f4b-964d-f21867aadfde` | Registry |
| clawket-relay-preview | `08eb7010-b947-4e12-b777-aec3c3f1bd62` | `1c7b4b08-154f-49a8-9a54-8cd0ff8903e4` | Relay |
| clawket-hermes-registry | `f86a479b-f628-48e6-95f5-b316243f64d2` | `e72e6ca2-d9dc-487c-82d4-fa3c2e9cec69` | Registry |
| clawket-hermes-relay | `89f3acdd-5956-4267-ae0a-d88ccd2f442f` | `b3572a7f-2666-494c-bb13-f47c14bb8ac0` | Relay |
| clawket-hermes-registry-preview | `1acfc0f3-a213-4b34-9ba3-692a1baddd2c` | `cfc13f65-210e-4e55-97c0-11826a57050f` | Registry |
| clawket-hermes-relay-preview | `6c32b400-4c97-4144-9400-54d541361c0e` | `cfb0dbdf-34f7-4dcc-884a-457c23fcd01b` | Relay |
| clawket-codex-registry | `25fa30fd-78c5-4b73-add5-f17b1f20c300` | `324bb263-5ef9-4bc9-8890-f9b0016da3cb` | Registry |
| clawket-codex-relay | `5049b110-5855-4f64-b10d-60646a9a5ae8` | `f3a908d0-7b58-48ff-876d-1ec8fa93a89b` | Relay |
| clawket-codex-registry-preview | `110e43ad-205a-4525-b552-26bd6511d573` | `7d2635f4-e159-4f8e-8467-8741b185435d` | Registry |
| clawket-codex-relay-preview | `da9621ff-b7ea-481c-a506-1cf5a4f4b04c` | `9bb9f27f-ab68-430a-b2a3-11821624d3d7` | Relay |
| clawket-claude-code-registry | `cf8dde3f-c19e-4bc6-9282-5cec2972594e` | `a3046758-af25-4ce7-9365-a16fb8575e82` | Registry |
| clawket-claude-code-relay | `85531bf2-8fff-4ac2-9e16-b8d451001b04` | `b9ae6b37-efe5-493a-9d75-d387f69886cd` | Relay |
| clawket-claude-code-registry-preview | `bb5dbb6c-7008-4b61-9dbe-bf8d2fdb354f` | `97ebfb7a-8615-460a-98f7-4a7403ac7f88` | Registry |
| clawket-claude-code-relay-preview | `c5f646e7-d56f-4238-8240-e333c2ad58f6` | `294c1cfc-3144-41da-af01-025fd6f31291` | Relay |
| clawket-pi-registry | `b65dfc55-fe2f-4bc7-960b-159f6cc8a7bb` | `742a9ce4-670a-4f40-a881-d57605bc0791` | Registry |
| clawket-pi-relay | `e99fd95f-08e1-4c3c-a91e-e3d5ff492df3` | `e6010af5-6810-4120-8615-1c170410dd2d` | Relay |
| clawket-pi-registry-preview | `5737327a-36cf-4002-99f8-a2661e87fd0c` | `2d2fe574-bbfd-4a60-a481-0bfab0bc7d75` | Registry |
| clawket-pi-relay-preview | `81692fa6-f94f-4529-9231-0c548ba7b0c2` | `ee0ba2cb-42a9-44e1-94a6-b170b5ce8047` | Relay |
| clawket-local-model-registry-preview | `6dd6de5e-0d26-4413-9f27-da6ebe7ff7ea` | `3a2743ee-c695-4522-a123-77c362e6205a` | Registry |
| clawket-local-model-relay-preview | `3f9ce070-9dbf-4543-b596-6a041754eae0` | `067b447a-3646-4308-af65-5ad43eb19df8` | Local Relay |

Verification:

- Final TLS/JSON health: 22 canonical and 22 retained legacy endpoints returned 200. Nine canonical Registry association endpoints returned the approved iOS App ID and valid Android association JSON. Production Android fingerprints remain empty pending the actual distribution certificate; Preview retains the existing approved certificate.
- Eleven synthetic pairings were registered against the old services before rollout. Each passed migrated claim, old-owner/new-client and new-owner/old-client WebSocket round trips, and reconnect with its saved client token. Nine gateway backends also passed real six-digit resolution, restricted pairing ticket, authenticated encrypted proof/decryption, and both old/canonical invitation origins/pages. Hermes retains its existing flow. The owner/client peers were synthetic; this proves pairing and transport, not phone acceptance or native model inference.
- Invitation-page testing exposed a canonical-host 403 while APIs worked. Exact official `/pair/ps_` pages were added to the challenge skip and existing 20/minute pairing guard; all nine final page checks returned 200 without browser challenges. A first immediate post-upload Production invitation-origin check failed; a fresh session and complete rerun passed before acceptance. No user pairing was touched.
- v1 replay: five files / 42 checks passed before deployment. Release matrix with complete exported Production snapshots: four cases / 24 phases passed. Core, CLI, Mobile and Registry affected-file tests and typechecks passed; full required suites and Windows/macOS compatibility ran in PR CI. Documentation checks cover eight instruction pairs and five regression checks.
- All 11 synthetic pairing records and 22 captured invitation records were deleted; exact-key readback confirmed all 33 absent, and the local synthetic-credential file was removed. Sockets were closed. The registration-rate counters retain their normal expiry. Closed synthetic rooms retain existing DO metadata and mirrored token hashes; those hashes no longer grant access without the Registry record. No namespace-wide cleanup was used.

Evidence files are in the private directory above: `metadata-before.json`, `metadata-desired.json`, `metadata-after.json`, `edge-after.json`, `deploy-results.json`, `probe-results.json`, `health-final.json`, `cleanup-results.json`, and the replay/matrix logs. Twenty existing ignored operator configs mirror the new hostnames; the previously absent local-model pair is captured under `operator-configs/` with stable primary-source paths and its unchanged migration/resource identities. Wrangler parsed all 22 operator configs and verified their canonical routes and URL/association variables. Preview retains its pre-existing observability settings; all ten Production services retain sanitized application-only logging.

App/Bridge versions were not bumped or distributed, and the owner's running Bridge was not restarted. New native associations and saved-client address migration reach installed clients only through a later authorized App/Bridge delivery. Keep Workers aliases until that delivery, legacy-client compatibility window and owner acceptance are complete.
