# Live

Live is Clawket's real-time activity surface for connected OpenClaw and Hermes backends. It provides a concise view of what agents and sessions are doing without maintaining a second simulated workspace.

## Data shown

- Current and recent sessions
- Explicit run lifecycle state: working, completed, aborted, or failed
- Latest tool activity per session
- Daily message, token, tool-call, and cost summaries when the backend supports them
- Unacknowledged cron failures and pending node/device pairing requests

All cards are derived from gateway data. Completion and failure state comes from runtime events, while recency is used only for working, recent, and standby labels.

## Backend behavior

- OpenClaw sessions are scoped to the selected agent prefix.
- Hermes sessions use global keys and are not filtered with OpenClaw prefix assumptions.
- Usage, cost, cron, and node requests are capability-gated so unsupported endpoints are never called.
- Selecting a session sends a generic Chat session request and opens Chat; it does not depend on Live remaining mounted.

## Implementation

- UI: `src/screens/LiveScreen/LiveTab.tsx` and `LiveOverview.tsx`
- Pure aggregation and backend-aware scoping: `src/services/live-dashboard.ts`
- The user-facing label and internal navigation route are both `Live`.

Live is headerless and begins below the platform safe area. Motion must respect the system reduce-motion setting.

## Analytics

- `live_session_opened`
- `live_attention_opened`

Analytics properties must remain low-cardinality and must not include raw session IDs or message content.
