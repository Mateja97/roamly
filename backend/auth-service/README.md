# auth-service

Owns authentication: login, JWT issuing and refresh, token validation for other services.

**Status:** planned — no code yet.

## Responsibilities

- Login and credential verification (credential storage design TBD)
- Issue and refresh JWTs
- gRPC endpoint for token validation used by proxy
- Publish auth events to Kafka (event set TBD)

See [ARCHITECTURE.md](../ARCHITECTURE.md) and [GO_STANDARDS.md](../GO_STANDARDS.md).
