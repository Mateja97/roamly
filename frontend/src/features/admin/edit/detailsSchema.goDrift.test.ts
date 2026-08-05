/** Two-way drift guard between `DETAILS_SCHEMA` and its source of truth,
 * `backend/shared/models/activitiessvc/activity.go`'s 13 `*Details` structs
 * plus the row structs (`ItemPrice`, `LineupItem`, `Show`, `Treatment`,
 * `Banner`, `ArtworkAttribution`, `Period`). `detailsSchema.ts`'s own doc
 * comment already forbids a schema-only key (an input that writes nowhere);
 * this file is what enforces the *other* direction too — a Go field added
 * without a matching editor field now fails `npm test` instead of shipping
 * silently invisible.
 *
 * Extraction is regex over the gofmt-ed Go source, not a real parser (13
 * flat, one-field-per-line structs don't earn a Go-parser dependency). The
 * risk that trade-off carries — a rename/reformat silently breaking the
 * regex — is why every extraction asserts a non-zero field count; see the
 * "does not pass vacuously" tests below for a fixture proving it. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETAILS_SCHEMA } from './detailsSchema';

const GO_FILE = '../backend/shared/models/activitiessvc/activity.go';
const SCHEMA_FILE = 'frontend/src/features/admin/edit/detailsSchema.ts';

/** category -> the Go struct its DETAILS_SCHEMA entry mirrors. Not a
 * mechanical transform of the category slug (Restaurant -> restaurants
 * pluralizes, ToursExperiences -> tours_experiences also snake-cases,
 * Nightlife/Nature/... don't change at all), so this is spelled out rather
 * than derived. */
const CATEGORY_STRUCTS: [category: string, structName: string][] = [
  ['restaurants', 'RestaurantDetails'],
  ['bars', 'BarDetails'],
  ['cafes', 'CafeDetails'],
  ['nightlife', 'NightlifeDetails'],
  ['nature', 'NatureDetails'],
  ['sport', 'SportDetails'],
  ['kids', 'KidsDetails'],
  ['culture', 'CultureDetails'],
  ['art', 'ArtDetails'],
  ['wellness', 'WellnessDetails'],
  ['shopping', 'ShoppingDetails'],
  ['entertainment', 'EntertainmentDetails'],
  ['tours_experiences', 'ToursExperiencesDetails'],
];

/** DETAILS_SCHEMA field key -> the Go row struct its `itemFields` mirrors,
 * for every field whose control is `line-items`, `object-group`, or
 * `opening-hours`. */
const ITEM_STRUCTS: Record<string, string> = {
  popular_dishes: 'ItemPrice',
  on_the_bar: 'ItemPrice',
  lineup: 'LineupItem',
  now_showing: 'Banner',
  current_exhibition: 'Banner',
  artwork: 'ArtworkAttribution',
  treatments: 'Treatment',
  upcoming_shows: 'Show',
  opening_hours: 'Period',
};

/** Go json keys that are legitimately absent from the editor — never a
 * silent omission. Covers exactly the legacy free-text hours fields
 * (dropped by `activity-opening-hours` T5) and the sync-owned blocks
 * (written by the Tripadvisor/Places sync jobs, never admin-authored). */
const NOT_EDITABLE: Record<string, string> = {
  hours: 'legacy free-text hours, dropped by activity-opening-hours T5',
  opens_time: 'legacy free-text hours, dropped by activity-opening-hours T5',
  open_status: 'legacy free-text hours, dropped by activity-opening-hours T5',
  open_tonight: 'legacy free-text hours, dropped by activity-opening-hours T5',
  tripadvisor: 'sync-owned, never admin-authored',
  reviews: 'sync-owned, never admin-authored',
  known_for: 'sync-owned, never admin-authored',
  difficulty_inferred: 'sync-owned, never admin-authored',
};

/** Pulls the `json:"..."` tag names off one `type <structName> struct {
 * ... }` block. Throws (rather than returning `[]`) both when the struct
 * itself can't be found (a rename) and when it's found but yields zero keys
 * (a reformat that breaks the tag pattern) — a silent empty result would
 * make every "Go key missing from schema" check below pass vacuously. */
function extractStructFields(source: string, structName: string): string[] {
  const block = source.match(
    new RegExp(`type ${structName} struct \\{([\\s\\S]*?)\\n\\}`),
  );
  if (!block) {
    throw new Error(
      `${GO_FILE}: struct "${structName}" not found — renamed or removed? Update CATEGORY_STRUCTS/ITEM_STRUCTS in the drift test alongside it.`,
    );
  }
  const keys = [...block[1].matchAll(/json:"([^",]+)/g)].map((m) => m[1]);
  if (keys.length === 0) {
    throw new Error(
      `${GO_FILE}: extracted zero json keys from "${structName}" — the drift test's regex likely broke against a rename/reformat of this struct.`,
    );
  }
  return keys;
}

/** The two-way check itself: every `goKey` is either a `schemaKey` or an
 * explicit `notEditable` entry, and every `schemaKey` is a real `goKey`. */
function twoWayDiff(
  label: string,
  goKeys: string[],
  schemaKeys: string[],
  notEditable: Record<string, string> = {},
): string[] {
  const violations: string[] = [];
  for (const key of goKeys) {
    if (!schemaKeys.includes(key) && !(key in notEditable)) {
      violations.push(
        `${label}.${key}: json tag in ${GO_FILE} has no DETAILS_SCHEMA field for it and is not in NOT_EDITABLE (${SCHEMA_FILE})`,
      );
    }
  }
  for (const key of schemaKeys) {
    if (!goKeys.includes(key)) {
      violations.push(
        `${label}.${key}: DETAILS_SCHEMA field in ${SCHEMA_FILE} has no matching json tag in ${GO_FILE}`,
      );
    }
  }
  return violations;
}

describe('DETAILS_SCHEMA vs activity.go (two-way drift guard)', () => {
  const goSource = readFileSync(GO_FILE, 'utf-8');

  it('CATEGORY_STRUCTS covers every DETAILS_SCHEMA category (and no extra ones)', () => {
    expect(CATEGORY_STRUCTS.map(([category]) => category).sort()).toEqual(
      Object.keys(DETAILS_SCHEMA).sort(),
    );
  });

  it('CATEGORY_STRUCTS covers every *Details struct in activity.go (and no extra ones)', () => {
    const goStructNames = [
      ...goSource.matchAll(/type (\w+Details) struct/g),
    ].map((m) => m[1]);
    expect(CATEGORY_STRUCTS.map(([, structName]) => structName).sort()).toEqual(
      goStructNames.sort(),
    );
  });

  it('every category struct matches its DETAILS_SCHEMA entry in both directions', () => {
    const violations = CATEGORY_STRUCTS.flatMap(([category, structName]) => {
      const goKeys = extractStructFields(goSource, structName);
      const schemaKeys = DETAILS_SCHEMA[category].map((f) => f.key);
      return twoWayDiff(
        `${category} (${structName})`,
        goKeys,
        schemaKeys,
        NOT_EDITABLE,
      );
    });
    expect(violations).toEqual([]);
  });

  it('every itemFields list matches its Go row struct in both directions', () => {
    const violations = Object.entries(DETAILS_SCHEMA).flatMap(
      ([category, fields]) =>
        fields
          .filter((f) => f.itemFields)
          .flatMap((field) => {
            const structName = ITEM_STRUCTS[field.key];
            if (!structName) {
              return [
                `${category}.${field.key}: has itemFields but no entry in this test's ITEM_STRUCTS map — add the Go row struct name`,
              ];
            }
            const goKeys = extractStructFields(goSource, structName);
            const schemaKeys = field.itemFields!.map((f) => f.key);
            return twoWayDiff(
              `${category}.${field.key} (${structName})`,
              goKeys,
              schemaKeys,
            );
          }),
    );
    expect(violations).toEqual([]);
  });

  it('does not pass vacuously when the extraction regex finds zero fields', () => {
    const reformatted = `
type FooDetails struct {
	Name  string
	Price string
}
`;
    expect(() => extractStructFields(reformatted, 'FooDetails')).toThrow(
      /zero json keys/,
    );
  });

  it('does not pass vacuously when the struct itself is renamed away', () => {
    const renamed = `type FooDetailsV2 struct {\n\tName string \`json:"name"\`\n}\n`;
    expect(() => extractStructFields(renamed, 'FooDetails')).toThrow(
      /not found/,
    );
  });

  it('flags a Go field added with no matching schema field or NOT_EDITABLE entry (drift-detection self-test)', () => {
    const violations = twoWayDiff(
      'fixture (FooDetails)',
      ['name', 'newly_added'],
      ['name'],
    );
    expect(violations).toEqual([
      `fixture (FooDetails).newly_added: json tag in ${GO_FILE} has no DETAILS_SCHEMA field for it and is not in NOT_EDITABLE (${SCHEMA_FILE})`,
    ]);
  });

  it('flags a DETAILS_SCHEMA field with no matching Go json tag (drift-detection self-test)', () => {
    const violations = twoWayDiff(
      'fixture (FooDetails)',
      ['name'],
      ['name', 'made_up'],
    );
    expect(violations).toEqual([
      `fixture (FooDetails).made_up: DETAILS_SCHEMA field in ${SCHEMA_FILE} has no matching json tag in ${GO_FILE}`,
    ]);
  });

  it('a NOT_EDITABLE entry suppresses its Go-only key (drift-detection self-test)', () => {
    const violations = twoWayDiff(
      'fixture (FooDetails)',
      ['name', 'hours'],
      ['name'],
      {
        hours: 'legacy free-text hours',
      },
    );
    expect(violations).toEqual([]);
  });
});
