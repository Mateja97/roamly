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
