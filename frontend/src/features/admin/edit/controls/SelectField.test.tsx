import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectField } from './SelectField';

const OPTIONS = [
  { value: 'restaurants', label: 'Restaurants' },
  { value: 'cafes', label: 'Cafés' },
];

describe('SelectField', () => {
  it('renders the given options plus an optional disabled placeholder', () => {
    render(
      <SelectField
        label="Category"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        placeholder="Select a category"
      />,
    );
    const select = screen.getByLabelText('Category');
    expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByText('Select a category')).toBeDisabled();
  });

  it('calls onChange when an option is picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="Category"
        value=""
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Category'), 'cafes');
    expect(onChange).toHaveBeenCalledWith('cafes');
  });

  it('shows invalid state and disabled state', () => {
    render(
      <SelectField
        label="Category"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        error="Choose a category"
        disabled
      />,
    );
    const select = screen.getByLabelText('Category');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toBeDisabled();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();
  });

  it('attaches a forwarded ref for focus-first-invalid', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <SelectField
        label="Category"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        ref={ref}
      />,
    );
    expect(ref.current).toBe(screen.getByLabelText('Category'));
  });
});
