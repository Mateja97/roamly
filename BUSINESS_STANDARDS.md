# Business Standards

Domain/business rules for Roamly — what an activity category means, and how
Nearby vs Anywhere search behaves. Read before touching activity categories,
search-scope logic, or filters in `backend/`, `frontend/`, or `app/`.

## Activity category taxonomy (13 categories)

Each category has a one-line rule to resolve overlaps:

- **Restaurants** — sit-down food venues.
- **Cafés** — coffee-primary spots (coffee is the main draw, food secondary).
- **Bars** — alcohol-primary venues, standard hours.
- **Nightlife** — after-midnight venues with loud music and a standing
  crowd — distinguished from Bars by time and format, not just "serves
  drinks."
- **Nature** — outdoors, parks, trails, natural landmarks.
- **Sport** — active/participatory sport venues and facilities.
- **Kids** — venues/activities aimed at children and families.
- **Culture** — free-to-experience heritage: street sites, monuments,
  museums.
- **Art** — galleries, studios, art-specific museums — paid/curated art
  experiences, distinct from Culture's free heritage sites.
- **Wellness** — spas, fitness/relaxation, health-oriented venues.
- **Shopping** — retail, markets, malls.
- **Entertainment** — catch-all for fun activities that don't fit any other
  bucket. Not a specific venue type — it's the overflow category.
- **Tours & Experiences** — guided/organized activities booked as a unit
  (a tour, a class, a day trip) — distinguished from the venue-type
  categories above by being an *activity you book*, not *a place you visit*.

## Subcategory (subtype) taxonomy

Each category has an optional subcategory (subtype): a finer classification
within it, e.g. Restaurants → Fine Dining. A subtype is validated to belong
to its category; empty is always valid. Slugs are globally unique (not just
per-category), so a subtype filter is unambiguous even across categories with
similarly-named subtypes (e.g. `bakery_dessert` under Restaurants vs
`bakery_cafe` under Cafés).

| Category (slug) | Subtypes (slug) |
|---|---|
| Restaurants (`restaurants`) | Fine Dining (`fine_dining`), Casual Dining (`casual_dining`), Fast Casual (`fast_casual`), Food Truck/Street Food (`street_food`), Bakery & Dessert (`bakery_dessert`) |
| Cafés (`cafes`) | Coffee Shop (`coffee_shop`), Tea House (`tea_house`), Bakery Cafe (`bakery_cafe`) |
| Bars (`bars`) | Cocktail Bar (`cocktail_bar`), Wine Bar (`wine_bar`), Brewery/Beer Garden (`brewery`), Sports Bar (`sports_bar`), Pub (`pub`), Shisha Bar (`shisha`), Kafana (`kafana`) |
| Nightlife (`nightlife`) | Nightclub (`nightclub`), Live Music Venue (`live_music_venue`), Lounge (`lounge`), Shisha Lounge (`shisha_lounge`), Kafana with Live Music (`kafana_live`) |
| Nature (`nature`) | Hiking Trail (`hiking_trail`), Park (`park`), Beach (`beach`), Garden/Botanical (`botanical_garden`), Viewpoint/Lookout (`viewpoint`) |
| Sport (`sport`) | Gym/Fitness Studio (`gym_fitness`), Climbing Gym (`climbing_gym`), Swimming Pool (`swimming_pool`), Sports Court/Field (`sports_court`), Golf Course (`golf_course`), Adventure/Extreme Sports (`extreme_sports`) |
| Kids (`kids`) | Playground (`playground`), Indoor Play Center (`indoor_play_center`), Zoo/Aquarium (`zoo_aquarium`), Amusement Park (`amusement_park`), Kids' Museum (`kids_museum`) |
| Culture (`culture`) | Historical Site (`historical_site`), Monument/Landmark (`monument_landmark`), Heritage Museum (`heritage_museum`), Religious Site (`religious_site`) |
| Art (`art`) | Art Gallery (`art_gallery`), Art Museum (`art_museum`), Studio/Workshop (`studio_workshop`), Public Art Installation (`public_art`) |
| Wellness (`wellness`) | Spa (`spa`), Yoga Studio (`yoga_studio`), Meditation Center (`meditation_center`), Hot Springs/Thermal Bath (`thermal_bath`) |
| Shopping (`shopping`) | Market/Bazaar (`market_bazaar`), Boutique (`boutique`), Mall (`mall`), Specialty Store (`specialty_store`) |
| Entertainment (`entertainment`) | Cinema (`cinema`), Escape Room (`escape_room`), Bowling/Arcade (`bowling_arcade`), Theater/Performance (`theater`), Casino (`casino`) |
| Tours & Experiences (`tours_experiences`) | Walking Tour (`walking_tour`), Day Trip (`day_trip`), Food & Drink Tour (`food_drink_tour`), Adventure Tour (`adventure_tour`), Cooking Class/Workshop (`cooking_class`), Bike Tour (`bike_tour`) |

### How subtypes get populated

Every subtype above is filled automatically, by one of two paths depending on
where the venue comes from.

**Google-sourced categories** (the ten in `placesmap.GoogleCategories`):
`backend/activities-service/internal/placesmap/discovery.go` maps each
(category, subtype) pair to its Google Places Table A types (or, for the
handful Table A can't express, a bounded text-search phrase), and the lazy
sync issues one search per pair, so a venue's subtype is known from the query
that found it rather than guessed from the response. The same table read
backward (`placesmap.Subtype`) classifies venues discovered by other
providers — one table, two directions, so discovery and classification can't
drift apart.

A venue's subtype is decided by its own Google `primaryType` first — so the
same venue gets the same subtype no matter which discovery row's search
happened to surface it — falling back to the row's subtype only when
`primaryType` maps to nothing. A venue can legitimately match rows in two
different *categories* (e.g. a park that is also a sports court); that
produces two stored rows on purpose, collapsed back into one in query results
whenever no category filter is active.

**Tripadvisor-sourced categories** (Restaurants, Bars, and the Tripadvisor
side of Cafés): Tripadvisor's own `categories[]` field, which would carry a
subtype-like tag, is not returned on Roamly's Content API entitlement — every
Tripadvisor venue's subtype is always empty at the source. Instead, once per
venue at sync time, the venue's name is looked up via a Google Places Text
Search tightly bounded to the venue's own coordinates (tight enough that a
same-named venue elsewhere in the city can't be matched), and the single
resulting place's Google `primaryType`/`types` is classified through the same
`placesmap.Subtype` table the Google-sourced categories use — no separate
Tripadvisor subtype vocabulary. A venue with no match, an ambiguous match (more
than one candidate in the tight radius), a Places API error, or a match whose
own returned name doesn't plausibly match the venue's (guards against Text
Search's best-ranked-neighbour result standing in for a venue missing from
Google) keeps subtype `""` — never a guess — and the venue is still ingested;
the lookup failing never fails the sync.

City and country are resolved once per synced map cell by reverse geocoding
the search anchor, not once per venue — deriving it per-venue from each
place's own address fragmented a single live city into eight different
strings.

**Adding a subtype to the table above requires a matching discovery row.** A
test enforces this (`TestDiscoveryRows_CoversEveryGoogleSubtype`) — a subtype
with no source turns the build red rather than quietly returning nothing.

Sourcing by category: Google Places covers Cafés, Nightlife, Nature, Sport,
Kids, Culture, Art, Wellness, Shopping and Entertainment. Restaurants and Bars
come from Tripadvisor (Cafés is also synced from Tripadvisor, but its
coverage there is too thin to stand alone). Tours & Experiences has no
provider yet and is deliberately empty.

**Name-derived subtypes.** Two Serbian venue types are classified from the
venue's name rather than a Google type, via `namemap.Subtype`: shisha bars
(`shisha`/`shisha_lounge`) and kafanas (`kafana`/`kafana_live`). These two
*override* a Google answer, because a name containing "nargila" or "kafana"
is never accidental and Google's `cafe`/`lounge`/`nightclub` answer for such
venues is the less accurate one. Every other name keyword is fallback-only:
consulted when Google resolves to `""`, never over a real Google answer. A
kafana is deliberately not mapped onto `pub` — a kafana is table service,
rakija and often live folk music, a pub is beer-led, and collapsing them
would be exactly the kind of guess this taxonomy refuses to make.

## Search scope rules (Nearby vs Anywhere)

| Rule | Nearby | Anywhere |
|---|---|---|
| Distance | Fixed 10km radius, not user-adjustable, no distance control shown | 7-stop slider (5/10/25/50/100/200km/Any), default pinned at "Any" (no limit) |
| Anchor | Current device location only | Current location (0 cities selected), or each selected city's centroid (1+ cities, union of radii) |
| Location permission | Required — screen blocks/shows retry state until granted | Optional — denied/unavailable still works, but only if the user anchors via city search instead |
| Category filter | Applies on top; same 13-category options in both scopes. Every selected category gets its own subtype chips (above, one group per category), OR'd within each category, AND-ed with the category filter overall | Same |
| Sort order | By distance (nearest first) | By distance (nearest first, per-anchor) |

## Known gaps vs. current implementation

- **Anywhere without an anchor**: `app/src/features/activity-list/filters.ts`'s
  `buildFeedRequest` currently allows a fully unanchored query (no
  `current_location`, no `cities`) when location is denied/unavailable and
  no city is picked — it just runs a broad query. The target rule above says
  Anywhere should require at least one city in that case. Fixing this is a
  separate follow-up task, not part of this doc. **Carve-out**: the content-
  first Feed's cold start (`App.tsx`) is a deliberate exception to that
  target rule, not an instance of this gap — the very first launch (and any
  later launch before location permission has been granted) is *meant* to
  run this same unanchored Anywhere query immediately, with no gate screen
  and no city required, so the feed always renders something on first paint
  (see `docs/superpowers/specs/2026-08-03-content-first-redesign-design.md`).
  A future fix for this gap must preserve that cold-start carve-out.

## See also

- `APP_STANDARDS.md` — per-category activity detail-page standard (built on
  top of this taxonomy).
