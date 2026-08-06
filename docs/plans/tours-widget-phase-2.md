# Spec — Tours Phase 2: the embedded GetYourGuide widget

**Status:** specified, not built.
**Depends on:** Phase 1 (PR #173) merged; `EXPO_PUBLIC_GYG_PARTNER_ID` set.
**Created:** 2026-08-06.

## Why this phase exists

Phase 1 ships a referral card with no partner content — no photos, no prices,
no availability, because §4.2.2(iii) bars storing their content and §3.1.4 bars
scraping it.

The widget is the **only** compliant way to show any of it. GetYourGuide serves
and renders the images, ratings and prices inside their own iframe; Roamly never
holds the bytes. Everything forbidden to us is permitted when they draw it
themselves.

That is the whole value of this phase: **photos and live prices in the Tours
surface.** If that isn't worth a dependency and the risks below, don't build it.

## The embed contract

Verified against GetYourGuide's published integration snippet:

```html
<script async src="https://widget.getyourguide.com/dist/pa.umd.production.min.js"></script>
<div data-gyg-href="https://widget.getyourguide.com/default/activities.frame"
     data-gyg-widget="activities"
     data-gyg-partner-id="Z2BLKH2"
     data-gyg-q="Belgrade, Serbia"
     data-gyg-locale-code="en-US"
     data-gyg-cmp="roamly-app"
     data-gyg-number-of-items="6"></div>
```

| Attribute | Value | Note |
|---|---|---|
| `data-gyg-partner-id` | `Z2BLKH2` | From `EXPO_PUBLIC_GYG_PARTNER_ID`, never inlined literally |
| `data-gyg-q` | `"{city}, {country}"` | **Format matters** — see "City format" below |
| `data-gyg-cmp` | `roamly-app` | Campaign label. Set it: this is what separates widget revenue from Phase 1 deep-link revenue in their analytics, and it's the only way to answer "did Phase 2 pay for itself" |
| `data-gyg-number-of-items` | `6` | Start here; the panel is a full screen, not a sidebar |
| `data-gyg-locale-code` | `en-US` | App is English-only today; wire to device locale when it isn't |

### City format

`data-gyg-q` wants **"City, Country"** ("Belgrade, Serbia"), not the bare city
`toursPartner.ts` currently returns. Both halves are already on the client:

- Anywhere → `CitySuggestion` carries `city` **and** `country` (`api/cities.ts:5`)
- Nearby → `Activity` carries `city` (`api/types.ts:343`) and `country`

So `resolveTourCity` gains a sibling — `resolveTourLocation(): {city, country} | null`
— rather than being changed. The deep link keeps taking the bare city (its `q`
parameter is a free-text search and does better without the country); the widget
takes the pair. **Don't collapse these into one resolver**; they have different
correct answers.

Null location → render the panel without `data-gyg-q` and let the widget pick,
or skip the panel and keep the Phase 1 deep link. Prefer the latter: a
locationless widget is a worse experience than a working link.

## Screen: `ToursPanelScreen`

Artboard **P2** in `Roamly Tours Partner.dc.html`.

Reuses the existing `detailOverlay` pattern in `ActivityListScreen` — conditional
render, no navigation library, so `APP_STANDARDS.md:40` holds.

Top to bottom:

1. **Back control** — icon-only `ChevronLeft`, interim back control recipe.
2. **Title** — "Tours & experiences", Marcellus display-title header variant
   (`DESIGN_STANDARDS.md:343`). Subtitle "In {city}".
3. **Attribution lockup** — the issuer seal at 30px plus "Tours and booking by
   GetYourGuide", then the commission disclosure. Provenance precedes content:
   the user must know whose surface this is *before* it paints.
4. **Widget region** — `WebView`, `flex: 1`, `--bg` behind it.

**The WebView is not nested in a ScrollView.** It owns its own scrolling, which
sidesteps the widget-height negotiation that makes embedded widgets miserable in
React Native. There is no `postMessage` height handshake in this design and
there should not be one.

**No bottom action bar.** The widget carries its own CTAs; a Roamly CTA layered
over partner content edges into §4.2.2(v).

### Entry point change

`ToursTicket`'s press handler moves from `Linking.openURL` to an `onPress` prop
the screen supplies. The ticket keeps "Opens in your browser" **only in the
deep-link fallback**; when it opens the panel the meta line becomes
"See tours" or similar. The ticket must not promise a browser handoff it no
longer performs.

### States

| State | Treatment |
|---|---|
| Loading | Centered `Spinner` on `--bg`, min 300ms so it can't flash |
| `onError` / `onHttpError` | `ErrorState` + a secondary "Open GetYourGuide" that falls back to the Phase 1 deep link |
| Offline | Same as error — the fallback link still works, the OS browser will show its own offline page |
| Widget renders empty for the city | GetYourGuide's own empty rendering. **We do not detect or override it** — that would be suppressing their content (§4.2.2 v) |

## Technical decisions that are easy to get wrong

### 1. `baseUrl` is load-bearing

Load the shell via `source={{ html, baseUrl: 'https://widget.getyourguide.com' }}`.

An `about:blank` or `data:` origin is opaque: third-party script loading and
cookie writes behave differently, and debugging that after the fact is painful.
Give the document a real https origin from the start.

### 2. Intercept top-frame navigations only

`onShouldStartLoadWithRequest` must let the widget's **own iframe** load and
intercept only the click-through to `www.getyourguide.com`, opening it with
`Linking.openURL`.

**Platform divergence, and the likeliest source of a bug here:** on iOS the
callback fires for iframe loads too; on Android it does not. An interceptor
written and tested on Android alone will hijack the widget's own frame on iOS
and render an empty panel. Gate on the top-frame flag *and* on the host, and
test on both platforms before believing it works.

### 3. Attribution must be re-verified end to end

This is the commercial risk, not a technical nicety.

Phase 1's attribution is clean: the deep link opens the system browser, which
sets GetYourGuide's cookie in the browser the user actually books in.

Phase 2 splits the context. The widget renders in a WebView; a cookie set there
does **not** transfer to the system browser. Attribution then depends entirely
on the click-through URL carrying `partner_id`. It should — that is how their
widget links are built — but *should* is not *verified*, and getting this wrong
means the feature generates traffic and no commission, silently.

**Gate on evidence:** install their Integration Analyzer, complete one real
booking through the widget path, confirm it appears in the Integrations report
attributed to `Z2BLKH2` with `cmp=roamly-app`. Do not ship this phase on the
assumption.

### 4. Third-party scripts and consent

Embedding their script makes Roamly the party loading it. On a deep link the
user leaves to GetYourGuide's own site, under GetYourGuide's own consent banner;
embedded, that boundary moves onto us.

Roamly has no consent framework today. Confirm whether the widget sets
non-essential cookies before this ships in the EU, and if it does, this phase
needs a consent gate — which is a bigger piece of work than the panel itself.

**This is the most likely reason to not build Phase 2**, and it should be
settled before any code is written.

## Dependency

`react-native-webview` — one addition, Expo-supported. Nothing else.

Per `CLAUDE.md`'s version-pinning rule, an Expo-managed native dependency must
match the SDK: install with `npx expo install react-native-webview`, never a
bare `npm install`, so the version resolves against Expo 57.

## Testing

- Unit: `resolveTourLocation` — Anywhere pair, Nearby pair, partial (city but no
  country), null. Widget HTML builder — partner ID injected, `q` formatted and
  URL-safe, `cmp` present, no literal ID in source.
- Component: panel renders spinner → content; error state offers the deep-link
  fallback; back control fires.
- **Not** unit-testable: whether the widget actually renders, and whether
  attribution lands. Both need a device and a real booking. Don't let green
  tests stand in for either.

## Definition of done

1. Consent question answered (§4 above).
2. Attribution verified by a real booking in the Integrations report.
3. Widget renders on **both** iOS and Android — interceptor correct on each.
4. Phase 1 deep link survives as the fallback on every failure path.

## Explicitly out of scope

- Reading, parsing, caching or storing anything the widget renders. The WebView
  is a sealed surface; that is what makes this compliant at all.
- Availability or city widgets. One widget type, one screen.
- The Partner API. Still gated at 50k app downloads for Basic tier, which
  excludes availability anyway — see `BUSINESS_STANDARDS.md`.
