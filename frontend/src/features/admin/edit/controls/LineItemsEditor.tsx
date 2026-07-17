import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { SubField } from '../detailsSchema';

export interface LineItemsEditorProps {
  label: string;
  /** Singular noun for "No <items> yet" / "+ Add <item>" copy. */
  itemLabel: string;
  fields: SubField[];
  value: Record<string, string>[];
  onChange: (value: Record<string, string>[]) => void;
  disabled?: boolean;
  /** Overrides the generic "No <item>s yet" empty-state copy. */
  emptyHint?: string;
  /** Overrides the generic "Remove <item>" button aria-label — e.g. a
   * numbered "Remove hours row N" when rows can look identical. */
  removeLabel?: (index: number) => string;
  /** Shows every required sub-field's error regardless of blur — set once
   * a Save attempt has been blocked, so the admin sees every problem, not
   * just the one they last touched. */
  forceErrors?: boolean;
}

/** Repeatable line-item editor (admin) — an array-of-objects `details`
 * value (dishes/lineup/treatments/shows/opening-hours periods). Each row is
 * its sub-fields as Form field inputs (text by default; a sub-field can ask
 * for a native `select` or `time` control instead); required sub-fields
 * validate on blur. */
export function LineItemsEditor({
  label,
  itemLabel,
  fields,
  value,
  onChange,
  disabled,
  emptyHint,
  removeLabel,
  forceErrors,
}: LineItemsEditorProps) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(value.length);

  useEffect(() => {
    if (value.length > prevLength.current) {
      const rows = containerRef.current?.querySelectorAll<HTMLElement>(
        '.admin-line-item-row',
      );
      rows?.[rows.length - 1]
        ?.querySelector<HTMLElement>('select, input')
        ?.focus();
    }
    prevLength.current = value.length;
  }, [value.length]);

  function updateRow(index: number, key: string, fieldValue: string) {
    onChange(
      value.map((row, i) =>
        i === index ? { ...row, [key]: fieldValue } : row,
      ),
    );
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addRow() {
    const row: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.defaultValue) row[f.key] = f.defaultValue;
    });
    onChange([...value, row]);
  }

  return (
    <div className="admin-field admin-field-full" ref={containerRef}>
      <span className="admin-field-label" id={`${label}-items-label`}>
        {label}
      </span>
      <div role="group" aria-labelledby={`${label}-items-label`}>
        {value.length === 0 && (
          <p className="admin-line-items-hint">
            {emptyHint ?? `No ${itemLabel}s yet`}
          </p>
        )}
        {value.map((row, index) => (
          <div className="admin-line-item-row" key={index}>
            {fields.map((f) => {
              const touchKey = `${index}-${f.key}`;
              const isEmpty = !(row[f.key] ?? '').trim();
              const showError =
                f.required && isEmpty && (touched.has(touchKey) || forceErrors);
              const error = showError
                ? (f.requiredMessage ?? `${f.label} is required`)
                : undefined;
              const inputId = `${label}-${index}-${f.key}`;
              return (
                <div className="admin-field" key={f.key}>
                  <label className="admin-field-label" htmlFor={inputId}>
                    {f.label}
                  </label>
                  {f.control === 'select' ? (
                    <select
                      id={inputId}
                      className={`admin-field-select ${error ? 'admin-field-input-invalid' : ''}`}
                      value={row[f.key] ?? ''}
                      disabled={disabled}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => updateRow(index, f.key, e.target.value)}
                      onBlur={() =>
                        setTouched((s) => new Set(s).add(touchKey))
                      }
                    >
                      {(f.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={inputId}
                      type={f.control === 'time' ? 'time' : 'text'}
                      className={`admin-field-input ${error ? 'admin-field-input-invalid' : ''}`}
                      value={row[f.key] ?? ''}
                      disabled={disabled}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => updateRow(index, f.key, e.target.value)}
                      onBlur={() =>
                        setTouched((s) => new Set(s).add(touchKey))
                      }
                    />
                  )}
                  <span className="admin-field-error">{error ?? ''}</span>
                </div>
              );
            })}
            <div className="admin-line-item-remove-wrap">
              <span
                className="admin-field-label admin-line-item-remove-label"
                aria-hidden="true"
              >
                &nbsp;
              </span>
              <button
                type="button"
                className="admin-line-item-remove"
                aria-label={removeLabel ? removeLabel(index) : `Remove ${itemLabel}`}
                disabled={disabled}
                onClick={() => removeRow(index)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="admin-chip-add admin-line-item-add"
          disabled={disabled}
          onClick={addRow}
        >
          <span aria-hidden="true">+</span> Add {itemLabel}
        </button>
      </div>
    </div>
  );
}
