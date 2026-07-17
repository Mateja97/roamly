import { Check } from 'lucide-react';
import { useId } from 'react';

export interface BooleanToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Boolean toggle (admin) — the one home for a `bool` detail value
 * (Nightlife.open_tonight). A native checkbox styled light; the check
 * glyph is the redundant non-color cue (checked is never color-only). */
export function BooleanToggle({
  label,
  checked,
  onChange,
  disabled,
}: BooleanToggleProps) {
  const id = useId();
  return (
    <div className="admin-field admin-boolean-toggle">
      <label className="admin-toggle-label" htmlFor={id}>
        <span className="admin-toggle-box">
          <input
            id={id}
            type="checkbox"
            className="admin-toggle-input"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {checked && (
            <Check
              size={14}
              className="admin-toggle-check"
              aria-hidden="true"
            />
          )}
        </span>
        {label}
      </label>
    </div>
  );
}
