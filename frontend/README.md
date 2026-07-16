# frontend

The platform's web client — React + TypeScript, built with Vite. Talks to
the backend only through `proxy-service`'s public HTTP API.

**Status:** the Roamly Admin panel (T3) — an admin shell (sidebar + top bar)
and the Activities overview screen, gated behind `X-Admin-Token`. Routes:
`/activities` (list), `/activities/new` and `/activities/:id/edit` (T4).

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

- `src/api/` — typed clients calling `proxy-service`; the only place `fetch`
  is called. `health.ts` (`/healthz`), `adminActivities.ts` (`/admin/*`,
  sends `X-Admin-Token` from `VITE_ADMIN_TOKEN`), `cities.ts` (public
  `/cities/suggest`, used to populate the admin city filter). Add new
  endpoints here, never call `fetch` from a component directly.
- `src/features/admin/` — the admin panel: `AdminShell` (sidebar/top-bar
  chrome) + `activities/` (the Activities overview: stat cards, filters,
  table, pagination).
- `src/styles/tokens.css` — the `DESIGN_STANDARDS.md` design tokens (colors,
  spacing, type scale), including the admin light-surface `--admin-*` set.

## Responsibilities

- Render the product UI.
- Call the backend via `proxy-service`'s public HTTP endpoints.

## Non-responsibilities

- No direct calls to backend services — everything goes through `proxy-service`.
- No business logic that belongs on the backend.

## Testing

`npm test` (Vitest + React Testing Library).

See [ARCHITECTURE.md](../ARCHITECTURE.md) and [FRONTEND_STANDARDS.md](../FRONTEND_STANDARDS.md).
