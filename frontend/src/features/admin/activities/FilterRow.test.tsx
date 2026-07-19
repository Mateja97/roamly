import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterRow } from './FilterRow';

function renderFilterRow(
  overrides: Partial<Parameters<typeof FilterRow>[0]> = {},
) {
  const props = {
    status: '',
    onStatusChange: vi.fn(),
    category: '',
    onCategoryChange: vi.fn(),
    city: '',
    onCityChange: vi.fn(),
    cityOptions: ['Belgrade', 'Novi Sad'],
    ...overrides,
  };
  render(<FilterRow {...props} />);
  return props;
}

describe('FilterRow', () => {
  it('marks exactly one status chip active', () => {
    renderFilterRow({ status: 'draft' });
    expect(screen.getByRole('button', { name: 'Drafts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking a status chip calls onStatusChange with its value', async () => {
    const user = userEvent.setup();
    const props = renderFilterRow();
    await user.click(screen.getByRole('button', { name: 'Published' }));
    expect(props.onStatusChange).toHaveBeenCalledWith('published');
  });

  it('renders the 13-category taxonomy plus "All categories"', () => {
    renderFilterRow();
    const select = screen.getByRole('combobox', { name: 'Category' });
    expect(select.querySelectorAll('option')).toHaveLength(14);
  });

  it('renders city options plus "All cities" and calls onCityChange', async () => {
    const user = userEvent.setup();
    const props = renderFilterRow();
    const select = screen.getByRole('combobox', { name: 'City' });
    expect(select.querySelectorAll('option')).toHaveLength(3);
    await user.selectOptions(select, 'Belgrade');
    expect(props.onCityChange).toHaveBeenCalledWith('Belgrade');
  });
});
