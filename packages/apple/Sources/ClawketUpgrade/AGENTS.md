# Read-only Expo upgrade import

Read root and `packages/apple/AGENTS.md`. This module preserves the existing same-application installation; it never reads another app's sandbox, deletes legacy values, activates a connection or changes a purchase identity. Production source construction verifies the running bundle and uses its own container. QA fixtures use injected sources, never the store app.

Keep Expo's Data-valued account/generic attributes and service precedence, AsyncStorage inline/null-to-MD5 format, registry rollback, identity validation, role-scoped tokens, original connection timestamps and sandbox-relative resource paths. Unknown app-owned values are preserved as opaque bytes. A corrupt source is an error, never an empty installation.

Stage bounded content-addressed values into separate secret/plain stores, verify every write, then publish one verified manifest. Failed or canceled imports leave the source unchanged and no completed receipt. Retain and validate owned voice/share resources in place; never force a 19.2 MB recording into an 8 MiB value store or silently evict unsent content. Actual signed same-bundle upgrade acceptance remains an owner/release checkpoint.
