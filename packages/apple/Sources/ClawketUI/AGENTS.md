# Native presentation

This directory owns reusable iOS presentation only. The app host owns backend capabilities, wire models, connection evidence, persistence and side effects. Do not infer delivery, authorship, permissions or readiness from prose, animation or socket state.

- Keep public presentation values and intents usable by the real app. Unsupported actions are hidden; temporarily unavailable actions explain their state. Do not ship fixture data or no-op controls.
- Send and Stop are independent capabilities. A running task must not hide a supported send/queue action; the host supplies its label and owns queue behavior. Approval and question IDs are host-wide scoped presentation identities, mapped by the host to the exact backend request generation.
- Preserve iOS 16.4. Guard iOS-only views so the package's macOS core checks compile. Use system navigation, sheets, menus, text selection and semantic colors/type; preserve the Clawket cat identity.
- Keep draft ownership outside view lifetimes. Compact/expanded editing must retain the same native text view, marked text and selection. Transcript IDs and reading anchors must survive streaming, pagination and reconciliation.
- Native builds and simulator/device checks require the shared leases. Record simulator, fixture and real-backend evidence separately in `docs/native-ios/` through the program owner.
