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
];

describe('DETAILS_SCHEMA', () => {
  it('has an entry for every one of the 12 categories with a bespoke details shape', () => {
    // tours_experiences (T2, the 13th category) is deliberately excluded —
    // it uses the default/empty detail rendering, no bespoke UI (out of
    // scope per product-tasks.md T1/T2).
    for (const { value } of CATEGORY_OPTIONS) {
      if (value === 'tours_experiences') continue;
      expect(DETAILS_SCHEMA[value]).toBeDefined();
      expect(DETAILS_SCHEMA[value].length).toBeGreaterThan(0);
    }
  });

  it('tours_experiences has no bespoke details schema (default/empty rendering)', () => {
    expect(DETAILS_SCHEMA.tours_experiences).toBeUndefined();
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

  it('offers no price or scraped-duration input for any category (T4 purge)', () => {
    const removedKeys = [
      'price_tier',
      'entry_price',
      'ticket_price',
      'price',
      'duration',
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

  it('popular_dishes/on_the_bar/treatments/upcoming_shows keep line-items (not chips) with only their surviving fields', () => {
    const byKey = (category: string, key: string) =>
      DETAILS_SCHEMA[category].find((f) => f.key === key);
    const dishes = byKey('restaurants', 'popular_dishes');
    const bar = byKey('cafes', 'on_the_bar');
    const treatments = byKey('wellness', 'treatments');
    const shows = byKey('entertainment', 'upcoming_shows');

    expect(dishes?.control).toBe('line-items');
    expect(dishes?.itemFields).toEqual([
      { key: 'name', label: 'Name', required: true },
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
});
