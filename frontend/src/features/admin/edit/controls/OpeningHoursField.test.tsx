import { useEffect, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OpeningHoursField,
  type OpeningHoursFieldHandle,
  type OpeningHoursFormValue,
} from './OpeningHoursField';
import { OPENING_HOURS_PERIOD_FIELDS } from '../detailsSchema';

const EMPTY: OpeningHoursFormValue = {
  timezone: '',
  alwaysOpen: false,
  periods: [],
};

/** A thin controlled-state harness — OpeningHoursField itself has no
 * internal value state, matching every other DetailsSection control. */
function Harness({
  initial = EMPTY,
  onValidateHandle,
  disabled,
}: {
  initial?: OpeningHoursFormValue;
  onValidateHandle?: (handle: OpeningHoursFieldHandle | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<OpeningHoursFieldHandle>(null);
  useEffect(() => {
    onValidateHandle?.(ref.current);
  });
  return (
    <OpeningHoursField
      label="Opening hours"
      periodFields={OPENING_HOURS_PERIOD_FIELDS}
      value={value}
      onChange={setValue}
      disabled={disabled}
      ref={ref}
    />
  );
}

describe('OpeningHoursField', () => {
  it('empty state: toggle off, timezone blank, "No hours yet" hint', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Open 24/7')).not.toBeChecked();
    expect(screen.getByLabelText('Timezone')).toHaveValue('');
    expect(screen.getByText('No hours yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add day/ }),
    ).toBeInTheDocument();
  });

  it('populated state: renders saved timezone, always_open and periods', () => {
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '09:00', close: '18:00' }],
        }}
      />,
    );
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Berlin');
    expect(screen.getByLabelText('Day')).toHaveValue('monday');
    expect(screen.getByLabelText('Opens')).toHaveValue('09:00');
    expect(screen.getByLabelText('Closes')).toHaveValue('18:00');
  });

  it('always-open mode hides timezone/weekly hours and shows the hint', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '09:00', close: '18:00' }],
        }}
      />,
    );
    await user.click(screen.getByLabelText('Open 24/7'));
    expect(
      screen.getByText('Open around the clock — no weekly hours needed.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Day')).not.toBeInTheDocument();

    // toggling back off restores what was there — no silent data loss.
    await user.click(screen.getByLabelText('Open 24/7'));
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Berlin');
    expect(screen.getByLabelText('Day')).toHaveValue('monday');
  });

  it('adding a day defaults it to Monday and moves focus to the Day select', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add day/ }));
    expect(screen.getByLabelText('Day')).toHaveValue('monday');
    expect(screen.getByLabelText('Day')).toHaveFocus();
  });

  it('blurring an empty Timezone with a period present shows the error', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          timezone: '',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '09:00', close: '18:00' }],
        }}
      />,
    );
    expect(
      screen.queryByText("Add the venue's timezone"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Timezone'));
    await user.tab();
    expect(screen.getByText("Add the venue's timezone")).toBeInTheDocument();
  });

  it('blurring a blank Opens/Closes shows "Enter a time"', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '', close: '' }],
        }}
      />,
    );
    await user.click(screen.getByLabelText('Opens'));
    await user.tab();
    expect(screen.getAllByText('Enter a time')).toHaveLength(1);
  });

  it('validate() passes and does nothing when always_open is on, even with no timezone', () => {
    let handle: OpeningHoursFieldHandle | null = null;
    render(
      <Harness
        initial={{ timezone: '', alwaysOpen: true, periods: [] }}
        onValidateHandle={(h) => {
          handle = h;
        }}
      />,
    );
    let result: boolean | undefined;
    act(() => {
      result = handle!.validate();
    });
    expect(result).toBe(true);
  });

  it('validate() fails, shows every error, and focuses the first invalid control', () => {
    let handle: OpeningHoursFieldHandle | null = null;
    render(
      <Harness
        initial={{
          timezone: '',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '', close: '18:00' }],
        }}
        onValidateHandle={(h) => {
          handle = h;
        }}
      />,
    );
    let result: boolean | undefined;
    act(() => {
      result = handle!.validate();
    });
    expect(result).toBe(false);
    expect(screen.getByText("Add the venue's timezone")).toBeInTheDocument();
    expect(screen.getByText('Enter a time')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toHaveFocus();
  });

  it('validate() passes with a well-formed timezone + period', () => {
    let handle: OpeningHoursFieldHandle | null = null;
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [{ day: 'monday', open: '09:00', close: '18:00' }],
        }}
        onValidateHandle={(h) => {
          handle = h;
        }}
      />,
    );
    let result: boolean | undefined;
    act(() => {
      result = handle!.validate();
    });
    expect(result).toBe(true);
  });

  it('disabled greys every control', () => {
    render(<Harness disabled />);
    expect(screen.getByLabelText('Open 24/7')).toBeDisabled();
    expect(screen.getByLabelText('Timezone')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add day/ })).toBeDisabled();
  });

  it('removing a row uses the numbered "Remove hours row N" aria-label', () => {
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [
            { day: 'monday', open: '09:00', close: '18:00' },
            { day: 'tuesday', open: '09:00', close: '18:00' },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Remove hours row 1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove hours row 2' }),
    ).toBeInTheDocument();
  });

  it('close earlier than open is never flagged as invalid', () => {
    let handle: OpeningHoursFieldHandle | null = null;
    render(
      <Harness
        initial={{
          timezone: 'Europe/Berlin',
          alwaysOpen: false,
          periods: [{ day: 'friday', open: '20:00', close: '02:00' }],
        }}
        onValidateHandle={(h) => {
          handle = h;
        }}
      />,
    );
    let result: boolean | undefined;
    act(() => {
      result = handle!.validate();
    });
    expect(result).toBe(true);
  });
});
