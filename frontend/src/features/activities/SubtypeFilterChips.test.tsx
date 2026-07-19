import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubtypeFilterChips } from './SubtypeFilterChips';

describe('SubtypeFilterChips', () => {
  it('renders nothing when 0 categories are selected', () => {
    const { container } = render(
      <SubtypeFilterChips categories={[]} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when more than 1 category is selected', () => {
    const { container } = render(
      <SubtypeFilterChips
        categories={['nature', 'sport']}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the subtype chips for the one selected category', () => {
    render(<SubtypeFilterChips categories={['nature']} onChange={vi.fn()} />);
    expect(
      screen.getByRole('group', { name: 'Filter by subtype' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hiking Trail' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Beach' })).toBeInTheDocument();
  });

  it('renders nothing for a category with no known subtypes (defensive fallback)', () => {
    const { container } = render(
      <SubtypeFilterChips categories={['not-a-real-category']} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('multi-selects chips (OR) and reports the full selection on every toggle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SubtypeFilterChips categories={['nature']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Hiking Trail' }));
    expect(onChange).toHaveBeenLastCalledWith(['hiking_trail']);
    expect(screen.getByRole('button', { name: 'Hiking Trail' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Beach' }));
    expect(onChange).toHaveBeenLastCalledWith(['hiking_trail', 'beach']);

    // Toggling back off drops just that one selection (OR set, independent).
    await user.click(screen.getByRole('button', { name: 'Hiking Trail' }));
    expect(onChange).toHaveBeenLastCalledWith(['beach']);
  });

  it('clears the selection and reports [] when the category changes (orphan-clearing)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SubtypeFilterChips categories={['nature']} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Hiking Trail' }));
    expect(
      screen.getByRole('button', { name: 'Hiking Trail' }),
    ).toHaveAttribute('aria-pressed', 'true');

    onChange.mockClear();
    rerender(<SubtypeFilterChips categories={['sport']} onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith([]);
    // Re-appears for the new category with nothing selected.
    expect(
      screen.getByRole('button', { name: 'Gym/Fitness Studio' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Hiking Trail' })).toBeNull();
  });

  it('clears the selection when the category count goes to 0', () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <SubtypeFilterChips categories={['nature']} onChange={onChange} />,
    );
    onChange.mockClear();
    rerender(<SubtypeFilterChips categories={[]} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith([]);
    expect(container).toBeEmptyDOMElement();
  });
});
