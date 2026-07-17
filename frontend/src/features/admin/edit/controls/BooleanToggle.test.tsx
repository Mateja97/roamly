import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BooleanToggle } from './BooleanToggle';

describe('BooleanToggle', () => {
  it('renders unchecked with no check glyph', () => {
    render(
      <BooleanToggle label="Open tonight" checked={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Open tonight')).not.toBeChecked();
  });

  it('renders checked with the redundant check glyph', () => {
    const { container } = render(
      <BooleanToggle label="Open tonight" checked onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Open tonight')).toBeChecked();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('toggling calls onChange with the flipped value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BooleanToggle
        label="Open tonight"
        checked={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText('Open tonight'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled prevents interaction', () => {
    render(
      <BooleanToggle
        label="Open tonight"
        checked={false}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText('Open tonight')).toBeDisabled();
  });
});
