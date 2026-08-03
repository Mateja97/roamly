import { ALL_SUBTYPE_SLUGS, SUBTYPE_ICONS } from './subtypeIcons';

describe('subtypeIcons', () => {
  it('has exactly one icon entry per canonical SUBCATEGORIES slug — no missing, no orphaned', () => {
    const mapped = Object.keys(SUBTYPE_ICONS).sort();
    const canonical = [...ALL_SUBTYPE_SLUGS].sort();
    expect(mapped).toEqual(canonical);
  });

  it('covers all 59 subtypes across the 13-category taxonomy', () => {
    expect(ALL_SUBTYPE_SLUGS).toHaveLength(59);
  });
});
