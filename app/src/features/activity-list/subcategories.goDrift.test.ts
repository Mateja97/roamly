/** Drift guard between this app's subtype taxonomy and its source of truth,
 * `backend/shared/models/activitiessvc/activity.go`'s `Subcategories` map.
 *
 * The failure this prevents is silent and expensive: a slug the backend
 * stores but `filters.ts` omits is data the user can never filter for, and
 * nothing else in the stack complains. Bars sat at 0 subtyped rows for a week
 * partly because nothing checked mirrors like this one.
 *
 * Extraction is regex over gofmt-ed Go, not a real parser — the map is one
 * flat line per category. The risk that carries (a rename or reformat
 * silently breaking the regex) is why the extraction asserts a non-zero
 * category count and a known-present slug. */
import { readFileSync } from 'node:fs';
import { SUBCATEGORIES } from './filters';
import { SUBTYPE_ICONS } from './subtypeIcons';

const GO_FILE = '../backend/shared/models/activitiessvc/activity.go';

/** Go const suffix -> category slug. Not a mechanical transform
 * (ToursExperiences snake-cases, Bars just lowercases), so it is spelled out. */
const CATEGORY_SLUGS: Record<string, string> = {
  Restaurants: 'restaurants',
  Cafes: 'cafes',
  Bars: 'bars',
  Nightlife: 'nightlife',
  Nature: 'nature',
  Sport: 'sport',
  Kids: 'kids',
  Culture: 'culture',
  Art: 'art',
  Wellness: 'wellness',
  Shopping: 'shopping',
  Entertainment: 'entertainment',
  ToursExperiences: 'tours_experiences',
};

function goSubcategories(): Record<string, string[]> {
  const src = readFileSync(GO_FILE, 'utf8');
  const body = src.match(/var Subcategories = map\[Category\]\[\]string\{([\s\S]*?)^\}/m);
  if (!body) throw new Error('could not locate the Subcategories map in activity.go');

  const out: Record<string, string[]> = {};
  for (const line of body[1].split('\n')) {
    const m = line.match(/Category(\w+):\s*\{(.*)\},/);
    if (!m) continue;
    const slug = CATEGORY_SLUGS[m[1]];
    if (!slug) throw new Error(`unknown Go category const: Category${m[1]}`);
    out[slug] = [...m[2].matchAll(/"([a-z_]+)"/g)].map((s) => s[1]);
  }
  return out;
}

describe('subtype taxonomy drift', () => {
  const go = goSubcategories();

  it('extraction does not pass vacuously', () => {
    expect(Object.keys(go)).toHaveLength(13);
    expect(go.bars).toContain('cocktail_bar');
  });

  it('every Go slug has a filter chip', () => {
    for (const [category, slugs] of Object.entries(go)) {
      const chips = (SUBCATEGORIES[category as keyof typeof SUBCATEGORIES] ?? []).map((c) => c.value);
      expect({ category, slugs: slugs.filter((s) => !chips.includes(s)) }).toEqual({ category, slugs: [] });
    }
  });

  it('every filter chip is a real Go slug', () => {
    for (const [category, chips] of Object.entries(SUBCATEGORIES)) {
      const slugs = go[category] ?? [];
      const extra = chips.map((c) => c.value).filter((v) => !slugs.includes(v));
      expect({ category, extra }).toEqual({ category, extra: [] });
    }
  });

  it('every Go slug has an icon', () => {
    const missing = Object.values(go)
      .flat()
      .filter((slug) => !SUBTYPE_ICONS[slug]);
    expect(missing).toEqual([]);
  });
});
