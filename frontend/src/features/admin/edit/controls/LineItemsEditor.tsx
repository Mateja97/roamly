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
}

/** Repeatable line-item editor (admin) — an array-of-objects `details`
 * value (dishes/lineup/treatments/shows). Each row is its sub-fields as
 * Form field inputs; required sub-fields validate on blur. */
export function LineItemsEditor({
  label,
  itemLabel,
  fields,
  value,
  onChange,
  disabled,
}: LineItemsEditorProps) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(value.length);

  useEffect(() => {
    if (value.length > prevLength.current) {
      const rows = containerRef.current?.querySelectorAll<HTMLElement>(
        '.admin-line-item-row',
      );
      rows?.[rows.length - 1]?.querySelector('input')?.focus();
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
    onChange([...value, {}]);
  }

  return (
    <div className="admin-field admin-field-full" ref={containerRef}>
      <span className="admin-field-label" id={`${label}-items-label`}>
        {label}
      </span>
      <div role="group" aria-labelledby={`${label}-items-label`}>
        {value.length === 0 && (
          <p className="admin-line-items-hint">No {itemLabel}s yet</p>
        )}
        {value.map((row, index) => (
          <div className="admin-line-item-row" key={index}>
            {fields.map((f) => {
              const touchKey = `${index}-${f.key}`;
              const isEmpty = !(row[f.key] ?? '').trim();
              const error =
                f.required && touched.has(touchKey) && isEmpty
                  ? `${f.label} is required`
                  : undefined;
              return (
                <div className="admin-field" key={f.key}>
                  <label
                    className="admin-field-label"
                    htmlFor={`${label}-${index}-${f.key}`}
                  >
                    {f.label}
                  </label>
                  <input
                    id={`${label}-${index}-${f.key}`}
                    className={`admin-field-input ${error ? 'admin-field-input-invalid' : ''}`}
                    value={row[f.key] ?? ''}
                    disabled={disabled}
                    aria-invalid={Boolean(error)}
                    onChange={(e) => updateRow(index, f.key, e.target.value)}
                    onBlur={() => setTouched((s) => new Set(s).add(touchKey))}
                  />
                  <span className="admin-field-error">{error ?? ''}</span>
                </div>
              );
            })}
            <button
              type="button"
              className="admin-line-item-remove"
              aria-label={`Remove ${itemLabel}`}
              disabled={disabled}
              onClick={() => removeRow(index)}
            >
              <X size={16} aria-hidden="true" />
            </button>
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
