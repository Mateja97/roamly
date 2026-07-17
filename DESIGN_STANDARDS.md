# Design Standards

The visual design system for **Roamly** — the app that helps people find and
explore activities (the opening flow asks *nearby / anywhere*, then shows
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
| `--scrim` | `rgba(42,14,17,0.72)` | modal dim behind bottom sheets/overlays (wine-black tint) |
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
- **Display accent** (`--font-display`): **Marcellus** (Google Font, regular
  400), the display type for **screen headers** — the Welcome destination
  hero and the primary title/H1 that gives a screen its identity — never body
  copy, labels, in-card titles (Activity card titles stay system font), or
  utility-bar titles. **Marcellus header sizes** (the full set — keep this
  list the single source so header work stays consistent):
  Welcome destination hero `--font-size-2xl` (36px) · search-setup H1
  ("Refine your search") `--font-size-xl` (28px) · activities-list title
  (Nearby/Anywhere) 26px. All render `--text` cream on `--bg`, weight 400
  (Marcellus ships one weight), line-height 1.2. Every size is ≥24px, so each
  is large text and clears contrast with margin (`--text` on `--bg` is 8.5:1).
  On
  `area: app` this is a new dependency (`expo-font` + `@expo-google-fonts/marcellus`);
  gate first paint on the font load so the prompt never flashes in the system
  stack, then falls back to the system stack only if loading fails. On
  `area: frontend` load it via `@font-face`/Google Fonts. This is the one and
  only non-system typeface in the system.
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
- `--radius-lg`: `16px` — larger feature surfaces only (the Scope ticket
  card); the default `--radius` (8px) stays the norm for buttons, inputs, and
  standard cards.
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

Optional supporting subtitle: a single caption line directly under the title,
`--font-size-sm` `--text-muted` (6.2:1 on `--bg`), for one-line context about
the list below (e.g. a ranking/sort caption). When present the header is a
two-line title block on the left; the actions stay right-aligned and
top-aligned. Truncate each line to one line with ellipsis (honor dynamic text
scaling). No new token or color pairing — reuses the documented
`--text-muted`-on-`--bg` combination.

**Display-title variant (Marcellus header):** a screen whose header IS the
screen's identity (not a utility bar) sets its title in `--font-display`
(Marcellus) at the matching **Marcellus header size** (see Typography) instead
of the system `--font-size-lg` — e.g. the activities-list title (26px) and the
search-setup H1 ("Refine your search", `--font-size-xl` 28px). `--text` cream
on `--bg`, weight 400, line-height 1.2, tightened tracking. Font-load-gated
like all Marcellus use — no system-stack flash before the font resolves. The
optional subtitle above applies unchanged. The nav affordances that flank such
a header (an interim back control, a scope indicator) are separate elements,
not part of the title block — see the Mobile-specific interim back control and
the scope indicator pill below.

**Scope indicator pill (non-interactive):** a small status pill that names the
active search scope (Nearby / Globe icon + "Nearby"/"Anywhere") in a header
row. Transparent bg on `--bg`, 1px `--primary` gold border (UI element, 3.65:1
✓), a 16px `--primary` gold scope icon (`MapPin` Nearby / `Globe` Anywhere),
and an uppercase label `--font-size-xs`, weight 600, `letter-spacing 0.05em`.
The **label is `--text` cream, not gold** — gold `--primary` on `--bg` is only
3.65:1, which clears the 3:1 UI/large bar the border and icon sit on but fails
the 4.5:1 normal-text bar a 12px label needs; cream is 8.5:1. Non-interactive
(no hover/press/focus); the icon is decorative (`aria-hidden`) since the label
carries the scope. This is the AA-safe reading of the gold-outline pill —
gold structure, cream label. No new token.

### Destination header (overline + display headline)

The Welcome screen's opening header, styled as a boarding-pass "destination
field": a small uppercase overline eyebrow over a large serif question with a
dashed accent underline. Distinct from the micro-labels of Stat display /
Slider (those sit on `--surface` inside a control and use `0.05em`); this is a
centered hero eyebrow above a `--font-display` headline on `--bg`, with wider
tracking.

- **Overline** (eyebrow): `--font-size-sm` (14px, honours the body-text
  floor; rounds the reference's 13px up), weight 600, uppercase, wide
  `letter-spacing: 0.22em`, `--text-muted` on `--bg` (6.2:1 ✓, normal text).
  Centered. `--space-3` (12px) below it to the headline.
- **Headline**: `--font-display` (Marcellus), `--font-size-2xl` (36px, one
  line), line-height 1.1, `--text` cream on `--bg` (8.5:1 ✓, large text).
  Centered. Font-load-gated like all Marcellus use (hold first paint until
  the font resolves; no fallback flash).
- **Dashed underline**: a gold accent rule directly beneath the headline,
  drawn as an **SVG stroke with `stroke-dasharray`** (the dashed-line device
  already used by the flight-path background and the logo route) — not a
  single-side dashed CSS/border, which renders inconsistently across web and
  native. Color `--card-highlight` (gold at 0.5 alpha); decorative, no
  contrast requirement (same class as the card top-edge highlight). Sits
  `--space-2` (8px) under the headline baseline, inset to roughly the
  headline's text width. Static — no animation.

Non-interactive, decorative header block; no focus/hover/press states.
Composes from `--text-muted`, `--text`, `--card-highlight`, `--bg`,
`--font-display`, `--font-size-sm`/`--font-size-2xl`. No new color tokens.

### Stat display

For the number that IS the screen. Label above: `--font-size-sm`
`--text-muted`, uppercase, `letter-spacing: 0.05em`. Value: `--font-size-2xl`
`--primary` (gold — this is large text, clears 3:1) or `--text` (cream),
`tabular-nums`. Eligible for the one per-screen `--glow`. Sub-line
(delta/status) `--font-size-sm` in the relevant semantic color.

### Difficulty meter (segmented)

A discrete N-segment level bar (e.g. an activity's difficulty, 3 of 5). Not a
continuous Slider — this is a read-only rating shown as filled-vs-unfilled
segments plus a text readout.

- **Label row:** name left — `--font-size-xs` (12px), uppercase,
  `letter-spacing: 0.05em`, `--text-muted` (6.2:1 on `--bg` ✓); current level
  right — `--font-size-sm` `--text`, weight 600 — the **level label only**
  (e.g. "Intermediate"), 8.5:1 on `--bg` ✓. The filled-segment count is the
  numeric cue; the readout does **not** append a "N/M" suffix — that
  duplicates the segments and diverges from the mock. The text readout — never
  color alone — carries the value.
- **Segments:** a full-width row of equal-flex bars, 6px tall, `--radius-full`,
  `--space-2` gap. Filled segments `--primary` gold (3.65:1 on `--bg` — UI
  element, clears 3:1 ✓); unfilled `--border` (decorative track). The
  filled-count is the redundant non-color cue beside the text level.
- Non-interactive; no hover/press/focus. Exposed to AT as the text level, not
  as an adjustable control. No animation (static on render).

Composes from `--primary`, `--border`, `--text`, `--text-muted`,
`--radius-full`, `--font-size-xs`/`--font-size-sm`. No new color token.

### Accent banner card

A highlighted info banner calling out one time-bound item (e.g. a museum's
current show, a gallery's current exhibition). The one emphasised block on a
detail screen, distinct from the flat fact chips around it.

- **Container:** `--surface-gradient` (flat `--surface` where the gradient
  isn't available), 1px `--border` with the gold `--card-highlight` top edge,
  `--radius`, `--space-4` padding, plus a **3px `--primary` gold left-accent
  bar** running the card's full height (decorative structure — a UI/decorative
  edge, no text-contrast requirement, same class as the card top-highlight).
- **Content stack** (`--space-1`/`--space-2` between lines): overline —
  `--font-size-xs`, uppercase, `letter-spacing: 0.08em`, `--text-muted` (5.3:1
  on `--surface` ✓). The overline is **not gold**: gold at this size fails the
  4.5:1 normal-text bar (`--primary` on `--surface` is 3.1:1) — the gold
  left-bar carries the accent, tan/cream the text (the gold-structure /
  cream-label rule the Scope indicator pill uses). Title — `--font-size-md`
  `--text`, weight 600 (≥6.5:1 across the gradient ✓, per the Activity card's
  gradient findings). Subline — `--font-size-sm` `--text-muted` (≥4.8:1 across
  the gradient ✓).
- Non-interactive. Reserves its layout space; **omitted entirely** when the
  screen has no such item to feature (no empty/placeholder banner — matches the
  omit-rather-than-blank pattern).

On `area: app` the gradient reuses `expo-linear-gradient` (already a dependency
via the Activity card / Scope ticket); fall back to flat `--surface` otherwise.
Composes from `--surface-gradient`/`--surface`, `--border`, `--card-highlight`,
`--primary`, `--text`, `--text-muted`, `--radius`. No new color token.

### Scope ticket (nearby / anywhere)

The opening flow's core control: a horizontal **boarding-pass ticket** card,
one per activity scope — **Nearby** and **Anywhere**. The whole card is a
single tap control (one screen-reader button) that sets the scope and enters
the browse flow. Exactly two, stacked full-width with `--space-4` between them;
no third option. Replaces the earlier three-way choice card.

**Container:** full width, `min-height: 104px`, `--radius-lg` (16px), content
clipped to the radius. Background `--surface-gradient` (`#93313A → #8A2C35`,
top-lit). Row layout: **stub | body | go-button**.

**Stub (left):** 78px wide, centred icon, fill a faint gold tint
(`rgba(206,144,66,0.14)`). Right edge is a **2px dashed tear line** in
`--border`. Icon 28px `lucide` in `--primary` gold, stroke 1.75 — Nearby
`MapPin`, Anywhere `Globe`. The icon is decorative (`aria-hidden`) — the card's
text title and accessible name carry the meaning — so its ~2.6:1 contrast on
the gold-tinted stub is an accepted decorative value, not an
information-bearing UI pairing.

**Perforation notches:** two 16px circles filled with the page background
`--bg` wine, centred on the tear-line's x, half-off the top and bottom card
edges, for the punched-ticket look. Decorative.

**Body (middle, `flex:1`, `--space-4`/`--space-6` padding, vertically centred):**
title `--font-size-lg` (20px), weight 600, `--text` cream (≥6.5:1 across the
gradient ✓); one-line hint `--font-size-sm` (14px) `--text-muted` tan (4.8:1 on
the gradient's lightest top stop ✓ — 14px honours the 14px body-text floor,
rounding the reference's 13px up). Nearby → "Nearby" / "Within reach";
Anywhere → "Anywhere" / "Across the world".

**Go-button (right, `--space-6` padding-right, vertically centred):** 40px
circle with a `lucide` `ArrowRight` (18px, stroke ~2.4), decorative
(`aria-hidden`).
- *Selected* ticket: circle filled `--primary` gold, arrow in `--ink` (6.6:1 ✓).
- *Unselected*: transparent circle, 1.5px `--primary` border, `--primary` arrow.

**Selection treatment** (single-select; **Nearby** is the default):
- *Selected*: **2px `--primary` gold border** (3.65:1 on `--bg` — UI, clears
  3:1 ✓) + the one per-screen `--glow` as a faint inner radial
  (`radial-gradient(ellipse at 30% 0%, --glow, transparent 65%)`) + the filled
  go-button. Never color-only — the filled-vs-outlined go-circle is the
  redundant non-color cue.
- *Unselected*: 1px `--border` with a gold `--card-highlight` top edge, and the
  outlined go-button.

**Interaction & states:**
- The whole card is the tap target (well over 44×44; the 40px go-circle is
  decorative, not a separate control). `--space-4` between the two tickets
  (> the `--space-2` neighbour gap).
- Tap navigates immediately (no separate confirm step in this flow), so the
  "selected" styling is BOTH the resting emphasis on the recommended default
  (Nearby) AND the press/active feedback: pressing either card shows the
  selected treatment (gold border + filled go-circle) within ~100ms, then the
  flow advances. There is no held toggle that moves the border between cards.
- *Loading* (a scope whose entry resolves device location first): keep the
  card's live colors (don't drop to disabled gray), disable re-trigger for the
  request's duration, swap the hint to a progress line ("Getting your
  location…") + inline Spinner in the go-button slot; `prefers-reduced-motion`
  → static "…" in the hint, no Spinner.
- *Focus* (keyboard/AT): the 2px `--primary` border is the focus indicator
  (same as the selected border) — visible, no separate ring.
- Each card exposes an accessible name — "Explore activities nearby" /
  "Explore activities anywhere"; icon and go-arrow are `aria-hidden`.
- Motion: color-only state change, no size/scale animation.

Composes from `--surface-gradient`, `--glow`, `--primary`, `--ink`, `--border`,
`--card-highlight`, `--text`, `--text-muted`, `--bg`, `--radius-lg`. On
`area: app` the gradient and glow need `expo-linear-gradient` (see
Mobile-specific). ponytail: two tickets is the whole flow — don't build a
generic wizard/stepper abstraction until a second step exists.

### Activity card

The visual, image-led **ticket** card for one browseable activity in a list
(cover image, category, rating, title, description, distance/location + a
go-arrow). Styled as a torn boarding-pass stub — the horizontal sibling of the
Scope ticket. The List row recipe is for compact text rows; this is richer.
The whole card is one tap control that opens the activity's detail screen —
exposed as a single screen-reader button (not a plain group), with the
accessibility label below acting as the button's name.

**Container:** full card width, `--radius-lg` (16px), content clipped to the
radius. Body background `--surface-gradient` (`#93313A → #8A2C35`, top-lit —
needs `expo-linear-gradient` on `area: app`, already a dependency). 1px
`--border` on all sides with the top edge set to `--card-highlight` (the gold
hairline), the standard card elevation device. `--space-4` between stacked
cards.

Structure (image-top, torn-stub):
- **Cover image** at the top, full width, fixed reserved height **150px** (a
  uniform cover strip; space reserved so nothing jumps as it loads),
  `--radius-lg` on the top corners only. Two overlay pills sit on it, each a
  `--scrim`-filled `--radius-full` pill:
  - **Category badge**, top-left, `--space-3` inset: `--font-size-xs`,
    uppercase, weight 600, `--text` (cream) label.
  - **Rating pill**, top-right, `--space-3` inset: a small `--primary` gold
    `Star` icon (decorative) + value `--font-size-sm` `--text` with
    `tabular-nums`.
  - `--text` on `--scrim` is ≥6.1:1 even over a pure-white photo (72%-opaque
    wine-black) — clears 4.5:1. The gold `Star` is ~2.6:1 worst-case, so it's
    decorative; the cream value carries the rating.
  - Loading: `--surface-hover` placeholder at the reserved 150px box with the
    Skeleton opacity pulse; the overlay pills (from data, not the image) still
    render.
  - Broken/missing: `--surface-hover` block with a centered 20px `--text-muted`
    `ImageOff` icon — never a broken-image glyph, never collapse the box.
  - Image *optimization* and *lazy-loading* are the engineer's concern
    (FRONTEND_STANDARDS / APP_STANDARDS); this recipe fixes only the reserved
    box and its loading/broken look.
- **Perforation seam** directly under the image (the torn-stub tear line):
  - a full-width horizontal **dashed rule** in `--border`, ~2px, drawn as an
    **SVG stroke with `stroke-dasharray`** (`~"2 12"`) — never a CSS/RN dashed
    border, which renders inconsistently across web and native (same rule as
    the Destination header's dashed underline). Sits in a ~2px seam row so it
    reserves its own space.
  - two **perforation notches**: 16px circles filled with the page background
    `--bg` wine, centered on the seam line, half-off the card's left and right
    edges (`left: -8` / `right: -8`); with the card's clip-to-radius the outer
    half is clipped and a wine half-circle bites into each edge (punched-ticket
    look). Decorative.
- **Body**, `--space-4` padding, on the gradient, `--space-2` between stacked
  elements:
  - **Title** `--font-size-lg` (20px) weight 600 `--text` (≥6.5:1 across the
    gradient ✓), up to 2 lines then ellipsis (truncate, never clip — honor
    dynamic text scaling). System font — **not** the Marcellus display accent
    (that stays the Welcome headline only).
  - **Description snippet**: `--font-size-sm` `--text-muted` (~5.3:1 on the
    gradient's lower stop), up to 2 lines then ellipsis, from
    `Activity.description`. Omitted entirely when the activity has no
    description — a shorter card than its neighbour is not a layout jump.
  - **Distance / location row**: a 16px `--primary` gold `MapPin` (decorative
    — the text carries the meaning) + distance/location `--font-size-sm`
    `--text-muted` (`tabular-nums` on the km value) on the **left**; the
    **go-button** on the **right**, spaced apart, vertically centered. No
    price/cost element — the flow shows no price signage anywhere (product
    decision; `PriceTier` stays in the wire contract but never renders).
  - No tags row: the ticket body is title → description → distance/go-row.
- **Go-button** (bottom-right of the distance row): a **38px** circle filled
  `--primary` gold with a `lucide` `ArrowRight` (~17px, stroke ~2.4) in
  `--ink` (6.6:1 ✓). **Decorative, not a separate control** — no own role and
  no own handler; a tap on it lands inside the card and fires the card's
  single `onPress` (opens the detail screen). Its sub-44px size is fine
  because the whole card is the tap target. Same size/token pattern as the
  Scope ticket go-button, scaled to 38px.
- **ActivityCardSkeleton**: matches this footprint — a 150px image skeleton
  block, the perforation seam, a title skeleton line (~80%), one-to-two
  description skeleton lines (~100% / ~70%), and a bottom row with a short
  distance skeleton line plus a 38px `--surface-hover` circle for the
  go-button — so real cards arrive with zero jump.
- **Accessibility label**: title, category, "rated {rating}", the
  distance/location phrase, then the description — description omitted from the
  label when absent, mirroring the visual. The cover image, both overlay
  pills, the dashed line, both notches, the go-button, and every icon are
  decorative and excluded from the label / hidden from the a11y tree
  (`accessibilityElementsHidden` / `importantForAccessibility`); no price
  reference ever appears.

**Interactive states** (the card is a control, not decoration): rest is the
gradient card above; **pressed** swaps the body to `--surface-hover` (a single
bg color swap, whole card, one target — carries on touch, no hover reliance);
**focused** (keyboard/AT) adds a 2px `--primary` focus border (replacing the
1px `--border`, keeping the gold `--card-highlight` top edge). The card clears
the 44×44 floor by a wide margin; stacked cards keep `--space-4` between them.
Press feedback lands within ~100ms; no size/scale animation — only the bg
color swaps. Fully keyboard-operable, never tap-only.

No new color tokens — composes from `--surface-gradient`, `--border`,
`--card-highlight`, `--scrim`, `--primary`, `--ink`, `--text`, `--text-muted`,
`--bg`, `--radius-lg`, `--radius-full`. `--space-4` between stacked cards.

### Photo attribution (Google-sourced imagery)

Credits a photo that carries Google author attribution (Places photos).
Renders **only** when that photo's optional attribution is present; when it
is absent the element renders nothing — zero height, no background, no
distinction treatment. A non-attributed photo (e.g. today's placeholder
imagery) looks exactly as it did before this recipe existed.

- **Placement**: a single caption line flush directly **below** the photo it
  credits — never overlaid on the image. Contrast over arbitrary photography
  can't be guaranteed, and an overlay risks obscuring the very photo Google's
  policy forbids obscuring. The caption belongs to that one photo and travels
  with it wherever the photo appears (card image, detail hero, and each photo
  of any future gallery — per-photo, not per-screen).
- **Content**: "Photo by {author}", `--font-size-xs`, `--space-2` vertical /
  `--space-4` horizontal padding matched to the photo's horizontal insets.
  - *No link*: author name in `--text-muted`, no underline, non-interactive.
  - *With link*: the author name is an **underlined** link — `--text` label,
    underlined so the link affordance never depends on the gold-on-surface
    pairing that fails normal-text contrast (`--primary` on `--surface` is
    only 3.1:1). The "Photo by" prefix stays `--text-muted`. The link is a
    44×44 tap target (the strip takes `min-height: 44px` when it holds a
    link), ≥`--space-2` from neighbors, keyboard-operable, with a 2px
    `--primary` focus outline. Opens the author's Google profile.
  - The attribution text is never truncated, recolored, or restyled away from
    the author's given name (Google policy: not hidden/obscured/altered); it
    wraps to a second line rather than ellipsing.
- **Visual distinction of the Google photo**: the caption strip carries a 1px
  `--border` top hairline separating it (and the photo above) from the
  content below, plus its `--space-2`/`--space-4` whitespace inset. This strip
  is the sanctioned "Google-sourced" marker (border + whitespace treatment);
  no extra frame is drawn around the photo itself.
- **No layout jump**: the strip is part of the photo block and its
  presence/absence is decided at data-load time, not toggled after paint, so
  nothing shifts. When attribution is absent the block collapses fully — no
  reserved empty strip; attribution is either present from first render or
  never.

Pre-computed pairings: `--text-muted` author on `--surface` 5.3:1 ✓ / on
`--bg` 6.2:1 ✓ · `--text` link on `--surface` 7.1:1 ✓ / on `--bg` 8.5:1 ✓ ·
`--primary` focus outline on `--surface` 3.1:1 / on `--bg` 3.65:1 (UI element,
clears 3:1). No new color tokens.

### Filter chip (selectable / removable)

The interactive sibling of the (non-interactive) Badge/pill, for two jobs: a
multi/single-select option inside the Bottom sheet, and a removable
active-filter chip on a list. `--font-size-sm`, weight 500, `--radius-full`,
padding `--space-2` `--space-3`, `min-height: 44px`, ≥`--space-2` from
neighbors, fully keyboard-operable with a visible focus border. Press/active
feedback carries on touch (no hover reliance).

- **Unselected** (sheet option): transparent bg, 1px `--border`, `--text-muted`
  label (5.3:1 on `--surface`).
- **Selected** (sheet option): `--surface-hover` bg, 2px `--primary` border,
  `--text` label (7.1:1), leading 16px `--primary` `Check` icon — selection is
  never color-only.
- **Removable** (active-filter chip on a list): `--surface-hover` bg, 1px
  `--border`, `--text` label + trailing 16px `X` icon in `--text-muted`. The
  whole chip is one 44×44 remove control; `aria-label` "Remove <filter>
  filter". Press → `--surface` bg.

No new color tokens.

### Slider (range)

A continuous single-value control (e.g. the activity Filter sheet's "Max
distance") — used instead of fixed chip buckets when the value genuinely
spans a range rather than a handful of discrete options.

- **Layout:** a group label row — the group name left (`--font-size-sm`
  `--text-muted`, uppercase, `letter-spacing 0.05em`), the current value right
  as text (`--font-size-md` `--text`, 7.1:1, `tabular-nums` so digits don't
  shift the row while dragging — the value is never color-only). Track spans
  the full content width below the label, 4px tall, `--radius-full`: active
  portion `--primary` gold (3.1:1 on `--surface`), inactive remainder
  `--border`. Min/max end labels under the track ends, `--font-size-xs`
  `--text-muted` (5.3:1). A 24px `--primary` gold thumb centered on the track,
  ≥44×44 hit area (extended vertically past the visible disc), ≥`--space-2`
  clear of the group above/below.
- **Default:** the widest/least-restrictive end of the range, so a filter's
  first-load value never narrows results the user hasn't asked to narrow —
  "pinned at max, drag to tighten" reads naturally as a maximum control.
- **States:**
  - *Default:* gold thumb + gold active fill; readout shows the current value.
  - *Dragging:* thumb and fill track the drag 1:1; the value readout updates
    live (`tabular-nums`, no layout shift) — the primary feedback. A 2px
    `--text` (cream) ring, offset ~2px from the thumb (never flush — cream
    directly on the gold thumb is only 2.32:1, an accepted gap, not something
    to fix by removing the offset) marks the active thumb; it reads against
    `--surface` at 7.1:1. The thumb itself is never darkened to
    `--primary-active` (2.38:1 on `--surface` — fails the 3:1 UI bar).
  - *Focused (keyboard):* same offset cream ring; arrow keys step by one
    unit, Home/End jump to the range ends; exposed as an adjustable control
    announcing the value in its unit. Never drag-only.
  - *Disabled:* track `--border`, fill + thumb `--text-disabled`, inert.
  - *Hidden:* omit the whole group rather than showing it disabled when the
    control genuinely doesn't apply in a given context (e.g. a scope where
    the backend rejects the field) — a value visibly there-but-inert reads as
    a bug, not a rule.
- **Touch & motion:** thumb hit area ≥44×44 with ≥`--space-2` clearance; drag
  is direct manipulation; the focus/drag ring fades on `opacity` ≤150ms,
  `prefers-reduced-motion` → instant, no size animation on track or thumb.

No new color tokens — composes entirely from `--surface`, `--primary`,
`--border`, `--text`, `--text-muted`.

### Bottom sheet

A modal panel that slides up from the bottom edge for a focused, in-context
sub-task (e.g. the activity Filter control) — used instead of a full-screen
route when the choice is quick.

- **Scrim**: `--scrim` over the screen behind, dimming and disabling it.
  Tapping the scrim dismisses (the keyboard/AT path is the close control
  below — never scrim-tap only).
- **Panel**: `--surface` bg with the gold `--card-highlight` top edge, top
  corners `--radius`, full width, pinned to the bottom; height grows to
  content up to ~85% of the viewport, then scrolls internally. `--space-6`
  padding; bottom padding extends past the safe-area inset so the footer
  clears the home indicator (Mobile-specific).
- **Header row**: a 4px `--border` drag-handle bar centered at the very top
  (grabber affordance), title `--font-size-lg` `--text` left, a Ghost close
  control (`X`, 44×44, `aria-label` "Close") right.
- **Footer**: sticky at the bottom of the panel — a full-width Primary button
  (the sheet's one action, e.g. "Apply filters") plus a Ghost "Clear all",
  ≥`--space-2` between them.
- Motion: panel slides in on `transform` (translateY) while the scrim fades on
  `opacity`, 150–300ms ease-out; exit ease-in; `prefers-reduced-motion` →
  instant, no slide. Never animate height.
- Focus: on open, focus moves into the panel and is trapped there; on close
  (button, scrim, or the platform back gesture / Android hardware back — never
  a custom back control) focus returns to the trigger. Android back closes the
  sheet, not the screen.

Uses the new `--scrim` token (mirror into `tokens.css` / `tokens.ts`).

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
- **Bottom action-bar / footer inset formula**: a footer or bottom sheet
  anchored to the screen's bottom edge sets its bottom padding to
  `--space-6` (its intrinsic breathing gap) **plus** the live bottom
  safe-area inset (`insets.bottom`) — the footer *owns* the bottom inset,
  so the safe-area container it sits in must not also pad the bottom (drop
  the bottom edge from that container) or the inset double-counts. On a
  device with no bottom inset the result is a flat `--space-6`; on a
  home-indicator device the footer's content clears the indicator with the
  same `--space-6` gap above it. Every bottom-anchored footer uses this
  identical formula so they stay consistent with each other. Uses no new
  token — reuses `--space-6` and the runtime inset.
- **Navigation chrome**: back navigation follows each platform's native
  convention (iOS: top-left back control / edge-swipe gesture; Android:
  the system back gesture/button) rather than inventing a custom back
  control — a router provides this for free once one is introduced (see
  "Deferred" below). **Interim on-screen back control**: until a router
  lands, a screen reached by a hand-rolled push (e.g. the activity detail
  screen) needs an explicit on-screen back affordance, since there is no
  navigator gesture to defer to and Android's hardware back alone leaves iOS
  with no back path. Spec it as a Ghost-style control at the top-left of the
  screen header: a 16px `ChevronLeft` icon + "Back" label in `--text-muted`
  (6.2:1 on `--bg`), 44×44 target, `aria-label`/`accessibilityLabel` "Back",
  keyboard-operable, `--surface-hover` bg on press. It coexists with (does
  not replace) the platform hardware/gesture back. Remove it in favor of the
  router's native chrome once a router exists.
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
  (it's just a border color). **Exception (Welcome screen):** the Scope ticket
  recipe genuinely needs both accents — its `--surface-gradient` background and
  the selected ticket's `--glow` inner radial — so that screen brings
  `expo-linear-gradient` into the app as a dependency and mirrors
  `--surface-gradient` and `--glow` into `tokens.ts`. Use them there; still
  don't reach for them speculatively on other app surfaces.

## Admin surface (light) — scoped to the admin panel

The back-office admin panel (`frontend/src/features/admin/…`) is a **deliberate
light-surface departure** from the app's dark wine theme: a data-dense catalog
tool reads better on a cream page than on wine, on the **same wine/gold brand**
(wine `#7D2027` and gold `#CE9042` stay the anchors — the wine moves to the
sidebar and the filled actions, gold stays the mark/accent). These tokens are
**additive and scoped to the admin panel only** — they do **not** change the
app's dark theme (`--bg`/`--surface`/`--text`/… are untouched; the app never
consumes an `--admin-*` token, and the admin panel never renders on `--bg`).
Mirror them into `frontend/src/styles/tokens.css` (the admin panel is
`area: frontend` only — no `tokens.ts` change).

Because the surface flips light, three brand reflexes invert here and are
baked into the tokens below, not left to each spec:
1. **Filled actions are wine, not gold.** Gold on cream is only 2.5:1 — a gold
   button fails on this surface. The primary admin action is a **wine fill with
   a cream label** (`--admin-sidebar` bg + `--admin-sidebar-text`, 8.5:1). Gold
   stays the wordmark, the active-nav accent, and decorative icons only.
2. **The focus ring is wine, not gold, on the light surface.** Gold as a focus
   outline on cream is 2.5:1 (fails the 3:1 UI bar). `--admin-focus` (wine) is
   9.3:1 on cream / 10:1 on white. On the **wine** sidebar and on wine-filled
   controls, focus flips back to gold `--primary` (3.65:1 on wine ✓) since wine
   on wine is invisible.
3. **Status colors are darkened for AA.** The mock's bright Published `#1F8A4C`
   / Draft `#B08968` / Pending `#CE9042` fail as normal text on the light pill
   tint (3.2–3.9:1), and bright gold Pending fails even the 3:1 large-text bar
   for the stat number. The tokens below are the AA-safe darkenings, in the same
   hues, used for **both** the stat-card number and the pill text/tint.

| Token | Hex / value | Use | Contrast (computed) |
|---|---|---|---|
| `--admin-bg` | `#FBF6EE` | admin page/body + top-bar background (cream) | — (surface) |
| `--admin-card` | `#FFFFFF` | cards, table, inputs, filled-control rest | — (surface) |
| `--admin-surface-alt` | `#F2E8DA` | table head, pagination footer, row hover, thumb/skeleton placeholder, chip tint | — (surface) |
| `--admin-border` | `#ECE0CF` | card/table/section borders, row hairlines | decorative hairline |
| `--admin-border-strong` | `#E4D6C4` | control/input/chip/button borders | supplementary (see note) |
| `--admin-ink` | `#2A1416` | primary text/headings | 16.1:1 on `--admin-bg`, 17.4:1 on `--admin-card` ✓ |
| `--admin-ink-muted` | `#5C4536` | labels, table cells, chip text, table-head | 8.3:1 bg / 8.9:1 card / 7.3:1 surface-alt ✓ |
| `--admin-ink-subtle` | `#8A6A57` | subtitle, captions, stat-card labels, "Showing X of N" | 4.56:1 bg / 4.9:1 card ✓ — **card/bg only** (4.2:1 on `--admin-surface-alt` fails; use `--admin-ink-muted` on tinted rows/head) |
| `--admin-placeholder` | `#B08968` | placeholder/hint text, low-emphasis icons (search, chevron, prev/next arrow) | 3.2:1 on card — placeholder-hint / UI-icon (3:1) only, never body text |
| `--admin-sidebar` | `#7D2027` | sidebar bg, filled primary-action bg, active chip / current-page bg (= brand wine) | pairs with `--admin-sidebar-text` |
| `--admin-sidebar-text` | `#F5EBDD` | cream label on wine (= brand `--text`) | 8.5:1 on `--admin-sidebar` ✓ |
| `--admin-accent-hover` | `#6E1C22` | hover/press for wine-filled controls (darker wine) | cream label ≥9:1 ✓ |
| `--admin-sidebar-active` | `rgba(206,144,66,0.18)` | gold-tint bg of the active sidebar nav item (over wine) | cream label ≥8:1 over the tint ✓ |
| `--admin-focus` | `#7D2027` | 2px focus ring for controls on the light surface (= wine) | 9.3:1 bg / 10:1 card (UI, clears 3:1) ✓ |
| `--admin-error` | `#A11D1A` | error-banner text/icon + outline on the light surface (a true red, distinct from the wine actions) | 7.8:1 card / 7.2:1 bg / 6.4:1 surface-alt ✓ |
| `--admin-status-published` | `#17703D` | Published stat number, pill text + pill tint | 6.1:1 on card, 5.3:1 on its 12% pill tint ✓ |
| `--admin-status-draft` | `#7A5A3C` | Draft stat number, pill text + pill tint | 6.3:1 on card, 5.5:1 on its 12% pill tint ✓ |
| `--admin-status-pending` | `#8A5A12` | Pending stat number, pill text + pill tint | 5.9:1 on card, 5.2:1 on its 12% pill tint ✓ |

**Light-surface component deltas** (everything else reuses the existing
recipes, radii — cards `--radius-lg`, controls `--radius`, pills
`--radius-full` — spacing, and type scale unchanged; interactive controls still
obey the 44×44 floor and `--space-2` gaps even though the mock draws them at
32–40px):

- **Primary action button (admin):** `--admin-sidebar` (wine) fill,
  `--admin-sidebar-text` (cream) label + optional 16px icon (`currentColor`,
  cream). Hover/press → `--admin-accent-hover`. Focus → 2px gold `--primary`
  ring, offset (wine ring would vanish on the wine fill). In-flight follows the
  base Buttons rule (keep live colors, progressive label + inline Spinner,
  disabled for the request). This is the light-surface stand-in for the gold
  Primary button — one per view.
- **Secondary / control button (admin):** `--admin-card` (white) fill, 1px
  `--admin-border-strong`, `--admin-ink-muted` label/icon. Hover →
  `--admin-surface-alt` bg. Focus → 2px `--admin-focus` (wine) ring, offset.
- **Error banner (admin):** the Error banner/toast recipe recolored for light —
  the standards' `--error` coral is defined for the dark surface and fails on
  cream, so the admin banner uses `--admin-card` bg, `--admin-error` (dark red)
  for the text/leading alert icon and a 1px `--admin-error` outline, `--radius`,
  `--space-3` padding, in a space-reserved slot. `--admin-error` is a true red,
  visibly distinct from the wine actions/focus, so an error never reads as a
  button. Dismiss control + message-from-server rules are unchanged from the base
  recipe.
- **Status pill (admin):** the Badge/pill recipe recolored for light — pill text
  = the status token, pill fill = the **same token at ~12% alpha** over the
  card, plus a 6px leading dot in the same token (the non-color redundancy is
  the text label; the dot is decorative reinforcement). No border.
- **Form field (admin) — text input / textarea / select:** the base Text input
  recipe recolored for the light surface (the base recipe's `--surface-hover`
  bg / `--border` / `--text` are dark-only). Rest: `--admin-card` (white) fill,
  1px `--admin-border-strong`, `--radius`, `--font-size-md` `--admin-ink` value
  (17.4:1 ✓), placeholder/hint `--admin-placeholder` (3.2:1 — hint only, never
  the label), `min-height: 44px` (mock draws 42px — upsize). Label always
  visible above, `--font-size-sm` weight 600 `--admin-ink-muted` (8.9:1 ✓),
  `--space-2` gap, programmatically associated with its field. **Textarea:**
  same, `min-height` grown (~84px), top-aligned padding, vertically resizable.
  **Select:** same, with a trailing 16px chevron in `--admin-placeholder`
  (3:1 UI ✓); a native `<select>` is the intended control (keyboard + AT for
  free) — the mock's custom chevron is a visual, not a reason to hand-build a
  listbox. States:
  - *Focus:* 2px `--admin-focus` (wine) ring, ~2px offset (10:1 on card ✓).
  - *Invalid* (validated on **blur**, never per-keystroke): 1.5px `--admin-error`
    border + an `--admin-error` message line below (`--font-size-sm`, 7.8:1 on
    card ✓), tied to the field (`aria-describedby`), `aria-invalid` set. The
    message slot is **space-reserved** so the field doesn't shift when it
    appears/clears.
  - *Disabled:* `--admin-surface-alt` bg, `--admin-ink-subtle` value, 1px
    `--admin-border`, inert (contrast-exempt).
- **Radio group (admin):** a vertical stack of option rows (no existing recipe).
  Selection is never color-only — the filled ring plus the option label carry
  it. Each row: `--space-3` padding, `--radius`, `--font-size-md` label,
  `min-height: 44px`, `--space-2` between rows; the group is one tab stop, arrow
  keys move the selection (native `<input type=radio>` gives this for free).
  - *Unselected:* 1px `--admin-border-strong` row border, `--admin-ink-muted`
    label, a 16px hollow ring in 2px `--admin-placeholder` (3.2:1 UI ✓ — not the
    ~1.4:1 hairline).
  - *Selected:* 1.5px `--admin-focus` (wine) row border + a faint wine tint fill
    (`--admin-sidebar` at ~8% alpha over the card — the same tint-over-card
    device the Status pill uses, no new token), `--admin-ink` label, and a 16px
    **filled wine ring** (thick `--admin-focus` ring with the card showing
    through the centre — the classic filled radio, 10:1 UI ✓). Filled-vs-hollow
    is the redundant non-color cue.
  - *Focus (keyboard):* 2px `--admin-focus` ring on the focused option, offset.
- **Removable chip (admin):** the Filter chip recipe's Removable variant
  recolored for light, for editing an array-of-strings value (e.g. one category
  detail's tag list) — a **reusable pattern, not a fixed set of fields.**
  `--admin-surface-alt` fill, `--admin-ink-muted` label (7.3:1 on surface-alt
  ✓), trailing 16px `X` in `--admin-placeholder`, `--radius-full`,
  `min-height: 44px`, ≥`--space-2` apart. The chip's × is one 44×44 remove
  control, `aria-label` "Remove <value>", keyboard-operable, focus → 2px
  `--admin-focus` ring. **Add affordance:** a trailing dashed-border chip (1px
  dashed `--admin-border-strong`, `--admin-ink-muted` label + leading 16px `+`)
  that becomes an inline text input on activate — Enter commits a new value, Esc
  cancels. (Editing `details` is in scope — this is data, distinct from the
  out-of-scope image-upload "+" tile.)
- **Repeatable line-item editor (admin):** for an **array-of-objects** detail
  value (e.g. a dishes/lineup/treatments/shows list where each entry is a record
  of 2–3 sub-fields). A labeled group (group label = the field name,
  `--font-size-sm` weight 600 `--admin-ink-muted`). Each existing item is a
  **row** of its 2–3 sub-fields, each a Form field (admin) input with its own
  label/placeholder, laid out inline (`--space-3` gap) and wrapping/stacking on
  narrow width; a trailing **remove-row** control (44×44, `X`/trash icon in
  `--admin-placeholder`, `aria-label` "Remove <item>", focus → 2px `--admin-focus`
  ring) sits at the row end. Rows `--space-2` apart. **Add-row affordance:** a
  full-width dashed control-button "+ Add <singular>" (1px dashed
  `--admin-border-strong`, `--admin-ink-muted` label + leading 16px `+`) below
  the rows; activating appends a blank row and moves focus to its first
  sub-field. **Empty state** (no items): the group label + a single
  `--admin-ink-muted` hint ("No <items> yet") + the Add button — no empty rows
  drawn. Per-subfield states are the Form field states (default / focus /
  invalid-on-blur for a required sub-field / disabled); each row's invalid
  message is reserved so the row doesn't shift. Every sub-field, add, and remove
  control is keyboard-reachable and labelled. No new token.
- **Nested single-object field group (admin):** for a **nullable single-object**
  detail value (a pointer that may be null — e.g. a now-showing / artwork /
  exhibition block of 2–3 text sub-fields). A labeled group holding the object's
  sub-fields as stacked Form field inputs (a mini-section). Because the object is
  nullable, present-vs-absent is **explicit**:
  - *Absent (null):* the group label + an `--admin-ink-muted` "Not set" hint + a
    control-button "Add <group>" that reveals the empty fields. No empty object
    is sent as if it were data.
  - *Present:* the sub-fields render, plus a "Remove <group>" control-button that
    clears the group back to null (empties the fields and drops the object).
  - A required sub-field (e.g. a banner title) is validated on blur **only while
    the group is present**. Per-field default/focus/invalid/disabled as Form
    field. Add/Remove keyboard-operable and labelled. No new token.
- **Boolean toggle (admin):** for a single `bool` detail value (e.g.
  `open_tonight`). A native checkbox styled light: unchecked = 1px
  `--admin-border-strong` box on `--admin-card`; checked = `--admin-focus`
  (wine) fill + a cream `--admin-sidebar-text` check glyph (8.5:1 ✓ — the check
  glyph is the redundant non-color cue, checked is never color-only); label to
  the right in `--admin-ink`, `--font-size-md`. 44×44 target, focus → 2px
  `--admin-focus` ring. No new token.
- **Focus ring rule:** controls on `--admin-bg`/`--admin-card` use a 2px
  `--admin-focus` (wine) outline with a ~2px offset; controls on the wine
  sidebar or with a wine fill use a 2px gold `--primary` outline. Never a
  gold ring on cream (2.5:1) and never a wine ring on wine.
- **Supplementary borders:** `--admin-border`/`--admin-border-strong` are soft
  low-contrast hairlines (~1.4:1 on white) — by design of the cream aesthetic.
  They are decorative container edges, **not** the sole identifier of a control:
  every admin control is identified by its icon + label (+ the AA focus ring on
  interaction), so the low border contrast does not gate operability. A form
  field that would rely on the border alone (T4's inputs) must carry a visible
  label and the wine focus ring, per Forms.
- **Disabled sidebar items** (Categories/Cities/Reviews/Settings, out of scope):
  rendered non-interactive — `--admin-sidebar-text` at reduced emphasis (muted
  tan, e.g. `--text-muted`), `cursor: default`, no hover/press/focus,
  `aria-disabled`; disabled controls are contrast-exempt. Only the active item
  gets the `--admin-sidebar-active` gold-tint fill + gold icon.
- **Photo manager (admin):** the drag-to-reorder photo gallery editor for the
  Manage-photos page (`/activities/:id/photos`) — the admin has no existing
  file-upload or draggable-grid component. Composes existing admin recipes;
  **no new token.** Parts:
  - *Dropzone:* a full-width drop area, `--admin-card` bg, 2px **dashed**
    `--admin-border-strong`, `--radius-lg`, `--space-8` padding. Centered stack:
    20px upload icon (`--admin-placeholder`, 3:1 UI ✓) → a "Browse files"
    control-button → hint `--font-size-sm` `--admin-ink-subtle` (4.9:1 on card
    ✓). *Drag-over:* border → 2px **solid** `--admin-focus` (wine, 10:1 UI ✓) +
    a wine tint fill (`--admin-sidebar` at ~8% alpha over the card — the
    tint-over-card device the Radio group / Status pill already use). *Focus*
    (on the Browse control): 2px `--admin-focus` ring, offset. The zone is
    drag-drop; **Browse files** is the keyboard/click path (never drag-only).
    A client-side reject (wrong type / >8 MB) surfaces inline under the hint as
    an `--admin-error` line (7.8:1 on card ✓), space-reserved.
  - *Reorder grid:* 4 columns at full width, `--space-3` gap, collapsing to 2
    then 1 column on narrow widths; a trailing dashed **Add-photo tile** always
    closes the grid.
  - *Photo tile:* `--admin-card` bg, 1px `--admin-border`, `--radius`. Stacked
    image box → footer → caption row.
    - *Image box* reuses the ImageSlot loading-skeleton / broken-`ImageOff`
      treatment (staged local previews render identically). Two overlays, each
      with guaranteed contrast over any photo: **Cover pill** (top-left, cover
      tile only) — opaque `--admin-sidebar` wine fill, `--admin-sidebar-text`
      cream label (8.5:1 ✓), `--font-size-xs` uppercase, `--radius-full` (opaque
      wine, not a translucent scrim, so a text pill stays AA over any image);
      **Remove control** (top-right) — 44×44 circular, `--admin-sidebar` wine
      fill, cream `X`, `aria-label` "Remove photo N", hover/press
      `--admin-accent-hover`, focus 2px gold `--primary` ring (wine-on-wine
      vanishes — the sidebar focus rule), ≥`--space-2` from the cover pill.
    - *Footer* (`--space-2` padding): left — **drag handle** (44×44,
      `GripVertical` `--admin-ink-muted`, `aria-label` "Reorder photo N") +
      **"Photo N"** (`--font-size-sm` `--admin-ink-muted`, `tabular-nums`);
      right — either the **Cover check** (cover tile: 16px `Check` in
      `--admin-status-published` green + "Cover" text `--admin-ink-muted` — the
      word "Cover" carries the meaning, the green is decorative reinforcement, so
      reusing the published-green token here is a UI-icon reuse, not a status
      claim; 6.1:1 on card ✓) or a **"Set as cover"** control-button (44×44) that
      moves the tile to index 0.
    - *Caption row:* an always-visible compact single-line Form field (admin) —
      visible micro-label "Caption" (`--font-size-xs` weight 600
      `--admin-ink-muted`, marked optional), placeholder "Add a caption"
      (`--admin-placeholder`), `min-height: 44px`, accessible name "Caption for
      photo N". Free text, no validation / no invalid state. Independent of
      attribution — never a substitute for a Google author credit.
  - *Add-photo tile:* same footprint, `--admin-card` bg, 2px **dashed**
    `--admin-border-strong`, centered 20px `+` (`--admin-ink-muted`) + "Add
    photo"; a 44×44 keyboard-operable button opening the same picker as Browse.
  - *Reorder interaction & keyboard path:* pointer drag reorders via the handle;
    tiles reflow by `transform` only, the drop-target shows the wine ~8% tint,
    motion ≤300ms ease-out, `prefers-reduced-motion` → instant. **Never
    drag-only:** the handle is focusable — Space/Enter picks up, arrow keys move
    among positions, Enter drops, Esc cancels. "Set as cover" is the
    pointer-and-keyboard shortcut for the most common reorder (to index 0).
  - *Staged / upload states* (upload-on-save — nothing is written on drop):
    *Staged* — tile previews the local object URL identically to a saved tile;
    the pending state is the whole page's unsaved edit, carried by the live
    **Save gallery** button. *Saving* — each pending tile dims (`opacity`) with a
    centered inline Spinner + "Uploading…", layout reserved/unchanged; Save
    follows the in-flight Button rule. *Upload failed (per tile)* — a 1.5px
    `--admin-error` outline + a "Retry" control-button, plus the page Error
    banner (admin); the staged gallery is **never dropped**, it stays editable
    and Save re-enables. *Empty* (no photos) — only the dropzone renders as the
    focal element (no grid, no add tile); its hint doubles as empty-state
    guidance.
  - Composes from `--admin-card`, `--admin-surface-alt`, `--admin-border`,
    `--admin-border-strong`, `--admin-ink-muted`, `--admin-ink-subtle`,
    `--admin-placeholder`, `--admin-sidebar`, `--admin-sidebar-text`,
    `--admin-accent-hover`, `--admin-focus`, `--admin-error`,
    `--admin-status-published`, `--primary`, `--radius`/`--radius-lg`/
    `--radius-full`, and the Form field / control-button / Spinner / Error
    banner / ImageSlot recipes. No new token.

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
- **Activity image loading/optimization** — activity cards carry photos as of
  the activities MVP, so the Activity card recipe now defines the reserved
  image box plus its loading/broken states. Image *optimization* and
  *lazy-loading* remain the engineer's implementation concern
  (FRONTEND_STANDARDS / APP_STANDARDS), not a design token.
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
