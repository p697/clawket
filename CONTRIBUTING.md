# Contributing

This repository is still in the migration and open-source-hardening phase.

## Current Priorities

- remove official hosted infrastructure assumptions from the public source tree
- keep self-hosting paths explicit and documented
- preserve current behavior while improving configuration boundaries
- improve docs, test coverage, and operator safety

## Ground Rules

- preserve product behavior
- preserve deploy and publish boundaries
- prefer path fixes and workspace orchestration over logic refactors
- do not mix protocol redesign with structural migration

## Before Opening a Change

- keep public-source defaults generic
- avoid adding new hardcoded hosted URLs or operator-specific values
- update docs when a configuration surface changes
- add or update tests when behavior changes

## Local Validation

Run the relevant checks before submitting changes:

```bash
pnpm typecheck
pnpm test
```

For targeted work, run the affected workspace tests directly.
