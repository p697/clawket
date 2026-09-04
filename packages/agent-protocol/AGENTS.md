# Agent Protocol Package

This package is the platform-neutral contract between Clawket UI and backend adapters.

1. Keep runtime dependencies empty. Do not import React, React Native, storage, networking, or backend implementations.
2. Export only serializable protocol data, adapter interfaces, capability policy, errors, and deterministic test helpers.
3. Backend support is expressed through `Capabilities`; unsupported management groups are absent instead of throwing at runtime.
4. Contract changes must remain additive unless a 3.0 specification update explicitly requires a breaking change.
5. Runtime branches require 100% branch coverage. Keep `createMockAdapter` deterministic and usable without a device runtime.
6. The package currently exposes TypeScript source for Metro/Jest. Node workspaces must use type-only imports until a compiled runtime export is added.
