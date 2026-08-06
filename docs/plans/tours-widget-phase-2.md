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

## Which widget

GetYourGuide ships the activity widget in two variants, and only one works here.

- **Automatic** — "reads the content around it and the page's meta data", runs
  NLP over the surrounding article, always renders exactly 3 activities. In a
  WebView shell there *is* no surrounding article and no page metadata: it would
  be reading an empty document. **Wrong for Roamly.**
- **Manual** — takes an explicit search term, URL, or location, and lets you set
  the item count. **This is the one.**

All three widget types (activity, city, availability) are documented as
"Available for: Blogs, **app** and websites", so app embedding is a supported
use, not a workaround.

## The embed contract

Verified against GetYourGuide's published integration snippet:

```html
<!-- 1. Integration Analyzer — MANDATORY for widgets, goes in <head>.
     Carries the partner id itself; it is not just a loader for the div below. -->
<script async defer
        src="https://widget.getyourguide.com/dist/pa.umd.production.min.js"
        data-gyg-partner-id="Z2BLKH2"></script>

<!-- 2. The widget, verbatim from our own portal (manual variant, Belgrade).
     Every attribute below is portal-generated, none reconstructed. -->
<div data-gyg-href="https://widget.getyourguide.com/default/activities.frame"
     data-gyg-location-id="1688"
     data-gyg-locale-code="en-US"
     data-gyg-widget="activities"
     data-gyg-number-of-items="6"
     data-gyg-cmp="roamly-app"
     data-gyg-partner-id="Z2BLKH2"><span>Powered by <a target="_blank" rel="sponsored"
     href="https://www.getyourguide.com/belgrade-l1688/">GetYourGuide</a></span></div>
```

**The Integration Analyzer is not optional.** Widgets 101's troubleshooting
section states it is *mandatory for widgets* — a widget that silently fails to
render or fails to attribute is very likely a missing analyzer. On a website it
is added once to the site header; in our WebView shell it belongs in the `<head>`
of the generated HTML, so it ships with every panel load by construction.

### The inner fallback anchor

The portal's snippet ships a child of the widget div:

```html
<span>Powered by <a target="_blank" rel="sponsored"
  href="https://www.getyourguide.com/belgrade-l1688/">GetYourGuide</a></span>
```

Three things follow:

- **Keep it verbatim.** It is GetYourGuide's own attribution markup. Stripping it
  would be altering content they supplied (§4.2.2 v), and `rel="sponsored"` is
  the correct disclosure rel for a paid link — removing it would be a step
  backwards on disclosure, not a cleanup.
- **It is the degraded state.** If the widget script is blocked, slow, or offline,
  this text link is what the user sees inside the panel. That is a reasonable
  fallback, but it means the panel's own error state must not fight it — treat a
  rendered-but-scriptless widget as content, not as an error.
- **It carries no `partner_id`.** The bare city URL is unattributed as written,
  which suggests the Integration Analyzer rewrites links at runtime — one more
  reason it is mandatory, and directly relevant to the attribution question in
  §3. The navigation interceptor must expect this anchor too, not only the
  widget's own click-throughs.

Its slugged city URL (`/belgrade-l1688/`) also confirms that GetYourGuide city
pages are slugged per city, which is why Phase 1's deep link uses `/s/?q=`
instead — we cannot derive a slug for an arbitrary city.

**Item count: 6, and the portal allows it.** Their docs recommend 3, and the automatic
variant is fixed at 3 — but both are tuned for a widget sitting *inside a blog
post*, competing with the article around it. Our panel is a dedicated screen
reached by an explicit tap, with nothing to compete with: 3 image-led cards fill
roughly one screenful and read as a thin result set. 6 gives about two screens
of scroll without reaching the tail where affiliate click-through collapses.

Use **3** for any widget that is ever placed inline in the feed — their
recommendation is right for that placement, it just doesn't transfer to this one.

This is a judgement, and `data-gyg-cmp` is what makes it correctable: if the tail
items draw no clicks in the Integrations report, drop back toward 3.

Their docs and the portal both advertise that the widget matches the host page's
font. Set the shell's `font-family` and base colours to Roamly's so it inherits
something closer to the app than a default web page — cheap, but verify how far
the adaptation actually goes rather than assuming.

**The embed contract has no open questions.** Every attribute above came from
our own portal. What remains unknown is entirely support-territory and listed
under "Technical decisions" below: whether the widget or analyzer sets
non-essential cookies (§4), and whether attribution survives the handoff to the
system browser (§2/§3). Neither blocks Phase 1, which is already shipped.

| Attribute | Value | Note |
|---|---|---|
| `data-gyg-partner-id` | `Z2BLKH2` | From `EXPO_PUBLIC_GYG_PARTNER_ID`, never inlined literally |
| `data-gyg-location-id` **or** `data-gyg-q` | `1688` / `"Belgrade"` | Two ways to target a city. See "Location: ID or query" below |
| `data-gyg-cmp` | `roamly-app` | Campaign label, portal-confirmed. The only thing separating widget revenue from Phase 1 deep-link revenue — and therefore the only way to answer "did Phase 2 pay for itself" |
| `data-gyg-number-of-items` | `6` | Start here; the panel is a full screen, not a sidebar |
| `data-gyg-locale-code` | `en-US` | App is English-only today; wire to device locale when it isn't |

### Location: ID or query

The portal generates either form. They are not equivalent in cost.

| | `data-gyg-q="Belgrade"` | `data-gyg-location-id="1688"` |
|---|---|---|
| Coverage | Any city the scope resolves to | Only cities mapped by hand |
| Accuracy | Free-text search; can misresolve ambiguous names | Exact, GetYourGuide's own identifier |
| Maintenance | None | One portal visit per city, forever |
| Unmapped city | Still works | Nothing renders |

**Decide by launch footprint, and pick one — not both.** A handful of cities →
`location-id`, exact and cheap to compile in one sitting. Arbitrary cities →
`q`, the only form without a silent coverage hole, since `suggestCities` lets a
user pick any city and Nearby resolves to wherever they are.

A "location-id when mapped, `q` otherwise" fallback is two code paths for one
job. Only build it if `q` demonstrably misresolves in practice.

Keep any ID map small and hand-made. A dozen IDs for launch cities is plainly
fine; a harvested list of every city they serve edges into §4.2.2(iii)'s
"create a database of GYG Platform Content, in whole or in part".

### City format — no new resolver needed

`data-gyg-q` takes the **bare city name** ("Belgrade"). An earlier draft of this
spec said "City, Country", taken from a third-party integration guide; our own
portal emits the bare city, so that guide was wrong or describing a different
case.

**This deletes planned work.** `resolveTourCity` already returns exactly this —
the widget and the deep link want the same value, so there is no second resolver
to write and nothing to change in `toursPartner.ts`.

One caveat kept in view: "Belgrade" is globally unambiguous, "Springfield" is
not. If an ambiguous city ever resolves to the wrong country's activities,
appending the country is the fix — the data is already on the client
(`CitySuggestion.country`, `Activity.country`). Don't pre-build it.

Null city → skip the panel and keep the Phase 1 deep link. A locationless widget
is a worse experience than a working link.

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

### 2. Whether to intercept the click-through at all — decide this first

The earlier draft of this spec assumed we intercept every navigation and hand it
to the system browser. **GetYourGuide's own documentation makes that the riskier
option, not the safer one.**

Deep links 101: they generate a unique **cookie** ID per partner account; a click
on a link *or widget* sets it; it stays valid across their whole site for **31
days**. Attribution is cookie-based, and cookie jars do not cross process
boundaries.

| | Stay in the WebView | Hand off to the system browser |
|---|---|---|
| Attribution | **Clean** — click and booking share one cookie jar | Depends entirely on the outbound URL carrying `partner_id` to re-establish the cookie |
| 31-day window | Preserved for that WebView's jar only | Preserved in the user's real browser, which they'll return to |
| User trust at payment | Chrome-less — the user cannot verify the URL while entering card details | Real URL bar on GetYourGuide's own origin |
| Store policy | Fine — real-world services are outside IAP rules | Fine |

There is no free option. Staying in the WebView protects the commission and
weakens the trust story at exactly the moment a user types a card number;
handing off does the reverse.

**Recommendation:** hand off, but treat it as *unverified until proven* — see §3.
The trust argument is the one that survives a bad outcome. If attribution turns
out not to survive the handoff and GetYourGuide can't fix it, the fallback is
staying on Phase 1 deep links, not shipping a chrome-less checkout.

If we do intercept, `onShouldStartLoadWithRequest` must let the widget's **own
iframe** load and catch only the top-frame click-through.

**Platform divergence, the likeliest bug here:** on iOS the callback fires for
iframe loads too; on Android it does not. An interceptor written and tested on
Android alone will hijack the widget's own frame on iOS and render an empty
panel. Gate on the top-frame flag *and* the host, and test on both.

### 3. Attribution must be proven, not assumed

The commercial risk, not a technical nicety. A silent failure here means the
feature generates traffic and earns nothing, and nothing in the UI would show it.

**Gate on evidence:** with the Integration Analyzer in place (mandatory anyway),
complete one real booking through the widget path and confirm it lands in the
Integrations report attributed to `Z2BLKH2` with `cmp=roamly-app`. The campaign
label is what separates this from Phase 1's deep-link revenue — without it the
report can't answer whether Phase 2 paid for itself.

Do not ship this phase on the assumption.

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
2. Integration Analyzer present in the shell's `<head>` — mandatory for widgets.
3. Attribution verified by a real booking in the Integrations report, attributed
   to `Z2BLKH2` with `cmp=roamly-app`.
4. Widget renders on **both** iOS and Android — interceptor correct on each.
5. Phase 1 deep link survives as the fallback on every failure path.

## Explicitly out of scope

- Reading, parsing, caching or storing anything the widget renders. The WebView
  is a sealed surface; that is what makes this compliant at all.
- Availability or city widgets. One widget type, one screen.
- The Partner API. Still gated at 50k app downloads for Basic tier, which
  excludes availability anyway — see `BUSINESS_STANDARDS.md`.
