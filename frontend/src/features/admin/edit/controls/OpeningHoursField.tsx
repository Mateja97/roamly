import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { SubField } from '../detailsSchema';
import { BooleanToggle } from './BooleanToggle';
import { TextField } from './TextField';
import { LineItemsEditor } from './LineItemsEditor';

export interface OpeningHoursFormValue {
  timezone: string;
  alwaysOpen: boolean;
  periods: Record<string, string>[];
}

export interface OpeningHoursFieldHandle {
  /** Runs the group's client-side validation, forcing every problem into
   * view (not just the last-touched one) and focusing the first invalid
   * control. Returns whether Save may proceed. */
  validate: () => boolean;
}

export interface OpeningHoursFieldProps {
  label: string;
  periodFields: SubField[];
  value: OpeningHoursFormValue;
  onChange: (value: OpeningHoursFormValue) => void;
  disabled?: boolean;
  ref?: Ref<OpeningHoursFieldHandle>;
}

/** Opening hours group (T2) — composes the Boolean toggle / Form field text
 * input / Repeatable line-item editor recipes into one structured
 * `opening_hours` value, styled like the existing Nested single-object
 * field group (no new recipe, per design-spec.md). */
export function OpeningHoursField({
  label,
  periodFields,
  value,
  onChange,
  disabled,
  ref,
}: OpeningHoursFieldProps) {
  const [timezoneTouched, setTimezoneTouched] = useState(false);
  // Bumped on every failed Save attempt — forces every problem into view
  // (not just the last-touched one) and re-triggers the focus effect below
  // even if the admin clicks Save again without fixing anything.
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const forceErrors = attempt > 0;
  const timezoneMissing =
    !value.alwaysOpen && value.periods.length > 0 && !value.timezone.trim();

  useEffect(() => {
    if (attempt === 0) return;
    containerRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [attempt]);

  useImperativeHandle(
    ref,
    () => ({
      validate: () => {
        if (value.alwaysOpen) return true;
        const timeMissing = value.periods.some(
          (p) => !(p.open ?? '').trim() || !(p.close ?? '').trim(),
        );
        const invalid = timezoneMissing || timeMissing;
        if (invalid) {
          setTimezoneTouched(true);
          setAttempt((n) => n + 1);
        }
        return !invalid;
      },
    }),
    [value, timezoneMissing],
  );

  const timezoneError =
    (timezoneTouched || forceErrors) && timezoneMissing
      ? "Add the venue's timezone"
      : undefined;

  return (
    <div
      className="admin-field admin-field-full admin-object-group"
      ref={containerRef}
    >
      <span className="admin-field-label">{label}</span>
      <BooleanToggle
        label="Open 24/7"
        checked={value.alwaysOpen}
        onChange={(checked) => onChange({ ...value, alwaysOpen: checked })}
        disabled={disabled}
      />
      {value.alwaysOpen ? (
        <p className="admin-object-group-hint">
          Open around the clock — no weekly hours needed.
        </p>
      ) : (
        <>
          <TextField
            label="Timezone"
            value={value.timezone}
            onChange={(timezone) => onChange({ ...value, timezone })}
            onBlur={() => setTimezoneTouched(true)}
            error={timezoneError}
            placeholder="e.g. Europe/Berlin"
            disabled={disabled}
          />
          <LineItemsEditor
            label="Weekly hours"
            itemLabel="day"
            fields={periodFields}
            value={value.periods}
            onChange={(periods) => onChange({ ...value, periods })}
            emptyHint="No hours yet"
            removeLabel={(i) => `Remove hours row ${i + 1}`}
            forceErrors={forceErrors}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
