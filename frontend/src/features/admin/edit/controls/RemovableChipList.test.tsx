import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RemovableChipList } from './RemovableChipList';

describe('RemovableChipList', () => {
  it('renders each value as a chip with a remove control', () => {
    render(
      <RemovableChipList
        label="Signature pours"
        values={['Negroni', 'Old Fashioned']}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Negroni')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Negroni' }),
    ).toBeInTheDocument();
  });

  it('removing a chip calls onChange without that value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RemovableChipList
        label="Signature pours"
        values={['Negroni', 'Old Fashioned']}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove Negroni' }));
    expect(onChange).toHaveBeenCalledWith(['Old Fashioned']);
  });

  it('activating Add reveals an inline input, Enter commits a new chip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RemovableChipList
        label="Signature pours"
        values={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Add/ }));
    const input = screen.getByLabelText('New Signature pours value');
    await user.type(input, 'Mule{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Mule']);
  });

  it('Escape cancels the add without calling onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RemovableChipList
        label="Signature pours"
        values={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Add/ }));
    const input = screen.getByLabelText('New Signature pours value');
    await user.type(input, 'Mule{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables remove and add controls when disabled', () => {
    render(
      <RemovableChipList
        label="Signature pours"
        values={['Negroni']}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Remove Negroni' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add/ })).toBeDisabled();
  });
});
