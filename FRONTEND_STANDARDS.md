# Frontend Standards

Rules the `frontend/` app follows. Principles, not code — examples land once the
app exists. (Backend conventions live in `GO_STANDARDS.md`.)

## Stack

- **React + TypeScript**, built with **Vite**.
- Package manager: **npm**.
- TypeScript `strict` mode on; no implicit `any`.

## Project layout

```
frontend/
├── src/
│   ├── components/   # reusable presentational components
│   ├── features/     # feature-scoped UI + state (files that change together live together)
│   ├── api/          # typed client for proxy-service's HTTP API
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

- Split by feature, not by technical layer. A feature owns its components,
  hooks, and state.
- Keep components focused — one clear responsibility. A component file growing
  large is a signal to split.

## Components & state

- Function components with hooks only. No class components.
- Local state with `useState`/`useReducer`; lift state only when shared.
- No global state library until a real need appears (YAGNI).

## Interaction & accessibility

Design-level rules (contrast, touch-target sizing, motion timing) live in
`DESIGN_STANDARDS.md`; these are the implementation-level counterparts:

- Semantic HTML and native elements first (`<button>`, `<label htmlFor>`,
  `<form>`) — ARIA only where native semantics can't express the state.
- Every interactive element is keyboard-operable (native elements get this
  for free; don't build click-only custom controls).
- Validate form fields on blur, not on every keystroke — don't show an error
  state while the user is still typing.
- After a failed submit, move focus to the first invalid field.
- Disable a control for the duration of its own async action (already the
  pattern: Reserve/Sign in disable and relabel while their request is in
  flight) — this is a correctness rule (prevents double-submit), not just
  visual polish.
- Any animation/transition added later uses `transform`/`opacity` only and
  respects `prefers-reduced-motion` (`@media (prefers-reduced-motion:
  reduce)` disables it) — don't animate layout properties.

## API access

- All backend calls go through `proxy-service`'s public HTTP API via the typed client in
  `src/api/` — components never call `fetch` directly.
- Request/response types are explicit TypeScript types.

## Error handling

- The typed client in `src/api/` never throws an opaque error for an API
  response — it resolves to a discriminated result: success, or one of the
  fixed statuses `proxy-service` can return (`400 | 403 | 404 | 409 | 500`),
  each carrying the server's message. See `GO_STANDARDS.md`'s Errors
  section and `backend/proxy-service/README.md`'s HTTP status codes table
  for where this set comes from.
- Every call site handles the result. An ignored error branch (empty
  `catch`, unhandled promise, discarded union member) is a bug, not a style
  nit.
- **Baseline:** the shared generic error banner (see `DESIGN_STANDARDS.md`'s
  Error banner/toast recipe) covers any status the task's `design-spec.md`
  doesn't call out explicitly. It's always available — "no explicit design"
  is never an excuse to swallow an error.
- **Escalate, don't improvise:** if a status code needs something
  structurally different from "show the generic banner" (e.g. `403` should
  block access or redirect, not just toast) and `design-spec.md` is silent
  on it, that's a design gap — raise it (see
  `.claude/agents/frontend-engineer.md`'s Design gap escalation), don't
  invent the treatment inline.

## Testing

- **Vitest** + **React Testing Library**.
- Test behavior users can observe (rendered output, interactions), not
  implementation details.
- Every non-trivial component/hook ships with a test before it merges.

## Tooling

- Format: **Prettier** (enforced).
- Lint: **ESLint** with the TypeScript + React config.
- Type-check (`tsc --noEmit`) and tests must pass before a PR opens.
