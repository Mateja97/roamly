# Engineering notes: fix-splash-screen

## T1 — area: app
Built: `app/src/features/splash/SplashScreen.tsx` restructure. Wrapped
`destinationField` + `ctaGlowWrap` in new `destinationCtaGroup` View
(`flex:1, justifyContent:'center'`), deleted `styles.spacer` and its
standalone `<View style={styles.spacer} />`. Brand block untouched, stays
fixed-size top block. `GLOW_BLEED` (`ctaGlowWrap`'s `paddingTop`) unchanged,
still the sole source of the underline-to-CTA gap.

Acceptance criteria, checked:
- Destination + CTA under one `flex:1, justifyContent:'center'` container,
  spacer removed — done, `SplashScreen.tsx:68-115`.
- Underline-to-CTA gap fixed at 24px via `GLOW_BLEED` (`space[6]`), no
  double-gap — measured live in browser: `underlineBottom=497.19,
  buttonTop=521.19, gap=24` exact.
- Brand block stays `flex:none` fixed top block — untouched, verified via
  computed layout (`brandBlock` div height unaffected by the change).
- Net effect: destination text reads lower, CTA sits directly beneath it —
  confirmed on screenshot, see below.
- Named consts (`TOP_PADDING`, `BOTTOM_SPACER`, `DESTINATION_BLOCK_GAP`,
  `OVERLINE_TO_HERO_GAP`, `HERO_TO_UNDERLINE_GAP`) untouched. CTA subtitle
  copy untouched. `Wordmark.tsx`/`FlightPathBackground.tsx`/`PrimaryTicket.tsx`
  internals untouched.
- `SplashScreen.test.tsx` unmodified, still green (3/3 pass).

Gates: `tsc --noEmit` clean. `npm test` full suite 774/774 pass (two tests
flaked under parallel load on an unrelated file — `ActivityListScreen.test.tsx`
and `App.test.tsx` — reran the full suite clean and in isolation on
unmodified `main`, confirmed pre-existing flake unrelated to this change).
`npm run lint` clean. Ponytail-review over the diff: lean already, ship (no
new deps, one new style object doing exactly the job the old `spacer` did,
comment explains the *why* not just what).

Dynamic-text-scaling state (design-spec.md T1): not captured — `PixelRatio.
getFontScale()` always reports 1 in a browser web-preview, no OS-level
Dynamic Type equivalent to simulate there; RN default `overflow: visible`
(no ancestor sets `overflow:hidden`) means nothing truncates/clips at
runtime even at large scale, but true device verification is out of this
pipeline's reach. Flagging as a known gap, not a blocker — no acceptance
criterion in `product-tasks.md` requires code changes for this state, only
the design-spec.md's descriptive prose does.

Visual check: `docker compose ps` showed nothing running; `docker ps -a`
failed with a daemon-unreachable error in this environment, so used the
same steps the app's Dockerfile runs (`npm run export:web` + serve the
`dist/` static export on port 4174) instead of a full `docker compose up`.
Screenshots: `pipeline/fix-splash-screen/screenshots/T1/splash-default.png`,
`splash-cta-pressed.png` (pressed state verified via computed
`background-color` change `rgb(206,144,66)` to `rgb(182,124,52)` —
`--primary` to `--primary-active`, pre-existing `PrimaryTicket` behavior,
unaffected by this task). Debugging note: an unrelated stray process (a
leftover Docker port-forward, `com.docke*`, unrelated to this repo's own
compose stack which was not running) was squatting on port 4174 from a
previous session and served a stale build during the first screenshot
attempt — killed it (`lsof -ti:4174 | xargs kill -9`) before recapturing;
the fix itself was correct on the first attempt, the screenshot mismatch was
purely a stale local server artifact.

PR: https://github.com/Mateja97/roamly/pull/152

## T1 — resolve pass (review round 1: changes-requested)
Fixing commit: `f6b0787`. Fixed all 3 findings, `SplashScreen.tsx`:

- **Important** (`justifyContent:'center'` overflow regression): swapped
  mechanism. `destinationCtaGroup` drops `justifyContent`, keeps `flex:1`
  only. New `groupContent` wrapper View (holds `destinationField` +
  `ctaGlowWrap`, both otherwise untouched — same nodes, same styles, just
  re-parented) gets `marginTop:'auto', marginBottom:'auto'`. Auto margins
  center same as before when content fits; Yoga (and CSS flexbox on web,
  same rule) clamps auto margins to 0 on overflow, so it collapses to
  top-packed with overflow running off bottom instead of centering off both
  edges — matches design-spec.md T1 dynamic-text-scaling requirement.
  `DESTINATION_BLOCK_GAP` (20px) stays as `destinationField`'s own
  `marginTop`, untouched — chose the extra wrapper View over relocating
  that already-reviewed property, keeps this fix isolated to new code only.
  Went with the review's "auto margins" option over its "ScrollView"
  option: no new scroll affordance on a static, no-motion screen, smaller
  diff, native flexbox behavior already in Yoga, no new import.
  Underline-to-CTA gap unaffected: `groupContent` adds no margin/padding of
  its own, `GLOW_BLEED` still sole source, still exactly `space[6]`=24px.
  Added regression test (`SplashScreen.test.tsx`): asserts
  `destinationCtaGroup` has no `justifyContent` and `groupContent` has both
  auto margins, via `testID`s added to both Views.
- **Minor** (engineering-notes dynamic-type justification answered wrong
  question): superseded — the Important fix above changes the actual
  mechanism, this note's "not captured" caveat still holds (web preview
  can't simulate OS font scale) but now correctly describes an overflow-
  safe (auto-margin, clamps to 0) layout instead of a broken
  centering-that-clips one.
- **Minor** (glow band hard-edged, ~38px short of card): `Svg` in
  `ctaGlowWrap` now takes explicit `width="100%" height="100%"` alongside
  `StyleSheet.absoluteFill` — on web, an absolutely-positioned `<svg>` with
  all 4 offsets zeroed still falls back to its intrinsic 300×150 default
  box unless width/height are set explicitly (replaced-element sizing rule,
  not simple stretch). Verified via screenshot crop: glow now spans full
  wrapper width edge-to-edge, fades out instead of terminating on a
  straight edge (`pipeline/fix-splash-screen/screenshots/T1/
  splash-default.png` vs. round-1 version).

Gates: `tsc --noEmit` clean (ran via `node --stack-size=8000
node_modules/typescript/lib/tsc.js` — default Node v23 stack overflows on
this project's type graph size regardless of this change, unrelated).
`npm test` 775/775 green (774 + 1 new regression test). `npm run lint`
clean. Ponytail-review on the diff: trimmed 3 duplicate mechanism-
explanation comments down to 1 (JSX comment, `destinationCtaGroup` comment,
`groupContent` comment all said near the same thing) — kept detail only on
`groupContent` where the mechanism lives.

Visual check: re-ran (`npm run export:web` + `npx serve dist -l 4174`,
Docker daemon unreachable in this environment again, same as round 1).
Recaptured both `T1` screenshots — rendering changed (new wrapper View,
auto-margin centering, glow sizing). `splash-default.png`: text+CTA read as
one unit, positioned same as round 1 visually (auto margins with no
overflow center identically to `justifyContent:'center'`), underline now
visible edge-to-edge glow confirmed by crop diff against round-1 screenshot.
`splash-cta-pressed.png`: pressed-state color change confirmed
programmatically (`rgb(206,144,66)` to `rgb(182,124,52)`), pre-existing
`PrimaryTicket` behavior, unaffected. Dynamic-text-scaling state: still not
capturable in web preview (same reasoning as round 1) — the fix itself
targets exactly this state, verified by code/CSS-rule reasoning
(Yoga/flexbox auto-margin-clamps-to-0-on-overflow is a standard, documented
rule) rather than a rendered capture, since there's no way to force OS
Dynamic Type in this environment.

PR: https://github.com/Mateja97/roamly/pull/152 (same, unmerged, resolve
pass pushed to `feature/fix-splash-screen-t1`)

## T2

area:app. Splash CTA polish per design-spec.md T2.

`SplashScreen.tsx`: split `GLOW_BLEED` (was space[6]=24, one constant doing
two jobs) into `UNDERLINE_TO_CTA_GAP` (space[8]=32, `ctaGlowWrap.marginTop`,
clean `--bg`) plus `GLOW_BLEED` (space[3]=12, `paddingTop` +
`paddingHorizontal` + equal negative `marginHorizontal` for side bleed).
Card keeps full gutter-to-gutter width (padding cancels the negative
margin), wrapper bleeds 12px past it each side for the ellipse fade.

`PrimaryTicket.tsx`: 6 changes. Fill-edge bevel (`borderWidth:1`, top
`--primary-hover`, sides/bottom `--primary-active`) + `overflow:'hidden'`.
Divider `View`(`borderLeftWidth` dashed, rendered solid on RN, dead)
replaced with `Svg`+`Line` dashed stroke, 32px, `rgba(42,14,17,0.40)`,
dasharray "4 4". `GO_DISC_SIZE` 40 to 36 (matches pin well). Pin-well tint
0.10 to 0.16. `paddingVertical` space[2] to space[3]. Deleted dead
`outlineStyle`/`outlineWidth` (confirmed no-op per spec's Diagnosis).

DESIGN_STANDARDS.md's T2 Standard additions (Fill-edge bevel, SVG-dashed-
perforation correction, go-disc/tint/padding/clip corrections, glow-bleed
geometry) were already on disk in this worktree (uncommitted, designer
edit) — carried them onto `feature/fix-splash-screen-t2` (branched off
freshly-pulled `main`, which didn't have them) since they weren't reachable
from any commit; they ship as part of this PR's diff.

Acceptance criteria:
- Underline-to-CTA gap reads as visible daylight, not glow haze — checked:
  screenshot pixel-scan confirms pure `--bg` rows between the dashed
  underline and the card's glow band (`splash-default.png`).
- Card reads as a rounded rectangle, not merged/reshaped — checked: bevel
  border + `overflow:hidden` + 12px side bleed make an ellipse-around-card
  glow shape; visible in screenshot crop.
- `PrimaryTicket` states (rest/hover/pressed/focus) still swap only
  `backgroundColor` — checked: `PrimaryTicket.test.tsx` unmodified, passes.
- No dashed-border dead code — checked: `divider` View removed, replaced by
  real SVG dash.
- Go-disc/pin-well symmetric caps — checked: both 36px.

Gates: `tsc --noEmit` clean. `npm test` 775/775 green (unmodified
`SplashScreen.test.tsx`/`PrimaryTicket.test.tsx` both pass, per spec
guarantee). `npm run lint` clean. Ponytail-review: diff is 1:1 spec-mapped
style/constant edits + one dead-code deletion (`outlineStyle`/`outlineWidth`),
no new abstractions, no new deps (`react-native-svg` already used on this
screen) — nothing to cut. Rename sweep: grepped `divider`, `GO_DISC_SIZE`,
`GLOW_BLEED`, `outlineStyle` — no stale references left.

Visual check: Docker stack port 4174 held by a sibling checkout's `roamly`
stack serving a different branch (not this one) — fell back to standalone
`npm run export:web` + `npx serve dist -l 4175` (avoids the port
collision), matching T1's precedent. Captured default/hover/pressed/focus
at 375x812 via a throwaway Playwright script (screenshots dir T2/). First
capture attempt via the bare `playwright screenshot` CLI raced the
headline's `onLayout` (underline SVG only mounts once `headlineWidth>0`) —
underline was missing from that shot. Recaptured with an explicit
`waitForTimeout(400)` after page load in the script; underline present in
all 4 recaptured screenshots. Read all 4: gap is genuine wine daylight
before the glow, card corners crisp and rounded with the bevel visible,
pressed/hover swap the fill as expected, focus shows the browser's native
outline (unmodified, per spec). Dynamic-type compression paragraph in the
spec (gap may shrink toward the 12px floor at largest text sizes) is
descriptive of existing auto-margin/overflow behavior from T1, not a new
mechanism — spec's own "Tokens used" section confirms these are two fixed
constants, no adaptive logic added; not capturable in web preview anyway
(no OS Dynamic Type control), same caveat as T1.

PR: https://github.com/Mateja97/roamly/pull/153
