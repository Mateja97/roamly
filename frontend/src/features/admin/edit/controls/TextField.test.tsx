import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from './TextField';

describe('TextField', () => {
  it('renders a labeled text input at its value', () => {
    render(<TextField label="Cuisine" value="Serbian" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Cuisine')).toHaveValue('Serbian');
  });

  it('calls onChange on keystroke and onBlur on blur (validate-on-blur)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <TextField label="Name" value="" onChange={onChange} onBlur={onBlur} />,
    );
    const input = screen.getByLabelText('Name');
    await user.type(input, 'x');
    expect(onChange).toHaveBeenCalledWith('x');
    await user.tab();
    expect(onBlur).toHaveBeenCalled();
  });

  it('shows the error message and marks aria-invalid when error is set', () => {
    render(
      <TextField
        label="Name"
        value=""
        onChange={vi.fn()}
        error="Enter an activity name"
      />,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter an activity name')).toBeInTheDocument();
  });

  it('reserves the error slot even with no error (no layout jump)', () => {
    render(<TextField label="Name" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Name');
    const errorId = input.getAttribute('aria-describedby');
    expect(document.getElementById(errorId!)).toBeInTheDocument();
  });

  it('disables the input when disabled', () => {
    render(<TextField label="Name" value="" onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('renders a numeric input for type=numeric', () => {
    render(
      <TextField
        label="Difficulty"
        value="3"
        onChange={vi.fn()}
        type="numeric"
      />,
    );
    expect(screen.getByLabelText('Difficulty')).toHaveAttribute(
      'type',
      'number',
    );
  });

  it('attaches a forwarded ref to the input for focus-first-invalid', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Name" value="" onChange={vi.fn()} ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('Name'));
  });
});
