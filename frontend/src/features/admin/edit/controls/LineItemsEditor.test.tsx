import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineItemsEditor } from './LineItemsEditor';

const FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'price', label: 'Price', required: true },
];

describe('LineItemsEditor', () => {
  it('empty state shows the "No <item>s yet" hint plus Add', () => {
    render(
      <LineItemsEditor
        label="Popular dishes"
        itemLabel="dish"
        fields={FIELDS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No dishs yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add dish/ }),
    ).toBeInTheDocument();
  });

  it('renders one row per item with its sub-fields', () => {
    render(
      <LineItemsEditor
        label="Popular dishes"
        itemLabel="dish"
        fields={FIELDS}
        value={[{ name: 'Ćevapi', price: '600 RSD' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Ćevapi')).toBeInTheDocument();
    expect(screen.getByDisplayValue('600 RSD')).toBeInTheDocument();
  });

  it('Add appends a blank row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LineItemsEditor
        label="Popular dishes"
        itemLabel="dish"
        fields={FIELDS}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Add dish/ }));
    expect(onChange).toHaveBeenCalledWith([{}]);
  });

  it('Remove drops that row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LineItemsEditor
        label="Popular dishes"
        itemLabel="dish"
        fields={FIELDS}
        value={[{ name: 'A' }, { name: 'B' }]}
        onChange={onChange}
      />,
    );
    const removeButtons = screen.getAllByRole('button', {
      name: 'Remove dish',
    });
    await user.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([{ name: 'B' }]);
  });

  it('a required sub-field shows an error only after blur, and not before', async () => {
    const user = userEvent.setup();
    render(
      <LineItemsEditor
        label="Popular dishes"
        itemLabel="dish"
        fields={FIELDS}
        value={[{ name: '', price: '' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('textbox')[0]);
    await user.tab();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  const HOURS_FIELDS = [
    {
      key: 'day',
      label: 'Day',
      control: 'select' as const,
      options: [
        { value: 'monday', label: 'Monday' },
        { value: 'tuesday', label: 'Tuesday' },
      ],
      defaultValue: 'monday',
    },
    {
      key: 'open',
      label: 'Opens',
      control: 'time' as const,
      required: true,
      requiredMessage: 'Enter a time',
    },
  ];

  it('a "select" sub-field renders a native <select> with its options', () => {
    render(
      <LineItemsEditor
        label="Weekly hours"
        itemLabel="day"
        fields={HOURS_FIELDS}
        value={[{ day: 'tuesday', open: '09:00' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Day').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Day')).toHaveValue('tuesday');
  });

  it('a "time" sub-field renders a native time input', () => {
    render(
      <LineItemsEditor
        label="Weekly hours"
        itemLabel="day"
        fields={HOURS_FIELDS}
        value={[{ day: 'monday', open: '09:00' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Opens')).toHaveAttribute('type', 'time');
  });

  it('a fresh row seeds each sub-field default (Day defaults to Monday)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LineItemsEditor
        label="Weekly hours"
        itemLabel="day"
        fields={HOURS_FIELDS}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Add day/ }));
    expect(onChange).toHaveBeenCalledWith([{ day: 'monday' }]);
  });

  it('emptyHint and removeLabel override the generic copy when provided', () => {
    render(
      <LineItemsEditor
        label="Weekly hours"
        itemLabel="day"
        fields={HOURS_FIELDS}
        value={[{ day: 'monday', open: '09:00' }]}
        onChange={vi.fn()}
        emptyHint="No hours yet"
        removeLabel={(i) => `Remove hours row ${i + 1}`}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Remove hours row 1' }),
    ).toBeInTheDocument();
  });

  it('forceErrors shows a required error before any blur', () => {
    render(
      <LineItemsEditor
        label="Weekly hours"
        itemLabel="day"
        fields={HOURS_FIELDS}
        value={[{ day: 'monday', open: '' }]}
        onChange={vi.fn()}
        forceErrors
      />,
    );
    expect(screen.getByText('Enter a time')).toBeInTheDocument();
  });
});
