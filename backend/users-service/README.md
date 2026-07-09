# users-service

Owns user profile and account data.

**Status:** planned — no code yet.

## Responsibilities

- CRUD for user profiles over gRPC (schema TBD)
- Publish user lifecycle events (e.g. `user.created`) to Kafka
- Consume relevant auth events (TBD)

See [ARCHITECTURE.md](../ARCHITECTURE.md) and [GO_STANDARDS.md](../GO_STANDARDS.md).
