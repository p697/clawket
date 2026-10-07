# Google Play 3.1.2 — 2026-10-07

The owner explicitly authorized an Android QA build and basic tests on the connected phone, followed by a signed production AAB, Google Play upload and review submission. Client version stays **3.1.2**. The previous 3.1.1 upload already consumed code 30102, so both builds use the explicit **30103** override.

## Fixed source and verification

- Source: `ca4e8f5f2e09d75e911b2a80fa75e22061ab2728`, merged [permission fix PR #213](https://github.com/p697/clawket/pull/213), including the owner's 3.1.2 version preparation. [CI run 37577779355](https://github.com/p697/clawket/actions/runs/37577779355) passed all required gates. Delivery documentation does not replace the tested artifact.
- Installed the independently named `com.p697.clawket.qa` 3.1.2/30103 over the existing QA package, preserving its data. The store package was not replaced or uninstalled. No forced-Pro or test billing configuration was used.
- Samsung SM_A566B, Android API 36: startup, saved OpenClaw connection, isolated text request/reply, Android system photo picker, attachment preview, image delivery and agent recognition, full-screen image preview, gallery save and background resume passed. Only an agent-generated green/grey checkerboard fixture was selected; gallery save added exactly one MediaStore row. The app returned online with its test history intact after backgrounding.
- The installed QA package requests none of `READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` or `READ_MEDIA_VISUAL_USER_SELECTED`. Camera and microphone remain ungranted. The crash buffer contained no QA package entries; this is a basic smoke test, not a prolonged stability test.
- Phone Hermes, billing purchase, camera/microphone capture and a 16 KB page-size runtime were not exercised. The merged permission fix's 184 focused tests cover the relevant dual-backend paths; CI provides the broader compatibility gate.
- Fresh `npm run security:audit` passed against both fixed lockfiles with zero blocking findings and the three existing owner-approved developer-tool exceptions. Local builds used the established SSD Gradle cache, two Gradle workers and a temporary two-worker Metro configuration, removed after packaging.

## Production artifact

Canonical `npm run build:android:aab` succeeded in 6m 47s. The signed `com.p697.clawket` **3.1.2/30103** AAB is **99,673,228 bytes**, SHA-256 `5b9ac4d3964584cbe4d0b884422239e311edab14771ade1eff896f913983bdb6`. All 1,340 fixed packaged-source hashes match.

`bundletool validate` and `jarsigner -verify` passed. The upload certificate matches 3.1.1/30102 and published 3.0.0/30001. Four ABIs remain: arm64-v8a, armeabi-v7a, x86 and x86_64. All 54 64-bit libraries out of 108 native libraries have LOAD alignment of at least 16 KB; BundleConfig requests `PAGE_ALIGNMENT_16K`. Native debug symbols and the production speech endpoint are embedded. The manifest is not debuggable, omits all five broad media reads, preserves camera/microphone/network, and caps legacy `WRITE_EXTERNAL_STORAGE` at SDK 32.

## Google Play scope

Before this submission, production contained the unsubmitted 3.1.1/30102 release and the owner's 57 pending localized screenshot changes. Valid closed Alpha 2.1.0/20108 and internal testing 1.7.0/10700 also contained all five broad media reads. The system-picker policy requires resolving affected bundles across tracks. The replacement uses the same clean production artifact without retaining those old bundles, while keeping existing countries, testers and managed publishing.

| Track | 3.1.2 / 30103 result | Previous bundle |
|---|---|---|
| Production | Release 5 saved and submitted, existing 178 countries / 100% rollout | 30102 excluded; unsubmitted 3.1.1 marked superseded |
| Closed Alpha | Release 6 saved and submitted, existing countries / 100% test rollout | 20108 excluded |
| Internal testing | Release 2 published to existing internal testers at 15:23 JST | 10700 excluded |

All three previews showed zero blocking version errors and no lost devices. The existing missing-deobfuscation-file reminder remained; native debug symbols were attached. All three releases have 19 localized notes. No tester, country, billing or production-service configuration was changed.

The owner-authorized **59 changes** (production release, Alpha release and the existing 57 screenshot updates) were confirmed for review. The prior system-photo-picker permission blocker disappeared and the review button was enabled. Google Play moved the changes into **“正在审核中的更改”**. At submission, its automatic quick checks were still running and indicated that successful checks would forward the changes immediately for review. This records the accepted submission request, not approval or public production availability.

Managed publishing remains **on**. Once Google approves the production/Alpha changes, their release remains a distinct publishing step. Internal testing was published immediately through its existing track flow. No App Store, OTA, Worker deployment or installed Bridge update was performed.

Build-only configuration and phone-mirror wrappers were removed, agent-started build/validation/mirror processes ended, and Android/heavy leases were released. The QA app and its isolated smoke-test history remain on the connected phone.

Local-only evidence is retained under `../3.0/evidence/google-play-2026-10-07/`: QA APK/hash, build and audit logs, phone screenshots, sanitized smoke-test results, the fixture and MediaStore count checks, source hashes, production artifact validation and Play state evidence. Credentials, phone identifiers, raw UI dumps and binaries remain ignored.
