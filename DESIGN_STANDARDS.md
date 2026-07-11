# Design Standards

The visual design system for `frontend/`. Dark, minimalist, olive-green,
premium. The `designer` agent applies these tokens per task; when a task
genuinely needs something missing, it extends this file via the
`**Standard additions:**` flow (see "Delivery mechanics") rather than
improvising one-off values. (Backend conventions live in
`GO_STANDARDS.md`, frontend code conventions in `FRONTEND_STANDARDS.md`.)

The Accessibility/Touch/Motion/Forms rules below incorporate the applicable
parts of the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
rule set (contrast minimums, touch-target sizing, motion timing, form
feedback patterns) — adapted directly into this doc rather than run as a
separate tool, and scoped down to what this app actually has surface area
for today (see "Deferred" below for what's intentionally left out).

## Palette

Elevation comes from stepping up the surface color, not from shadows —
shadows read as cheap on a dark background. This is the same technique
premium dark UIs (Linear/Vercel/Stripe-style dark modes) use.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#14160F` | app background — near-black, warm olive tint |
| `--surface` | `#1B1E14` | cards, panels |
| `--surface-hover` | `#242819` | hover/elevated surface |
| `--border` | `#2E331F` | dividers, low-contrast borders |
| `--primary` | `#8A9A5B` | buttons, links, focus rings |
| `--primary-hover` | `#A4B378` | primary, lighter |
| `--primary-active` | `#6E7C46` | primary, darker (pressed) |
| `--text` | `#EDEFE6` | primary text — warm off-white |
| `--text-muted` | `#9BA08C` | secondary text |
| `--text-disabled` | `#5C6152` | disabled text |
| `--success` | `#7FA65B` | close to primary — reads as on-brand |
| `--warning` | `#C9A227` | muted gold |
| `--error` | `#CC7350` | muted rust/terracotta, not alarm-red |
| `--error-hover` | `#D98963` | destructive button, hover |
| `--card-highlight` | `#383E26` | 1px lighter top edge on cards (decorative) |
| `--glow` | `rgba(138,154,91,0.15)` | radial accent behind ONE focal element per screen |
| `--surface-gradient` | — | faint top-lit gradient for large cards (`#1D2016 → #1B1E14`) |
| `--radius-full` | `999px` | pills/badges |

## Accessibility

Every text/background token pair actually used in the UI must hit **WCAG AA**
contrast before it ships: 4.5:1 for normal text, 3:1 for large text (≥24px,
or ≥18.66px bold) and UI components (borders, icons). Disabled controls are
exempt (WCAG 1.4.3) — `--text-disabled` on `--surface-hover` (2.36:1) is
fine as-is.

- **Filled `--primary` buttons/controls use `--bg` as the label color**, not
  `--text` — `--text` on `--primary` is only 2.64:1 (fails even the large-text
  bar); `--bg` on `--primary` is 5.95:1.
- `--error` is deliberately lighter than a "pure rust" would be
  (`#CC7350`, not `#B5533C`) specifically so error text clears 4.5:1 at the
  normal `--font-size-sm` it's typically rendered at — don't darken it back
  down without re-checking contrast.
- Pre-computed pairings for the v2 component recipes (don't re-derive):
  `--bg` on `--error` (destructive button label) 5.33:1 ✓ · `--bg` on
  `--error-hover` 6.69:1 ✓ · `--success` on `--surface` 6.04:1 ✓ ·
  `--warning` on `--surface` 6.98:1 ✓ · `--error` on `--surface` 4.94:1 ✓ ·
  `--text-muted` on `--surface-hover` 5.60:1 ✓.
- When a task's design-spec introduces a new text/background pairing (not
  just the ones listed above), the `designer` agent must compute its
  contrast ratio before using it, and pick an existing token combination (or
  write a `**Standard additions:**` entry per the "Delivery mechanics" rule
  below) rather than assume a
  token that reads fine on one surface also reads fine on another.
- Focus rings are 2–4px (the `--primary` border-color swap already used on
  inputs satisfies this at the low end — don't go thinner).
- Every non-text UI element (icon-only buttons, if any appear later) needs a
  text alternative (`aria-label` or equivalent) — never rely on icon shape
  alone.
- Full keyboard reachability and operability, not just visual focus — this
  is enforced in code (`FRONTEND_STANDARDS.md`), but the design-spec must
  never require a hover-only or drag-only interaction with no keyboard path.
- Respect `prefers-reduced-motion` (see "Motion" below) and support dynamic
  text scaling — don't design layouts that truncate or clip at larger
  user-set font sizes.

## Touch & interaction

- Interactive elements (buttons, inputs, links acting as controls) are
  **minimum 44×44px** — `.sign-in-card button` and `.event-card button`
  both get an explicit `min-height: 44px` for this reason (measured short
  by ~1.5px on `padding: var(--space-3) 0` alone).
- Maintain at least `--space-2` (8px) gap between adjacent interactive
  elements so touch targets don't crowd each other.
- Every tap/click gets visible feedback within ~100ms — the existing
  hover/active token swaps (`--primary-hover`/`--primary-active`) satisfy
  this; never rely on a hover-only state as the sole feedback (hover doesn't
  exist on touch).
- Buttons are disabled for the duration of their async action (already the
  pattern here: Reserve/Sign in disable and relabel while in flight) —
  don't let a user re-trigger a request that's already running.

## Motion

- Micro-interactions (hover/active swaps, focus changes): instant-to-150ms.
  Anything more deliberate (a state transition, not just a color swap):
  150–300ms, up to 400ms for a more complex transition. This system doesn't
  have complex transitions yet — don't add one speculatively.
- Animate only `transform`/`opacity` — never `width`/`height`/`top`/`left`,
  which forces layout and jitters on lower-end devices.
- Enter with ease-out, exit with ease-in — motion should feel like it's
  arriving with intent and leaving out of the way.
- Respect `prefers-reduced-motion: reduce` — fall back to an instant
  state-change, no animation, when the user has that set.

## Typography

- System font stack — no added dependency:
  `-apple-system, "Segoe UI", Inter, Roboto, sans-serif`.
- Scale: `--font-size-xs` 12px, `--font-size-sm` 14px, `--font-size-md` 16px,
  `--font-size-lg` 20px, `--font-size-xl` 28px, `--font-size-2xl` 36px.
  Body text is never smaller than `--font-size-sm` (14px); prefer
  `--font-size-md` (16px) as the default body size.
- Line-height: 1.5 body, 1.2 headings. Slightly tightened letter-spacing on
  headings.
- Target 60–75 characters per line for any paragraph-length text (this
  app's copy is short labels/status lines so far — this matters once a
  screen carries real paragraph copy).
- Numbers that update in place (the remaining-ticket count) use tabular
  (monospace-width) figures — `font-variant-numeric: tabular-nums` — so the
  digit width doesn't shift the surrounding layout when the count changes.

## Spacing & shape

- 4px base spacing scale: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px,
  `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px,
  `--space-16` 64px.
- `--radius`: `8px` on cards, buttons, inputs — soft but not pill-shaped.
- No box-shadows for elevation; a 1px `--border` line is enough.

## Depth & accents

Flat `--surface` + a uniform 1px `--border` reads as unfinished. These are
the sanctioned depth devices — tokenized, and still no drop shadows:

- **Card top highlight**: cards set `border-top-color: var(--card-highlight)`
  — a 1px lighter top edge that reads as light hitting the surface (the
  Linear/Vercel dark-mode trick). Decorative; no contrast requirement.
- **Primary glow**: at most ONE per screen, behind the screen's focal
  element (the primary CTA or the stat display), via
  `background: radial-gradient(ellipse at 50% 0%, var(--glow), transparent 70%)`
  on the element's container. Never on secondary surfaces.
- **Surface gradient** (optional, large/hero cards only):
  `background: var(--surface-gradient)` instead of flat `--surface`. The
  goal is "too subtle to notice consciously".
- The no-box-shadow rule stands: these are border-color and background
  devices, not shadows. Don't stack all three on one element — highlight
  is default for every card, glow and gradient are per-screen accents.

## Components

Concrete recipes the `designer` agent composes from. Each is tokens +
proportions + states; the engineer writes the CSS, but the look is fixed
here. All interactive recipes inherit the Touch (44×44px, --space-2 gaps)
and Motion rules.

### Buttons

All variants: `--radius`, `min-height: 44px`, `--font-size-md`, weight 500,
padding `--space-3` vertical / `--space-6` horizontal (full-width in narrow
cards), label + optional 16px icon with `--space-2` gap. Disabled (any
variant): `--text-disabled` label on `--surface-hover`, inert.

| Variant | Rest | Hover | Active | Use |
|---|---|---|---|---|
| Primary | `--primary` bg, `--bg` label | `--primary-hover` bg | `--primary-active` bg | THE action of the screen — one per view |
| Secondary | transparent, 1px `--border`, `--text` label | `--surface-hover` bg, `--primary` border | `--surface` bg | alternate actions, empty-state CTAs |
| Ghost | no bg/border, `--text-muted` label | `--text` label, `--surface-hover` bg | `--surface` bg | low-emphasis (Sign out, Cancel) |
| Destructive | `--error` bg, `--bg` label (5.33:1) | `--error-hover` bg (6.69:1) | `--error` bg | irreversible actions only |

In-flight: keep the variant's rest colors, swap label to progressive form
("Reserving…") with an inline Spinner, disable interaction — don't drop to
the disabled gray (the action is live, not unavailable).

### Text input

`--surface-hover` bg, 1px `--border`, `--radius`, `--font-size-md` `--text`,
placeholder `--text-disabled`, `min-height: 44px`, padding `--space-3` /
`--space-4`. Focus: border → `--primary`. Error: border → `--error` +
`--error` message line below (see Forms). Label always visible above,
`--font-size-sm` `--text-muted`, `--space-2` gap.

### Badge / pill

For statuses (`reserved`, `confirmed`, `sold out`). `--font-size-xs`,
uppercase, `letter-spacing: 0.05em`, weight 500, padding `--space-1`
`--space-2`, `--radius-full`, transparent bg, 1px border in the badge's
color, text in the same color: neutral `--text-muted`/`--border` border ·
success `--success` · warning `--warning` · error `--error`. (Ratios on
`--surface`: 6.04 / 6.98 / 4.94 — all pass.) Non-interactive; no hover.

### Skeleton loader

Replaces "Loading…" text for any content fetch. `--surface-hover` blocks,
`--radius`, shaped like the content they stand in for (text line → 1em-tall
bar at ~60% width; stat → one 2.5em bar; list → 3 rows). Animation: opacity
0.5→1, 1.2s ease-in-out infinite alternate; `prefers-reduced-motion`:
static at opacity 0.7. Layout space identical to the loaded state — zero
jump on arrival.

### Spinner (inline)

16px circle, 2px stroke: `--border` track, `--primary` arc, 0.8s linear
rotation. Lives inside buttons (next to the in-flight label) and inline
status lines — never a full-page overlay. `prefers-reduced-motion`: replace
with the static "…" in the label.

### Error banner/toast

Baseline fallback for any API error a task's design doesn't call out
explicitly (see `FRONTEND_STANDARDS.md`'s Error handling section).
`--surface` bg, `--error` text/icon (4.94:1 on `--surface`, already
pre-computed in Accessibility above), 1px `--border`-weight outline in
`--error`, `--radius`, `--space-3` padding. Reserves its layout space so it
doesn't shift surrounding elements on appear/dismiss (per "No layout jump"
below). Dismissible: a Ghost-style close control, keyboard-operable,
`min-height: 44px` / `min-width: 44px` touch target, ≥`--space-2` from
adjacent content. Message text comes straight from the server response the
typed client surfaces — this recipe prescribes presentation, not wording.

### Empty state

Never a lone muted sentence. Centered in the content area, `--space-12`
vertical padding: 20px icon in `--text-muted` → title `--font-size-md`
`--text` → hint `--font-size-sm` `--text-muted` (one line, what to do
next) → optional Secondary button. `--space-3` between elements.

### List row

Flex row, `--space-3` vertical padding, 1px `--border` bottom hairline
(none on last), primary text `--font-size-sm` `--text` left, meta/badge
right. Interactive rows: `--surface-hover` bg on hover + visible focus
border; static rows get no hover response.

### Page header

Transparent on `--bg`, 1px `--border` bottom hairline, padding `--space-4`
vertical / `--space-6` horizontal. Title `--font-size-lg` `--text` left;
Ghost-button actions right. Single row at all widths.

### Stat display

For the number that IS the screen (remaining tickets). Label above:
`--font-size-sm` `--text-muted`, uppercase, `letter-spacing: 0.05em`.
Value: `--font-size-2xl` `--text`, `tabular-nums`. Eligible for the one
per-screen `--glow`. Sub-line (delta/status) `--font-size-sm` in the
relevant semantic color.

## Icons

`lucide-react`, one family only. `stroke-width: 1.75` everywhere. 16px
inline with text (buttons, rows), 20px standalone (empty states). Color:
`currentColor` — icons inherit their text context, never carry their own
palette. Paired with visible text → `aria-hidden="true"`; icon-only
control → `aria-label` required. Never emoji.

## Layout

- Single content column, `max-width: 720px`, centered; side gutters
  `--space-4` below tablet width, `--space-6` above.
- Vertical rhythm: `--space-8` between page sections, `--space-6` card
  padding, `--space-4` between heading and its content.
- Cards: `--surface`, 1px `--border` with `--card-highlight` top edge,
  `--radius`, `--space-6` padding.
- One focal element per screen (largest type or the glow), everything else
  steps down — if everything is prominent, nothing is.

## Delivery mechanics

- Tokens are CSS custom properties in `frontend/src/styles/tokens.css`,
  imported once from `index.css`.
- Components consume `var(--token)` in colocated `.css` files — never a
  hard-coded color, size, or spacing value that a token already covers.
- The `designer` agent (`.claude/agents/designer.md`) composes these tokens
  and recipes into a `design-spec.md` per frontend task. A task that
  genuinely needs something new is a `DESIGN_STANDARDS.md` addition the
  designer writes into this file directly (flagged as `**Standard
  additions:**` in its spec section, approved at the design checkpoint);
  the frontend-engineer mirrors any new token into `tokens.css` and commits
  both on the task branch, so additions ship — and revert — with the
  feature that needed them.

## UX baseline (not just visual polish)

The `designer` agent designs interaction behavior, not only appearance.
Every design-spec must account for:

- **No layout jump**: reserve space for conditional content (errors,
  confirmations) rather than letting it push surrounding elements when it
  appears/disappears.
- **Consistent feedback per action**: every async action (submit, reserve,
  fetch) has an explicit loading, success, and error treatment — never a
  silent no-op while a request is in flight.
- **Focus and keyboard reachability**: interactive elements need a visible
  focus state (a border/outline color change is enough — this system uses
  no separate glow token) and must be operable via keyboard, not just click.
- **Accessibility basics** (see above) are part of the design-spec, not an
  afterthought left to code review.

## Forms & feedback

- Labels are always visible, never placeholder-only (already the pattern:
  `SignInForm`'s "User identifier" label persists; the placeholder
  `e.g. alice` is a hint, not the label).
- Errors render below the affected field/action, not in a toast/banner
  disconnected from it (already the pattern on both `SignInForm` and
  `EventPage`).
- Validate on blur, not on every keystroke — don't design a red-error state
  that would fire while the user is still mid-typing. (Implementation detail
  lives in `FRONTEND_STANDARDS.md`; the design-spec just shouldn't imply
  keystroke-level validation.)
- After a failed submit, focus returns to the first invalid field
  (implementation detail, called out here so the design-spec doesn't
  silently omit it as a requirement).

## Deferred — not yet applicable

These categories exist in the source guidance this system draws from but
have no surface area in the app yet. Don't design for them speculatively;
revisit when the trigger condition below actually appears:

- **Image optimization / lazy loading** — no images in the app yet.
- **Navigation patterns** (bottom nav, deep linking, back-stack) — the app
  is two conditionally-rendered screens with no router; revisit if/when a
  real router or a 3rd top-level screen is added.
- **Charts & data visualization** — no charts yet.
- **Light mode** — this system is deliberately dark-only (not a dark variant
  of a light-first system); revisit only if a real light-mode requirement
  appears, and then design both modes together, not one inferred from the
  other.

## Values are a first pass

The palette/type/spacing values above are expected to be revisited — treat
them as the current baseline, not a permanent lock-in.
