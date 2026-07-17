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
  it('has an entry for every one of the 12 taxonomy categories', () => {
    for (const { value } of CATEGORY_OPTIONS) {
      expect(DETAILS_SCHEMA[value]).toBeDefined();
      expect(DETAILS_SCHEMA[value].length).toBeGreaterThan(0);
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
});
