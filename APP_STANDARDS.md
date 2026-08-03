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
- **Named exception — reviews:** the activity detail screen's Reviews
  section is the one deliberate, spec-recorded departure from the baseline
  above (`docs/superpowers/specs/2026-08-02-activity-detail-system-design.md`'s
  "Reviews" state table). Google reviews are fetched live on detail open,
  independently of the rest of the page, and can fail or come back empty on
  their own — a fetch failure, an unavailable result, or a genuinely
  missing Google Maps attribution link all omit the section (and the review
  count, and the maps link) silently, with **no error banner**. A
  supplementary section failing shouldn't alarm someone reading a venue
  page, and the reviews section's own compliance rule (never render without
  being able to link back to Google Maps) already forces the same silent
  omission in that case anyway. This carve-out is scoped to that one
  section — every other API failure on this screen (and everywhere else in
  the app) still follows the baseline above.
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

Each of the 13 categories in `BUSINESS_STANDARDS.md` owns its own extra
properties and one unique detail-page section, on top of a shared base
layout — implemented, not aspirational: `ActivityDetailScreen.tsx` composes
every category from one canonical section order plus a single optional
"promote one slot above the stat grid" per category
(`activityDetailConfig.ts`'s `bodySectionOrder`), driven by one typed-slot
library (`FactStrip`/`UniqueSection`/`MetaLine`/`ReviewsSection`/etc., all
in `src/features/activity-list/`) rather than 13 independently-drifting
per-category layouts.

Reference design:
`docs/superpowers/specs/2026-08-02-activity-detail-system-design.md` (the
data contract — every generated field's `scalar`/`phrase`/`prose` kind and
its absence rule — the canonical section order, and each category's exact
composition) plus
`pipeline/activity-detail-system/design-import/Roamly Activity Detail System.dc.html`
(the paired visual mockup: exact tokens/spacing for every slot, rendered
against 13 example venues). Pull exact visual treatment from the `.dc.html`
file when touching a category's detail screen, composition/kind rules from
the spec doc — not from the table below, which is a summary.

Shared base layout (every category): hero image, back button, action chips
(Directions/Website/Call/Share/Menu, each present only when its data is),
title block, meta line (category · subtype · … · distance, one optional
status/level chip), hours row (when structured hours are usable), stat
grid, description, unique section, good-to-know, reviews, map, bottom
action bar (a generic Directions/Share action plus one category-specific
primary CTA). Every generated field is declared as `scalar`, `phrase`, or
`prose` and is **omitted, never relocated or placeheld**, when it fails its
kind's shape or matches the placeholder denylist — see the spec doc's "The
data contract" section, implemented in `fieldKind.ts`
(`backend/shared/contentkind` is the same contract's backend half).

Per-category chip/duration/price wording below reflects what T2/T3 actually
shipped (`activityDetailConfig.ts`'s `factStripFields`/`uniqueSection`): every
per-item scraped price and duration is gone from both the fact-chip grid and
the list sections (Verifiability rule, `DESIGN_STANDARDS.md`) — those
sections are now name-only pill rows. Nature's `cost` and Tours'
seeded/editorial `duration` are the two exceptions, not oversights.

| Category | Extra properties | Unique section | Primary CTA |
|---|---|---|---|
| Restaurants | cuisine, hours, open status; no price-tier chip (Verifiability rule) — Tripadvisor-sourced rows carry price level/cuisine in the meta line instead and drop the Cuisine chip too | Popular dishes (name-only pills) | Book a table |
| Bars | vibe, happy-hour window, opens time | Signature pours (pill list, built from a raw `string[]` — not yet per-item validated, see Pill row recipe) | See menu |
| Cafés | known-for brew, wifi quality, hours | On the bar (name-only pills); description promoted above the stat grid | Get directions |
| Nightlife | dress code, opens time, live "open tonight" status; no entry-price chip (Verifiability rule) | Tonight lineup (time + act + stage), promoted above the stat grid | Guest list |
| Nature | time to spend, best time, cost (hand-authored editorial value, not a scraped price — kept) | Good to know (checklist) | Get directions |
| Sport | difficulty (segmented meter, promoted above the stat grid), effort level, gear; no duration chip (Verifiability rule) | What to bring (checklist) | Book session |
| Kids | age range, facilities; no fact-chip grid (never had price/duration) | Facilities (icon grid); description promoted above the stat grid | Get directions |
| Culture | venue type (only when it differs from the subtype), hours; no ticket-price chip (Verifiability rule) | Now showing (banner), promoted above the stat grid | Get tickets |
| Art | hours, artwork attribution (artist/work/medium, shown under the title); no ticket-price chip (Verifiability rule) — Art now has no fact chip of its own, only the legacy-hours fallback can still populate the grid | Current exhibition (banner), promoted above the stat grid | Get tickets |
| Wellness | no fact-chip grid at all — typical-visit and price-from chips removed (Verifiability rule), and this category has no legacy hours field to fall back to | Treatments (name-only pills), good-to-know checklist, external-booking note | Visit website |
| Entertainment | genre, neighborhood (both surface in the meta line, not a fact chip); no fact-chip grid — typical-show-length and price-from chips removed (Verifiability rule) | Upcoming shows (date + title only, name/date-block — no time/price), good-to-know checklist | Get tickets |
| Shopping | venue type (only when it differs from the subtype), best day, hours | What you'll find (tag pills, built from a raw `string[]` — not yet per-item validated, see Pill row recipe); description promoted above the stat grid | Get directions |
| Tours & Experiences | duration (seeded/editorial, not scraped — kept), group size, languages, difficulty level (level chip in the meta line, never the difficulty meter) | What's included (✓/✗ checklist), meeting point (address + map), itinerary (numbered stops) — no reviews section (no data source yet) | Check availability |
