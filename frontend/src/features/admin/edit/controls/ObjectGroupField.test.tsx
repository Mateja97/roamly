import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectGroupField } from './ObjectGroupField';

const FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'description', label: 'Description' },
];

describe('ObjectGroupField', () => {
  it('absent (null) shows "Not set" and an Add control, no sub-fields', () => {
    render(
      <ObjectGroupField
        label="Now showing"
        fields={FIELDS}
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Now showing' }),
    ).toBeInTheDocument();
  });

  it('Add reveals the empty sub-fields with an empty object', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ObjectGroupField
        label="Now showing"
        fields={FIELDS}
        value={null}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Now showing' }));
    expect(onChange).toHaveBeenCalledWith({ title: '', description: '' });
  });

  it('present renders sub-fields and a Remove control that clears to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ObjectGroupField
        label="Now showing"
        fields={FIELDS}
        value={{ title: 'Hamlet', description: '' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Hamlet');
    await user.click(
      screen.getByRole('button', { name: 'Remove Now showing' }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('required sub-field validates on blur only while present', async () => {
    const user = userEvent.setup();
    render(
      <ObjectGroupField
        label="Now showing"
        fields={FIELDS}
        value={{ title: '', description: '' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Title'));
    await user.tab();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });
});
