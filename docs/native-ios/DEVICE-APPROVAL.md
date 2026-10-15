# Native device approval

A valid OpenClaw credential can still require the computer owner to approve a new mobile device. This is separate from missing or rejected authentication. The native host now offers a read-only verification sheet from its connection status and Settings; it does not replace the credential, approve itself or issue an approval RPC. Dismissal has no connection or task effect. Check again explicitly reconnects the same saved connection, and only the normal verified handshake can make it ready.

## Evidence and identity

This contract was checked against the installed OpenClaw 2026.10.2 source bundles: `message-handler-XS4QOnr2.mjs` (original `src/gateway/server/ws-connection/connect-device-pairing.ts` region), `connect-error-details-q_NaMExM.mjs`, `device-identity-CPVvFoMk.mjs`, `device-pairing-core.worker-BOWNGvu5.mjs` and `devices-CsTgRT60.mjs`. These are code observations, not a phone approval or successful inference test.

The Gateway creates a pending request after checking the signed device identity. Actual pairing is `NOT_PAIRED` with `details.code = PAIRING_REQUIRED`; identity/authentication/policy rejection codes remain distinct. Structured reasons include not-paired, role-upgrade, scope-upgrade and metadata-upgrade. Pending requests include an exact request ID and device/public-key binding; refreshed or superseded requests must not be selected by a device name or recency alone.

`RuntimeDeviceApprovalContext` is constructed from the identity captured synchronously beside the actual signed connect params and their exact authentication/socket scope. It re-derives SHA-256 of the 32-byte Ed25519 public key and checks the stored device ID. This matches OpenClaw's device ID derivation, so the one public ID displayed by the app is also the public-key fingerprint. A peer-supplied device ID can corroborate that value but cannot replace it. Only an exact structured pairing error creates this context; missing/malformed/foreign metadata never invents identity evidence. Request IDs use the Gateway's bounded ASCII grammar without parsing peer prose. Unknown reasons remain unknown.

The public context contains no private key, credential, signature, raw URL or bearer token. It is product verification information, never a diagnostic identity or an approval capability. It is not restored from cache as a current request. A new attempt, authentication replacement, ready connection or explicit disconnection clears the old context; old authentication scopes cannot publish a late review after A to B to A changes.

## Native interaction

The status uses an approval symbol and opens the exact current context instead of blindly reconnecting. Missing context/capability cannot turn the button into a different operation. The sheet shows the full selectable/copyable device ID, computer-side matching instructions and, for upgrades, a reminder to inspect the requested access. Copy and Check again revalidate the current active connection/context ID. No automatic approval, rejection, polling or credential deletion is added.

The ordinary operator iOS handshake may close its socket while waiting for approval. The app therefore does not promise a live resolved event on that socket. Existing Mobile self-pairing resolution requires the exact pending request ID; another device's owner approval is not evidence of this device's readiness. Future event-based recovery must preserve that distinction.

All fixed text uses the app's real 19-language catalog. The old combined “pair again” error was replaced with separate credential and computer-approval guidance. Context creation/invalidation, public-only projection, malformed metadata, current scope and explicit reconnect are tested with scripted protocol sockets; the real app and exact compiled resources are CI gates. Actual USB matching/approval, two-backend recovery and inference remain the program owner's device acceptance, with no service changes or release authorized by this slice.
