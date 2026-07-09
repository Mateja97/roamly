# shared

Common Go library used by all services. A library, not a service — no main, no Dockerfile.

**Status:** planned — no packages yet.

## Planned packages

- Structured logging setup (slog wrapper/defaults)
- Kafka producer/consumer helpers
- Config loading helpers (env vars)
- Common error types

Rule: code enters `shared/` only when a second service actually needs it.

See [GO_STANDARDS.md](../GO_STANDARDS.md).
