import { useId, type Ref } from 'react';

export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: SelectFieldOption[];
  /** Shown as a disabled placeholder option when `value` is empty — used
   * for a required select with no default (Category in create mode). */
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/** Form field (admin) — select variant. A native `<select>` (keyboard + AT
 * for free), same label/error/disabled treatment as `TextField`. */
export function SelectField({
  label,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  error,
  disabled,
  ref,
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        ref={ref}
        className={`admin-field-select ${error ? 'admin-field-input-invalid' : ''}`}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span id={errorId} className="admin-field-error">
        {error ?? ''}
      </span>
    </div>
  );
}
