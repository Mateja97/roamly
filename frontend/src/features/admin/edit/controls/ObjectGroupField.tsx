import { useState } from 'react';
import type { SubField } from '../detailsSchema';

export interface ObjectGroupFieldProps {
  label: string;
  fields: SubField[];
  value: Record<string, string> | null;
  onChange: (value: Record<string, string> | null) => void;
  disabled?: boolean;
}

/** Nested single-object field group (admin) — a nullable `*object` detail
 * value (now_showing / artwork / current_exhibition). Present-vs-absent is
 * explicit: absent shows "Not set" + an Add control; present shows the
 * sub-fields + a Remove control that clears the group back to null. */
export function ObjectGroupField({
  label,
  fields,
  value,
  onChange,
  disabled,
}: ObjectGroupFieldProps) {
  const [touched, setTouched] = useState<Set<string>>(new Set());

  if (value === null) {
    return (
      <div className="admin-field admin-field-full admin-object-group">
        <span className="admin-field-label">{label}</span>
        <p className="admin-object-group-hint">Not set</p>
        <button
          type="button"
          className="admin-control-button"
          disabled={disabled}
          onClick={() =>
            onChange(Object.fromEntries(fields.map((f) => [f.key, ''])))
          }
        >
          Add {label}
        </button>
      </div>
    );
  }

  return (
    <div className="admin-field admin-field-full admin-object-group">
      <span className="admin-field-label">{label}</span>
      {fields.map((f) => {
        const isEmpty = !(value[f.key] ?? '').trim();
        const error =
          f.required && touched.has(f.key) && isEmpty
            ? `${f.label} is required`
            : undefined;
        return (
          <div className="admin-field" key={f.key}>
            <label className="admin-field-label" htmlFor={`${label}-${f.key}`}>
              {f.label}
            </label>
            <input
              id={`${label}-${f.key}`}
              className={`admin-field-input ${error ? 'admin-field-input-invalid' : ''}`}
              value={value[f.key] ?? ''}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              onBlur={() => setTouched((s) => new Set(s).add(f.key))}
            />
            <span className="admin-field-error">{error ?? ''}</span>
          </div>
        );
      })}
      <button
        type="button"
        className="admin-control-button"
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        Remove {label}
      </button>
    </div>
  );
}
