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
| Bars (`bars`) | Cocktail Bar (`cocktail_bar`), Wine Bar (`wine_bar`), Brewery/Beer Garden (`brewery`), Sports Bar (`sports_bar`), Pub (`pub`) |
| Nightlife (`nightlife`) | Nightclub (`nightclub`), Live Music Venue (`live_music_venue`), Lounge (`lounge`) |
| Nature (`nature`) | Hiking Trail (`hiking_trail`), Park (`park`), Beach (`beach`), Garden/Botanical (`botanical_garden`), Viewpoint/Lookout (`viewpoint`) |
| Sport (`sport`) | Gym/Fitness Studio (`gym_fitness`), Climbing Gym (`climbing_gym`), Swimming Pool (`swimming_pool`), Sports Court/Field (`sports_court`), Golf Course (`golf_course`), Adventure/Extreme Sports (`extreme_sports`) |
| Kids (`kids`) | Playground (`playground`), Indoor Play Center (`indoor_play_center`), Zoo/Aquarium (`zoo_aquarium`), Amusement Park (`amusement_park`), Kids' Museum (`kids_museum`) |
| Culture (`culture`) | Historical Site (`historical_site`), Monument/Landmark (`monument_landmark`), Heritage Museum (`heritage_museum`), Religious Site (`religious_site`) |
| Art (`art`) | Art Gallery (`art_gallery`), Art Museum (`art_museum`), Studio/Workshop (`studio_workshop`), Public Art Installation (`public_art`) |
| Wellness (`wellness`) | Spa (`spa`), Yoga Studio (`yoga_studio`), Meditation Center (`meditation_center`), Hot Springs/Thermal Bath (`thermal_bath`) |
| Shopping (`shopping`) | Market/Bazaar (`market_bazaar`), Boutique (`boutique`), Mall (`mall`), Specialty Store (`specialty_store`) |
| Entertainment (`entertainment`) | Cinema (`cinema`), Escape Room (`escape_room`), Bowling/Arcade (`bowling_arcade`), Theater/Performance (`theater`), Casino (`casino`) |
| Tours & Experiences (`tours_experiences`) | Walking Tour (`walking_tour`), Day Trip (`day_trip`), Food & Drink Tour (`food_drink_tour`), Adventure Tour (`adventure_tour`), Cooking Class/Workshop (`cooking_class`), Bike Tour (`bike_tour`) |

## Search scope rules (Nearby vs Anywhere)

| Rule | Nearby | Anywhere |
|---|---|---|
| Distance | Fixed 10km radius, not user-adjustable, no distance control shown | 5-500km slider, default pinned at 500 ("no limit") |
| Anchor | Current device location only | Current location (0 cities selected), or each selected city's centroid (1+ cities, union of radii) |
| Location permission | Required — screen blocks/shows retry state until granted | Optional — denied/unavailable still works, but only if the user anchors via city search instead |
| Category filter | Applies on top; same 13-category options in both scopes. When exactly one category is selected, its subtype chips (above) are also available, OR'd within the category, AND-ed with it | Same |
| Sort order | By distance (nearest first) | By distance (nearest first, per-anchor) |

## Known gaps vs. current implementation

- **Anywhere without an anchor**: `app/src/features/search-setup/anywhereSearch.ts`'s
  `buildAnywhereSearchRequest` currently allows a fully unanchored query (no
  `current_location`, no `cities`) when location is denied/unavailable and
  no city is picked — it just runs a broad query. The target rule above says
  Anywhere should require at least one city in that case. Fixing this is a
  separate follow-up task, not part of this doc.
- **Two Anywhere distance ranges**: the 5-500km slider above is the
  Anywhere search-setup screen's range
  (`app/src/features/search-setup/anywhereSearch.ts`). The activity list's
  Filter sheet has a second Anywhere distance slider with a different
  100-2000km range plus a "No limit" stop
  (`app/src/features/activity-list/filters.ts`). Converging on one
  canonical range is a separate follow-up task.

## See also

- `APP_STANDARDS.md` — per-category activity detail-page standard (built on
  top of this taxonomy).
