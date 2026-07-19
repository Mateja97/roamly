import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BasicsSection } from './BasicsSection';

function basicsProps(overrides: Partial<Parameters<typeof BasicsSection>[0]> = {}) {
  return {
    name: '',
    onNameChange: vi.fn(),
    onNameBlur: vi.fn(),
    category: '',
    onCategoryChange: vi.fn(),
    onCategoryBlur: vi.fn(),
    subcategory: '',
    onSubcategoryChange: vi.fn(),
    city: '',
    onCityChange: vi.fn(),
    description: '',
    onDescriptionChange: vi.fn(),
    ...overrides,
  };
}

function renderBasics(
  overrides: Partial<Parameters<typeof BasicsSection>[0]> = {},
) {
  const props = basicsProps(overrides);
  const { rerender: rerenderRaw } = render(<BasicsSection {...props} />);
  return {
    ...props,
    rerender: (rerenderOverrides: Partial<Parameters<typeof BasicsSection>[0]>) =>
      rerenderRaw(<BasicsSection {...basicsProps(rerenderOverrides)} />),
  };
}

describe('BasicsSection', () => {
  it('renders name/category/subcategory/city/description fields', () => {
    renderBasics();
    expect(screen.getByLabelText('Activity name')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Subcategory')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('Short description')).toBeInTheDocument();
  });

  it('calls onNameBlur/onCategoryBlur on blur (validate on blur)', async () => {
    const user = userEvent.setup();
    const props = renderBasics();
    await user.click(screen.getByLabelText('Activity name'));
    await user.tab();
    expect(props.onNameBlur).toHaveBeenCalled();
  });

  it('shows the required-field errors when given', () => {
    renderBasics({
      nameError: 'Enter an activity name',
      categoryError: 'Choose a category',
    });
    expect(screen.getByText('Enter an activity name')).toBeInTheDocument();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();
  });

  it('category select lists all 13 taxonomy values plus the placeholder', () => {
    renderBasics();
    const select = screen.getByLabelText('Category');
    expect(select.querySelectorAll('option')).toHaveLength(14);
  });

  it('disables every field when disabled', () => {
    renderBasics({ disabled: true });
    expect(screen.getByLabelText('Activity name')).toBeDisabled();
    expect(screen.getByLabelText('Category')).toBeDisabled();
    expect(screen.getByLabelText('Subcategory')).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeDisabled();
    expect(screen.getByLabelText('Short description')).toBeDisabled();
  });

  describe('dependent Subcategory field (T2)', () => {
    it('is disabled and shows only "—" before a category is chosen', () => {
      renderBasics({ category: '' });
      const select = screen.getByLabelText('Subcategory') as HTMLSelectElement;
      expect(select).toBeDisabled();
      expect(select.querySelectorAll('option')).toHaveLength(1);
      expect(select.querySelector('option')).toHaveTextContent('—');
    });

    it('populates with the selected category\'s subtypes, "—" first and selectable', () => {
      renderBasics({ category: 'restaurants' });
      const select = screen.getByLabelText('Subcategory') as HTMLSelectElement;
      expect(select).not.toBeDisabled();
      const options = select.querySelectorAll('option');
      expect(options[0]).toHaveTextContent('—');
      expect(options[0]).not.toBeDisabled();
      expect(screen.getByText('Fine Dining')).toBeInTheDocument();
    });

    it('options track the selected category — switching category swaps the option set', () => {
      const { rerender } = renderBasics({ category: 'restaurants' });
      expect(screen.getByText('Fine Dining')).toBeInTheDocument();

      rerender({ category: 'sport' });
      expect(screen.queryByText('Fine Dining')).toBeNull();
      expect(screen.getByText('Gym/Fitness Studio')).toBeInTheDocument();
    });
  });
});
