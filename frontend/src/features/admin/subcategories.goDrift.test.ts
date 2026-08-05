/** Drift guard between this admin surface's subtype taxonomy and its source
 * of truth, `backend/shared/models/activitiessvc/activity.go`'s
 * `Subcategories` map.
 *
 * The failure this prevents is silent and expensive: a slug the backend
 * stores but `constants.ts` omits is data the admin can never assign, and
 * nothing else in the stack complains. Bars sat at 0 subtyped rows for a week
 * partly because nothing checked mirrors like this one.
 *
 * Extraction is regex over gofmt-ed Go, not a real parser — the map is one
 * flat line per category. The risk that carries (a rename or reformat
 * silently breaking the regex) is why the extraction asserts a non-zero
 * category count and a known-present slug. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUBCATEGORIES } from './constants';

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

  it('every Go slug has an admin option', () => {
    for (const [category, slugs] of Object.entries(go)) {
      const options = (SUBCATEGORIES[category] ?? []).map((o) => o.value);
      expect({ category, slugs: slugs.filter((s) => !options.includes(s)) }).toEqual({ category, slugs: [] });
    }
  });

  it('every admin option is a real Go slug', () => {
    for (const [category, options] of Object.entries(SUBCATEGORIES)) {
      const slugs = go[category] ?? [];
      const extra = options.map((o) => o.value).filter((v) => !slugs.includes(v));
      expect({ category, extra }).toEqual({ category, extra: [] });
    }
  });
});
