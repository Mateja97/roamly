# Business Standards

Domain/business rules for Roamly — what an activity category means, and how
Nearby vs Anywhere search behaves. Read before touching activity categories,
search-scope logic, or filters in `backend/`, `frontend/`, or `app/`.

## Activity category taxonomy (target state, 12 categories)

Supersedes today's 6-value enum (`food_and_drink`, `history_and_culture`,
`nature_and_outdoors`, `art_and_design`, `sports`,
`entertainment_and_wellness`) — see "Known gaps" below. Each category has a
one-line rule to resolve overlaps:

- **Restaurants** — sit-down food venues.
- **Cafes** — coffee-primary spots (coffee is the main draw, food secondary).
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

## Search scope rules (Nearby vs Anywhere)

| Rule | Nearby | Anywhere |
|---|---|---|
| Distance | Fixed 10km radius, not user-adjustable, no distance control shown | 5-500km slider, default pinned at 500 ("no limit") |
| Anchor | Current device location only | Current location (0 cities selected), or each selected city's centroid (1+ cities, union of radii) |
| Location permission | Required — screen blocks/shows retry state until granted | Optional — denied/unavailable still works, but only if the user anchors via city search instead |
| Category filter | Applies on top; same 12-category options in both scopes | Same |
| Sort order | By distance (nearest first) | By distance (nearest first, per-anchor) |

## Known gaps vs. current implementation

- **Anywhere without an anchor**: `app/src/features/search-setup/anywhereSearch.ts`'s
  `buildAnywhereSearchRequest` currently allows a fully unanchored query (no
  `current_location`, no `cities`) when location is denied/unavailable and
  no city is picked — it just runs a broad query. The target rule above says
  Anywhere should require at least one city in that case. Fixing this is a
  separate follow-up task, not part of this doc.
- **Category taxonomy**: the 12-category list above is the target; the
  actual `Category` enum (Go, proto, DB, frontend/app) still has 6 values
  today. Migrating it is a separate follow-up task.

## See also

- `APP_STANDARDS.md` — per-category activity detail-page standard (built on
  top of this taxonomy).
