# Security Policy

## Reporting

If you find a security issue, do not open a public issue with exploit details.

Report it privately via email to **support@clawket.ai**. If private vulnerability reporting is enabled for the repository, you can also use [GitHub Security Advisories](https://github.com/p697/clawket/security/advisories/new).

## Scope

The most important areas for review in this repository are:

- pairing and access-code flows
- relay authentication and websocket routing
- bridge-side token handling
- mobile QR parsing and connection bootstrapping
- any logging path that could leak credentials or message payloads

## Public Repo Rules

Do not commit:

- provider, Cloudflare, analytics administration or billing secret keys
- operator-specific Cloudflare account/namespace IDs and private deployment configuration
- APNs, signing, or release credentials
- internal-only operational links or escalation paths

Use placeholder domains such as `example.com` in deployment templates. Public product endpoints, application identifiers and public SDK keys are not authentication secrets; official endpoints may appear in compatibility logic and official release profiles. Community builds must not require official accounts or services. Keep operator values in ignored local files or the release environment, and never commit `.env.local` or `.dev.vars`.

All `EXPO_PUBLIC_*` values are embedded in the client and must be treated as public. PostHog ingestion tokens and RevenueCat public SDK keys are designed for this use; personal API keys, provider keys, signing keys and server secrets are not. The optional legacy `EXPO_PUBLIC_YOUMIND_APP_SECRET` is a client HMAC value and is extractable from a distributed App. It must not grant server-level privilege or be treated as proof of a trusted client. That authentication protocol needs a separate backend review; hiding its value in Git does not make it confidential in the App.

CI runs Gitleaks against Git history with redacted output. Its exceptions are limited to reviewed synthetic constants and one exact historical public PostHog-token finding. Do not add broad file/directory exclusions. `.gitignore` prevents accidental additions but does not remove tracked files or old commits. If a real secret is exposed, revoke/rotate it before considering coordinated history cleanup; deleting it from the latest revision is insufficient.
