# Ponytail debt ledger

A `ponytail:` comment marks a deliberate shortcut or deferral, made on purpose with the reasoning inline, not a TODO left by accident.
This doc is a generated index for scanning; the in-code comment at each location stays the source of truth — edit the code, not this file.

40 markers across 28 files, as of this writing — every `ponytail:` comment in `app/src`, test files included (`grep -rn "ponytail:" app/src --include='*.ts' --include='*.tsx' | wc -l` for markers, add `-l` before `wc` for files). Listed below as 38 entries: one entry groups three near-identical markers in `activities.ts` that record the same deferral at three call sites.

## `features/scope-sheet/`

- **ScopeSheet.tsx:461** — `AnywherePane`'s city-search code is a straight copy of the old `AnywhereSearchScreen` (deleted in T4) rather than a shared hook; now that the original screen is gone, this is the only copy left, so extraction only pays off if a second consumer shows up.

## `features/activity-list/` — feed screen & scope

- **ActivityListScreen.tsx:360** — The design spec's animated collapsing header (pill row/rail stay sticky while header collapses on scroll) was shipped as a static header instead; nothing in this codebase has ever implemented a scroll-driven collapse, and the category row/subtype rail already read as "sticky" simply by never leaving the screen.
- **ActivityListScreen.tsx:451** — Reopening `ScopeSheet` after Apply re-triggers the main feed query with the same request the sheet just resolved, because `onApply` only hands back the draft, not the already-fetched result — one accepted extra round trip per Apply.
- **feedContext.ts:21** — `scopePillInfo`'s filler copy only covers 3 of the reachable context-line states the design spec didn't enumerate (Nearby at midday, Anywhere cold start, and traveler mode combined with Nearby scope, which can never show a city name since there's no reverse-geocoding in the app) — flagged as a real design gap, not something to patch by inventing a geocoding feature.
- **types.ts:24** — `Filters.minRating`/`maxDistanceKm` are dead (superseded by `ScopeDraft`) but left on the type rather than triggering a mechanical sweep of every `Filters` literal in production and tests; remove them if `Filters` is touched again anyway.
- **nearbyNudge.ts:28** — A failed `AsyncStorage` write when dismissing the nearby nudge is swallowed silently; the flag is local-only and low-stakes, so worst case the nudge just reappears next launch.
- **travelerMode.ts:37** — Same reasoning as `nearbyNudge.ts`: a failed write recording a home-base sample is swallowed, since it's a best-effort local signal with no UI to surface a retry into.

## `features/activity-list/` — activity detail

- **ActivityDetailScreen.tsx:286** — When a fact strip folds down to one value, only `.value` is kept and `.label` is dropped on purpose (asserted by a test); every field seen so far reads fine unlabelled, so a label-aware fold is deferred until a real field needs it.
- **activityDetailConfig.ts:767** — The proxy always sends `details: {}` (no `omitempty`) for activities whose category has no category-specific data, so `.category` ends up missing rather than a known value; `factStripFields` degrades to an empty fact strip instead of crashing on that case.
- **activityDetailConfig.ts:806** — If `Intl` throws while formatting an upcoming-show date, the code falls through to the same fallback path used for an unparseable date, rather than a dedicated Intl-failure branch.
- **activityDetailConfig.ts:920** — Same `details: {}` shape/rationale as the 767 entry, this time for the second body section builder.
- **fieldKind.ts:55** — `matchesDenylist` isn't exported since only `classifyField` calls it today; export it if a future task needs to check `PLACEHOLDER_DENYLIST` parity directly.
- **fieldKind.ts:87** — A denylisted field value is logged via a plain `console.warn`, deduped per distinct value with an in-module `Set` (warn-once, not time-windowed) rather than following an established logging convention, because no such convention exists yet in `app/src`.
- **fieldKind.ts:103** — Scalar field length is measured with `[...value].length` (Unicode code points) rather than `.length` (UTF-16 code units) so it agrees with the backend's Go rune-count check, including for emoji/astral characters.

## `features/activity-list/` — reviews

- **ReviewsSection.tsx:15** — The `onSeeAll` prop has no caller yet, since the "See all reviews" screen the mockup implies doesn't exist in the app; the control itself already correctly stays hidden until a caller passes it.
- **ReviewsSection.tsx:28** — The mockup's per-star rating-distribution bar chart isn't built because neither Google's nor Tripadvisor's API response ever carries a ratings histogram (confirmed against `api/activities.ts`); add it once a real field exists to populate it.
- **TripadvisorReviewsCarousel.tsx:144** — `ReviewCard` is a plain function rather than `React.memo`, since it only ever renders up to 3 stateless cards with no async per-card work (unlike `PhotoViewerModal`'s memoized `PhotoPage`).

## `features/activity-list/` — misc UI & tests

- **WeekHoursModal.tsx:40** — The modal's mount-time open animation duplicates `FilterSheet`'s own open-effect logic rather than sharing a hook, since there are only 2 call sites; extract one if a third bottom-sheet-style modal appears.
- **WeekHoursModal.test.tsx:59** — There's no scrim-tap test because RNTL's accessibility-tree computation treats the animated scrim as hidden (starting opacity 0) regardless of the reduced-motion mock, so the tap target isn't reachable in tests; the explicit close control and `onRequestClose` already cover the required dismiss paths.
- **ProseBlock.tsx:38** — Overflow detection for the "Show more" control uses an invisible unclamped duplicate `Text` measured via `onLayout`, instead of `numberOfLines`/`onTextLayout`, because react-native-web (the platform this test gate can verify) never implements `onTextLayout`.

## `components/`

- **TripadvisorSubratingsPlate.tsx:74** — The subratings grid always lays out 2 columns via `flexBasis`/`flexWrap`; collapsing to 1 column at large dynamic-text sizes would need measuring rendered text width, which RN has no media-query primitive for, so it's deferred until a real overflow report comes in.
- **GoogleAttributionPlate.tsx:85** — `GoogleMapsMark` renders the literal words "Google Maps" instead of a bundled brand-mark SVG (unlike `TripadvisorLogo.tsx`), because sourcing an accurate copy of Google's actual logo asset was out of scope; the plain-text form is policy-sanctioned in the interim.
- **GoogleAttributionPlate.tsx:111** — Opening a reviewer's Google profile link swallows the rejection on a dead link, matching `PhotoAttributionCaption`'s waiver.
- **GoogleAttributionPlate.tsx:180** — Opening the "View on Google Maps" link swallows the rejection on a dead link, same waiver as above.
- **PhotoAttributionCaption.tsx:35** — Opening a photo's attribution link swallows the rejection on a dead link, since the design spec explicitly waives error UI for this case.
- **ScopeTicket.tsx:66** — The selected-card glow uses a top-fade linear gradient (via `expo-linear-gradient`) as a stand-in for the spec's radial ellipse, since the library only supports linear gradients; swap in a real radial gradient if a native lib for that is ever added.
- **TripadvisorLogo.tsx:3** — The Tripadvisor brand-mark SVG is inlined as a string rather than imported from `app/assets/tripadvisor-logo.svg`, because Metro has no `react-native-svg-transformer` configured to import `.svg` files as components; the asset file stays in sync as the source-of-record copy.
- **EdgeFade.tsx:7** — The trailing-edge fade on the category row/subtype rail is a solid-background gradient overlay, not a true CSS `mask-image` alpha mask (which isn't a valid React Native style property); upgrade to a real alpha mask (`MaskedView`) if a non-solid background is ever placed behind these rows.
- **Wordmark.tsx:3** — Same inlined-SVG-string reasoning as `TripadvisorLogo.tsx`: no `react-native-svg-transformer` configured, and one single-icon use doesn't justify adding the build step; add the transformer if a second SVG asset shows up.
- **ActivityCard.tsx:114** — The dashed seam's decorative notches are positioned assuming the fixed `IMAGE_HEIGHT`, so they only land exactly on the seam when no attribution caption renders between image and seam; misalignment when a caption does render is treated as a cosmetic gap not worth measuring layout for.
- **ActivityCard.tsx:182** — The loading skeleton reuses the plain seam gap (no dashed line/notches) rather than replicating the real card's decoration, since the design spec allows either and a static seam is one less thing to keep in sync.
- **PrimaryTicket.tsx:13** — `PIN_WELL_SIZE` is hardcoded to 36px, neither the spec's 26px icon size nor the original 44px, chosen empirically to fit the 26px icon while leaving enough horizontal room for the sub-label to stay on one line at 375pt.
- **PrimaryTicket.test.tsx:58** — There's no jest test for the hover-swap state, since RN's `Pressability` gates `onMouseEnter` behind a module-load-time `Platform.OS === 'web'` check that can't be flipped per-test; the pressed-state test covers what matters on-device, and hover is verified separately via a real Playwright `.hover()` visual check.

## `api/`

- **cities.ts:40** — If a city-search error response body isn't valid JSON, the parse failure is swallowed and the generic fallback error message is used instead.
- **activities.ts:102** — The `attributes`/`recommended_visit_length` fields are decoded off the wire but no screen renders them yet, since 0 of 83 sampled venues across categories ever returned a non-empty value for either; build the UI once a real venue actually populates one.
- **activities.ts:513**, **557**, **606** — Same non-JSON-error-body fallback as `cities.ts:40`, repeated at each of the photos-upgrade, live-details-upgrade, and a third fetch's error-handling path.

## `utils/`

- **withTimeout.ts:3** — `LOCATION_TIMEOUT_MS` is hardcoded to 15 seconds as a reasonable GPS-fix bound, not a number specified anywhere; tune it if real-device testing shows it's too eager or too lax.
- **firstLaunch.ts:3** — First-launch tracking uses `@react-native-async-storage/async-storage` directly rather than a per-feature storage abstraction, since it's Expo's own documented answer for a persisted flag and no local-storage mechanism existed anywhere in the app before this; other local flags (nearby-nudge-dismissed, home-base samples) reuse the same key-value primitive directly.
