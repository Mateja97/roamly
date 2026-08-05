import { describe, expect, it } from 'vitest';
import { DETAILS_SCHEMA, type ControlKind } from './detailsSchema';
import { CATEGORY_OPTIONS } from '../constants';

const VALID_CONTROLS: ControlKind[] = [
  'text',
  'numeric',
  'textarea',
  'url',
  'chips',
  'line-items',
  'object-group',
  'opening-hours',
  'select',
];

describe('DETAILS_SCHEMA', () => {
  it('has an entry for every one of the 13 taxonomy categories with a bespoke details shape', () => {
    // tours_experiences (T1, admin-activities-schema-resync) is the 13th
    // category and now has its own schema entry too — no category falls
    // back to the "No additional details" hint anymore.
    for (const { value } of CATEGORY_OPTIONS) {
      expect(DETAILS_SCHEMA[value]).toBeDefined();
      expect(DETAILS_SCHEMA[value].length).toBeGreaterThan(0);
    }
  });

  it('tours_experiences mirrors ToursExperiencesDetails: 3 text, 1 select, 3 chips, 1 textarea', () => {
    const fields = DETAILS_SCHEMA.tours_experiences;
    expect(fields.map((f) => f.key)).toEqual([
      'duration',
      'group_size',
      'languages',
      'difficulty_level',
      'included',
      'not_included',
      'itinerary',
      'meeting_point',
    ]);
    expect(fields.find((f) => f.key === 'difficulty_level')?.control).toBe(
      'select',
    );
    expect(
      fields.find((f) => f.key === 'meeting_point')?.control,
    ).toBe('textarea');
  });

  it("difficulty_level offers a leading '—' plus exactly Easy/Moderate/Challenging", () => {
    const field = DETAILS_SCHEMA.tours_experiences.find(
      (f) => f.key === 'difficulty_level',
    );
    expect(field?.options).toEqual([
      { value: '', label: '—' },
      { value: 'Easy', label: 'Easy' },
      { value: 'Moderate', label: 'Moderate' },
      { value: 'Challenging', label: 'Challenging' },
    ]);
  });

  it('every select field declares options', () => {
    for (const fields of Object.values(DETAILS_SCHEMA)) {
      for (const field of fields) {
        if (field.control === 'select') {
          expect(field.options?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every field uses a valid control kind and a non-empty key/label', () => {
    for (const fields of Object.values(DETAILS_SCHEMA)) {
      for (const field of fields) {
        expect(VALID_CONTROLS).toContain(field.control);
        expect(field.key).not.toHaveLength(0);
        expect(field.label).not.toHaveLength(0);
      }
    }
  });

  it('line-items and object-group fields declare their sub-fields', () => {
    for (const fields of Object.values(DETAILS_SCHEMA)) {
      for (const field of fields) {
        if (
          field.control === 'line-items' ||
          field.control === 'object-group'
        ) {
          expect(field.itemFields?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('wellness.treatments is line-items, not a flat chip list (mock oversimplified it)', () => {
    const treatments = DETAILS_SCHEMA.wellness.find(
      (f) => f.key === 'treatments',
    );
    expect(treatments?.control).toBe('line-items');
  });

  it('nature.good_to_know is chips, not textarea (corrected in the addendum)', () => {
    const goodToKnow = DETAILS_SCHEMA.nature.find(
      (f) => f.key === 'good_to_know',
    );
    expect(goodToKnow?.control).toBe('chips');
  });

  it('still offers no input for the scraped-value keys the Go model itself dropped (detail-price-duration-purge T1)', () => {
    // Unlike price_tier/entry_price/ticket_price/the line-item price/
    // tours_experiences.duration (all reinstated by T1 of
    // admin-activities-schema-resync as real, admin-authored string
    // fields), these keys have no json tag left on any *Details/row struct
    // at all — there's nothing for a schema entry to point at.
    const removedKeys = [
      'time_or_price',
      'price_from',
      'typical_visit',
      'typical_show_length',
    ];
    for (const [category, fields] of Object.entries(DETAILS_SCHEMA)) {
      for (const field of fields) {
        expect(removedKeys).not.toContain(field.key);
        for (const sub of field.itemFields ?? []) {
          expect(removedKeys, `${category}.${field.key}`).not.toContain(
            sub.key,
          );
        }
      }
    }
  });

  it('popular_dishes/on_the_bar/treatments/upcoming_shows keep line-items (not chips), with a price sub-field on the two ItemPrice-backed ones', () => {
    const byKey = (category: string, key: string) =>
      DETAILS_SCHEMA[category].find((f) => f.key === key);
    const dishes = byKey('restaurants', 'popular_dishes');
    const bar = byKey('cafes', 'on_the_bar');
    const treatments = byKey('wellness', 'treatments');
    const shows = byKey('entertainment', 'upcoming_shows');

    expect(dishes?.control).toBe('line-items');
    expect(dishes?.itemFields).toEqual([
      { key: 'name', label: 'Name', required: true },
      { key: 'price', label: 'Price' },
    ]);
    expect(bar?.control).toBe('line-items');
    expect(bar?.itemFields).toEqual(dishes?.itemFields);
    expect(treatments?.itemFields).toEqual([
      { key: 'item', label: 'Item', required: true },
    ]);
    expect(shows?.itemFields).toEqual([
      { key: 'date', label: 'Date', required: true },
      { key: 'title', label: 'Title', required: true },
    ]);
  });

  it('price-ish scalar fields land next to the existing field they relate to, without reordering anything else', () => {
    const keysOf = (category: string) =>
      DETAILS_SCHEMA[category].map((f) => f.key);
    expect(keysOf('restaurants').slice(0, 2)).toEqual([
      'cuisine',
      'price_tier',
    ]);
    expect(keysOf('culture').slice(0, 2)).toEqual([
      'venue_type',
      'ticket_price',
    ]);
    expect(keysOf('art').slice(0, 2)).toEqual(['venue_type', 'ticket_price']);
    expect(keysOf('nightlife')).toContain('entry_price');
  });

  it('wellness and entertainment each gain good_to_know (chips) and opening_hours', () => {
    for (const category of ['wellness', 'entertainment']) {
      const goodToKnow = DETAILS_SCHEMA[category].find(
        (f) => f.key === 'good_to_know',
      );
      const hours = DETAILS_SCHEMA[category].find(
        (f) => f.key === 'opening_hours',
      );
      expect(goodToKnow?.control).toBe('chips');
      expect(hours?.control).toBe('opening-hours');
    }
  });
});
