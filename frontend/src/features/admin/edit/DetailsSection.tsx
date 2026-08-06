import type { Ref } from 'react';
import { DETAILS_SCHEMA } from './detailsSchema';
import { TextField } from './controls/TextField';
import { TextareaField } from './controls/TextareaField';
import { SelectField } from './controls/SelectField';
import { RemovableChipList } from './controls/RemovableChipList';
import { LineItemsEditor } from './controls/LineItemsEditor';
import { ObjectGroupField } from './controls/ObjectGroupField';
import {
  OpeningHoursField,
  type OpeningHoursFieldHandle,
  type OpeningHoursFormValue,
} from './controls/OpeningHoursField';

export interface DetailsSectionProps {
  category: string;
  details: Record<string, unknown>;
  onChange: (details: Record<string, unknown>) => void;
  disabled?: boolean;
  openingHoursRef?: Ref<OpeningHoursFieldHandle>;
}

function asString(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function asRecordArray(v: unknown): Record<string, string>[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) =>
    row && typeof row === 'object'
      ? Object.fromEntries(
          Object.entries(row as Record<string, unknown>).map(([k, val]) => [
            k,
            asString(val),
          ]),
        )
      : {},
  );
}

function asObjectOrNull(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object') return null;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, val]) => [
      k,
      asString(val),
    ]),
  );
}

function asOpeningHoursValue(v: unknown): OpeningHoursFormValue {
  if (!v || typeof v !== 'object') {
    return { timezone: '', alwaysOpen: false, periods: [] };
  }
  const obj = v as Record<string, unknown>;
  return {
    timezone: asString(obj.timezone),
    alwaysOpen: Boolean(obj.always_open),
    periods: asRecordArray(obj.periods),
  };
}

/** Renders the selected category's actual `details` shape (per the T4
 * addendum's build-deterministic key -> control table), never the mock's
 * fixed five inputs. Every scalar edit either sets or (when cleared)
 * deletes the key — an empty `website_url` must never be sent as `""`
 * (would fail the server's "absolute URL when present" check), so "empty"
 * means "key absent", matching the model's nullable-pointer convention. */
export function DetailsSection({
  category,
  details,
  onChange,
  disabled,
  openingHoursRef,
}: DetailsSectionProps) {
  const fields = DETAILS_SCHEMA[category] ?? [];

  function setScalar(key: string, raw: string, numeric = false) {
    const next = { ...details };
    if (raw.trim() === '') {
      delete next[key];
    } else {
      next[key] = numeric ? Number(raw) : raw;
    }
    onChange(next);
  }

  function setArrayLike(key: string, value: unknown[]) {
    const next = { ...details };
    if (value.length === 0) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  function setObjectOrNull(key: string, value: Record<string, string> | null) {
    const next = { ...details };
    if (value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  function setOpeningHours(key: string, value: OpeningHoursFormValue) {
    const next = { ...details };
    const isEmpty =
      !value.alwaysOpen && !value.timezone.trim() && value.periods.length === 0;
    if (isEmpty) {
      delete next[key];
    } else {
      next[key] = {
        timezone: value.timezone,
        always_open: value.alwaysOpen,
        periods: value.periods,
      };
    }
    onChange(next);
  }

  if (fields.length === 0) {
    // Defensive fallback only — all 13 taxonomy categories have editable
    // keys, so this path is unreachable for a valid category (an
    // unrecognized string would hit it instead of crashing on a missing
    // schema entry).
    return (
      <section className="admin-card admin-section">
        <h2 className="admin-section-heading">Details</h2>
        <p className="admin-details-empty-hint">
          No additional details for this category
        </p>
      </section>
    );
  }

  return (
    <section className="admin-card admin-section">
      <h2 className="admin-section-heading">Details</h2>
      <div className="admin-details-grid">
        {fields.map((field) => {
          switch (field.control) {
            case 'text':
            case 'url':
              return (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={asString(details[field.key])}
                  onChange={(v) => setScalar(field.key, v)}
                  disabled={disabled}
                />
              );
            case 'numeric':
              return (
                <TextField
                  key={field.key}
                  label={field.label}
                  type="numeric"
                  value={asString(details[field.key])}
                  onChange={(v) => setScalar(field.key, v, true)}
                  disabled={disabled}
                />
              );
            case 'textarea':
              return (
                <TextareaField
                  key={field.key}
                  label={field.label}
                  value={asString(details[field.key])}
                  onChange={(v) => setScalar(field.key, v)}
                  disabled={disabled}
                />
              );
            case 'select':
              return (
                <SelectField
                  key={field.key}
                  label={field.label}
                  value={asString(details[field.key])}
                  onChange={(v) => setScalar(field.key, v)}
                  options={field.options ?? []}
                  disabled={disabled || (field.options ?? []).length === 0}
                />
              );
            case 'chips':
              return (
                <RemovableChipList
                  key={field.key}
                  label={field.label}
                  values={asStringArray(details[field.key])}
                  onChange={(values) => setArrayLike(field.key, values)}
                  disabled={disabled}
                />
              );
            case 'line-items':
              return (
                <LineItemsEditor
                  key={field.key}
                  label={field.label}
                  itemLabel={field.itemLabel ?? 'item'}
                  fields={field.itemFields ?? []}
                  value={asRecordArray(details[field.key])}
                  onChange={(rows) => setArrayLike(field.key, rows)}
                  disabled={disabled}
                />
              );
            case 'object-group':
              return (
                <ObjectGroupField
                  key={field.key}
                  label={field.label}
                  fields={field.itemFields ?? []}
                  value={asObjectOrNull(details[field.key])}
                  onChange={(obj) => setObjectOrNull(field.key, obj)}
                  disabled={disabled}
                />
              );
            case 'opening-hours':
              return (
                <OpeningHoursField
                  key={field.key}
                  label={field.label}
                  periodFields={field.itemFields ?? []}
                  value={asOpeningHoursValue(details[field.key])}
                  onChange={(value) => setOpeningHours(field.key, value)}
                  disabled={disabled}
                  ref={openingHoursRef}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </section>
  );
}
