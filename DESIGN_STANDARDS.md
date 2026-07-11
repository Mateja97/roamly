# Design Standards

The visual design system for **Roamly** — the app that helps people find and
explore activities (the opening flow asks *home / nearby / abroad*, then shows
activities to match). Shared by `frontend/` and `app/`. Dark, minimalist,
**deep-wine and gold**, premium. The `designer` agent applies these tokens per
task; when a task genuinely needs something missing, it extends this file via
the `**Standard additions:**` flow (see "Delivery mechanics") rather than
improvising one-off values. (Backend conventions live in `GO_STANDARDS.md`,
frontend code conventions in `FRONTEND_STANDARDS.md`.)

The two brand colors are fixed: **wine `#7D2027`** (the background the app
lives on) and **gold `#CE9042`** (the accent — headings, CTAs, links, icons,
borders, and the logo). Everything else in the palette is a supporting token
tuned so text stays WCAG-AA readable on wine — see "Accessibility".

The Accessibility/Touch/Motion/Forms rules below incorporate the applicable
parts of the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
rule set (contrast minimums, touch-target sizing, motion timing, form
feedback patterns) — adapted directly into this doc rather than run as a
separate tool, and scoped down to what this app actually has surface area
for today (see "Deferred" below for what's intentionally left out).

## Palette

Elevation comes from stepping up the surface color and from a **gold hairline
top edge**, not from shadows — shadows read as cheap on a dark background.
Deep wine + gold hairlines is the premium wine-label / luxury-menu move, and
puts the gold brand into the structure, not only the text.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#7D2027` | app background — brand wine |
| `--surface` | `#8A2C35` | cards, panels (one step lighter than `--bg`) |
| `--surface-hover` | `#97363F` | hover/elevated surface |
| `--border` | `#5C171C` | dividers, low-contrast borders (deep-wine hairline) |
| `--primary` | `#CE9042` | brand gold — buttons, links, focus rings, headings, icons |
| `--primary-hover` | `#DCA35A` | primary, lighter |
| `--primary-active` | `#B67C34` | primary, darker (pressed) |
| `--ink` | `#2A0E11` | label color ON gold/light fills (near-black wine) |
| `--text` | `#F5EBDD` | primary/body text — warm cream |
| `--text-muted` | `#E0C9AE` | secondary text — warm tan |
| `--text-disabled` | `#B0857A` | disabled text |
| `--success` | `#A3D18E` | light sage — reads on wine, distinct from gold |
| `--warning` | `#E8C572` | light amber — distinct from brand gold |
| `--error` | `#F5B79B` | light coral — true red disappears on wine |
| `--error-hover` | `#F0A588` | destructive fill, hover (darker coral) |
| `--card-highlight` | `rgba(206,144,66,0.5)` | gold 1px top edge on cards (decorative) |
| `--glow` | `rgba(206,144,66,0.15)` | radial gold accent behind ONE focal element per screen |
| `--surface-gradient` | — | faint top-lit gradient for large cards (`#93313A → #8A2C35`) |
| `--radius-full` | `999px` | pills/badges |

## Accessibility

Every text/background token pair actually used in the UI must hit **WCAG AA**
contrast before it ships: 4.5:1 for normal text, 3:1 for large text (≥24px,
or ≥18.66px bold) and UI components (borders, icons). Disabled controls are
exempt (WCAG 1.4.3) — `--text-disabled` on `--surface-hover` is fine as-is.

- **Body text is never gold.** Gold `--primary` on wine `--bg` is only
  **3.65:1** — it clears the 3:1 bar for large text (≥24px / ≥18.66px bold),
  CTAs, icons, and borders, but **fails 4.5:1 for normal body copy**. Body and
  paragraph text uses `--text` (cream, 8.5:1) or `--text-muted` (tan, 6.2:1).
  Gold is for headings, the logo, CTAs, links, and accents — not running text.
- **Filled `--primary` (gold) buttons/controls use `--ink` as the label
  color**, not `--text` and not `--bg` — wine `--bg` on gold is only 3.65:1
  (fails the button-label bar); `--ink` on `--primary` is **6.6:1**.
- `--error` is a deliberately **light coral** (`#F5B79B`), not a saturated
  red — a true red camouflages against the wine background and also can't
  clear 4.5:1 on it. Error *text* clears 4.5:1 on `--surface` at the light
  coral value; don't darken it back toward red without re-checking contrast.
- Pre-computed pairings for the component recipes (don't re-derive):
  `--text` on `--bg` 8.5:1 ✓ · `--text-muted` on `--bg` 6.2:1 ✓ ·
  `--primary` on `--bg` 3.65:1 (large/UI only) · `--ink` on `--primary`
  6.6:1 ✓ · `--text` on `--surface` 7.1:1 ✓ · `--text-muted` on `--surface`
  5.3:1 ✓ · `--primary` on `--surface` 3.1:1 (large/UI only) · `--success` on
  `--surface` 4.84:1 ✓ · `--warning` on `--surface` 5.08:1 ✓ · `--error` on
  `--surface` 4.86:1 ✓ · `--ink` on `--error` (destructive label) 10.4:1 ✓.
- When a task's design-spec introduces a new text/background pairing (not
  just the ones listed above), the `designer` agent must compute its
  contrast ratio before using it, and pick an existing token combination (or
  write a `**Standard additions:**` entry per the "Delivery mechanics" rule
  below) rather than assume a token that reads fine on one surface also reads
  fine on another.
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
  **minimum 44×44px** — buttons and card actions get an explicit
  `min-height: 44px` for this reason (measured short by ~1.5px on
  `padding: var(--space-3) 0` alone).
- Maintain at least `--space-2` (8px) gap between adjacent interactive
  elements so touch targets don't crowd each other.
- Every tap/click gets visible feedback within ~100ms — the existing
  hover/active token swaps (`--primary-hover`/`--primary-active`) satisfy
  this; never rely on a hover-only state as the sole feedback (hover doesn't
  exist on touch).
- Buttons are disabled for the duration of their async action — don't let a
  user re-trigger a request that's already running.

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
- Numbers that update in place use tabular (monospace-width) figures —
  `font-variant-numeric: tabular-nums` — so the digit width doesn't shift the
  surrounding layout when the count changes.

## Spacing & shape

- 4px base spacing scale: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px,
  `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px,
  `--space-16` 64px.
- `--radius`: `8px` on cards, buttons, inputs — soft but not pill-shaped.
- No box-shadows for elevation; a 1px `--border` line plus the gold top edge
  is enough.

## Depth & accents

Flat `--surface` + a uniform 1px `--border` reads as unfinished. These are
the sanctioned depth devices — tokenized, and still no drop shadows:

- **Card top highlight**: cards set `border-top-color: var(--card-highlight)`
  — a 1px **gold** top edge that reads as light hitting the surface (the
  Linear/Vercel dark-mode trick, recolored to the brand gold). Decorative; no
  contrast requirement.
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
| Primary | `--primary` bg, `--ink` label (6.6:1) | `--primary-hover` bg | `--primary-active` bg | THE action of the screen — one per view |
| Secondary | transparent, 1px `--border`, `--text` label | `--surface-hover` bg, `--primary` border | `--surface` bg | alternate actions, empty-state CTAs |
| Ghost | no bg/border, `--text-muted` label | `--text` label, `--surface-hover` bg | `--surface` bg | low-emphasis (Sign out, Cancel) |
| Destructive | `--error` bg, `--ink` label (10.4:1) | `--error-hover` bg | `--error` bg | irreversible actions only |

In-flight: keep the variant's rest colors, swap label to progressive form
("Loading…") with an inline Spinner, disable interaction — don't drop to
the disabled gray (the action is live, not unavailable).

### Text input

`--surface-hover` bg, 1px `--border`, `--radius`, `--font-size-md` `--text`,
placeholder `--text-disabled`, `min-height: 44px`, padding `--space-3` /
`--space-4`. Focus: border → `--primary`. Error: border → `--error` +
`--error` message line below (see Forms). Label always visible above,
`--font-size-sm` `--text-muted`, `--space-2` gap.

### Badge / pill

For statuses. `--font-size-xs`, uppercase, `letter-spacing: 0.05em`, weight
500, padding `--space-1` `--space-2`, `--radius-full`, transparent bg, 1px
border in the badge's color, text in the same color: neutral
`--text-muted`/`--border` border · success `--success` · warning `--warning`
· error `--error`. (Ratios on `--surface`: 5.3 / 4.84 / 5.08 / 4.86 — all
pass 4.5.) Non-interactive; no hover.

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
`--surface` bg, `--error` text/icon (4.86:1 on `--surface`, pre-computed in
Accessibility above), 1px `--border`-weight outline in `--error`, `--radius`,
`--space-3` padding. Reserves its layout space so it doesn't shift
surrounding elements on appear/dismiss (per "No layout jump" below).
Dismissible: a Ghost-style close control, keyboard-operable,
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

For the number that IS the screen. Label above: `--font-size-sm`
`--text-muted`, uppercase, `letter-spacing: 0.05em`. Value: `--font-size-2xl`
`--primary` (gold — this is large text, clears 3:1) or `--text` (cream),
`tabular-nums`. Eligible for the one per-screen `--glow`. Sub-line
(delta/status) `--font-size-sm` in the relevant semantic color.

### Choice card (home / nearby / abroad)

The opening flow's core control — the three activity-scope options. Each is a
full-width card (stacked on mobile, 3-up on wide): `--surface`, 1px `--border`
with gold `--card-highlight` top edge, `--radius`, `--space-6` padding, tap
target well over 44px. Contents: 20px `--primary` (gold) icon → title
`--font-size-lg` `--text` → one-line hint `--font-size-sm` `--text-muted`.
Rest → hover/press: `--surface-hover` bg + border → `--primary`. The selected
card carries a `--primary` border and is the eligible spot for the one
per-screen `--glow`. Fully keyboard-operable (it's a control, not decoration)
with a visible focus border. ponytail: three cards is the whole flow today —
don't build a generic wizard/stepper abstraction until a second step exists.

## Icons

`lucide-react` (web) / `lucide-react-native` (app), one family only.
`stroke-width: 1.75` everywhere. 16px inline with text (buttons, rows), 20px
standalone (empty states, choice cards). Color: `currentColor` — icons
inherit their text context, never carry their own palette. Paired with
visible text → `aria-hidden="true"`; icon-only control → `aria-label`
required. Never emoji.

## Logo

The Roamly logo is a **wordmark** — "Roamly" set in the brand system font
stack (weight 650, tightened letter-spacing) in gold `--primary`, with a
**dashed gold travel-route** underneath: a filled start dot on the left, a
dashed path, and an open destination ring on the right. The route is the
brand's "find and explore a journey" idea made literal; it is part of the
lockup, not optional decoration.

- **Source of record**: `frontend/public/roamly-wordmark.svg`. The app mirrors
  it into `app/assets/roamly-wordmark.svg` when a screen needs it (same
  manual-sync model as the token files — see "Delivery mechanics"). The
  wordmark renders as live `<text>` in the system font, so it stays editable
  and matches the UI type; it is not outlined to paths.
- **Color**: gold `#CE9042` on the wine background. On any other background,
  swap the SVG `fill` to `currentColor` and set the color in context — never
  recolor the wordmark outside the wine/gold/cream family.
- **Square mark / favicon**: `frontend/public/favicon.svg` — a gold "R"
  monogram with the gold pin-dot on a wine rounded-square, for favicons, app
  tiles, and any spot too small for the full wordmark. Use the monogram, not
  a squeezed wordmark, below ~96px wide.
- **Clear space & min size**: keep at least the cap-height of "R" clear on all
  sides; don't render the full wordmark below ~120px wide (use the monogram
  instead). Don't stretch, rotate, add shadows, or place it on a busy
  background.
- **Raster app icons** (`app/assets/icon.png`, adaptive/monochrome icons,
  splash) are still the default Expo placeholders. Generating those PNGs is
  outside this doc's tooling; the mark above is the source a designer/engineer
  exports them from when that task comes up (see "Deferred").

## Layout

- Single content column, `max-width: 720px`, centered; side gutters
  `--space-4` below tablet width, `--space-6` above.
- Vertical rhythm: `--space-8` between page sections, `--space-6` card
  padding, `--space-4` between heading and its content.
- Cards: `--surface`, 1px `--border` with gold `--card-highlight` top edge,
  `--radius`, `--space-6` padding.
- One focal element per screen (largest type or the glow), everything else
  steps down — if everything is prominent, nothing is.

## Mobile-specific

For `area: app` tasks. Colors, type scale, and spacing values are identical
to `area: frontend` — the platform difference is interaction chrome, not
the palette:

- **Safe areas**: every top-level screen renders inside a safe-area
  container (RN's `SafeAreaView` or equivalent) — never let content sit
  under a device notch, status bar, or home indicator.
- **Navigation chrome**: back navigation follows each platform's native
  convention (iOS: top-left back control / edge-swipe gesture; Android:
  the system back gesture/button) rather than inventing a custom back
  control — a router provides this for free once one is introduced (see
  "Deferred" below).
- **Touch targets**: the existing 44×44px floor (see "Touch & interaction"
  above) already satisfies both iOS HIG's 44pt minimum and Android
  Material's 48dp recommendation — no separate mobile sizing rule needed.
- **No hover state**: mobile has no hover; every interaction that relies on
  `--surface-hover`/hover-only feedback on web needs its rest/active pair
  to carry the full feedback on mobile (already true per "Touch &
  interaction" above — never rely on hover as the sole feedback).
- **Depth devices deferred**: `--glow` (radial gradient) and
  `--surface-gradient` require a gradient library on React Native
  (`expo-linear-gradient`) not yet a project dependency — skip these two
  accents for `area: app` tasks until a task genuinely needs them; the
  gold card top-highlight border device works identically on both platforms
  (it's just a border color).

## Delivery mechanics

- Tokens are CSS custom properties in `frontend/src/styles/tokens.css`,
  imported once from `index.css`.
- For `area: app`, the same values live as TypeScript constants in
  `app/src/theme/tokens.ts` — React Native has no CSS custom properties.
  This file is manually kept in sync with `tokens.css`; there is currently
  no automated check that the two don't drift (a known gap — closing it is
  a separate initiative, not this doc's job).
- **Rebrand status**: this doc is the source of record for the wine/gold
  system. The token files (`tokens.css`, `tokens.ts`) and the raster app
  icons still carry earlier values and are updated by the frontend/app
  engineers on their task branches when they touch the affected surface —
  same designer→engineer flow every token change uses.
- Components consume `var(--token)` (web) or the `tokens.ts` constants
  (app) in colocated styles — never a hard-coded color, size, or spacing
  value that a token already covers.
- The `designer` agent (`.claude/agents/designer.md`) composes these tokens
  and recipes into a `design-spec.md` per frontend/app task. A task that
  genuinely needs something new is a `DESIGN_STANDARDS.md` addition the
  designer writes into this file directly (flagged as `**Standard
  additions:**` in its spec section, approved at the design checkpoint);
  the frontend-engineer or app-engineer mirrors any new token into
  `tokens.css` or `tokens.ts` respectively and commits it on the task
  branch, so additions ship — and revert — with the feature that needed
  them.

## UX baseline (not just visual polish)

The `designer` agent designs interaction behavior, not only appearance.
Every design-spec must account for:

- **No layout jump**: reserve space for conditional content (errors,
  confirmations) rather than letting it push surrounding elements when it
  appears/disappears.
- **Consistent feedback per action**: every async action (submit, fetch,
  select) has an explicit loading, success, and error treatment — never a
  silent no-op while a request is in flight.
- **Focus and keyboard reachability**: interactive elements need a visible
  focus state (a border/outline color change is enough — this system uses
  no separate glow token) and must be operable via keyboard, not just click.
- **Accessibility basics** (see above) are part of the design-spec, not an
  afterthought left to code review.

## Forms & feedback

- Labels are always visible, never placeholder-only (the placeholder is a
  hint, not the label).
- Errors render below the affected field/action, not in a toast/banner
  disconnected from it.
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

- **Raster logo assets** — the wordmark and square mark exist as SVG; the
  Expo raster icons (`icon.png`, adaptive/monochrome, splash) and any PNG
  favicon still need exporting from the mark when a branding task takes it on.
- **Activity imagery / lazy loading** — no images in the app yet; once
  activity cards carry photos, add image optimization and lazy loading here.
- **Navigation patterns** (bottom nav, deep linking, back-stack) — the app is
  a short flow with no router yet; revisit if/when a real router or a fourth
  top-level screen is added.
- **Charts & data visualization** — no charts yet.
- **Light mode** — this system is deliberately dark-only (deep wine is the
  base, not a dark variant of a light-first system); revisit only if a real
  light-mode requirement appears, and then design both modes together.

## Values are a first pass

The palette/type/spacing values above are expected to be revisited — treat
them as the current baseline, not a permanent lock-in.
