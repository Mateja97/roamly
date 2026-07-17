import { useId } from 'react';

export interface TextareaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** Form field (admin) — textarea variant: same recipe as `TextField`, grown
 * min-height, vertically resizable. */
export function TextareaField({
  label,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  placeholder,
}: TextareaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="admin-field admin-field-full">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`admin-field-textarea ${error ? 'admin-field-input-invalid' : ''}`}
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
