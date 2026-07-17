import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BasicsSection } from './BasicsSection';

function renderBasics(
  overrides: Partial<Parameters<typeof BasicsSection>[0]> = {},
) {
  const props = {
    name: '',
    onNameChange: vi.fn(),
    onNameBlur: vi.fn(),
    category: '',
    onCategoryChange: vi.fn(),
    onCategoryBlur: vi.fn(),
    city: '',
    onCityChange: vi.fn(),
    description: '',
    onDescriptionChange: vi.fn(),
    ...overrides,
  };
  render(<BasicsSection {...props} />);
  return props;
}

describe('BasicsSection', () => {
  it('renders name/category/city/description fields', () => {
    renderBasics();
    expect(screen.getByLabelText('Activity name')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
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

  it('category select lists all 12 taxonomy values plus the placeholder', () => {
    renderBasics();
    const select = screen.getByLabelText('Category');
    expect(select.querySelectorAll('option')).toHaveLength(13);
  });

  it('disables every field when disabled', () => {
    renderBasics({ disabled: true });
    expect(screen.getByLabelText('Activity name')).toBeDisabled();
    expect(screen.getByLabelText('Category')).toBeDisabled();
    expect(screen.getByLabelText('City')).toBeDisabled();
    expect(screen.getByLabelText('Short description')).toBeDisabled();
  });
});
