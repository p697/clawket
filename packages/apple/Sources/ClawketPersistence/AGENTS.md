# Native local storage

Keep this module independent of backend and presentation models. Credentials use an app-specific Keychain service with WhenUnlockedThisDeviceOnly accessibility. Payloads, paths, keys and native errors are never diagnostic output.

Document writes serialize across awaited storage operations, preserve a valid rollback and verify read-back before callers publish new state. An unreadable or corrupt registry is an error, not an empty installation. File stores use opaque scoped names, bounded reads, atomic writes, private permissions and iOS file protection; caches are excluded from device backup.

Legacy imports must be explicit, read-only at the source, validated and transactionally verified. Native QA storage does not authorize accessing another app's sandbox or clearing old Keychain entries. Test corrupt input, failed writes and cross-connection scope collisions.
