# frontend

The platform's web client — React + TypeScript, built with Vite. Talks to
the backend only through `proxy-service`'s public HTTP API.

**Status:** scaffolded — renders `proxy-service`'s `/healthz` status, proving
the wiring works. Build real features on top via `/run-pipeline`.

## Run locally

```
npm install
npm run dev      # http://localhost:5173, talks to proxy-service via VITE_PROXY_URL
```

Copy `.env.example` to `.env` and point `VITE_PROXY_URL` at a running
`proxy-service` (defaults to `http://localhost:8080`, matching the
docker-compose port).

Or via the full stack: `docker compose up` from the repo root brings up
`postgres` + `proxy-service` + this app together (`http://localhost:4173`).

## What's here

- `src/api/health.ts` — typed client calling `proxy-service`'s `/healthz`;
  the only place `fetch` is called. Add new endpoints here as `src/api/*.ts`
  files, never call `fetch` from a component directly.
- `src/styles/tokens.css` — the `DESIGN_STANDARDS.md` design tokens (colors,
  spacing, type scale).

## Responsibilities

- Render the product UI.
- Call the backend via `proxy-service`'s public HTTP endpoints.

## Non-responsibilities

- No direct calls to backend services — everything goes through `proxy-service`.
- No business logic that belongs on the backend.

## Testing

`npm test` (Vitest + React Testing Library).

See [ARCHITECTURE.md](../ARCHITECTURE.md) and [FRONTEND_STANDARDS.md](../FRONTEND_STANDARDS.md).
