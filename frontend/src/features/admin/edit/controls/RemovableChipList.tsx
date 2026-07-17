import { useState } from 'react';
import { X } from 'lucide-react';

export interface RemovableChipListProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

/** Removable chip (admin) — an array-of-strings `details` value, editable
 * as chips plus a dashed "+ Add" affordance that becomes an inline text
 * input on activate (Enter commits, Esc cancels). */
export function RemovableChipList({
  label,
  values,
  onChange,
  disabled,
}: RemovableChipListProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) onChange([...values, trimmed]);
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="admin-field admin-field-full">
      <span className="admin-field-label" id={`${label}-chips-label`}>
        {label}
      </span>
      <div
        className="admin-chip-list"
        role="group"
        aria-labelledby={`${label}-chips-label`}
      >
        {values.map((value, i) => (
          <span className="admin-editable-chip" key={`${value}-${i}`}>
            {value}
            <button
              type="button"
              className="admin-chip-remove"
              aria-label={`Remove ${value}`}
              disabled={disabled}
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            className="admin-chip-add-input"
            value={draft}
            disabled={disabled}
            aria-label={`New ${label} value`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={commit}
          />
        ) : (
          <button
            type="button"
            className="admin-chip-add"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            <span aria-hidden="true">+</span> Add
          </button>
        )}
      </div>
    </div>
  );
}
