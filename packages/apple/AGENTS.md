# Native Apple packages

Root instructions apply. These Swift 6 packages support iOS 16.4 and macOS 13; they contain no React Native or JavaScript runtime. Keep the application in `apps/ios`, reusable presentation in `ClawketUI`, and backend identity separate from transport identity.

`ClawketTransport` owns bounded WebSocket frames, RPC correlation, socket generations and transport liveness. Only an adapter's verified backend response may establish readiness or reset retry backoff. Relay ticks prove transport traffic only. Advertise only implemented capabilities; the initial native client supports `relay.client-pong.v1`, not client-ping or transfer hints.

The coordinator owns the single event-stream reader and retry scheduling; screens never compete for that stream. Use the advertised capability list when constructing Relay URLs. Requests may run during handshaking, but neither a successful arbitrary RPC nor `relay.ready` automatically confirms backend readiness.

Retirement synchronously invalidates pending operations before closing the captured socket. Fence every awaited continuation by generation; reject uncertain writes without replay. Cap frames at 8 MiB, JSON nesting at 64, JSON tokens at 250,000 (including object keys) and pending RPCs at 128. The event stream defaults to 256 events/16 MiB of buffered wire data; overflow retires it instead of silently dropping state. Raw frames, endpoint credentials and peer/native error text are application data, never diagnostic labels. Errors describe fixed categories.

Use injectable socket and monotonic clock protocols for deterministic tests. Fixtures in `tests/compat/fixtures/v1` remain the historical protocol source; native tests read them without modifying them. A macOS package test is not evidence of phone, Relay or backend inference behavior. Follow root resource leases and narrow test rules before Swift builds or tests.
