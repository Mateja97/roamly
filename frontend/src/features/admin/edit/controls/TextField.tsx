import { useId, type Ref } from 'react';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /** 'numeric' renders a native number input (Sport.difficulty, Art.year). */
  type?: 'text' | 'numeric';
  ref?: Ref<HTMLInputElement>;
}

/** Form field (admin) — text/numeric input. Default / focus / invalid /
 * disabled per `DESIGN_STANDARDS.md`; the error line is a space-reserved
 * slot so an appearing/clearing message never shifts layout. */
export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  placeholder,
  type = 'text',
  ref,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type={type === 'numeric' ? 'number' : 'text'}
        className={`admin-field-input ${error ? 'admin-field-input-invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <span id={errorId} className="admin-field-error">
        {error ?? ''}
      </span>
    </div>
  );
}
