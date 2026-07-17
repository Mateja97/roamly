import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextareaField } from './TextareaField';

describe('TextareaField', () => {
  it('renders a labeled textarea at its value', () => {
    render(
      <TextareaField label="Description" value="hello" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Description')).toHaveValue('hello');
  });

  it('calls onChange and onBlur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <TextareaField
        label="Note"
        value=""
        onChange={onChange}
        onBlur={onBlur}
      />,
    );
    const field = screen.getByLabelText('Note');
    await user.type(field, 'x');
    expect(onChange).toHaveBeenCalledWith('x');
    await user.tab();
    expect(onBlur).toHaveBeenCalled();
  });

  it('shows error state and disabled state', () => {
    render(
      <TextareaField
        label="Note"
        value=""
        onChange={vi.fn()}
        error="Required"
        disabled
      />,
    );
    expect(screen.getByLabelText('Note')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Note')).toBeDisabled();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
