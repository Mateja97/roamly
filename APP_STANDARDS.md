# App Standards

Rules the `app/` (React Native / Expo) client follows. Principles, not code —
examples land once real features exist. (Backend conventions live in
`GO_STANDARDS.md`, web frontend conventions in `FRONTEND_STANDARDS.md`.)

## Stack

- **React Native**, via **Expo** (managed workflow) + **TypeScript**, built
  with Expo's Metro bundler.
- Package manager: **npm**.
- TypeScript `strict` mode on; no implicit `any`.

## Project layout

```
app/
├── App.tsx           # entry point
├── src/
│   ├── components/   # reusable presentational components
│   ├── features/     # feature-scoped UI + state (files that change together live together)
│   ├── api/           # typed client for proxy-service's HTTP API
│   └── theme/
│       └── tokens.ts # DESIGN_STANDARDS.md's palette/type/spacing as TS constants
├── app.json
├── package.json
├── tsconfig.json
└── babel.config.js
```

- Split by feature, not by technical layer. A feature owns its components,
  hooks, and state.
- Keep components focused — one clear responsibility. A component file growing
  large is a signal to split.

## Components & state

- Function components with hooks only. No class components.
- Local state with `useState`/`useReducer`; lift state only when shared.
- No navigation library (e.g. React Navigation) or global state library until
  a real need appears (YAGNI) — the scaffold is a single screen with no
  routing yet.

## Interaction & accessibility

Design-level rules (contrast, touch-target sizing, motion timing, safe
areas, native nav) live in `DESIGN_STANDARDS.md` (see its Mobile-specific
section); these are the implementation-level counterparts:

- Native components first (`Pressable`, `TextInput`, `SafeAreaView`) —
  `accessibilityLabel`/`accessibilityRole` set explicitly where the native
  component doesn't already imply the right semantics.
- Every interactive element is operable via the platform's own accessibility
  tooling (VoiceOver/TalkBack) — native components get this for free; don't
  build custom touch handling that bypasses it.
- Validate form fields on blur, not on every keystroke — don't show an error
  state while the user is still typing.
- Disable a control for the duration of its own async action (prevents
  double-submit) — this is a correctness rule, not just visual polish.
- Any animation/transition added later uses the `Animated`/`Reanimated`
  `transform`/`opacity` APIs only and respects the OS-level reduce-motion
  setting (`AccessibilityInfo.isReduceMotionEnabled()`) — don't animate
  layout properties.

## API access

- All backend calls go through `proxy-service`'s public HTTP API via the
  typed client in `src/api/` — components never call `fetch` directly.
- Request/response types are explicit TypeScript types.
- Configuration (e.g. the proxy URL) comes from `EXPO_PUBLIC_`-prefixed
  environment variables, inlined at build time by Expo/Metro — the same
  pattern `frontend/`'s Vite `VITE_`-prefixed variables use.

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
  `.claude/agents/app-engineer.md`'s Design gap escalation), don't
  invent the treatment inline.

## Testing

- **Jest** (via the `jest-expo` preset) + **React Native Testing Library**.
- Test behavior users can observe (rendered output, interactions), not
  implementation details.
- Every non-trivial component/hook ships with a test before it merges.

## Tooling

- Format: **Prettier** (enforced).
- Lint: **ESLint** with `eslint-config-expo`.
- Type-check (`tsc --noEmit`) and tests must pass before a PR opens.

## Known limitation — token duplication

React Native has no CSS custom properties, so `src/theme/tokens.ts`
re-exports `DESIGN_STANDARDS.md`'s palette/type/spacing values as
TypeScript constants, **manually kept in sync** with
`frontend/src/styles/tokens.css`. This is a known drift risk — flagged
here rather than solved here; a single-sourcing mechanism is a separate
future initiative, not this doc's job.

## Activity detail pages — per-category standard

Each of the 12 categories in `BUSINESS_STANDARDS.md` owns its own extra
properties and one unique detail-page section, on top of a shared base
layout. This is a target standard for when each category's detail page is
actually built — it does not describe anything implemented today (the
current `ActivityDetailScreen` is one generic layout for every category).

Reference design: `Roamly Activity Types.dc.html`, in the claude.ai/design
project `e93d4e9b-8c28-4bef-971e-aaa37462d1ec` ("Designer Standards
Request") — mocks up all 12 category detail screens. Pull exact visual
treatment (colors, spacing, copy) from that file when implementing a
category, not from the table below.

Shared base layout (every category): hero image, back button, category
badge, title, rating row, description, bottom action bar (a generic
Directions/Share action plus one category-specific primary CTA).

| Category | Extra properties | Unique section | Primary CTA |
|---|---|---|---|
| Restaurants | cuisine, price tier, hours, open status | Popular dishes (name + price) | Book a table |
| Bars | vibe, happy-hour window, opens time | Signature pours (pill list) | See menu |
| Cafés | known-for brew, wifi quality, hours | On the bar (item + price) | Get directions |
| Nightlife | entry price, dress code, opens time, live "open tonight" status | Tonight lineup (time + act + stage) | Guest list |
| Nature | time to spend, best time, cost | Good to know (checklist) | Get directions |
| Sport | difficulty (segmented meter), effort level, duration, gear | What to bring (checklist) | Book session |
| Kids | age range, facilities | Facilities (icon grid) | Get directions |
| Culture | venue type, ticket price, hours | Now showing (banner) | Get tickets |
| Art | venue type, ticket price, hours, artwork attribution (artist/work/medium) | Current exhibition (banner) | Get tickets |
| Wellness | — | Treatments (item + duration + price), external-booking note | Visit website |
| Entertainment | genre, neighborhood | Upcoming shows (date + title + time/price) | Get tickets |
| Shopping | venue type, best day, hours | What you'll find (tag pills) | Get directions |
